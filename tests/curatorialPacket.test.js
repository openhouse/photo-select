import { describe, it, expect } from 'vitest';
import { groupSources, resolveReference, checkManifest } from '../src/core/curatorialPacket.js';

const hash = 'a'.repeat(64);
const otherHash = 'b'.repeat(64);
const row = (packet, file, sha256 = hash, extra = {}) => ({ packet, path: file, sha256, bytes: 8, mode: 'exact', ...extra });

describe('archival source palette contracts', () => {
  it('stores identical bytes once while retaining every source witness', () => {
    const groups = groupSources([row('A', 'one.md'), row('B', 'two.md')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].witnesses.map(x => x.packet)).toEqual(['A', 'B']);
  });
  it('retains differing editions even when their original paths match', () => {
    expect(groupSources([row('A', 'one.md'), row('B', 'one.md', otherHash)])).toHaveLength(2);
  });
  it('does not allow a duplicate exact copy to override a protected disposition', () => {
    expect(groupSources([row('A', 'one.md'), row('B', 'two.md', hash, { mode: 'pointer' })])[0].mode).toBe('pointer');
  });
  it.each(['../escape.md', '/escape.md', 'ok/../../escape.md'])('rejects unsafe source path %s', file => {
    expect(() => groupSources([row('A', file)])).toThrow(/path/i);
  });
  it('resolves original repository links after a source is relocated', () => {
    const source = row('C', 'exact/01/file.md', hash, { logicalPaths: ['wiki/notes/file.md'] });
    const target = row('C', 'exact/02/person.md', otherHash, { logicalPaths: ['wiki/people/person.md'] });
    const result = resolveReference(source, '../people/person.md#voice', [source, target]);
    expect(result.state).toBe('matched');
    expect(result.matches).toEqual([otherHash]);
    expect(result.fragment).toBe('voice');
  });
  it('keeps competing versions ambiguous instead of selecting a convenient one', () => {
    const source = row('C', 'exact/01/file.md', hash, { logicalPaths: ['wiki/file.md'] });
    const targets = [row('A', 'a.md', otherHash, { logicalPaths: ['wiki/person.md'] }), row('D', 'd.md', 'c'.repeat(64), { logicalPaths: ['wiki/person.md'] })];
    expect(resolveReference(source, 'person.md', [source, ...targets]).state).toBe('ambiguous');
  });
  it('never turns a basename coincidence into a resolved reference', () => {
    expect(resolveReference(row('A', 'a/one.md'), '../missing/person.md', [row('A', 'other/person.md')]).state).toBe('unresolved');
  });
  it('does not confuse identical repository-relative paths in different repositories', () => {
    const source = row('C', 'one.md', hash, { logicalPaths: ['wiki/a.md'], repositories: ['example/source'] });
    const unrelated = row('C', 'two.md', otherHash, { logicalPaths: ['wiki/person.md'], repositories: ['example/other'] });
    expect(resolveReference(source, 'person.md', [source, unrelated]).state).toBe('unresolved');
  });
  it('uses pinned URL repository identity to disambiguate relocated references', () => {
    const source = row('A', 'one.md', hash, { logicalPaths: ['wiki/a.md'], urls: ['https://github.com/example/source/blob/abc/wiki/a.md'] });
    const correct = row('B', 'two.md', otherHash, { logicalPaths: ['wiki/person.md'], urls: ['https://github.com/example/source/blob/def/wiki/person.md'] });
    const unrelated = row('A', 'three.md', 'c'.repeat(64), { logicalPaths: ['wiki/person.md'], repositories: ['example/other'] });
    expect(resolveReference(source, 'person.md', [source, correct, unrelated]).matches).toEqual([otherHash]);
  });
  it('resolves a pinned GitHub witness without a network request', () => {
    const url = 'https://github.com/example/repo/blob/123/wiki/person.md';
    expect(resolveReference(row('A', 'one.md'), url, [row('B', 'two.md', otherHash, { urls: [url] })]).matches).toEqual([otherHash]);
  });
  it('rejects executable link schemes', () => {
    expect(resolveReference(row('A', 'one.md'), 'javascript:alert(1)', []).state).toBe('unresolved');
  });
  const manifest = { files: [{ path: 'wiki/a.md', sha256: hash, bytes: 8 }], sources: [{ id: hash, path: 'wiki/a.md' }], claims: [{ sourceIds: [hash] }], maxBytes: 100 };
  it('accepts the complete unchanged candidate', () => {
    expect(checkManifest(manifest, manifest.files)).toEqual([]);
  });
  it.each([
    ['altered artifact', [{ path: 'wiki/a.md', sha256: otherHash, bytes: 8 }]],
    ['missing artifact', []],
    ['unexpected file', [...manifest.files, { path: 'extra.txt', sha256: hash, bytes: 8 }]],
    ['oversized candidate', [{ path: 'wiki/a.md', sha256: hash, bytes: 101 }]],
  ])('rejects %s', (_, actual) => { expect(checkManifest(manifest, actual).length).toBeGreaterThan(0); });
  it('rejects orphan claims', () => {
    expect(checkManifest({ ...manifest, claims: [{ sourceIds: [otherHash] }] }, manifest.files)).toContain('orphan-claim');
  });
});
