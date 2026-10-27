import { describe, expect, it } from 'vitest';
import { estimateHostedCost, evaluateHostedProposal, evaluateXiaomiProfile } from '../src/core/hostedOpenWeights.js';

const rates = { provider: 'deepinfra', model: 'XiaomiMiMo/MiMo-V2.6-Pro', unit: 'USD_per_million_tokens',
  input: 0.43, cachedInput: 0.004, output: 0.87, cacheWrite: null };
const base = { provider: 'deepinfra', model: 'XiaomiMiMo/MiMo-V2.6-Pro', rates,
  usage: { inputTokens: 100000, cachedInputTokens: 0, cacheWriteTokens: 0,
    outputTokens: 10000, reasoningTokens: null, outputIncludesReasoning: true } };
describe('hosted inference cost accounting', () => {
  it('prices billed output once even when its reasoning breakdown is unknown', () => {
    expect(estimateHostedCost(base).usd).toBeCloseTo(0.0517, 10);
    expect(estimateHostedCost(base).unknown).toEqual([]);
  });
  it('subtracts cached and written input from ordinary input before pricing', () => {
    const input = structuredClone(base);
    input.rates.cacheWrite = 0.5;
    Object.assign(input.usage, { cachedInputTokens: 50000, cacheWriteTokens: 10000, reasoningTokens: 8000 });
    expect(estimateHostedCost(input).usd).toBeCloseTo(0.0311, 10);
  });
  it('adds separately reported reasoning only when output excludes it', () => {
    const input = structuredClone(base);
    Object.assign(input.usage, { outputIncludesReasoning: false, reasoningTokens: 2000 });
    expect(estimateHostedCost(input).usd).toBeCloseTo(0.05344, 10);
  });
  it.each([
    ['unknown input', x => { x.usage.inputTokens = null; }],
    ['missing usage object', x => { x.usage = null; }],
    ['missing tariff object', x => { x.rates = null; }],
    ['unknown cache reads', x => { delete x.usage.cachedInputTokens; }],
    ['unknown cache writes', x => { x.usage.cacheWriteTokens = null; }],
    ['unpriced cache writes', x => { x.usage.cacheWriteTokens = 1; }],
    ['unknown output semantics', x => { delete x.usage.outputIncludesReasoning; }],
    ['unknown separate reasoning', x => { x.usage.outputIncludesReasoning = false; }],
    ['cache overflow', x => { x.usage.cachedInputTokens = 100001; }],
    ['negative usage', x => { x.usage.outputTokens = -1; }],
    ['reasoning overflow', x => { x.usage.reasoningTokens = 10001; }],
    ['missing identity', x => { delete x.provider; }],
    ['different provider tariff', x => { x.rates.provider = 'other'; }],
    ['different model tariff', x => { x.rates.model = 'other'; }],
    ['different price units', x => { x.rates.unit = 'USD_per_token'; }],
    ['nonfinite rate', x => { x.rates.output = Infinity; }],
    ['overflowing cost', x => { x.rates.input = Number.MAX_VALUE; x.usage.inputTokens = 10000000; }],
  ])('does not report a total for %s', (_, mutate) => {
    const input = structuredClone(base); mutate(input);
    expect(estimateHostedCost(input).usd).toBeNull();
    expect(estimateHostedCost(input).unknown.length).toBeGreaterThan(0);
  });
  it('preserves explicit zero usage with an unpublished cache-write rate', () => {
    const input = structuredClone(base);
    Object.assign(input.usage, { inputTokens: 0, outputTokens: 0 });
    expect(estimateHostedCost(input)).toEqual({ usd: 0, unknown: [] });
  });
});

