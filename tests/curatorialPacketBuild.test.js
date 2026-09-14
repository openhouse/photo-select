import { it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { buildPacket, verifyPacket } from '../scripts/lib/curatorialPacket.mjs';
const scratch = [];
afterEach(async () => { for (const p of scratch.splice(0)) await rm(p, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'packet-test-')); scratch.push(root);
  const input = path.join(root, 'input'); await mkdir(input);
  const body = '# Witness\nAn unresolved speaker describes access.\n[Related](second.md)\n';
  await writeFile(path.join(input, 'first.md'), body);
  await writeFile(path.join(input, 'second.md'), '# Another edition\nA different account.\n');
  const records = await Promise.all(['first.md', 'second.md'].map(async file => {
    const bytes = await readFile(path.join(input, file));
    return { packet: 'A', path: file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, mode: 'exact' };
  }));
  const config = { title: 'Synthetic archive', date: '2026-09-13', roots: { A: input }, records,
    requests: [{ path: 'requests/originals/request.txt', text: 'Prepare an archival palette.' }],
    pages: [{ path: 'START-HERE.md', title: 'Start', body: '[Read the source](@{A:first.md})' }],
    claims: [{ id: 'claim-1', text: 'One attributed account concerns access.', sourceRefs: ['A:first.md'], state: 'attributed-report' }],
    retrievalCases: [{ id: 'access', start: 'START-HERE.md', sourceRef: 'A:first.md', contains: ['unresolved speaker describes access'] }] };
  return { root, input, config, out: path.join(root, 'output') };
}
it('builds portable readings and validates the actual unchanged package', async () => {
  const { config, out } = await fixture(); const result = await buildPacket(config, out);
  expect(result.sources).toBe(2);
  const report = await verifyPacket(out); expect(report.errors).toEqual([]); expect(report.retrievalPassed).toBe(1);
  const index = JSON.parse(await readFile(path.join(out, 'manifests/catalog.json'), 'utf8'));
  const text = await readFile(path.join(out, index[0].reading), 'utf8');
  expect(text).toContain('Preserved document');
  expect(text).not.toContain('](second.md)');
});
it('refuses to overwrite an existing directory', async () => {
  const { config, out } = await fixture(); await mkdir(out);
  await expect(buildPacket(config, out)).rejects.toThrow(/exist/i);
});
it('rejects drift in a frozen source before writing a packet', async () => {
  const { config, input, out } = await fixture(); await writeFile(path.join(input, 'first.md'), 'changed');
  await expect(buildPacket(config, out)).rejects.toThrow(/source.*changed/i);
});
it('rejects a symlink source even when its bytes match', async () => {
  const { config, input, out } = await fixture(); await symlink('first.md', path.join(input, 'link.md')); config.records[0].path = 'link.md';
  await expect(buildPacket(config, out)).rejects.toThrow(/symlink/i);
});
it('detects tampered exact bytes and stale candidate evidence', async () => {
  const { config, out } = await fixture(); await buildPacket(config, out);
  const catalog = JSON.parse(await readFile(path.join(out, 'manifests/catalog.json'), 'utf8'));
  await writeFile(path.join(out, catalog[0].path), 'altered');
  expect((await verifyPacket(out)).errors.length).toBeGreaterThan(0);
});
it('roundtrips compressed support material without presenting it as a source reading', async () => {
  const { config, out } = await fixture(); config.records[1].mode = 'gzip';
  await buildPacket(config, out); const catalog = JSON.parse(await readFile(path.join(out, 'manifests/catalog.json'), 'utf8'));
  expect(catalog.find(s => s.mode === 'gzip').path).toMatch(/\.gz$/);
  expect((await verifyPacket(out)).errors).toEqual([]);
});
it('fails an independent retrieval case when the referenced source lacks the expected passage', async () => {
  const { config, out } = await fixture(); config.retrievalCases[0].contains = ['invented passage'];
  await buildPacket(config, out); expect((await verifyPacket(out)).errors).toContain('retrieval:access');
});
it('reports a missing source body without accepting the stale receipt', async () => {
  const { config, out } = await fixture(); await buildPacket(config, out);
  const catalog = JSON.parse(await readFile(path.join(out, 'manifests/catalog.json'), 'utf8'));
  await rm(path.join(out, catalog[0].path));
  expect((await verifyPacket(out)).errors).toContain('missing-source');
});
it('reports a damaged compressed source as a verification failure', async () => {
  const { config, out } = await fixture(); config.records[1].mode = 'gzip'; await buildPacket(config, out);
  const catalog = JSON.parse(await readFile(path.join(out, 'manifests/catalog.json'), 'utf8'));
  await writeFile(path.join(out, catalog.find(s => s.mode === 'gzip').path), 'invalid gzip');
  expect((await verifyPacket(out)).errors).toContain('source-unreadable');
});
it('does not leave a published directory when its byte budget fails', async () => {
  const { config, out } = await fixture(); config.maxBytes = 10;
  await expect(buildPacket(config, out)).rejects.toThrow(/size limit/);
  await expect(readFile(path.join(out, 'START-HERE.md'))).rejects.toThrow();
});
it('detects a removed verbatim request and an authored dead link', async () => {
  const { config, out } = await fixture(); config.pages[0].body += '\n[Missing](absent.md)'; await buildPacket(config, out);
  await rm(path.join(out, 'requests/originals/request.txt'));
  const errors = (await verifyPacket(out)).errors;
  expect(errors).toContain('changed:requests/originals/request.txt');
  expect(errors).toContain('link:START-HERE.md:absent.md');
});
it('groups unresolved links by originating source while preserving every target', async () => {
  const { config, input, out } = await fixture();
  const body = '# Witness\nAn unresolved speaker describes access.\n[One](missing-one.md) [Two](missing-two.md)';
  await writeFile(path.join(input, 'first.md'), body);
  config.records[0].bytes = Buffer.byteLength(body);
  config.records[0].sha256 = createHash('sha256').update(body).digest('hex');
  await buildPacket(config, out);
  const refs = await readdir(path.join(out, 'wiki/references')); expect(refs).toHaveLength(1);
  const page = await readFile(path.join(out, 'wiki/references', refs[0]), 'utf8');
  expect(page).toContain('missing-one.md'); expect(page).toContain('missing-two.md');
  expect((await verifyPacket(out)).errors).toEqual([]);
});
it('preserves enough build configuration to reproduce the same candidate in another directory', async () => {
  const { config, out, root } = await fixture();
  const first = await buildPacket(config, out);
  const frozen = JSON.parse(await readFile(path.join(out, 'manifests/input-inventory.json'), 'utf8'));
  const second = await buildPacket(frozen, path.join(root, 'rebuild'));
  expect(second.fingerprint).toBe(first.fingerprint);
  expect(frozen.requests).toEqual(config.requests);
});
it('retains the complete machine navigation ledger in reversible compression', async () => {
  const { config, out } = await fixture(); await buildPacket(config, out);
  const rows = JSON.parse(gunzipSync(await readFile(path.join(out, 'manifests/navigation.json.gz'))));
  expect(rows).toContainEqual({ from: config.records[0].sha256, target: 'second.md', state: 'matched', matches: [config.records[1].sha256] });
  expect((await verifyPacket(out)).errors).toEqual([]);
});
