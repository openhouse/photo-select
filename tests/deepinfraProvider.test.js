import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import DeepInfraProvider from '../src/providers/deepinfra.js';
import { buildDeepInfraRequest, deepinfraReplyIssues, deepinfraRequestIdentity, normalizeDeepInfraUsage } from '../src/core/deepinfra.js';

const model = 'XiaomiMiMo/MiMo-V2.6-Pro';
const messages = [{ role: 'system', content: 'Original custom prompt {{curators}}.' }, { role: 'user', content: [
  { type: 'text', text: '{"filename":"one.jpg","people":["Stale"]}' },
  { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,eA==', detail: 'high' } },
] }];
const reply = { minutes: [{ speaker: 'A (exact)', text: 'What should we examine next?' }], decisions: [{ filename: 'one.jpg', decision: 'keep', reason: 'Visible shape.' }] };
const requestOptions = { messages, model, filenames: ['one.jpg'], curators: ['A (exact)'], photoPeople: [{ file: 'one.jpg', people: ['Fresh'] }] };
const result = (content = JSON.stringify(reply), extra = {}) => ({ id: 'reply-1', model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content, reasoning_content: 'Provider reasoning.' } }], usage: { prompt_tokens: 100, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 10 }, estimated_cost: 0.001 }, ...extra });
const http = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body });
function memoryJournal() { const values = new Map(); return { values, load: async key => values.get(key), save: async (key, value) => values.set(key, structuredClone(value)) }; }

