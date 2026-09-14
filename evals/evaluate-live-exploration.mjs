// Offline RFC trace checker. Descriptors are synthetic, not authenticated facts.
export function evaluateExploration(trace) {
  const errors = new Set();
  const fail = name => errors.add(name);
  const { scope, currentScope, calls, limits, repositories, records, frozenIds } = trace;
  if (!['subject', 'recipient', 'purpose', 'provider', 'policy', 'correction'].every(k =>
    typeof scope[k] === 'string' && scope[k] && scope[k] === currentScope[k])) fail('scope');
  const discovered = new Map(), fetched = new Map(), cursors = new Map(), consumed = new Set();
  let bytes = 0;
  for (const c of calls) {
    if (!['search', 'read'].includes(c.tool)) fail('tool');
    if (!Object.hasOwn(repositories, c.repository) || !/^[a-f0-9]{40}$/.test(c.commit) || repositories[c.repository] !== c.commit) fail('snapshot');
    if (!Number.isSafeInteger(c.bytes) || c.bytes < 0) fail('budget');
    bytes += c.bytes;
    if (c.status !== 'ok') { fail('coverage'); continue; }
    const binding = JSON.stringify([c.repository, c.commit]);
    if ((c.follows || []).some(id => !fetched.has(id))) fail('discovery');
    if (c.tool === 'search') {
      const query = JSON.stringify([c.repository, c.commit, c.query]);
      if ((cursors.get(query) || null) !== c.cursor || (c.cursor && consumed.has(c.cursor))) fail('coverage');
      if (c.cursor) consumed.add(c.cursor);
      cursors.set(query, c.nextCursor);
      for (const id of c.ids) {
        if (discovered.has(id) && discovered.get(id) !== binding) fail('discovery');
        discovered.set(id, binding);
      }
    }
    if (c.tool === 'read') for (const id of c.ids) {
      if (discovered.get(id) !== binding) fail('discovery');
      fetched.set(id, binding);
    }
  }
  if ([...cursors.values()].some(Boolean)) fail('coverage');
  if (![limits.calls, limits.bytes].every(n => Number.isSafeInteger(n) && n > 0) || calls.length > limits.calls || bytes > limits.bytes) fail('budget');
  if (!frozenIds.length || new Set(frozenIds).size !== frozenIds.length || frozenIds.some(id =>
    !fetched.has(id) || records.filter(r => r.id === id).length !== 1)) fail('citation');
  for (const r of records.filter(r => frozenIds.includes(r.id))) {
    if (fetched.get(r.id) !== JSON.stringify([r.repository, repositories[r.repository]])) fail('citation');
    if (!r.speaker || !['observation', 'attributed-report', 'interpretation', 'open-question'].includes(r.posture)) fail('attribution');
    if (r.contradicts.some(id => !frozenIds.includes(id))) fail('countervoice');
  }
  if (!trace.receipt || trace.phaseReceipts.length !== 3 || trace.phaseReceipts.some(id => id !== trace.receipt)) fail('phase');
  if (trace.trust !== 'untrusted-source-data') fail('trust');
  if (trace.output !== 'private') fail('sink');
  if (trace.actions.length) fail('side-effect');
  return [...errors].sort();
}
