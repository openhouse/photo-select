import { it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildIntegration, verifyIntegration } from '../scripts/lib/integratedSelection.mjs';
const scratch = [];
afterEach(async () => { for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true }); });
const digest = data => createHash('sha256').update(data).digest('hex');
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'integration-test-')); scratch.push(root);
  const previous = path.join(root, '01'); await mkdir(previous);
  const sources = [];
  for (const [id, terminalLevel, files] of [['A', 5, [['old.jpg', 'old'], ['a.jpg', 'alpha']]], ['B', 3, [['old.jpg', 'old'], ['b.jpg', 'beta']]]]) {
    const level = terminalLevel - 1;
    const directory = path.join(root, id, `_level-${String(level).padStart(3, '0')}`); await mkdir(directory, { recursive: true });
    const rows = [];
    for (const [filename, body] of files) { await writeFile(path.join(directory, filename), body); rows.push({ filename, sha256: digest(body), bytes: Buffer.byteLength(body) }); }
    sources.push({ id, directory, terminalLevel, level, files: rows });
  }
  await writeFile(path.join(previous, 'old.jpg'), 'old');
  const config = { step: 2, previous: { directory: previous, files: [sources[0].files[0]] }, sources,
    decisions: [{ filename: 'old.jpg', decision: 'inherit', reason: 'Preserve preceding selection.' }, { filename: 'a.jpg', decision: 'add', reason: 'Adds a distinct view.' }, { filename: 'b.jpg', decision: 'aside', reason: 'Retain as source alternate.' }] };
  return { root, config, out: path.join(root, '02') };
}
it('copies an exact superset, preserves filenames and records both source witnesses without duplication', async () => {
  const { config, out } = await fixture();
  const report = await buildIntegration(config, out);
  expect((await readdir(out)).sort()).toEqual(['a.jpg', 'old.jpg']);
  expect(await readFile(path.join(out, 'old.jpg'), 'utf8')).toBe('old');
  expect(await readFile(path.join(out, 'a.jpg'), 'utf8')).toBe('alpha');
  expect(await readFile(path.join(config.previous.directory, 'old.jpg'), 'utf8')).toBe('old');
  expect(report.photos.find(p => p.filename === 'old.jpg').witnesses.map(w => w.run).sort()).toEqual(['A', 'B']);
  expect(report.previousCount).toBe(1); expect(report.addedCount).toBe(1);
  expect((await verifyIntegration(out)).errors).toEqual([]);
});
it('allows an equal superset when the preceding levels add no selected image', async () => {
  const { config, out } = await fixture(); config.decisions[1].decision = 'aside';
  expect((await buildIntegration(config, out)).count).toBe(1);
});
it.each([
  ['dropping a preceding photograph', c => { c.decisions[0].decision = 'aside'; }, /inherit|preceding/i],
  ['omitting a candidate disposition', c => { c.decisions.pop(); }, /decision|coverage/i],
  ['inventing a filename', c => { c.decisions.push({ filename: 'invented.jpg', decision: 'add', reason: 'x' }); }, /unknown|coverage/i],
  ['duplicating a decision', c => { c.decisions.push(c.decisions[1]); }, /duplicate/i],
  ['omitting a reason', c => { c.decisions[1].reason = ''; }, /reason/i],
  ['selecting the wrong source level', c => { c.sources[0].level--; }, /level/i],
  ['skipping an integration directory', c => { c.step = 3; }, /sibling|step|directory/i],
  ['using a traversal filename', c => { c.sources[0].files[0].filename = '../old.jpg'; }, /filename/i],
])('rejects %s before creating output', async (_name, change, pattern) => {
  const { config, out } = await fixture(); change(config);
  await expect(buildIntegration(config, out)).rejects.toThrow(pattern);
  await expect(readdir(out)).rejects.toThrow();
});
it('rejects same-name different-byte sources rather than silently choosing one', async () => {
  const { config, out } = await fixture();
  await writeFile(path.join(config.sources[1].directory, 'old.jpg'), 'new');
  config.sources[1].files[0].sha256 = digest('new');
  await expect(buildIntegration(config, out)).rejects.toThrow(/conflict/i);
});
it('rejects source drift, including an unselected candidate', async () => {
  const { config, out } = await fixture(); await writeFile(path.join(config.sources[1].directory, 'b.jpg'), 'changed');
  await expect(buildIntegration(config, out)).rejects.toThrow(/changed|hash/i);
});
it('rejects an unrecorded source photo', async () => {
  const { config, out } = await fixture(); await writeFile(path.join(config.sources[0].directory, 'extra.jpg'), 'extra');
  await expect(buildIntegration(config, out)).rejects.toThrow(/inventory/i);
});
it('rejects a changed preceding photo even when the new sources are intact', async () => {
  const { config, out } = await fixture(); await writeFile(path.join(config.previous.directory, 'old.jpg'), 'changed');
  await expect(buildIntegration(config, out)).rejects.toThrow(/changed|hash/i);
});
it('rejects symlink photos before writing output', async () => {
  const { config, out } = await fixture(); const file = path.join(config.sources[0].directory, 'a.jpg');
  await rm(file); await writeFile(path.join(config.sources[0].directory, 'target.txt'), 'alpha'); await symlink('target.txt', file);
  await expect(buildIntegration(config, out)).rejects.toThrow(/symlink|regular/i);
});
it('refuses an existing output without changing it', async () => {
  const { config, out } = await fixture(); await mkdir(out); await writeFile(path.join(out, 'owned.txt'), 'preserve');
  await expect(buildIntegration(config, out)).rejects.toThrow(/exist/i);
  expect(await readFile(path.join(out, 'owned.txt'), 'utf8')).toBe('preserve');
});
it('refuses an existing receipt before creating output', async () => {
  const { config, out } = await fixture(); await writeFile(out + '.integration.json', 'preserve');
  await expect(buildIntegration(config, out)).rejects.toThrow(/exist/i);
  await expect(readdir(out)).rejects.toThrow();
});
it.each(['missing', 'changed', 'extra'])('verification catches %s destination photos', async mode => {
  const { config, out } = await fixture(); await buildIntegration(config, out);
  if (mode === 'missing') await rm(path.join(out, 'old.jpg'));
  if (mode === 'changed') await writeFile(path.join(out, 'old.jpg'), 'damaged');
  if (mode === 'extra') await writeFile(path.join(out, 'extra.jpg'), 'extra');
  expect((await verifyIntegration(out)).errors.length).toBeGreaterThan(0);
});
it('verification catches a changed preceding directory and a missing receipt', async () => {
  const { config, out } = await fixture(); await buildIntegration(config, out);
  await writeFile(path.join(config.previous.directory, 'old.jpg'), 'changed');
  expect((await verifyIntegration(out)).errors.length).toBeGreaterThan(0);
  await rm(out + '.integration.json');
  expect((await verifyIntegration(out)).errors.length).toBeGreaterThan(0);
});
it('rejects case-colliding filenames across source runs on every platform', async () => {
  const { config, out } = await fixture(); const b = config.sources[1];
  await rm(path.join(b.directory, 'b.jpg')); await writeFile(path.join(b.directory, 'A.jpg'), 'beta');
  b.files[1].filename = 'A.jpg'; config.decisions[2].filename = 'A.jpg'; config.decisions[2].decision = 'add';
  await expect(buildIntegration(config, out)).rejects.toThrow(/case|collision/i);
});
it('does not omit a newly discovered preceding photo from the inheritance requirement', async () => {
  const { config, out } = await fixture(); await writeFile(path.join(config.previous.directory, 'late.jpg'), 'late');
  await expect(buildIntegration(config, out)).rejects.toThrow(/inventory/i);
});
it('requires the previous receipt for later integration steps', async () => {
  const { config, out } = await fixture(); await buildIntegration(config, out);
  const next = structuredClone(config); next.step = 3;
  next.previous = { directory: out, files: [...config.previous.files, config.sources[0].files[1]] };
  for (const source of next.sources) {
    const old = source.directory; source.level--;
    source.directory = path.join(path.dirname(old), `_level-${String(source.level).padStart(3, '0')}`);
    await mkdir(source.directory);
    for (const row of source.files) await writeFile(path.join(source.directory, row.filename), await readFile(path.join(old, row.filename)));
  }
  next.decisions[1].decision = 'inherit';
  expect((await buildIntegration(next, path.join(path.dirname(out), '03'))).previousCount).toBe(2);
  await rm(path.join(path.dirname(out), '03'), { recursive: true }); await rm(path.join(path.dirname(out), '03.integration.json'));
  await rm(out + '.integration.json');
  await expect(buildIntegration(next, path.join(path.dirname(out), '03'))).rejects.toThrow(/preceding.*receipt/i);
});
it('runs the real CLI and exits nonzero for a tampered output', async () => {
  const { root, config, out } = await fixture(); const file = path.join(root, 'config.json');
  await writeFile(file, JSON.stringify(config)); const cli = path.resolve('scripts/integrate-selection.mjs');
  const built = JSON.parse(execFileSync(process.execPath, [cli, 'build', file, out], { encoding: 'utf8' }));
  expect(built.count).toBe(2); expect(built.inherited).toBe(1);
  expect(JSON.parse(execFileSync(process.execPath, [cli, 'verify', out], { encoding: 'utf8' })).errors).toEqual([]);
  await writeFile(path.join(out, 'a.jpg'), 'tampered');
  expect(() => execFileSync(process.execPath, [cli, 'verify', out], { stdio: 'pipe' })).toThrow();
});