describe('dedicated DeepInfra request contract', () => {
  it('preserves original prompt and ordered metadata while removing unsupported image detail', () => {
    const request = buildDeepInfraRequest(requestOptions);
    expect(request.model).toBe(model); expect(request.stream).toBe(false);
    expect(request.messages[0].content).toContain('Original custom prompt {{curators}}.');
    expect(request.messages[1].content.filter(x => x.type === 'image_url')).toEqual([{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,eA==' } }]);
    expect(request.messages[1].content.find(x => x.text?.includes('Fresh')).text).toBe('{"filename":"one.jpg","people":["Fresh"]}');
    expect(JSON.stringify(request)).not.toContain('Stale');
    expect(messages[1].content[1].image_url.detail).toBe('high');
    for (const message of request.messages) expect(JSON.stringify(message)).toContain('A (exact)');
    expect(request.response_format.type).toBe('json_schema');
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(request.response_format.json_schema.schema.properties.decisions.items.properties.filename.enum).toEqual(['one.jpg']);
    expect(request).not.toHaveProperty('reasoning_effort');
  });
  it.each(['minimal', 'low', 'medium', 'high', 'xhigh'])('holds unverified MiMo reasoning setting %s', reasoningEffort => {
    expect(() => buildDeepInfraRequest({ ...requestOptions, reasoningEffort })).toThrow(/reasoning/i);
  });
  it('holds requested verbosity until the model capability is verified', () => { expect(() => buildDeepInfraRequest({ ...requestOptions, verbosity: 'high' })).toThrow(/verbosity/i); });
  it('uses independent phase schemas without legacy extra keys', () => {
    const first = buildDeepInfraRequest({ ...requestOptions, expectFieldNotesDiff: true }).response_format.json_schema.schema;
    expect(Object.keys(first.properties)).toEqual(['minutes', 'decisions', 'field_notes_diff']);
    const second = buildDeepInfraRequest({ ...requestOptions, expectFieldNotesMd: true }).response_format.json_schema.schema;
    expect(Object.keys(second.properties)).toEqual(['field_notes_md']);
    expect(deepinfraReplyIssues({ field_notes_md: '# Notebook' }, ['one.jpg'], { expectFieldNotesMd: true })).toEqual([]);
    expect(buildDeepInfraRequest({ ...requestOptions, expectFieldNotesMd: true }).messages[0].content).not.toContain('in decisions');
  });
  it('includes the exact notebook snapshot and requested diff in both Act II messages', () => {
    const request = buildDeepInfraRequest({ ...requestOptions, expectFieldNotesMd: true, fieldNotesText: '# Prior\nExisting sentence.', fieldNotesDiff: '-Existing sentence.\n+Replacement sentence.' });
    for (const message of request.messages) {
      expect(JSON.stringify(message)).toContain('Replacement sentence.'); expect(JSON.stringify(message)).toContain('Existing sentence.');
    }
    const changed = buildDeepInfraRequest({ ...requestOptions, expectFieldNotesMd: true, fieldNotesText: '# Prior\nExisting sentence.', fieldNotesDiff: '-Existing sentence.\n+Other sentence.' });
    expect(deepinfraRequestIdentity({ request: changed })).not.toBe(deepinfraRequestIdentity({ request }));
  });
  it.each([
    ['extra key', x => { x.extra = true; }],
    ['missing filename', x => { x.decisions = []; }],
    ['duplicate filename', x => { x.decisions.push(x.decisions[0]); }],
    ['unknown filename', x => { x.decisions[0].filename = 'two.jpg'; }],
    ['bad decision', x => { x.decisions[0].decision = 'maybe'; }],
    ['no final question', x => { x.minutes[0].text = 'Final statement.'; }],
    ['extra minute field', x => { x.minutes[0].private = true; }],
    ['empty reason', x => { x.decisions[0].reason = ''; }],
  ])('rejects %s without salvaging decisions', (_, mutate) => { const value = structuredClone(reply); mutate(value); expect(deepinfraReplyIssues(value, ['one.jpg']).length).toBeGreaterThan(0); });
  it('binds cache identity to complete request bytes and original image hashes', () => {
    const request = buildDeepInfraRequest(requestOptions);
    const identity = { request, originalImages: [{ filename: 'one.jpg', sha256: 'a'.repeat(64) }] };
    const key = deepinfraRequestIdentity(identity);
    expect(key).toMatch(/^hosted-v1-[a-f0-9]{64}$/);
    for (const change of [x => { x.request.model = 'other'; }, x => { x.request.messages[0].content += '!'; }, x => { x.originalImages[0].sha256 = 'b'.repeat(64); }, x => { x.endpoint = 'https://api.deepinfra.com/v2/openai'; }, x => { x.profile = 'future'; }, x => { x.codeIdentity = { codeRevision: 'b'.repeat(40), codeSha256: 'a'.repeat(64) }; }]) {
      const changed = structuredClone(identity); change(changed); expect(deepinfraRequestIdentity(changed)).not.toBe(key);
    }
  });
  it('captures known billing categories and retains missing categories as unknown', () => {
    expect(normalizeDeepInfraUsage(result().usage)).toEqual({ inputTokens: 100, cachedInputTokens: 20, cacheWriteTokens: null, outputTokens: 30, reasoningTokens: 10, outputIncludesReasoning: true });
    expect(normalizeDeepInfraUsage(null)).toEqual({ inputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: null, reasoningTokens: null, outputIncludesReasoning: true });
  });
  it.each(['https://images.example/one.jpg', 'data:image/jpeg;base64,', 'data:image/svg+xml;base64,eA=='])('holds unsupported image payload %s before submission', url => {
    const changed = structuredClone(requestOptions); changed.messages[1].content[1].image_url.url = url;
    expect(() => buildDeepInfraRequest(changed)).toThrow(/image/i);
  });
});

describe('DeepInfra submission and resumable holds', () => {
  let directory, image, journal, requests, options;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'photo-select-deepinfra-'));
    image = path.join(directory, 'one.jpg'); await writeFile(image, 'original image bytes');
    journal = memoryJournal(); requests = [];
    options = { prompt: 'Original prompt', images: [image], curators: ['A (exact)'], photoPeople: requestOptions.photoPeople, journal };
    vi.stubEnv('DEEPINFRA_API_KEY', 'dedicated-test-key'); vi.stubEnv('OPENAI_API_KEY', 'openai-secret-must-not-be-sent');
  });
  const provider = (requests, responses, settings = {}) => new DeepInfraProvider({ buildMessages: async () => ({ messages: structuredClone(messages), used: [settings.image] }), fetch: async (url, init) => { requests.push({ url, init, request: JSON.parse(init.body) }); const response = responses.shift(); if (response instanceof Error) throw response; return response; }, sleep: async () => {}, ...settings });
  it('uses only dedicated credentials and persists raw response, usage and provenance before returning', async () => {
    const p = provider(requests, [http(result())], { image });
    try {
      expect(await p.chat(options)).toBe(JSON.stringify(reply));
      expect(requests[0].url).toBe('https://api.deepinfra.com/v1/openai/chat/completions');
      expect(requests[0].init.headers.Authorization).toBe('Bearer dedicated-test-key');
      expect(requests[0].init.redirect).toBe('error');
      expect(JSON.stringify([...journal.values.values()])).not.toContain('dedicated-test-key');
      const saved = [...journal.values.values()][0];
      expect(saved.status).toBe('completed'); expect(saved.attempts[0].response.usage.estimated_cost).toBe(0.001);
      expect(saved.attempts[0].response.choices[0].message.reasoning_content).toBe('Provider reasoning.');
      expect(saved.originalImages[0].sha256).toMatch(/^[a-f0-9]{64}$/); expect(saved.submittedImages[0].sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(saved.originalImages[0].filename_sha256).toBe('703239fa3dea919c8ec4be274679b0c1466a9d1c12327b0804a4d14716394f01');
      expect(saved.providerEstimatedCost).toBe(0.001);
      expect(saved.identity.checkpoint).toBeNull(); expect(saved.json_validity_rate).toBe(1);
      expect(await p.chat(options)).toBe(JSON.stringify(reply)); expect(requests).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('repairs a malformed JSON reply once with frozen images, roster and targeted diagnostics', async () => {
    const events = []; const p = provider(requests, [http(result('{broken')), http(result())], { image });
    try {
      expect(await p.chat({ ...options, onProgress: event => events.push(event) })).toBe(JSON.stringify(reply));
      expect(requests).toHaveLength(2); expect(requests[1].request.messages.slice(0, 2)).toEqual(requests[0].request.messages);
      expect(requests[1].request.messages.at(-1).content).toContain('JSON_PARSE');
      expect(events).toContain('retry_recovered');
      expect([...journal.values.values()][0].retry_recovery_rate).toBe(1);
      const restarted = provider(requests, [http(result())], { image }); expect(await restarted.chat(options)).toBe(JSON.stringify(reply)); expect(requests).toHaveLength(2);
    } finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('emits a terminal repair suggestion and never retries the held result on restart', async () => {
    const p = provider(requests, [http(result('{broken')), http(result('{still broken'))], { image });
    try {
      await expect(p.chat(options)).rejects.toMatchObject({ code: 'DEEPINFRA_HELD', repairSuggestion: { type: 'repair_suggestion', patch: expect.any(String) } });
      expect([...journal.values.values()][0]).toMatchObject({ json_validity_rate: 0, contract_validity_rate: 0, retry_recovery_rate: 0 });
      await expect(p.chat(options)).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' }); expect(requests).toHaveLength(2);
    } finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it.each([['timeout', new Error('socket timeout')], ['server error', http({}, 503)], ['truncation', http(result(undefined, { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(reply) } }] }))]])('holds ambiguous %s without automatic submission', async (_, failure) => {
    const p = provider(requests, [failure, http(result())], { image });
    try {
      await expect(p.chat(options)).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' });
      await expect(p.chat(options)).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' }); expect(requests).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('retries only a definite 429 rejection within its bounded transport allowance', async () => {
    const p = provider(requests, [http({}, 429, { 'Retry-After': '0' }), http(result())], { image });
    try { expect(await p.chat(options)).toBe(JSON.stringify(reply)); expect(requests).toHaveLength(2); expect([...journal.values.values()][0].transportRetries).toBe(1); }
    finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('holds before network if durable preparation fails', async () => {
    const p = provider(requests, [http(result())], { image });
    try { await expect(p.chat({ ...options, journal: { load: async () => null, save: async () => { throw new Error('disk full'); } } })).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' }); expect(requests).toHaveLength(0); }
    finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('retains a completed result in memory when final persistence fails, without duplicate charge', async () => {
    const p = provider(requests, [http(result()), http(result())], { image }); let saves = 0;
    const failing = { ...journal, save: async (key, value) => { if (++saves > 1) throw new Error('disk full'); return journal.save(key, value); } };
    try { await expect(p.chat({ ...options, journal: failing })).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' }); await expect(p.chat({ ...options, journal: failing })).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' }); expect(requests).toHaveLength(1); }
    finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('rejects alternate destinations and missing dedicated credentials before a request', async () => {
    const p = provider(requests, [http(result())], { image });
    try {
      await expect(p.chat({ ...options, endpoint: 'https://elsewhere.example/v1/openai' })).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' });
      vi.stubEnv('DEEPINFRA_API_KEY', ''); await expect(p.chat(options)).rejects.toThrow(/DEEPINFRA_API_KEY/); expect(requests).toHaveLength(0);
    } finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('treats an empty optional endpoint environment variable as the official default', async () => {
    vi.stubEnv('DEEPINFRA_BASE_URL', ''); const p = provider(requests, [http(result())], { image });
    try { expect(await p.chat(options)).toBe(JSON.stringify(reply)); expect(requests[0].url).toBe('https://api.deepinfra.com/v1/openai/chat/completions'); }
    finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('records uncertain transport attempts without treating absent failed usage as zero', async () => {
    const p = provider(requests, [new Error('private transport detail')], { image });
    try { await expect(p.chat(options)).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' }); const saved = [...journal.values.values()][0]; expect(saved.attempts[0]).toMatchObject({ outcome: 'ambiguous', usage: null, request_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }); expect(JSON.stringify(saved)).not.toContain('private transport detail'); }
    finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('preserves a definite billing pause through the provider and resume without another charge', async () => {
    const p = provider(requests, [http({}, 402), http(result())], { image });
    try {
      await expect(p.chat(options)).rejects.toMatchObject({ code: 'BILLING_LIMIT' });
      await expect(p.chat(options)).rejects.toMatchObject({ code: 'BILLING_LIMIT' }); expect(requests).toHaveLength(1);
      expect([...journal.values.values()][0]).toMatchObject({ status: 'held', error_code: 'BILLING_LIMIT' });
    } finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('does not submit credential-like prompt content or returned credentials', async () => {
    const secret = 'sk-proj-' + 'x'.repeat(30);
    const p = provider(requests, [http(result(JSON.stringify({ ...reply, minutes: [{ speaker: 'A', text: secret + '?' }] })))], { image });
    try {
      await expect(p.chat({ ...options, prompt: 'Contains ' + secret })).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' }); expect(requests).toHaveLength(0);
      await expect(p.chat(options)).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' }); expect(JSON.stringify([...journal.values.values()])).not.toContain(secret); expect(requests).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('revalidates completed private receipts instead of accepting a corrupted cached answer', async () => {
    const p = provider(requests, [http(result())], { image });
    try {
      await p.chat(options); const [key, saved] = [...journal.values.entries()][0]; saved.raw = JSON.stringify({ ...reply, decisions: [] }); journal.values.set(key, saved);
      const restarted = provider(requests, [http(result())], { image });
      await expect(restarted.chat(options)).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' }); expect(requests).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('defaults direct callers to the four contract voices and binds private code identity', async () => {
    journal.identity = { codeRevision: 'a'.repeat(40), codeSha256: 'b'.repeat(64) };
    const p = provider(requests, [http(result())], { image });
    try {
      await p.chat({ ...options, curators: [] }); const saved = [...journal.values.values()][0];
      expect(saved.curators).toEqual(['Ingeborg Gerdes', 'Alexandra Munroe', 'Deborah Treisman', 'Warren Sack']);
      expect(saved.codeIdentity).toEqual(journal.identity);
    } finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('redacts a host key echoed in response and never stores it in its private receipt', async () => {
    const echoed = result(JSON.stringify({ ...reply, minutes: [{ speaker: 'A', text: 'dedicated-test-key?' }] }));
    const p = provider(requests, [http(echoed)], { image });
    try { await expect(p.chat(options)).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' }); expect(JSON.stringify([...journal.values.values()])).not.toContain('dedicated-test-key'); }
    finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('rejects changed source bytes during encoding before any paid request', async () => {
    const p = provider(requests, [http(result())], { image, buildMessages: async () => { await writeFile(image, 'changed during encoding'); return { messages, used: [image] }; } });
    try { await expect(p.chat(options)).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' }); expect(requests).toHaveLength(0); }
    finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('bounds repeated definite rate-limit rejections without a repair attempt', async () => {
    const p = provider(requests, [http({}, 429), http({}, 429), http({}, 429), http(result())], { image });
    try { await expect(p.chat(options)).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' }); expect(requests).toHaveLength(3); expect([...journal.values.values()][0].status).toBe('held'); }
    finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('holds a valid JSON contract failure then preserves all valid minutes after its single repair', async () => {
    const restored = { ...reply, minutes: Array.from({ length: 4 }, (_, index) => ({ speaker: 'A', text: index === 3 ? 'Where next?' : `Minute ${index}` })) };
    const p = provider(requests, [http(result(JSON.stringify({ ...reply, decisions: [] }))), http(result(JSON.stringify(restored)))], { image });
    try {
      expect(JSON.parse(await p.chat({ ...options, minutesMax: 2 })).minutes).toEqual(restored.minutes); expect(requests).toHaveLength(2); expect(requests[1].request.messages.at(-1).content).toContain('DECISION_FILENAMES');
      const saved = [...journal.values.values()][0]; expect(saved.json_validity_rate).toBe(1); expect(saved.contract_validity_rate).toBe(0.5);
      expect(saved.warnings[0].code).toBe('MINUTES_COUNT_OUTSIDE_TARGET'); expect(saved.initial_request_sha256).not.toBe(saved.final_request_sha256); expect(saved.model_sha256).toBe(saved.final_request_sha256);
    }
    finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
  it('holds credential-like frozen people metadata and notebook inputs before submission', async () => {
    const secret = 'sk-proj-' + 'x'.repeat(30), p = provider(requests, [http(result())], { image });
    try {
      await expect(p.chat({ ...options, photoPeople: [{ file: 'one.jpg', people: [secret] }] })).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' });
      await expect(p.chat({ ...options, expectFieldNotesMd: true, fieldNotesText: secret, fieldNotesDiff: '+New sentence.' })).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' });
      expect(requests).toHaveLength(0);
    } finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
});