const xiaomi = { schemaVersion: 1, provider: 'xiaomi', model: 'mimo-v2.6-pro',
  capabilityProfile: 'xiaomi-mimo-v2.6-pro-2026-10-26-v3',
  endpoint: 'https://api.xiaomimimo.com/v1', transport: 'chat-completions', apiKeyEnvironment: 'MIMO_API_KEY',
  maxImages: 10, responseMode: 'json_object', serverSchemaEnforcement: 'not-requested', precision: null, checkpoint: null,
  stage: 'proposed', ready: false, modelRequests: 0,
  implementation: { status: 'implemented', verification: 'mock-tested', liveAcceptance: 'pending' },
  reasoningEfforts: ['auto'], defaultWorkers: 1, githubTools: 'unsupported',
  concurrency: { minWorkers: 1, maxWorkers: 50, sharedRequestPool: true, phases: ['triage', 'repair', 'actII'],
    adaptiveGrowthAfterValid: 2, fieldNotesSessions: 'serial', fatalHold: 'stop-queued-finish-active-receipts',
    transportRetries: 0, verifiedHostConcurrency: null },
  evidence: { visualUsefulness: 'unmeasured', jsonValidityRate: null, retryRecoveryRate: null },
  historicalPilot: { path: 'evals/reports/xiaomi-direct-compatibility-pilot-2026-10-26.json', sha256: 'a'.repeat(64) },
  rates: { provider: 'xiaomi', model: 'mimo-v2.6-pro', unit: 'USD_per_million_tokens', input: 0.435,
    cachedInput: 0.0036, output: 0.87, cacheWrite: null, source: 'https://mimo.mi.com/docs/en-US/price/pay-as-you-go', observedAt: '2026-10-26' },
  sources: [{ url: 'https://mimo.mi.com/docs/en-US/price/pay-as-you-go', checkedOn: '2026-10-26' }] };
const historicalPilot = { scope: 'bounded-user-authorized-private-harness-compatibility-pilot',
  provider: 'xiaomi-direct', model: 'mimo-v2.6-pro', productionXiaomiCLIIntegration: false, readyForUnattendedCuration: false };
const xiaomiInput = () => structuredClone({ profile: xiaomi, historicalPilot, historicalPilotSha256: 'a'.repeat(64) });
describe('Xiaomi runtime profile and historical evidence boundary', () => {
  it('accepts a source-bound runtime profile without promoting historical harness evidence', () => {
    expect(evaluateXiaomiProfile(xiaomiInput())).toEqual([]);
  });
  it.each([
    ['readiness inflation', x => { x.profile.ready = true; }],
    ['invented live verification', x => { x.profile.implementation.verification = 'live-tested'; }],
    ['invented acceptance', x => { x.profile.implementation.liveAcceptance = 'passed'; }],
    ['credential cross-routing', x => { x.profile.apiKeyEnvironment = 'OPENAI_API_KEY'; }],
    ['different endpoint', x => { x.profile.endpoint = 'https://example.com/v1'; }],
    ['different model', x => { x.profile.model = 'mimo-v2.6-flash'; }],
    ['wrong provider', x => { x.profile.provider = 'deepinfra'; }],
    ['wrong capability revision', x => { x.profile.capabilityProfile = 'unreviewed-profile'; }],
    ['invented model requests', x => { x.profile.modelRequests = 1; }],
    ['parallel default', x => { x.profile.defaultWorkers = 4; }],
    ['missing concurrency boundary', x => { delete x.profile.concurrency; }],
    ['unbounded workers', x => { x.profile.concurrency.maxWorkers = 51; }],
    ['zero minimum workers', x => { x.profile.concurrency.minWorkers = 0; }],
    ['per-batch pools', x => { x.profile.concurrency.sharedRequestPool = false; }],
    ['repair outside admission pool', x => { x.profile.concurrency.phases = ['triage', 'actII']; }],
    ['unverified adaptive growth', x => { x.profile.concurrency.adaptiveGrowthAfterValid = 1; }],
    ['parallel notebook sessions', x => { x.profile.concurrency.fieldNotesSessions = 'parallel'; }],
    ['queued dispatch after fatal hold', x => { x.profile.concurrency.fatalHold = 'continue-queued'; }],
    ['ambiguous transport retry', x => { x.profile.concurrency.transportRetries = 1; }],
    ['invented host capacity', x => { x.profile.concurrency.verifiedHostConcurrency = 50; }],
    ['image limit expansion', x => { x.profile.maxImages = 11; }],
    ['invented strict schema', x => { x.profile.serverSchemaEnforcement = 'verified'; }],
    ['changed response mode', x => { x.profile.responseMode = 'json_schema'; }],
    ['unverified effort', x => { x.profile.reasoningEfforts.push('xhigh'); }],
    ['invented tool integration', x => { x.profile.githubTools = 'supported'; }],
    ['invented visual usefulness', x => { x.profile.evidence.visualUsefulness = 'measured'; }],
    ['historical report replacement', x => { x.historicalPilotSha256 = 'b'.repeat(64); }],
    ['historical report promoted to production', x => { x.historicalPilot.productionXiaomiCLIIntegration = true; }],
    ['historical unattended readiness', x => { x.historicalPilot.readyForUnattendedCuration = true; }],
    ['unbound rate source', x => { x.profile.rates.source = 'https://example.com'; }],
    ['stale rate join', x => { x.profile.rates.observedAt = '2026-10-25'; }],
    ['different provider tariff', x => { x.profile.rates.provider = 'deepinfra'; }],
    ['different model tariff', x => { x.profile.rates.model = 'other'; }],
  ])('rejects %s', (_, mutate) => {
    const input = xiaomiInput(); mutate(input);
    expect(evaluateXiaomiProfile(input).length).toBeGreaterThan(0);
  });
});

