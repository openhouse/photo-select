import { createHash } from 'node:crypto';

const digest = text => createHash('sha256').update(text).digest('hex');
const held = reason => ({ status: 'held', reason });
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const safePath = value => nonempty(value) && !value.startsWith('/') &&
  value.split('/').every(part => part && part !== '.' && part !== '..') && !/[\\%\x00-\x1f]/.test(value);

// RFC-only pure model. The adapter must authenticate and verify these descriptors.
// This function performs no I/O and is NOT called by any production run path.
export function planKnowledgeContext({ request: q, policy: p, sources, coverage, records } = {}) {
  if (!q || !p || !nonempty(p.revision) || !Number.isFinite(q.now) ||
      !Number.isFinite(p.expiresAt) || q.now >= p.expiresAt ||
      !Number.isSafeInteger(q.maxBytes) || q.maxBytes <= 0 ||
      !['subject', 'recipient', 'purpose'].every(k => nonempty(q[k]) && q[k] === p[k])) return held('scope');
  if (!Array.isArray(sources) || !sources.length || sources.some(s => !s || !nonempty(s.repository) ||
      s.active !== true || !/^[a-f0-9]{40}$/.test(s.commit) || !nonempty(s.correctionRevision) ||
      !nonempty(s.prefix) || !s.prefix.endsWith('/') || !safePath(s.prefix.slice(0, -1))) ||
      new Set(sources.map(s => s.repository)).size !== sources.length) return held('source');
  if (!Array.isArray(coverage) || coverage.length !== sources.length || sources.some(s => {
    const rows = coverage.filter(c => c?.repository === s.repository);
    return rows.length !== 1 || rows[0].state !== 'complete' || rows[0].commit !== s.commit ||
      rows[0].correctionRevision !== s.correctionRevision;
  })) return held('coverage');
  if (!Array.isArray(records)) return held('record');
  const ids = new Set(records.map(r => r?.id));
  if (ids.size !== records.length) return held('record');
  const items = [];
  for (const r of records) {
    const s = sources.find(s => s.repository === r?.repository);
    if (!r || !s || !nonempty(r.id) || !safePath(r.path) || !r.path.startsWith(s.prefix) ||
        r.commit !== s.commit || typeof r.text !== 'string' || !r.text || digest(r.text) !== r.digest ||
        !nonempty(r.speaker) || !['observation', 'attributed-report', 'interpretation', 'open-question'].includes(r.posture) ||
        !Array.isArray(r.audiences) || !r.audiences.includes(q.recipient) ||
        !Array.isArray(r.purposes) || !r.purposes.includes(q.purpose) || r.withdrawn === true ||
        r.disposition !== 'exact' || !Array.isArray(r.contradicts) ||
        r.contradicts.some(id => !ids.has(id))) return held('record');
    items.push({ id: r.id, text: r.text, speaker: r.speaker, posture: r.posture, contradicts: [...r.contradicts],
      citation: { repository: s.repository, commit: r.commit, path: r.path, digest: r.digest } });
  }
  items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const bytes = Buffer.byteLength(JSON.stringify(items));
  if (bytes > q.maxBytes) return held('budget');
  const binding = { policy: p, sources, coverage, items, budget: q.maxBytes };
  return { status: items.length ? 'ready' : 'empty', items, bytes,
    key: `knowledge-v2:${digest(JSON.stringify(binding))}`,
    trust: 'untrusted-source-data', publication: 'held' };
}
