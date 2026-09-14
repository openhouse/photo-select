import path from 'node:path';

export function safePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.includes('\0') || value.split('/').some(p => p === '..' || p === '.')) throw new Error('Unsafe package path');
  return value;
}

export function groupSources(records) {
  const groups = new Map();
  const modes = { gzip: 0, exact: 1, pointer: 2 };
  for (const record of records) {
    safePath(record.path);
    if (!/^[a-f0-9]{64}$/.test(record.sha256) || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || !(record.mode in modes)) throw new Error('Invalid source record');
    let group = groups.get(record.sha256);
    if (!group) groups.set(record.sha256, group = { id: record.sha256, bytes: record.bytes, mode: record.mode, witnesses: [] });
    if (group.bytes !== record.bytes) throw new Error('Conflicting digest sizes');
    if (modes[record.mode] > modes[group.mode]) group.mode = record.mode;
    group.witnesses.push(record);
  }
  return [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function referenceIndex(records) {
  const local = new Map(), logical = new Map(), urls = new Map();
  const add = (map, key, record) => { if (!map.has(key)) map.set(key, []); map.get(key).push(record); };
  for (const record of records) {
    add(local, `${record.packet}:${record.path}`, record);
    for (const alias of record.logicalPaths || []) add(logical, alias, record);
    for (const url of record.urls || []) add(urls, url.split('#')[0], record);
  }
  return { local, logical, urls };
}

export function resolveReference(source, target, catalog) {
  const index = Array.isArray(catalog) ? referenceIndex(catalog) : catalog;
  const [raw, ...anchor] = target.replace(/^<|>$/g, '').split('#');
  const fragment = anchor.join('#');
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { return { state: 'unresolved', matches: [] }; }
  const finish = rows => {
    const matches = [...new Set(rows.map(x => x.sha256))].sort();
    return { state: matches.length === 1 ? 'matched' : matches.length ? 'ambiguous' : 'unresolved', matches, fragment };
  };
  if (!raw) return finish([source]);
  if (/^https?:\/\//i.test(raw)) {
    const rows = index.urls.get(raw) || index.urls.get(decoded) || [];
    return rows.length ? finish(rows) : { state: 'external', matches: [], url: target };
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith('/') || decoded.includes('\\')) return finish([]);
  const direct = index.local.get(`${source.packet}:${path.posix.normalize(path.posix.join(path.posix.dirname(source.path), decoded))}`);
  if (direct?.length) return finish(direct);
  const repositories = record => [...new Set([...(record.repositories || []), ...(record.urls || []).flatMap(url => {
    const match = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|tree)\//i);
    return match ? [match[1]] : [];
  })])];
  const originRepositories = repositories(source);
  const candidates = (source.logicalPaths || []).flatMap(alias => index.logical.get(path.posix.normalize(path.posix.join(path.posix.dirname(alias), decoded))) || [])
    .filter(candidate => !originRepositories.length || repositories(candidate).some(repo => originRepositories.includes(repo)));
  const localCandidates = candidates.filter(r => r.packet === source.packet);
  return finish(localCandidates.length ? localCandidates : candidates);
}

export function checkManifest(manifest, actual) {
  const errors = [], found = new Map(actual.map(f => [f.path, f]));
  const declared = new Set(manifest.files.map(f => f.path));
  if (found.size !== actual.length || declared.size !== manifest.files.length) errors.push('duplicate-path');
  for (const file of manifest.files) {
    try { safePath(file.path); } catch { errors.push('unsafe-path'); }
    const item = found.get(file.path);
    if (!item || item.sha256 !== file.sha256 || item.bytes !== file.bytes) errors.push(`changed:${file.path}`);
  }
  if (actual.some(f => !declared.has(f.path))) errors.push('unexpected-file');
  if (actual.reduce((sum, f) => sum + f.bytes, 0) > manifest.maxBytes) errors.push('size-limit');
  const ids = new Set(manifest.sources.map(s => s.id));
  if (ids.size !== manifest.sources.length) errors.push('duplicate-source');
  for (const source of manifest.sources) if (!found.has(source.path)) errors.push('missing-source');
  for (const claim of manifest.claims || []) if (!claim.sourceIds?.length || claim.sourceIds.some(id => !ids.has(id))) errors.push('orphan-claim');
  return [...new Set(errors)];
}