const source = { id: 'deepinfra-api', url: 'https://deepinfra.com/XiaomiMiMo/MiMo-V2.6-Pro/api', checkedOn: '2026-10-26' };
const proposal = { schemaVersion: 1, stage: 'proposed', status: 'proposed', ready: false, modelRequests: 0,
  implementation: { status: 'implemented', verification: 'mock-tested', liveAcceptance: 'pending' },
  provider: base.provider, model: base.model, endpoint: 'https://api.deepinfra.com/v1/openai', precision: 'fp8', checkpoint: null,
  evidence: { visualUsefulness: 'unmeasured', jsonValidityRate: null, retryRecoveryRate: null },
  liveAcceptance: { authorization: 'unverified', strictSchemaWithImages: 'unverified', thinkingControls: 'unverified',
    cacheReuse: 'unverified', editorialUsefulness: 'unmeasured', costSavings: 'unmeasured' },
  graph: { proposalId: 'photo-select-rfc-0013', conceptId: 'photo-select-hosted-open-weights' },
  rates: { ...rates, observedAt: '2026-10-26', source: source.url }, sources: [source] };
const graph = { schemaVersion: 1, rootId: 'photo-select-wiki', nodes: [
  { id: proposal.graph.proposalId, kind: 'research-inquiry', path: 'docs/rfcs/0013-hosted-open-weights.md', status: 'draft' },
  { id: proposal.graph.conceptId, kind: 'method', path: 'wiki/hosted-open-weights.md', status: 'draft' },
  { id: source.id, kind: 'source', url: source.url, status: 'maintained' },
  { id: 'photo-select-wiki', kind: 'index', path: 'wiki/index.md', status: 'maintained' },
].map(n => ({ ...n, visibility: 'public-safe', sensitivity: 'low' })), edges: [
  { from: proposal.graph.proposalId, type: 'uses_method', to: proposal.graph.conceptId, layer: 'semantic', href: '../../wiki/hosted-open-weights.md', context: 'Proposed method' },
  { from: proposal.graph.proposalId, type: 'uses_source', to: source.id, layer: 'evidence', href: source.url, context: 'Pricing evidence' },
  { from: 'photo-select-wiki', type: 'related_to', to: proposal.graph.proposalId, layer: 'semantic', href: '../docs/rfcs/0013-hosted-open-weights.md', context: 'Proposal entry point' },
] };
const files = ['docs/rfcs/0013-hosted-open-weights.md', 'wiki/hosted-open-weights.md', 'wiki/index.md'];
const documents = {
  'docs/rfcs/0013-hosted-open-weights.md': `---
id: photo-select-rfc-0013
kind: research-inquiry
status: draft
visibility: public-safe
sensitivity: low
canonical_path: docs/rfcs/0013-hosted-open-weights.md
stage: proposed
implementation: Dedicated DeepInfra provider implemented and mock-tested; live acceptance pending.
---
`,
  'wiki/hosted-open-weights.md': `---
id: photo-select-hosted-open-weights
kind: method
status: draft
visibility: public-safe
sensitivity: low
canonical_path: wiki/hosted-open-weights.md
---
`,
  'wiki/index.md': `---
id: photo-select-wiki
kind: index
status: maintained
visibility: public-safe
sensitivity: low
canonical_path: wiki/index.md
---
`,
};
describe('hosted proposal graph acceptance', () => {
  it('accepts a linked, source-backed proposal without claiming model acceptance', () => {
    expect(evaluateHostedProposal({ proposal, graph, files, documents })).toEqual([]);
  });
  it.each([
    ['ready inflation', x => { x.proposal.ready = true; }],
    ['status inflation', x => { x.proposal.stage = 'operational'; }],
    ['operational manifest status', x => { x.proposal.status = 'operational'; }],
    ['invented authorization acceptance', x => { x.proposal.liveAcceptance.authorization = 'verified'; }],
    ['invented strict-schema acceptance', x => { x.proposal.liveAcceptance.strictSchemaWithImages = 'verified'; }],
    ['invented thinking-control acceptance', x => { x.proposal.liveAcceptance.thinkingControls = 'verified'; }],
    ['invented cache acceptance', x => { x.proposal.liveAcceptance.cacheReuse = 'verified'; }],
    ['invented measured usefulness', x => { x.proposal.liveAcceptance.editorialUsefulness = 'measured'; }],
    ['invented measured savings', x => { x.proposal.liveAcceptance.costSavings = 'measured'; }],
    ['missing implementation boundary', x => { delete x.proposal.implementation; }],
    ['invented live implementation evidence', x => { x.proposal.implementation.verification = 'live-tested'; }],
    ['invented accepted implementation', x => { x.proposal.implementation.liveAcceptance = 'passed'; }],
    ['unimplemented runtime status', x => { x.proposal.implementation.status = 'pending'; }],
    ['adopted RFC stage', x => { x.documents[x.files[0]] = x.documents[x.files[0]].replace('stage: proposed', 'stage: operational'); }],
    ['RFC implementation claim', x => { x.documents[x.files[0]] = x.documents[x.files[0]].replace('implementation: Dedicated DeepInfra provider implemented and mock-tested; live acceptance pending.', 'implementation: Provider operational and live acceptance passed.'); }],
    ['invented requests', x => { x.proposal.modelRequests = 1; }],
    ['invented quality', x => { x.proposal.evidence.jsonValidityRate = 1; }],
    ['wrong provider', x => { x.proposal.provider = 'openai'; }],
    ['wrong model', x => { x.proposal.model += '-alias'; }],
    ['wrong endpoint', x => { x.proposal.endpoint = 'https://example.com'; }],
    ['wrong precision', x => { x.proposal.precision = 'mxfp4'; }],
    ['invented checkpoint', x => { x.proposal.checkpoint = 'unknown-revision'; }],
    ['unregistered file', x => { x.files.pop(); }],
    ['path escape', x => { x.graph.nodes[0].path = '../outside.md'; }],
    ['duplicate id', x => { x.graph.nodes.push(x.graph.nodes[0]); }],
    ['invalid kind', x => { x.graph.nodes[0].kind = 'rfc'; }],
    ['invalid lifecycle', x => { x.graph.nodes[0].status = 'proposed'; }],
    ['private graph node', x => { x.graph.nodes[2].visibility = 'private'; }],
    ['sensitive graph node', x => { x.graph.nodes[2].sensitivity = 'high'; }],
    ['missing source document', x => { delete x.documents[x.files[0]]; }],
    ['document identity drift', x => { x.documents[x.files[0]] = x.documents[x.files[0]].replace('id: photo-select-rfc-0013', 'id: other-record'); }],
    ['document kind drift', x => { x.documents[x.files[0]] = x.documents[x.files[0]].replace('kind: research-inquiry', 'kind: method'); }],
    ['document lifecycle drift', x => { x.documents[x.files[0]] = x.documents[x.files[0]].replace('status: draft', 'status: archived'); }],
    ['document path drift', x => { x.documents[x.files[0]] = x.documents[x.files[0]].replace('canonical_path: docs/', 'canonical_path: other/'); }],
    ['private source document', x => { x.documents[x.files[0]] = x.documents[x.files[0]].replace('visibility: public-safe', 'visibility: private'); }],
    ['sensitive source document', x => { x.documents[x.files[0]] = x.documents[x.files[0]].replace('sensitivity: low', 'sensitivity: high'); }],
    ['dangling edge', x => { x.graph.edges[0].to = 'missing'; }],
    ['invalid edge type', x => { x.graph.edges[0].type = 'proposes'; }],
    ['invalid layer', x => { x.graph.edges[0].layer = 'authority'; }],
    ['wrong local href', x => { x.graph.edges[0].href = '../other.md'; }],
    ['wrong external href', x => { x.graph.edges[1].href = 'https://example.com'; }],
    ['missing semantic edge', x => { x.graph.edges.shift(); }],
    ['missing evidence edge', x => { x.graph.edges.splice(1, 1); }],
    ['unreachable proposal', x => { x.graph.edges.pop(); }],
    ['wrong source binding', x => { x.graph.nodes[2].url = 'https://example.com'; }],
    ['unlisted tariff source', x => { x.proposal.rates.source = 'https://example.com'; }],
    ['wrong tariff date', x => { x.proposal.rates.observedAt = '2026-10-25'; }],
  ])('rejects %s', (_, mutate) => {
    const input = structuredClone({ proposal, graph, files, documents }); mutate(input);
    expect(evaluateHostedProposal(input).length).toBeGreaterThan(0);
  });
});
