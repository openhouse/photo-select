import path from 'node:path';
const count = value => Number.isSafeInteger(value) && value >= 0;
const rate = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function evaluateXiaomiProfile({ profile: p = {}, historicalPilot: prior = {}, historicalPilotSha256 } = {}) {
  const failures = new Set(), fail = code => failures.add(code);
  if (p.schemaVersion !== 1 || p.stage !== 'proposed' || p.ready !== false || p.modelRequests !== 0 ||
      p.implementation?.status !== 'implemented' || p.implementation?.verification !== 'mock-tested' ||
      p.implementation?.liveAcceptance !== 'pending') fail('xiaomi-acceptance-boundary');
  if (p.provider !== 'xiaomi' || p.model !== 'mimo-v2.6-pro' || p.capabilityProfile !== 'xiaomi-mimo-v2.6-pro-2026-10-26-v2' || p.endpoint !== 'https://api.xiaomimimo.com/v1' ||
      p.transport !== 'chat-completions' || p.apiKeyEnvironment !== 'MIMO_API_KEY' || p.precision !== null || p.checkpoint !== null) fail('xiaomi-identity');
  if (p.maxImages !== 10 || p.responseMode !== 'json_object' || p.serverSchemaEnforcement !== 'not-requested' ||
      JSON.stringify(p.reasoningEfforts) !== '["auto"]' || p.defaultWorkers !== 1 || p.githubTools !== 'unsupported') fail('xiaomi-capabilities');
  if (p.evidence?.visualUsefulness !== 'unmeasured' || p.evidence?.jsonValidityRate !== null || p.evidence?.retryRecoveryRate !== null) fail('xiaomi-unmeasured-evidence');
  if (p.historicalPilot?.path !== 'evals/reports/xiaomi-direct-compatibility-pilot-2026-10-26.json' ||
      !/^[a-f0-9]{64}$/.test(historicalPilotSha256 || '') || p.historicalPilot?.sha256 !== historicalPilotSha256 ||
      prior.scope !== 'bounded-user-authorized-private-harness-compatibility-pilot' || prior.provider !== 'xiaomi-direct' ||
      prior.model !== 'mimo-v2.6-pro' || prior.productionXiaomiCLIIntegration !== false || prior.readyForUnattendedCuration !== false) fail('xiaomi-historical-binding');
  const sources = Array.isArray(p.sources) ? p.sources : [];
  if (!sources.length || sources.some(s => !/^https:\/\//.test(s.url || '') || !/^\d{4}-\d{2}-\d{2}$/.test(s.checkedOn || '')) ||
      !sources.some(s => s.url === p.rates?.source && s.checkedOn === p.rates?.observedAt) ||
      estimateHostedCost({ ...p, usage: { inputTokens: 2, cachedInputTokens: 1, cacheWriteTokens: 0, outputTokens: 1, reasoningTokens: null, outputIncludesReasoning: true } }).usd === null) fail('xiaomi-tariff-binding');
  return [...failures];
}
// inputTokens includes cache reads/writes. Output semantics must be supplied,
// because providers differ on whether their output count includes reasoning.
export function estimateHostedCost({ provider, model, rates = {}, usage = {} } = {}) {
  rates ??= {}; usage ??= {};
  const unknown = [];
  if (!provider || !model || rates.provider !== provider || rates.model !== model || rates.unit !== 'USD_per_million_tokens') unknown.push('tariff-identity');
  for (const key of ['inputTokens', 'cachedInputTokens', 'cacheWriteTokens', 'outputTokens']) {
    if (!count(usage[key])) unknown.push(key);
  }
  if (typeof usage.outputIncludesReasoning !== 'boolean') unknown.push('outputIncludesReasoning');
  if (usage.reasoningTokens != null && !count(usage.reasoningTokens)) unknown.push('reasoningTokens');
  if (usage.outputIncludesReasoning === false && !count(usage.reasoningTokens)) unknown.push('reasoningTokens');
  if (usage.outputIncludesReasoning === true && usage.reasoningTokens > usage.outputTokens) unknown.push('reasoning-overflow');
  if (usage.cachedInputTokens + usage.cacheWriteTokens > usage.inputTokens) unknown.push('cache-overflow');
  const buckets = { input: usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens,
    cachedInput: usage.cachedInputTokens, cacheWrite: usage.cacheWriteTokens,
    output: usage.outputTokens + (usage.outputIncludesReasoning === false ? usage.reasoningTokens : 0) };
  for (const [key, tokens] of Object.entries(buckets)) if (tokens > 0 && !rate(rates[key])) unknown.push(`rate:${key}`);
  let usd = unknown.length ? null : Object.entries(buckets).reduce((sum, [key, tokens]) => sum + (tokens ? tokens / 1e6 * rates[key] : 0), 0);
  if (usd !== null && !Number.isFinite(usd)) { unknown.push('cost-overflow'); usd = null; }
  return { usd, unknown: [...new Set(unknown)] };
}
const metadata = text => typeof text === 'string' ? text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '' : '';
const scalar = (body, key) => {
  const matches = [...body.matchAll(new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'gm'))];
  return matches.length === 1 ? matches[0][1].replace(/^(['"])(.*)\1$/, '$2') : null;
};
// This consumes the small authored local registry, not an upstream graph build.
export function evaluateHostedProposal({ proposal: p = {}, graph: g = {}, files = [], documents = {} } = {}) {
  const failures = new Set(), fail = code => failures.add(code), knownFiles = new Set(files);
  if (p.schemaVersion !== 1 || p.stage !== 'proposed' || p.status !== 'proposed' || p.ready !== false || p.modelRequests !== 0) fail('proposal-state');
  if (p.implementation?.status !== 'implemented' || p.implementation?.verification !== 'mock-tested' || p.implementation?.liveAcceptance !== 'pending') fail('implementation-boundary');
  if (p.provider !== 'deepinfra' || p.model !== 'XiaomiMiMo/MiMo-V2.6-Pro' || p.endpoint !== 'https://api.deepinfra.com/v1/openai' || p.precision !== 'fp8' || p.checkpoint !== null) fail('provider-identity');
  if (p.evidence?.visualUsefulness !== 'unmeasured' || p.evidence?.jsonValidityRate !== null || p.evidence?.retryRecoveryRate !== null) fail('unmeasured-evidence');
  const acceptance = { authorization: 'unverified', strictSchemaWithImages: 'unverified', thinkingControls: 'unverified',
    cacheReuse: 'unverified', editorialUsefulness: 'unmeasured', costSavings: 'unmeasured' };
  if (Object.entries(acceptance).some(([key, expected]) => p.liveAcceptance?.[key] !== expected)) fail('live-acceptance');
  const nodes = Array.isArray(g.nodes) ? g.nodes : [], edges = Array.isArray(g.edges) ? g.edges : [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const kinds = new Set(['index', 'research-inquiry', 'method', 'source']);
  const statuses = new Set(['inbox', 'draft', 'maintained', 'governed-open', 'superseded', 'archived', 'retired']);
  const types = new Set(['uses_method', 'uses_source', 'related_to', 'informed_by', 'mentions']);
  const safePath = value => typeof value === 'string' && value && !path.posix.isAbsolute(value) && !value.includes('\\') && !value.split('/').includes('..');
  if (g.schemaVersion !== 1 || g.rootId !== 'photo-select-wiki' || byId.get(g.rootId)?.kind !== 'index' || byId.size !== nodes.length) fail('graph-shape');
  for (const n of nodes) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(n.id || '') || !kinds.has(n.kind) || !statuses.has(n.status)) fail('node-metadata');
    if (n.visibility !== 'public-safe' || n.sensitivity !== 'low') fail('public-graph-boundary');
    if (n.path ? !safePath(n.path) || !knownFiles.has(n.path) : n.kind !== 'source' || !/^https:\/\//.test(n.url || '')) fail('node-locator');
    if (n.path) {
      const body = metadata(documents[n.path]);
      for (const [key, expected] of Object.entries({ id: n.id, kind: n.kind, status: n.status, visibility: n.visibility, sensitivity: n.sensitivity, canonical_path: n.path })) {
        if (scalar(body, key) !== expected) fail('document-metadata');
      }
    }
  }
  const inquiry = byId.get(p.graph?.proposalId), method = byId.get(p.graph?.conceptId);
  if (inquiry?.id !== 'photo-select-rfc-0013' || inquiry?.kind !== 'research-inquiry' || inquiry?.status !== 'draft' || inquiry?.path !== 'docs/rfcs/0013-hosted-open-weights.md' || method?.id !== 'photo-select-hosted-open-weights' || method?.kind !== 'method' || method?.status !== 'draft' || method?.path !== 'wiki/hosted-open-weights.md') fail('proposal-registration');
  const rfc = metadata(documents[inquiry?.path]);
  if (scalar(rfc, 'stage') !== 'proposed' || scalar(rfc, 'implementation') !== 'Dedicated DeepInfra provider implemented and mock-tested; live acceptance pending.') fail('rfc-decision-state');
  for (const e of edges) {
    const from = byId.get(e.from), to = byId.get(e.to), href = typeof e.href === 'string' ? e.href.split('#')[0] : '';
    if (!from || !to || !types.has(e.type) || !['semantic', 'evidence'].includes(e.layer) || typeof e.context !== 'string' || !e.context.trim()) { fail('edge-metadata'); continue; }
    if (to.url ? e.href !== to.url : !from.path || !href || path.posix.isAbsolute(href) || path.posix.normalize(path.posix.join(path.posix.dirname(from.path), href)) !== to.path) fail('edge-locator');
    if ((e.type === 'uses_method' && to.kind !== 'method') || (e.type === 'uses_source' && to.kind !== 'source')) fail('edge-kind');
  }
  const reachable = new Set([g.rootId]), queue = [g.rootId];
  for (const id of queue) for (const e of edges) if (e.from === id && !reachable.has(e.to)) { reachable.add(e.to); queue.push(e.to); }
  if (nodes.some(n => !reachable.has(n.id))) fail('unreachable-node');
  if (!edges.some(e => e.from === inquiry?.id && e.to === method?.id && e.type === 'uses_method' && e.layer === 'semantic')) fail('method-relation');
  const sources = Array.isArray(p.sources) ? p.sources : [];
  if (!sources.length || new Set(sources.map(s => s.id)).size !== sources.length) fail('sources');
  for (const s of sources) if (byId.get(s.id)?.kind !== 'source' || byId.get(s.id)?.url !== s.url || !/^\d{4}-\d{2}-\d{2}$/.test(s.checkedOn || '') || !edges.some(e => [inquiry?.id, method?.id].includes(e.from) && e.to === s.id && e.type === 'uses_source' && e.layer === 'evidence')) fail('source-binding');
  if (!sources.some(s => s.url === p.rates?.source && s.checkedOn === p.rates?.observedAt) || !/^\d{4}-\d{2}-\d{2}$/.test(p.rates?.observedAt || '') || estimateHostedCost({ ...p, usage: { inputTokens: 1, cachedInputTokens: 1, cacheWriteTokens: 0, outputTokens: 1, reasoningTokens: null, outputIncludesReasoning: true } }).usd === null || !rate(p.rates?.input)) fail('tariff-binding');
  return [...failures];
}
