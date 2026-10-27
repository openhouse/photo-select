import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createHostedJournal } from '../src/hostedRun.js';
import { HostedConcurrencyController } from '../src/core/hostedConcurrency.js';

const core = await import('../src/core/xiaomi.js').catch(() => null);
const adapter = await import('../src/providers/xiaomi.js').catch(() => null);
const roots = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const roster = Array.from({ length: 17 }, (_, index) => `Exact Curator ${index + 1} (context)`);
const filenames = Array.from({ length: 10 }, (_, index) => `${index + 1}.jpg`);
const ordinary = () => [{ role: 'system', content: 'Original custom brief: preserve its bytes and context.' }, { role: 'user', content: filenames.flatMap(filename => [{ type: 'text', text: JSON.stringify({ filename, people: ['Stale'] }) }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,eA==', detail: 'high' } }]) }];
const requestOptions = () => ({ messages: ordinary(), filenames, curators: roster, photoPeople: filenames.map(file => ({ file, people: ['Fresh Name'] })) });
const reply = () => ({ minutes: [{ speaker: roster[0], text: 'What should we examine next?' }], decisions: filenames.map(filename => ({ filename, decision: 'keep', reason: 'Visible shape.' })) });
const result = (content = JSON.stringify(reply()), changes = {}) => ({ model: 'mimo-v2.6-pro', choices: [{ finish_reason: 'stop', message: { content, reasoning_content: 'Provider reasoning.' } }], usage: { prompt_tokens: 100, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20, image_tokens: 70 }, completion_tokens_details: { reasoning_tokens: 10 } }, ...changes });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const requestControl = (overrides = {}) => ({ run: work => work(), observe: () => {}, stop: () => {}, assertRunning: () => {}, snapshot: () => ({ targetConcurrency: 1, maxConcurrency: 1 }), ...overrides });
function buildRequest(options = requestOptions()) { expect(core?.buildXiaomiRequest).toBeTypeOf('function'); return core.buildXiaomiRequest(options); }

describe('Xiaomi direct request boundary', () => {
  it('preserves ten ordered images, the ordinary prompt and all seventeen exact curator names', () => {
    const request = buildRequest();
    expect(request.model).toBe('mimo-v2.6-pro'); expect(request.stream).toBe(false);
    expect(request.max_completion_tokens).toBe(8192); expect(request.response_format).toEqual({ type: 'json_object' });
    expect(request).not.toHaveProperty('max_tokens'); expect(request).not.toHaveProperty('reasoning_effort'); expect(request).not.toHaveProperty('thinking');
    expect(request.messages[0].content).toContain(ordinary()[0].content);
    expect(request.messages[1].content.filter(part => part.type === 'image_url')).toHaveLength(10);
    expect(request.messages[1].content.filter(part => part.type === 'image_url').every(part => !('detail' in part.image_url))).toBe(true);
    expect(JSON.stringify(request)).not.toContain('Stale');
    for (const message of request.messages) for (const name of roster) expect(JSON.stringify(message)).toContain(name);
    for (const filename of filenames) expect(request.messages[0].content).toContain(filename);
    expect(ordinary()[1].content[1].image_url.detail).toBe('high');
  });
  it('rejects eleven photos before any request is constructed', () => {
    expect(() => buildRequest({ ...requestOptions(), filenames: [...filenames, 'eleven.jpg'] })).toThrow(/at most 10|ten images/i);
  });
  it('rejects unequal image and filename counts', () => {
    expect(() => buildRequest({ ...requestOptions(), filenames: filenames.slice(1) })).toThrow(/image|whitelist/i);
  });
  it.each(['minimal', 'low', 'medium', 'high', 'xhigh'])('holds unverified reasoning setting %s', reasoningEffort => {
    expect(() => buildRequest({ ...requestOptions(), reasoningEffort })).toThrow(/reasoning/i);
  });
  it('holds verbosity and an unsupported model', () => {
    expect(() => buildRequest({ ...requestOptions(), verbosity: 'high' })).toThrow(/verbosity/i);
    expect(() => buildRequest({ ...requestOptions(), model: 'gpt-6.1-terra' })).toThrow(/model|mimo/i);
  });
  it('gives both Act II messages the same notebook, diff, roster and field-notes-only schema', () => {
    const request = buildRequest({ ...requestOptions(), expectFieldNotesMd: true, fieldNotesText: '# Existing notebook', fieldNotesDiff: 'Add a careful comparison.' });
    const guard = request.messages[1].content.at(-1).text;
    expect(request.messages[0].content.endsWith(guard)).toBe(true);
    expect(guard).toContain('# Existing notebook'); expect(guard).toContain('Add a careful comparison.');
    expect(guard).toContain('field_notes_md'); expect(guard).not.toContain('"minutes"'); expect(guard).not.toContain('"decisions"');
    expect(request.messages[1].content.filter(part => part.type === 'image_url')).toHaveLength(10);
  });
});

async function fixture(responses = [], extra = {}) {
  expect(adapter?.default).toBeTypeOf('function');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaomi-provider-')); roots.push(root);
  const source = path.join(root, 'photos'); await fs.mkdir(source);
  const images = filenames.map(name => path.join(source, name)); await Promise.all(images.map(file => fs.writeFile(file, 'original image bytes')));
  const journal = await createHostedJournal({ source, base: path.join(root, 'audit'), provider: 'xiaomi' });
  const calls = [];
  vi.stubEnv('MIMO_API_KEY', 'dedicated-xiaomi-test-key'); vi.stubEnv('MIMO_BASE_URL', ''); vi.stubEnv('OPENAI_API_KEY', 'wrong-openai-key'); vi.stubEnv('DEEPINFRA_API_KEY', 'wrong-deepinfra-key');
  const provider = new adapter.default({ journal, buildMessages: async () => ({ messages: ordinary(), used: images }), fetch: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); const next = responses.shift(); if (next instanceof Error) throw next; if (!next) throw new Error('Unexpected extra inference'); return next; }, ...extra });
  const options = { prompt: 'Original custom brief: preserve its bytes and context.', images, curators: roster, photoPeople: requestOptions().photoPeople };
  const records = async () => Promise.all((await fs.readdir(path.join(journal.root, 'requests'))).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await fs.readFile(path.join(journal.root, 'requests', name), 'utf8'))));
  return { root, source, images, journal, calls, provider, options, records };
}
describe('Xiaomi submission with real durable journal', () => {
  it('uses dedicated credentials and commits response plus notebook before returning; restart performs zero fetches', async () => {
    const item = await fixture([response(result())]);
    const raw = await item.provider.chat(item.options);
    expect(JSON.parse(raw)).toEqual(reply());
    expect(item.calls[0].url).toBe('https://api.xiaomimimo.com/v1/chat/completions'); expect(item.calls[0].init.redirect).toBe('error');
    expect(item.calls[0].init.headers.Authorization).toBe('Bearer dedicated-xiaomi-test-key');
    expect(item.provider.hostedCuration).toMatchObject({ provider: 'xiaomi', maxImages: 10, credentialEnv: 'MIMO_API_KEY', label: 'Xiaomi' });
    const [record] = await item.records();
    expect(record).toMatchObject({ status: 'completed', identity: { provider: 'xiaomi', model: 'mimo-v2.6-pro', checkpoint: null }, returnedModel: 'mimo-v2.6-pro', json_validity_rate: 1 });
    expect(record.originalImages).toHaveLength(10); expect(record.submittedImages).toHaveLength(10);
    expect(record.model_sha256).toMatch(/^[a-f0-9]{64}$/); expect(record.key).toMatch(/^xiaomi-v3-/);
    expect(JSON.stringify(record)).not.toContain('dedicated-xiaomi-test-key'); expect(record.normalizedUsage).toMatchObject({ inputTokens: 100, cachedInputTokens: 20, outputTokens: 30, reasoningTokens: 10, imageTokens: 70, outputIncludesReasoning: true });
    expect(record.providerEstimatedCost).toBeNull();
    const changed = execFileSync('git', ['-C', item.journal.root, 'show', '--pretty=', '--name-only', 'HEAD'], { encoding: 'utf8' });
    expect(changed).toContain('requests/'); expect(changed).toContain('field-notes.md');
    expect((await fs.stat(path.join(item.journal.root, 'requests', record.key + '.json'))).mode & 0o777).toBe(0o600);
    const restarted = new adapter.default({ journal: item.journal, buildMessages: async () => ({ messages: ordinary(), used: item.images }), fetch: async () => { throw new Error('A cached request must not fetch'); } });
    expect(await restarted.chat(item.options)).toBe(raw);
  });
  it('repairs a closing-question failure once and preserves the frozen original messages', async () => {
    const invalid = reply(); invalid.minutes[0].text = 'A final statement.';
    const item = await fixture([response(result(JSON.stringify(invalid))), response(result())]);
    const events = []; await item.provider.chat({ ...item.options, onProgress: event => events.push(event) });
    expect(item.calls).toHaveLength(2); expect(item.calls[1].body.messages.slice(0, 2)).toEqual(item.calls[0].body.messages);
    expect(item.calls[1].body.messages.at(-1).content).toContain('FINAL_QUESTION'); expect(events).toContain('retry_recovered');
    const [record] = await item.records(); expect(record).toMatchObject({ contract_validity_rate: 0.5, retry_recovery_rate: 1, retry_recovered: true });
  });
  it('repairs mixed minutes/string output with the complete frozen phase schema and root-level decision directions', async () => {
    const malformed = { minutes: [...reply().minutes, 'DECISIONS_JSON belongs elsewhere'] };
    const item = await fixture();
    item.provider.fetch = async (url, init) => {
      const body = JSON.parse(init.body); item.calls.push({ url, init, body });
      if (item.calls.length === 1) return response(result(JSON.stringify(malformed)));
      const repair = body.messages.at(-1).content;
      const complete = repair.includes('"required":["minutes","decisions","field_notes_diff"]')
        && repair.includes('"filename":"1.jpg","decision":"keep"')
        && repair.includes('Never put decisions or JSON/Markdown strings inside minutes.')
        && roster.every(name => repair.includes(name)) && filenames.every(name => repair.includes(name));
      return response(result(JSON.stringify(complete ? { ...reply(), field_notes_diff: '' } : malformed)));
    };
    expect(JSON.parse(await item.provider.chat({ ...item.options, expectFieldNotesDiff: true }))).toEqual({ ...reply(), field_notes_diff: '' });
    expect(item.calls).toHaveLength(2); expect(item.calls[1].body.messages.slice(0, 2)).toEqual(item.calls[0].body.messages);
    expect(item.calls[1].body.messages.at(-1).content).toContain(item.calls[0].body.messages[1].content.at(-1).text);
  });
  it('holds after two parse failures and never resubmits a held receipt', async () => {
    const item = await fixture([response(result('{broken')), response(result('{still broken'))]);
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD', repairSuggestion: { type: 'repair_suggestion', patch: expect.any(String) } });
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(item.calls).toHaveLength(2);
    expect((await item.records())[0]).toMatchObject({ status: 'held', json_validity_rate: 0, repair_suggestion: { type: 'repair_suggestion' } });
  });
  it.each([['billing', 402, 'BILLING_LIMIT'], ['rate limit', 429, 'XIAOMI_HELD'], ['server failure', 503, 'XIAOMI_HELD']])('holds %s without automatic transport retry or zero-cost fiction', async (_, status, code) => {
    const item = await fixture([response({ error: 'Rejected.' }, status)]);
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code });
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code }); expect(item.calls).toHaveLength(1);
    expect((await item.records())[0].attempts[0].usage).toBeNull();
  });
  it('holds uncertain transport without preserving raw exception details or resubmitting', async () => {
    const item = await fixture([new Error('sensitive socket detail')]);
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' });
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(item.calls).toHaveLength(1);
    const [record] = await item.records(); expect(record.attempts[0]).toMatchObject({ outcome: 'ambiguous', usage: null }); expect(JSON.stringify(record)).not.toContain('sensitive socket detail');
  });
  it('preserves a billing pause even when the 402 error body is not JSON', async () => {
    const item = await fixture([new Response('Payment required', { status: 402 })]);
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'BILLING_LIMIT' });
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'BILLING_LIMIT' }); expect(item.calls).toHaveLength(1);
    expect((await item.records())[0].attempts[0]).toMatchObject({ status: 402, usage: null, responseBodyUnreadable: true });
  });
  it('retries completed-result persistence without repeating a paid request', async () => {
    const item = await fixture([response(result())]);
    const save = item.journal.save; let failOnce = true;
    item.journal.save = async (key, record) => { if (record.status === 'completed' && failOnce) { failOnce = false; throw new Error('Simulated disk write interruption'); } return save(key, record); };
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' });
    expect(await item.provider.chat(item.options)).toBe(JSON.stringify(reply())); expect(item.calls).toHaveLength(1);
    expect((await item.records())[0].status).toBe('completed');
    expect(execFileSync('git', ['-C', item.journal.root, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('');
  });
  it.each(['another-model', undefined])('holds returned model %s without repair', async returnedModel => {
    const item = await fixture([response(result(undefined, { model: returnedModel }))]);
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(item.calls).toHaveLength(1);
    expect((await item.records())[0].reason).toMatch(/model/i);
  });
  it('holds a truncated reply without repair', async () => {
    const item = await fixture([response(result(undefined, { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(reply()) } }] }))]);
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(item.calls).toHaveLength(1);
  });
  it.each(['http://api.xiaomimimo.com/v1', 'https://api.xiaomimimo.com.evil.example/v1', 'https://elsewhere.example/v1'])('holds credential destination %s before upload', async endpoint => {
    const item = await fixture(); await expect(item.provider.chat({ ...item.options, endpoint })).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(item.calls).toHaveLength(0);
  });
  it('never falls back from missing MIMO_API_KEY to another provider key', async () => {
    const item = await fixture(); vi.stubEnv('MIMO_API_KEY', '');
    await expect(item.provider.chat(item.options)).rejects.toThrow(/MIMO_API_KEY/); expect(item.calls).toHaveLength(0);
  });
  it('requires code-verifiable durable journals before preparing paid work', async () => {
    const item = await fixture(); delete item.journal.verifyCodeIdentity;
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' });
    expect(item.calls).toHaveLength(0); expect(await item.records()).toHaveLength(0);
  });
  it('holds if image bytes change during encoding', async () => {
    const item = await fixture(); item.provider.buildMessages = async () => { await fs.writeFile(item.images[0], 'changed during preparation'); return { messages: ordinary(), used: item.images }; };
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(item.calls).toHaveLength(0);
  });
  it('rejects a mismatching frozen source baseline before any paid preparation', async () => {
    const item = await fixture();
    const expectedSourceHashes = filenames.map(filename => ({ filename, sha256: '0'.repeat(64) }));
    await expect(item.provider.chat({ ...item.options, expectedSourceHashes })).rejects.toMatchObject({ code: 'XIAOMI_HELD' });
    expect(item.calls).toHaveLength(0); expect(await item.records()).toHaveLength(0);
  });
  it('preserves the same frozen source hash baseline across triage and Act II', async () => {
    const item = await fixture([response(result()), response(result(JSON.stringify({ field_notes_md: '# Should not be accepted' })))]);
    const expectedSourceHashes = filenames.map(filename => ({ filename, sha256: createHash('sha256').update('original image bytes').digest('hex') }));
    await item.provider.chat({ ...item.options, expectedSourceHashes });
    await fs.writeFile(item.images[0], 'changed between phases');
    await expect(item.provider.chat({ ...item.options, expectedSourceHashes, expectFieldNotesMd: true })).rejects.toMatchObject({ code: 'XIAOMI_HELD' });
    expect(item.calls).toHaveLength(1);
  });
  it('requires an exact unique expected source roster rather than ignoring missing or duplicate bindings', async () => {
    const item = await fixture();
    for (const expectedSourceHashes of [null, [], filenames.map(() => ({ filename: '1.jpg', sha256: 'a'.repeat(64) }))]) {
      await expect(item.provider.chat({ ...item.options, expectedSourceHashes })).rejects.toMatchObject({ code: 'XIAOMI_HELD' });
    }
    expect(item.calls).toHaveLength(0);
  });
  it('rechecks image hashes before a repair rather than submitting changed source bytes', async () => {
    const item = await fixture(); item.provider.fetch = async (url, init) => { item.calls.push({ url, init }); await fs.writeFile(item.images[0], 'changed after submission'); return response(result('{broken')); };
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(item.calls).toHaveLength(1);
  });
  it('requires journal code identity verification before every paid POST', async () => {
    const item = await fixture([response(result('{broken'))]); let checked = 0;
    item.journal.verifyCodeIdentity = async () => { if (++checked > 1) throw new Error('Code changed.'); };
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(item.calls).toHaveLength(1); expect(checked).toBe(2);
  });
  it('checks source bytes after progress callbacks before submitting', async () => {
    const item = await fixture([response(result())]);
    await expect(item.provider.chat({ ...item.options, onProgress: async stage => { if (stage === 'request') await fs.writeFile(item.images[0], 'changed by request callback'); } })).rejects.toMatchObject({ code: 'XIAOMI_HELD' });
    expect(item.calls).toHaveLength(0);
  });
  it('checks source bytes after prepared-attempt persistence before submitting', async () => {
    const item = await fixture([response(result())]), save = item.journal.save;
    item.journal.save = async (key, record) => { await save(key, record); if (record.status === 'prepared' && record.attempts.length) await fs.writeFile(item.images[0], 'changed during persistence'); };
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(item.calls).toHaveLength(0);
  });
  it('checks frozen context/template inputs after prepared-attempt persistence before submitting', async () => {
    const item = await fixture([response(result())]), save = item.journal.save;
    let changed = false;
    item.journal.save = async (key, record) => { await save(key, record); if (record.status === 'prepared' && record.attempts.length) changed = true; };
    const verifyInputs = async () => { if (changed) throw new Error('Context or prompt changed.'); };
    await expect(item.provider.chat({ ...item.options, verifyInputs })).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(item.calls).toHaveLength(0);
  });
  it('rechecks context/template inputs before the one permitted repair', async () => {
    const item = await fixture([response(result('{broken')), response(result())]); let checks = 0;
    const verifyInputs = async () => { if (++checks === 2) throw new Error('Context changed between attempts.'); };
    await expect(item.provider.chat({ ...item.options, verifyInputs })).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(item.calls).toHaveLength(1); expect(checks).toBe(2);
  });
  it('redacts echoed host credentials and holds the response', async () => {
    const invalid = reply(); invalid.minutes[0].text = 'dedicated-xiaomi-test-key?';
    const item = await fixture([response(result(JSON.stringify(invalid)))]);
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(JSON.stringify(await item.records())).not.toContain('dedicated-xiaomi-test-key');
  });
  it('holds credential-like notebook data before private persistence and upload', async () => {
    const item = await fixture();
    await expect(item.provider.chat({ ...item.options, fieldNotesText: 'dedicated-xiaomi-test-key', expectFieldNotesDiff: true })).rejects.toMatchObject({ code: 'XIAOMI_HELD' });
    expect(item.calls).toHaveLength(0); expect(await item.records()).toHaveLength(0);
  });
  it('validates Act II separately and records the notebook response in the same private commit', async () => {
    const item = await fixture([response(result(JSON.stringify({ field_notes_md: '# Updated notebook\n' })))]);
    await item.provider.chat({ ...item.options, expectFieldNotesMd: true, fieldNotesText: '# Prior notebook', fieldNotesDiff: 'Update the comparison.' });
    expect(await fs.readFile(path.join(item.journal.root, 'field-notes.md'), 'utf8')).toBe('# Updated notebook\n');
    expect((await item.records())[0].json).toEqual({ field_notes_md: '# Updated notebook\n' });
  });
  it('admits every paid repair through the shared request controller and records capacity provenance', async () => {
    let admitted = false;
    const controller = requestControl({ run: async work => { admitted = true; try { return await work(); } finally { admitted = false; } } });
    const item = await fixture([], { requestController: controller });
    item.provider.fetch = async (url, init) => { if (!admitted) throw new Error('POST escaped admission'); item.calls.push({ url, init }); return response(result(item.calls.length === 1 ? '{broken' : undefined)); };
    expect(JSON.parse(await item.provider.chat(item.options))).toEqual(reply()); expect(item.calls).toHaveLength(2);
    const [record] = await item.records();
    for (const attempt of record.attempts) expect(attempt.admission).toMatchObject({ admittedAt: expect.any(String), snapshot: { targetConcurrency: 1, maxConcurrency: 1 } });
  });
  it('records a stopped queued request as not submitted without mislabeling it ambiguous', async () => {
    const controller = requestControl({ run: async () => { throw Object.assign(new Error('Pool billing stop.'), { code: 'BILLING_LIMIT' }); } });
    const item = await fixture([response(result())], { requestController: controller });
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'BILLING_LIMIT' }); expect(item.calls).toHaveLength(0);
    const [record] = await item.records(); expect(record.status).toBe('held'); expect(record.attempts[0]).toMatchObject({ outcome: 'not-submitted', usage: null });
    expect(record.attempts[0]).not.toHaveProperty('submittedAt');
  });
  it('checks frozen inputs at actual admission after any queue delay', async () => {
    const item = await fixture([response(result())]);
    item.provider.requestController = requestControl({ run: async work => { await fs.writeFile(item.images[0], 'changed while queued'); return work(); } });
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(item.calls).toHaveLength(0);
  });
  it('stops the shared queue upon HTTP402 before consuming its response body', async () => {
    let stopped = false, stoppedBeforeBody = false;
    const controller = requestControl({ stop: error => { stopped = error.code === 'BILLING_LIMIT'; } });
    const billing = { ok: false, status: 402, headers: new Headers(), json: async () => { stoppedBeforeBody = stopped; return { error: 'Billing exhausted' }; } };
    const item = await fixture([billing], { requestController: controller });
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'BILLING_LIMIT' }); expect(item.calls).toHaveLength(1); expect(stoppedBeforeBody).toBe(true);
  });
  it('reports definite429 capacity feedback without retrying or releasing a fatal request first', async () => {
    const observations = []; let stopped = false;
    const controller = requestControl({ observe: entry => observations.push(entry), stop: () => { stopped = true; } });
    const item = await fixture([new Response('{"error":"Capacity"}', { status: 429, headers: { 'Retry-After': '3' } })], { requestController: controller });
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(item.calls).toHaveLength(1); expect(stopped).toBe(true);
    expect(observations).toContainEqual(expect.objectContaining({ status: 429, retryAfterMs: 3000, outcome: 'rejected', latencyMs: expect.any(Number) }));
  });
  it('reuses a same-instance completed receipt without changing it or entering the controller again', async () => {
    const item = await fixture([response(result())]);
    const first = await item.provider.chat(item.options);
    expect(await item.provider.chat(item.options)).toBe(first); expect(item.calls).toHaveLength(1);
    expect(item.provider.requestController.snapshot().launched).toBe(1);
  });
  it('bounds actual overlapping POSTs across distinct parallel chat calls with one shared controller', async () => {
    const controller = new HostedConcurrencyController({ maxConcurrency: 2 });
    const item = await fixture([], { requestController: controller });
    item.provider.buildMessages = async prompt => { const messages = ordinary(); messages[0].content = prompt; return { messages, used: item.images }; };
    let release, active = 0, maximum = 0;
    const gate = new Promise(resolve => { release = resolve; });
    item.provider.fetch = async (url, init) => { item.calls.push({ url, init }); active++; maximum = Math.max(maximum, active); await gate; active--; return response(result()); };
    const requests = Array.from({ length: 6 }, (_, index) => item.provider.chat({ ...item.options, prompt: `Independent batch ${index}` }));
    const settled = Promise.allSettled(requests);
    let outcomes;
    try {
      await vi.waitFor(() => { expect(item.calls).toHaveLength(2); expect(controller.snapshot().queued).toBe(4); }, { timeout: 3000 });
      expect(maximum).toBe(2);
    } finally { release(); outcomes = await settled; }
    expect(outcomes.every(outcome => outcome.status === 'fulfilled')).toBe(true); expect(item.calls).toHaveLength(6); expect(maximum).toBe(2);
    expect((await item.records()).every(record => record.status === 'completed')).toBe(true);
  });
  it('halts all queued chats on billing while preserving the one actually submitted attempt', async () => {
    const controller = new HostedConcurrencyController();
    const item = await fixture([], { requestController: controller });
    item.provider.buildMessages = async prompt => { const messages = ordinary(); messages[0].content = prompt; return { messages, used: item.images }; };
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    item.provider.fetch = async (url, init) => { item.calls.push({ url, init }); await gate; return response({ error: 'Credits exhausted' }, 402); };
    const requests = Array.from({ length: 4 }, (_, index) => item.provider.chat({ ...item.options, prompt: `Billing batch ${index}` }));
    const settled = Promise.allSettled(requests);
    await vi.waitFor(() => expect(controller.snapshot().queued).toBe(3)); release();
    const outcomes = await settled; expect(outcomes.every(outcome => outcome.status === 'rejected' && outcome.reason.code === 'BILLING_LIMIT')).toBe(true);
    expect(item.calls).toHaveLength(1);
    const records = await item.records();
    expect(records).toHaveLength(4); expect(records.every(record => record.status === 'held')).toBe(true);
    expect(records.flatMap(record => record.attempts).filter(attempt => attempt.outcome === 'not-submitted')).toHaveLength(3);
  });
  it('latches a failed preflight so subsequent uncached work cannot reach a paid POST', async () => {
    const item = await fixture([response(result())]);
    await expect(item.provider.chat({ ...item.options, prompt: 'Contains dedicated-xiaomi-test-key' })).rejects.toMatchObject({ code: 'XIAOMI_HELD' });
    await expect(item.provider.chat(item.options)).rejects.toMatchObject({ code: 'XIAOMI_HELD' }); expect(item.calls).toHaveLength(0);
    expect(item.provider.requestController.snapshot().stopped).toBe(true);
  });
  it('rechecks a billing stop after an admitted task finishes its awaited input guards', async () => {
    const controller = new HostedConcurrencyController({ maxConcurrency: 2 });
    const item = await fixture([], { requestController: controller });
    item.provider.buildMessages = async prompt => { const messages = ordinary(); messages[0].content = prompt; return { messages, used: item.images }; };
    let releaseBilling, releaseGuard, guarded, submitted;
    const billingGate = new Promise(resolve => { releaseBilling = resolve; });
    const guardGate = new Promise(resolve => { releaseGuard = resolve; });
    const guardEntered = new Promise(resolve => { guarded = resolve; });
    const postEntered = new Promise(resolve => { submitted = resolve; });
    item.provider.fetch = async (url, init) => { item.calls.push({ url, init }); submitted(); await billingGate; return response({ error: 'Credits exhausted' }, 402); };
    const first = item.provider.chat({ ...item.options, prompt: 'Billing request' });
    const second = item.provider.chat({ ...item.options, prompt: 'Guarded request', verifyInputs: async () => { guarded(); await guardGate; } });
    const settled = Promise.allSettled([first, second]);
    let outcomes;
    try {
      await Promise.all([guardEntered, postEntered]); releaseBilling();
      await vi.waitFor(() => expect(controller.snapshot().stopped).toBe(true));
    } finally { releaseBilling(); releaseGuard(); outcomes = await settled; }
    expect(outcomes.every(outcome => outcome.status === 'rejected' && outcome.reason.code === 'BILLING_LIMIT')).toBe(true);
    expect(item.calls).toHaveLength(1);
    const attempts = (await item.records()).flatMap(record => record.attempts);
    expect(attempts.filter(attempt => attempt.outcome === 'not-submitted')).toHaveLength(1);
    expect(attempts.filter(attempt => attempt.submittedAt)).toHaveLength(1);
  });
});
