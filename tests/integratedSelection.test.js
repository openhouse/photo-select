import { it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as midpointCore from '../src/core/planIntegratedSelection.js';
import * as midpointIO from '../scripts/lib/integratedSelection.mjs';
import { planIntegratedSelection, integrationGameStatus } from '../src/core/planIntegratedSelection.js';
import { buildIntegration, verifyIntegration } from '../scripts/lib/integratedSelection.mjs';
const scratch = [];
afterEach(async () => { for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true }); });
const digest = data => createHash('sha256').update(data).digest('hex');
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'integration-test-')); scratch.push(root);
  const previous = path.join(root, '01');
  const sources = [];
  for (const [id, terminalLevel, files] of [['A', 5, [['old.jpg', 'old'], ['a.jpg', 'alpha']]], ['B', 3, [['old.jpg', 'old'], ['b.jpg', 'beta']]]]) {
    const level = terminalLevel - 1;
    const directory = path.join(root, id, `_level-${String(level).padStart(3, '0')}`); await mkdir(directory, { recursive: true });
    const rows = [];
    for (const [filename, body] of files) { await writeFile(path.join(directory, filename), body); rows.push({ filename, sha256: digest(body), bytes: Buffer.byteLength(body) }); }
    sources.push({ id, directory, terminalLevel, level, files: rows });
  }
  const terminalSources = [];
  for (const source of sources) {
    const directory = path.join(path.dirname(source.directory), `_level-${String(source.terminalLevel).padStart(3, '0')}`);
    await mkdir(directory); await writeFile(path.join(directory, 'old.jpg'), 'old');
    terminalSources.push({ ...source, directory, level: source.terminalLevel, files: [source.files[0]] });
  }
  await buildIntegration({ step: 1, sources: terminalSources, decisions: [{ filename: 'old.jpg', decision: 'add', reason: 'Initial selection.' }] }, previous);
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
  await rm(path.join(config.sources[0].directory, 'a.jpg')); config.sources[0].files.pop(); config.decisions.splice(1, 1);
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

it.each([2, 3])('accepts total count %i at the inclusive source-count boundaries', async count => {
  const { config, out } = await fixture(); const source = config.sources[1];
  await writeFile(path.join(source.directory, 'c.jpg'), 'gamma');
  source.files.push({ filename: 'c.jpg', sha256: digest('gamma'), bytes: 5 });
  config.decisions.push({ filename: 'c.jpg', decision: 'aside', reason: 'Source alternative.' });
  if (count === 3) config.decisions[2].decision = 'add';
  const report = await buildIntegration(config, out);
  expect(report.count).toBe(count);
  expect(report.sourceCounts).toEqual([{ id: 'A', count: 2 }, { id: 'B', count: 3 }]);
  expect(report.bounds).toEqual({ minimum: 2, maximum: 3, effectiveMinimum: 2 });
  expect((await verifyIntegration(out)).bounds).toEqual(report.bounds);
});
it.each([
  ['below', c => { c.decisions[1].decision = 'aside'; }, /count 1.*2.*2/i],
  ['above', c => { c.decisions[2].decision = 'add'; }, /count 3.*2.*2/i],
])('rejects a selection %s the bounds without changing the predecessor', async (_label, change, pattern) => {
  const { config, out } = await fixture(); change(config);
  await expect(buildIntegration(config, out)).rejects.toThrow(pattern);
  await expect(readdir(out)).rejects.toThrow();
  expect(await readFile(path.join(config.previous.directory, 'old.jpg'), 'utf8')).toBe('old');
});
it('reports an infeasible inherited count instead of dropping photos or inflating the maximum', async () => {
  const { config, out } = await fixture();
  config.previous.files.push(config.sources[0].files[1], config.sources[1].files[1]);
  config.decisions.forEach(d => { d.decision = 'inherit'; });
  await expect(buildIntegration(config, out)).rejects.toThrow(/infeasible.*3.*maximum 2/i);
  await expect(readdir(out)).rejects.toThrow();
});
it('uses the entire output count and retains the inherited minimum', async () => {
  const { config } = await fixture(); config.previous.files.push(config.sources[0].files[1]);
  config.decisions[1].decision = 'inherit'; config.sources[0].files.pop();
  config.sources[1].files.push(config.previous.files[1]);
  const report = planIntegratedSelection(config);
  expect(report.count).toBe(2); expect(report.addedCount).toBe(0);
  expect(report.bounds).toEqual({ minimum: 1, maximum: 3, effectiveMinimum: 2 });
});
it('rejects duplicate source entries rather than letting them enlarge the count limit', async () => {
  const { config } = await fixture(); config.sources[0].files.push(config.sources[0].files[0]);
  expect(() => planIntegratedSelection(config)).toThrow(/duplicate source/i);
});
it('builds and verifies 01 under the same count rule without a predecessor', async () => {
  const { root, config } = await fixture(); config.step = 1; delete config.previous;
  config.decisions[0].decision = 'add';
  for (const source of config.sources) {
    const old = source.directory; source.level = source.terminalLevel;
    source.directory = path.join(path.dirname(old), `_level-${String(source.level).padStart(3, '0')}`);
    await mkdir(source.directory, { recursive: true });
    for (const row of source.files) await writeFile(path.join(source.directory, row.filename), await readFile(path.join(old, row.filename)));
  }
  const parent = path.join(root, 'revised'); await mkdir(parent); const out = path.join(parent, '01');
  const report = await buildIntegration(config, out);
  expect(report.schemaVersion).toBe(2); expect(report.previousCount).toBe(0); expect(report.count).toBe(2);
  expect((await verifyIntegration(out)).errors).toEqual([]);
  config.decisions[2].decision = 'add';
  expect(() => planIntegratedSelection(config)).toThrow(/count 3.*2.*2/i);
  config.decisions[2].decision = 'aside'; config.previous = { files: [] };
  expect(() => planIntegratedSelection(config)).toThrow(/first.*predecessor/i);
});
it('requires a bounded predecessor receipt even when building 02', async () => {
  const { config, out } = await fixture(); await rm(config.previous.directory + '.integration.json', { force: true });
  await expect(buildIntegration(config, out)).rejects.toThrow(/preceding.*receipt/i);
  await expect(readdir(out)).rejects.toThrow();
});
it('does not certify a legacy receipt as meeting the new rule', async () => {
  const { out, config } = await fixture(); await buildIntegration(config, out);
  const report = JSON.parse(await readFile(out + '.integration.json')); report.schemaVersion = 1;
  await writeFile(out + '.integration.json', JSON.stringify(report));
  expect((await verifyIntegration(out)).errors.join(' ')).toMatch(/legacy|schema|identity/i);
});

