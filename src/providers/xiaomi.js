import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CURATORS } from '../core/knowledgeLive.js';
import { credentialLike } from '../core/githubBridge.js';
import { HostedConcurrencyController } from '../core/hostedConcurrency.js';
import { deepinfraReplyIssues, deepinfraAttemptMetrics, hostedSha256 } from '../core/deepinfra.js';
import { XIAOMI_MODEL, XIAOMI_BASE_URL, XIAOMI_PROFILE, XIAOMI_MAX_IMAGES, xiaomiHeld, buildXiaomiRequest, buildXiaomiRepairRequest, xiaomiRequestIdentity, normalizeXiaomiUsage, redactXiaomiResponse, validateXiaomiConfiguration } from '../core/xiaomi.js';

const sharedMessages = async (...args) => (await import('../chatClient.js')).buildMessages(...args);
const isHold = error => ['XIAOMI_HELD', 'BILLING_LIMIT'].includes(error?.code);
const boundedRetryAfter = (headers, now) => {
  const value = headers?.get?.('retry-after');
  if (value === null || value === undefined || value === '') return undefined;
  const seconds = Number(value), milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? Math.min(30000, milliseconds) : undefined;
};
export default class XiaomiProvider {
  name = 'xiaomi'; supportsAsync = false; preventAutomaticResubmit = true;
  hostedCuration = Object.freeze({ provider: 'xiaomi', profile: XIAOMI_PROFILE, maxImages: XIAOMI_MAX_IMAGES, credentialEnv: 'MIMO_API_KEY', label: 'Xiaomi' });
  constructor({ fetch = globalThis.fetch, buildMessages = sharedMessages, journal, now = Date.now, requestController = new HostedConcurrencyController() } = {}) { Object.assign(this, { fetch, buildMessages, journal, now, requestController }); this.pending = new Map(); }
  async submit(options = {}) { return { promise: this.chat(options) }; }
  async collect(handle) { const raw = await handle.promise; return { raw, json: JSON.parse(raw) }; }
  async chat(options = {}) {
    try { return await this.#chat(options); }
    catch (error) {
      const held = isHold(error) ? error : xiaomiHeld('Xiaomi request held; inspect the private run before further paid work.');
      if (typeof this.requestController?.stop === 'function') this.requestController.stop(held);
      throw held;
    }
  }
  async #chat(options) {
    const { prompt, images = [], curators = [], photoPeople, onProgress = () => {}, savePayload, verifyInputs, journal = this.journal } = options;
    const apiKey = process.env.MIMO_API_KEY?.trim();
    const configuration = validateXiaomiConfiguration({ endpoint: options.endpoint ?? (process.env.MIMO_BASE_URL || XIAOMI_BASE_URL), model: options.model ?? XIAOMI_MODEL, reasoningEffort: options.reasoningEffort ?? 'auto', apiKey });
    if (typeof prompt !== 'string' || !prompt.trim()) throw xiaomiHeld('Xiaomi requires a rendered nonempty prompt.');
    if (credentialLike(prompt) || prompt.includes(apiKey)) throw xiaomiHeld('Credential-like prompt content is held before upload.');
    if (!journal || typeof journal.load !== 'function' || typeof journal.save !== 'function' || typeof journal.verifyCodeIdentity !== 'function') throw xiaomiHeld('Xiaomi requires a code-verifiable durable private journal before submission.');
    if (!this.requestController || ['run', 'observe', 'stop', 'snapshot', 'assertRunning'].some(method => typeof this.requestController[method] !== 'function')) throw xiaomiHeld('Xiaomi requires a shared bounded request controller.');
    if (verifyInputs !== undefined && typeof verifyInputs !== 'function') throw xiaomiHeld('The frozen-input verifier must be a function.');
    const filenames = images.map(file => path.basename(file));
    const expectedSourceHashes = options.expectedSourceHashes === undefined ? null : structuredClone(options.expectedSourceHashes);
    if (options.expectedSourceHashes !== undefined && (!Array.isArray(expectedSourceHashes) || expectedSourceHashes.length !== filenames.length || new Set(expectedSourceHashes.map(item => item?.filename)).size !== filenames.length || expectedSourceHashes.some(item => !filenames.includes(item?.filename) || typeof item?.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)))) throw xiaomiHeld('Expected source hashes must bind every exact filename once to a SHA-256 hash.');
    const originalImages = await Promise.all(images.map(async (file, index) => ({ filename: filenames[index], filename_sha256: hostedSha256(filenames[index]), sha256: hostedSha256(await readFile(file)) })));
    const sourceBaseline = new Map((expectedSourceHashes ?? originalImages).map(item => [item.filename, item.sha256]));
    if (originalImages.some(image => image.sha256 !== sourceBaseline.get(image.filename))) throw xiaomiHeld('Source images do not match the frozen batch hashes; no request was submitted.');
    const verifySources = async () => {
      try {
        const current = await Promise.all(images.map(async file => hostedSha256(await readFile(file))));
        if (current.some((hash, index) => hash !== sourceBaseline.get(filenames[index]))) throw new Error('Changed image.');
      } catch { throw xiaomiHeld('Source images changed after preparation; no further request was submitted.'); }
    };
    const roster = Object.freeze(curators.length ? [...curators] : [...CURATORS]); onProgress('encoding');
    const { messages, used } = await this.buildMessages(prompt, images, roster, { photoPeople });
    if (used?.length !== images.length || used.some((file, index) => file !== images[index])) throw xiaomiHeld('Image preparation did not preserve the complete ordered whitelist.');
    const request = buildXiaomiRequest({ ...options, ...configuration, messages, filenames, curators: roster, photoPeople });
    if (credentialLike(request) || JSON.stringify(request).includes(apiKey)) throw xiaomiHeld('Credential-like request or notebook data is held before private persistence and upload.');
    await verifySources();
    const submittedImages = request.messages[1].content.filter(part => part.type === 'image_url').map((part, index) => ({ filename: filenames[index], sha256: hostedSha256(Buffer.from(part.image_url.url.split(',')[1], 'base64')) }));
    const codeIdentity = journal.identity ?? null;
    const key = xiaomiRequestIdentity({ request, originalImages, endpoint: configuration.endpoint, codeIdentity });
    const work = async () => {
      let record = this.pending.get(key) || await journal.load(key);
      if (record) {
        if (record.status !== 'completed') throw xiaomiHeld('A previous Xiaomi request is held or incomplete; inspect its private receipt before any new paid work.', record.error_code === 'BILLING_LIMIT' ? { code: 'BILLING_LIMIT' } : {});
        let cached; try { cached = JSON.parse(record.raw); } catch { throw xiaomiHeld('Completed private receipt failed validation.'); }
        if (record.identity?.provider !== 'xiaomi' || record.returnedModel !== XIAOMI_MODEL || deepinfraReplyIssues(cached, filenames, options).length || JSON.stringify(cached) !== JSON.stringify(record.json) || record.key !== key || record.model_sha256 !== hostedSha256(record.submittedRequest) || xiaomiRequestIdentity({ request: record.request, originalImages: record.originalImages, endpoint: configuration.endpoint, codeIdentity }) !== key) throw xiaomiHeld('Completed private receipt failed validation.');
        await this.persist(journal, key, record); return record.raw;
      }
      record = { status: 'prepared', key, identity: { provider: 'xiaomi', endpoint: configuration.endpoint, transport: 'chat-completions', model: configuration.model, advertisedPrecision: null, checkpoint: null, capabilityProfile: XIAOMI_PROFILE, requestedReasoningEffort: configuration.reasoningEffort, acceptedReasoningEffort: null, verifiedReasoningEffort: null, responseMode: 'json_object-local-validation' }, codeIdentity, originalImages, expectedSourceHashes, submittedImages, curators: roster, prompt_sha256: hostedSha256(prompt), model_sha256: hostedSha256(request), initial_request_sha256: hostedSha256(request), request, createdAt: new Date(this.now()).toISOString(), attempts: [], transportRetries: 0 };
      if (typeof savePayload === 'function') await savePayload(structuredClone(request));
      await this.persist(journal, key, record);
      let submitted = request;
      try {
        for (let repair = 0; repair < 2; repair++) {
          const attempt = { request_sha256: hostedSha256(submitted), startedAt: new Date(this.now()).toISOString(), usage: null, outcome: 'not-submitted' };
          record.attempts.push(attempt);
          await this.persist(journal, key, record);
          const result = await this.requestController.run(async () => {
            const admittedAt = this.now();
            attempt.admission = { admittedAt: new Date(admittedAt).toISOString(), snapshot: this.requestController.snapshot() };
            const observe = outcome => {
              const latencyMs = this.now() - admittedAt;
              if (record.status !== 'completed') attempt.latencyMs = latencyMs;
              this.requestController.observe({ status: attempt.status, latencyMs, retryAfterMs: attempt.retryAfterMs, outcome });
            };
            try {
              await onProgress('request');
              attempt.outcome = 'prepared'; await this.persist(journal, key, record);
              if (verifyInputs) { try { await verifyInputs(); attempt.frozenInputsVerified = true; } catch { throw xiaomiHeld('Frozen context or prompt inputs changed; no further paid request was submitted.'); } }
              try { await journal.verifyCodeIdentity(); } catch { throw xiaomiHeld('Repository code identity changed; no further paid request was submitted.'); }
              await verifySources();
              let received;
              this.requestController.assertRunning();
              attempt.submittedAt = new Date(this.now()).toISOString(); attempt.outcome = 'in-flight';
              try { received = await this.fetch(`${configuration.endpoint}/chat/completions`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(submitted), signal: AbortSignal.timeout(180000) }); }
              catch { attempt.outcome = 'ambiguous'; attempt.completedAt = new Date(this.now()).toISOString(); throw xiaomiHeld('Ambiguous Xiaomi transport failure; no automatic resubmission.'); }
              attempt.status = received.status; attempt.retryAfterMs = boundedRetryAfter(received.headers, this.now());
              if (received.status === 402) this.requestController.stop(xiaomiHeld('Xiaomi HTTP 402; request held without automatic resubmission.', { code: 'BILLING_LIMIT' }));
              let response;
              try { response = await received.json(); }
              catch {
                attempt.outcome = received.ok ? 'invalid-envelope' : [402, 429].includes(received.status) ? 'rejected' : 'unknown';
                attempt.responseBodyUnreadable = true;
                throw xiaomiHeld(received.status === 402 ? 'Xiaomi HTTP 402; request held without automatic resubmission.' : 'Xiaomi response envelope was unreadable; no automatic resubmission.', received.status === 402 ? { code: 'BILLING_LIMIT' } : {});
              }
              attempt.completedAt = new Date(this.now()).toISOString();
              const safe = redactXiaomiResponse(response, apiKey);
              Object.assign(attempt, { response_sha256: hostedSha256(response), response: safe.value, usage: safe.findings.length ? null : response?.usage ?? null });
              if (safe.findings.length) { Object.assign(attempt, { redacted: true, credentialFindings: safe.findings }); throw xiaomiHeld('Credential-like response held; private diagnostics were redacted.'); }
              if (!received.ok) { attempt.outcome = [402, 429].includes(received.status) ? 'rejected' : 'unknown'; throw xiaomiHeld(`Xiaomi HTTP ${received.status}; request held without automatic resubmission.`, received.status === 402 ? { code: 'BILLING_LIMIT' } : {}); }
              if (response.model !== configuration.model) throw xiaomiHeld('Xiaomi returned a different or missing model identity; response held without repair.');
              if (response.choices?.length !== 1 || response.choices[0].finish_reason !== 'stop' || typeof response.choices[0].message?.content !== 'string') throw xiaomiHeld('Xiaomi did not return a complete single reply.');
              const raw = response.choices[0].message.content; let json, issues;
              try { json = JSON.parse(raw); attempt.jsonParsed = true; issues = deepinfraReplyIssues(json, filenames, options); } catch { attempt.jsonParsed = false; issues = ['JSON_PARSE']; }
              attempt.contractValid = !issues.length;
              if (issues.length) {
                attempt.validationIssues = issues; attempt.outcome = 'invalid';
                if (repair) throw xiaomiHeld('Xiaomi reply remained invalid after one repair.', { repairSuggestion: { type: 'repair_suggestion', patch: '--- a/private-reply.json\n+++ b/private-reply.json\n@@ -1 +1 @@\n-Invalid JSON or reply contract\n+Manually repair the private reply against its frozen phase schema before resuming\n' } });
                record.repairRequested = true; await this.persist(journal, key, record); observe('invalid');
                return { repair: buildXiaomiRepairRequest({ request, raw, issues }) };
              }
              attempt.outcome = 'valid'; attempt.latencyMs = this.now() - admittedAt;
              const count = json.minutes?.length, minimum = options.minutesMin ?? 1, maximum = options.minutesMax ?? 32;
              const warnings = count !== undefined && (count < minimum || count > maximum) ? [{ code: 'MINUTES_COUNT_OUTSIDE_TARGET', actual: count, min: minimum, max: maximum }] : [];
              Object.assign(record, { status: 'completed', completedAt: new Date(this.now()).toISOString(), latencyMs: this.now() - Date.parse(record.createdAt), returnedModel: response.model, raw, json, submittedRequest: submitted, final_request_sha256: hostedSha256(submitted), model_sha256: hostedSha256(submitted), usage: response.usage ?? null, providerEstimatedCost: response.usage?.estimated_cost ?? null, normalizedUsage: normalizeXiaomiUsage(response.usage), retry_recovered: repair === 1, warnings });
              Object.assign(record, deepinfraAttemptMetrics(record));
              this.pending.set(key, record); await this.persist(journal, key, record);
              if (repair) onProgress('retry_recovered'); onProgress('done'); observe('valid'); return { raw };
            } catch (error) {
              if (!attempt.submittedAt) attempt.outcome = 'not-submitted';
              const held = isHold(error) ? error : xiaomiHeld('Xiaomi request held; inspect its private receipt before further paid work.');
              observe(attempt.outcome); this.requestController.stop(held); throw held;
            }
          });
          if (result.repair) { submitted = result.repair; continue; }
          return result.raw;
        }
      } catch (error) {
        if (record.status !== 'completed') {
          Object.assign(record, { status: 'held', heldAt: new Date(this.now()).toISOString(), reason: isHold(error) ? error.message : 'Ambiguous transport or persistence failure; no automatic resubmission.', error_code: isHold(error) ? error.code : 'XIAOMI_HELD' });
          if (error.repairSuggestion) record.repair_suggestion = error.repairSuggestion;
          Object.assign(record, deepinfraAttemptMetrics(record)); await this.persist(journal, key, record);
        }
        throw isHold(error) ? error : xiaomiHeld('Xiaomi request held; inspect its private receipt before further paid work.');
      }
    };
    try { return await (journal.withLock ? journal.withLock(key, work) : work()); }
    catch (error) { throw isHold(error) ? error : xiaomiHeld('Xiaomi private persistence failed; paid work remains held.'); }
  }
  async persist(journal, key, record) { try { await journal.save(key, record); } catch { throw xiaomiHeld('Xiaomi private persistence failed; paid work remains held.'); } }
}