it.each([[499, 'continue'], [500, 'complete'], [501, 'complete']])('finishes only a verified level at the threshold: %i', (count, expected) => {
  expect(integrationGameStatus({ count, verified: true })).toBe(expected);
  expect(integrationGameStatus({ count, verified: false })).toBe('needs-verification');
});
it('reports the game state only after successful file verification', async () => {
  const { config, out } = await fixture(); await buildIntegration(config, out);
  expect((await verifyIntegration(out)).gameStatus).toBe('continue');
  await writeFile(path.join(out, 'a.jpg'), 'tampered');
  const report = await verifyIntegration(out);
  expect(report.errors.length).toBeGreaterThan(0); expect(report.gameStatus).not.toBe('complete');
});
it('refuses a new round after a completed 500-photo level without creating output', async () => {
  const { root } = await fixture();
  const first = { step: 1, sources: [], decisions: [] };
  const rows = Array.from({ length: 500 }, (_, i) => ({ filename: `image-${i}.jpg`, sha256: digest('photo'), bytes: 5 }));
  for (const id of ['C', 'D']) {
    const directory = path.join(root, id, '_level-002'); await mkdir(directory, { recursive: true });
    for (const row of rows) await writeFile(path.join(directory, row.filename), 'photo');
    first.sources.push({ id, directory, terminalLevel: 2, level: 2, files: rows });
  }
  first.decisions = rows.map(row => ({ filename: row.filename, decision: 'add', reason: 'Synthetic diverse candidate.' }));
  const parent = path.join(root, 'finished-game'); await mkdir(parent);
  const previous = path.join(parent, '01'); await buildIntegration(first, previous);
  expect((await verifyIntegration(previous)).gameStatus).toBe('complete');
  const next = structuredClone(first); next.step = 2; next.previous = { directory: previous, files: rows };
  next.decisions.forEach(row => { row.decision = 'inherit'; });
  for (const source of next.sources) {
    source.level = 1; source.directory = path.join(path.dirname(source.directory), '_level-001');
    await mkdir(source.directory); for (const row of rows) await writeFile(path.join(source.directory, row.filename), 'photo');
  }
  const out = path.join(parent, '02');
  await expect(buildIntegration(next, out)).rejects.toThrow(/game.*complete.*500/i);
  await expect(readdir(out)).rejects.toThrow();
});

// Intermediate boxes must preserve the lower box and choose only from the upper.
async function midpointFixture() {
  const { config, out, root } = await fixture();
  config.decisions[2].decision = 'add';
  const b = config.sources[1];
  await writeFile(path.join(b.directory, 'c.jpg'), 'gamma');
  b.files.push({ filename: 'c.jpg', sha256: digest('gamma'), bytes: 5 });
  config.decisions.push({ filename: 'c.jpg', decision: 'aside', reason: 'Source alternate.' });
  await buildIntegration(config, out);
  const midpoint = { lower: { directory: config.previous.directory, receiptSha256: digest(await readFile(config.previous.directory + '.integration.json')) },
    upper: { directory: out, receiptSha256: digest(await readFile(out + '.integration.json')) },
    decisions: [{ filename: 'a.jpg', decision: 'add', reason: 'Distinct view.' }, { filename: 'b.jpg', decision: 'aside', reason: 'Retain in the upper box.' }] };
  return { root, config: midpoint, out: path.join(root, '01.5') };
}
it.each([[353, 500, 427], [10, 12, 11], [10, 11, 11], [10, 10, 10]])('rounds the %i/%i midpoint to %i while retaining the entire lower set', (low, high, count) => {
  const rows = Array.from({ length: high }, (_, n) => ({ filename: `${n}.jpg`, bytes: 1, sha256: digest(String(n)) }));
  const plan = midpointCore.planIntermediateSelection({ lower: rows.slice(0, low), upper: rows,
    decisions: rows.slice(low).map((r, i) => ({ filename: r.filename, decision: i < count - low ? 'add' : 'aside', reason: 'Reviewed candidate.' })) });
  expect(plan.count).toBe(count); expect(plan.previousCount).toBe(low);
  expect(plan.photos.filter(p => p.inherited).map(p => p.filename).sort()).toEqual(rows.slice(0, low).map(p => p.filename).sort());
});
it('builds and verifies an intermediate box without altering either endpoint', async () => {
  const { config, out } = await midpointFixture();
  const report = await midpointIO.buildIntermediateSelection(config, out);
  expect(report.count).toBe(2); expect(report.addedCount).toBe(1);
  expect((await readdir(out)).sort()).toEqual(['a.jpg', 'old.jpg']);
  expect((await readdir(config.lower.directory)).sort()).toEqual(['old.jpg']);
  expect((await readdir(config.upper.directory)).sort()).toEqual(['a.jpg', 'b.jpg', 'old.jpg']);
  expect(await readFile(path.join(out, 'a.jpg'), 'utf8')).toBe('alpha');
  expect((await midpointIO.verifyIntermediateSelection(out)).errors).toEqual([]);
});
it.each([
  ['wrong count', c => { c.decisions[1].decision = 'add'; }, /count|midpoint/i],
  ['missing disposition', c => { c.decisions.pop(); }, /coverage|decision/i],
  ['unknown photo', c => { c.decisions[1].filename = '../extra.jpg'; }, /unknown|candidate/i],
  ['duplicate decision', c => { c.decisions[1] = c.decisions[0]; }, /duplicate/i],
  ['blank reason', c => { c.decisions[0].reason = ''; }, /reason/i],
  ['invalid disposition', c => { c.decisions[0].decision = 'inherit'; }, /decision/i],
  ['changed source receipt', c => { c.upper.receiptSha256 = '0'.repeat(64); }, /receipt/i],
  ['reversed endpoints', c => { [c.lower, c.upper] = [c.upper, c.lower]; }, /consecutive|endpoint/i],
])('refuses midpoint %s before creating output', async (_name, change, pattern) => {
  const { config, out } = await midpointFixture(); change(config);
  await expect(midpointIO.buildIntermediateSelection(config, out)).rejects.toThrow(pattern);
  await expect(readdir(out)).rejects.toThrow();
});
it('rejects an upper set missing or changing an inherited photo', () => {
  const row = { filename: 'old.jpg', sha256: digest('old'), bytes: 3 };
  for (const upper of [[], [{ ...row, sha256: digest('new') }]]) {
    expect(() => midpointCore.planIntermediateSelection({ lower: [row], upper, decisions: [] })).toThrow(/subset|changed/i);
  }
});
it.each(['missing', 'changed', 'extra', 'symlink', 'receipt'])('midpoint verification detects %s output', async mode => {
  const { config, out } = await midpointFixture(); await midpointIO.buildIntermediateSelection(config, out);
  const file = path.join(out, 'a.jpg');
  if (mode === 'missing') await rm(file);
  if (mode === 'changed') await writeFile(file, 'bad');
  if (mode === 'extra') await writeFile(path.join(out, 'extra.jpg'), 'bad');
  if (mode === 'symlink') { await rm(file); await symlink(path.join(config.upper.directory, 'a.jpg'), file); }
  if (mode === 'receipt') { const p = out + '.interpolation.json'; const receipt = JSON.parse(await readFile(p)); receipt.count++; await writeFile(p, JSON.stringify(receipt)); }
  expect((await midpointIO.verifyIntermediateSelection(out)).errors.length).toBeGreaterThan(0);
});
it('refuses to overwrite a midpoint and detects subsequent endpoint drift', async () => {
  const { config, out } = await midpointFixture(); await midpointIO.buildIntermediateSelection(config, out);
  await expect(midpointIO.buildIntermediateSelection(config, out)).rejects.toThrow(/exists/i);
  await writeFile(path.join(config.upper.directory, 'b.jpg'), 'changed unselected source');
  expect((await midpointIO.verifyIntermediateSelection(out)).errors.length).toBeGreaterThan(0);
});
it('runs the intermediate CLI and returns failure for a tampered copy', async () => {
  const { config, out, root } = await midpointFixture(); const input = path.join(root, 'midpoint.json');
  await writeFile(input, JSON.stringify(config)); const cli = path.resolve('scripts/interpolate-selection.mjs');
  expect(JSON.parse(execFileSync(process.execPath, [cli, 'build', input, out], { encoding: 'utf8' })).count).toBe(2);
  await writeFile(path.join(out, 'a.jpg'), 'bad');
  expect(() => execFileSync(process.execPath, [cli, 'verify', out], { stdio: 'pipe' })).toThrow();
});
