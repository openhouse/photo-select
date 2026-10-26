import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CURATORS } from '../core/knowledgeLive.js';
import { credentialLike } from '../core/githubBridge.js';
import { DEEPINFRA_BASE_URL, DEEPINFRA_MODEL, DEEPINFRA_PROFILE, buildDeepInfraRequest, deepinfraAttemptMetrics, deepinfraHeld, deepinfraReplyIssues, deepinfraRequestIdentity, hostedSha256, normalizeDeepInfraUsage, redactDeepInfraResponse, validateDeepInfraConfiguration } from '../core/deepinfra.js';

const sharedMessages = async (...args) => (await import('../chatClient.js')).buildMessages(...args);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const isProviderHold = error => ['DEEPINFRA_HELD', 'BILLING_LIMIT'].includes(error?.code);
export default class DeepInfraProvider {
  name = 'deepinfra'; supportsAsync = false; preventAutomaticResubmit = true;
  constructor({ fetch = globalThis.fetch, buildMessages = sharedMessages, journal, sleep: pause = sleep, now = Date.now } = {}) {
    Object.assign(this, { fetch, buildMessages, journal, sleep: pause, now }); this.pending = new Map();
  }
  async submit(options = {}) { return { promise: this.chat(options) }; }
  async collect(handle) { const raw = await handle.promise; return { raw, json: JSON.parse(raw) }; }
  async chat(options = {}) {
    const { prompt, images = [], curators = [], photoPeople, onProgress = () => {}, savePayload, journal = this.journal } = options;
    const apiKey = process.env.DEEPINFRA_API_KEY;
    const configuration = validateDeepInfraConfiguration({ endpoint: options.endpoint ?? (process.env.DEEPINFRA_BASE_URL || DEEPINFRA_BASE_URL), model: options.model ?? DEEPINFRA_MODEL, reasoningEffort: options.reasoningEffort ?? 'auto', apiKey });
    if (typeof prompt !== 'string' || !prompt.trim()) throw deepinfraHeld('DeepInfra requires a rendered nonempty prompt.');
    if (credentialLike(prompt) || prompt.includes(apiKey)) throw deepinfraHeld('Credential-like content in the prompt is held before upload.');
    if (!journal || typeof journal.load !== 'function' || typeof journal.save !== 'function') throw deepinfraHeld('DeepInfra requires a durable private run journal before submission.');
    const filenames = images.map(file => path.basename(file));
    const originalImages = await Promise.all(images.map(async (file, index) => ({ filename: filenames[index], filename_sha256: hostedSha256(filenames[index]), sha256: hostedSha256(await readFile(file)) })));
    const roster = Object.freeze(curators.length ? [...curators] : [...CURATORS]); onProgress('encoding');
    const { messages, used } = await this.buildMessages(prompt, images, roster, { photoPeople });
    if (used?.length !== images.length || used.some((file, index) => file !== images[index])) throw deepinfraHeld('Image preparation did not preserve the complete ordered whitelist.');
    const request = buildDeepInfraRequest({ ...options, ...configuration, messages, filenames, curators: roster, photoPeople });
    if (credentialLike(request) || JSON.stringify(request).includes(apiKey)) throw deepinfraHeld('Credential-like content in request metadata or notebook data is held before upload.');
    const currentHashes = await Promise.all(images.map(async file => hostedSha256(await readFile(file))));
    if (currentHashes.some((hash, index) => hash !== originalImages[index].sha256)) throw deepinfraHeld('Source images changed during preparation; no request was submitted.');
    const submittedImages = request.messages[1].content.filter(part => part.type === 'image_url').map((part, index) => ({ filename: filenames[index], sha256: hostedSha256(Buffer.from(part.image_url.url.split(',')[1] || '', 'base64')) }));
    if (submittedImages.length !== images.length) throw deepinfraHeld('Image preparation did not preserve every submitted image.');
    const codeIdentity = journal.identity ?? null;
    const key = deepinfraRequestIdentity({ request, originalImages, endpoint: configuration.endpoint, codeIdentity });
    const work = async () => {
      let record = this.pending.get(key) || await journal.load(key);
      if (record) {
        if (record.status !== 'completed') throw deepinfraHeld('A previous DeepInfra request is held or incomplete; inspect its private receipt before any new paid work.', record.error_code === 'BILLING_LIMIT' ? { code: 'BILLING_LIMIT' } : {});
        let cached; try { cached = JSON.parse(record.raw); } catch { throw deepinfraHeld('Completed private receipt failed validation.'); }
        if (deepinfraReplyIssues(cached, filenames, options).length || JSON.stringify(cached) !== JSON.stringify(record.json) || record.key !== key || record.model_sha256 !== hostedSha256(record.submittedRequest) || deepinfraRequestIdentity({ request: record.request, originalImages: record.originalImages, endpoint: configuration.endpoint, codeIdentity }) !== key) throw deepinfraHeld('Completed private receipt failed validation.');
        await this.persist(journal, key, record); return record.raw;
      }
      record = { status: 'prepared', key, identity: { provider: 'deepinfra', endpoint: configuration.endpoint, transport: 'chat-completions', model: configuration.model, advertisedPrecision: 'fp8', checkpoint: null, capabilityProfile: DEEPINFRA_PROFILE, requestedReasoningEffort: configuration.reasoningEffort, acceptedReasoningEffort: null, verifiedReasoningEffort: null }, codeIdentity, originalImages, submittedImages, curators: roster, prompt_sha256: hostedSha256(prompt), model_sha256: hostedSha256(request), initial_request_sha256: hostedSha256(request), request, createdAt: new Date(this.now()).toISOString(), attempts: [], transportRetries: 0 };
      if (typeof savePayload === 'function') await savePayload(structuredClone(request));
      await this.persist(journal, key, record);
      let submitted = request;
      try {
        for (let repair = 0; repair < 2; repair++) {
          onProgress('request'); let response;
          for (let transportAttempt = 0; ; transportAttempt++) {
            const startedAt = new Date(this.now()).toISOString();
            let received;
            try { received = await this.fetch(`${configuration.endpoint}/chat/completions`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(submitted), signal: AbortSignal.timeout(180000) }); }
            catch { record.attempts.push({ request_sha256: hostedSha256(submitted), startedAt, completedAt: new Date(this.now()).toISOString(), outcome: 'ambiguous', usage: null }); throw deepinfraHeld('Ambiguous DeepInfra transport failure; no automatic resubmission.'); }
            if (received.status === 429 && transportAttempt < 2) {
              record.transportRetries++; record.attempts.push({ request_sha256: hostedSha256(submitted), startedAt, status: 429, definiteRejection: true });
              await this.persist(journal, key, record);
              const wait = Number(received.headers?.get('retry-after') ?? 2 ** transportAttempt);
              if (!Number.isFinite(wait) || wait < 0 || wait > 30) throw deepinfraHeld('DeepInfra rate limit requires a billing or capacity pause.');
              await this.sleep(wait * 1000); continue;
            }
            if (!received.ok) { record.attempts.push({ request_sha256: hostedSha256(submitted), startedAt, status: received.status, outcome: [402, 429].includes(received.status) ? 'rejected' : 'unknown', usage: null }); throw deepinfraHeld(`DeepInfra HTTP ${received.status}; request held without automatic resubmission.`, received.status === 402 ? { code: 'BILLING_LIMIT' } : {}); }
            try { response = await received.json(); }
            catch { record.attempts.push({ request_sha256: hostedSha256(submitted), startedAt, status: received.status, outcome: 'invalid-envelope', usage: null }); throw deepinfraHeld('DeepInfra response envelope was unreadable; no automatic resubmission.'); }
            const safe = redactDeepInfraResponse(response, apiKey);
            if (safe.findings.length) {
              record.attempts.push({ request_sha256: hostedSha256(submitted), startedAt, response_sha256: hostedSha256(response), response: safe.value, redacted: true, credentialFindings: safe.findings });
              throw deepinfraHeld('Credential-like response held; private diagnostics were redacted.');
            }
            record.attempts.push({ request_sha256: hostedSha256(submitted), startedAt, completedAt: new Date(this.now()).toISOString(), response_sha256: hostedSha256(response), response });
            break;
          }
          if (response.choices?.length !== 1 || response.choices[0].finish_reason !== 'stop' || typeof response.choices[0].message?.content !== 'string') throw deepinfraHeld('DeepInfra did not return a complete single reply.');
          const raw = response.choices[0].message.content; let json, issues;
          try { json = JSON.parse(raw); record.attempts.at(-1).jsonParsed = true; issues = deepinfraReplyIssues(json, filenames, options); } catch { record.attempts.at(-1).jsonParsed = false; issues = ['JSON_PARSE']; }
          record.attempts.at(-1).contractValid = !issues.length;
          if (issues.length) {
            record.attempts.at(-1).validationIssues = issues;
            if (repair) throw deepinfraHeld('DeepInfra reply remained invalid after one repair.', { repairSuggestion: { type: 'repair_suggestion', patch: '--- a/private-reply.json\n+++ b/private-reply.json\n@@ -1 +1 @@\n-Invalid JSON or reply contract\n+Manually repair the private reply against its frozen phase schema before resuming\n' } });
            record.repairRequested = true;
            submitted = { ...request, messages: [...request.messages, { role: 'assistant', content: raw }, { role: 'user', content: `Repair the previous JSON response once. Validation codes: ${issues.join(', ')}. Preserve every valid minute, frozen curator names and exact filename whitelist. Return only the original phase schema.` }] };
            await this.persist(journal, key, record); continue;
          }
          const count = json.minutes?.length, minimum = options.minutesMin ?? 1, maximum = options.minutesMax ?? 32;
          const warnings = count !== undefined && (count < minimum || count > maximum) ? [{ code: 'MINUTES_COUNT_OUTSIDE_TARGET', actual: count, min: minimum, max: maximum }] : [];
          Object.assign(record, { status: 'completed', completedAt: new Date(this.now()).toISOString(), latencyMs: this.now() - Date.parse(record.createdAt), returnedModel: response.model ?? null, raw, json, submittedRequest: submitted, final_request_sha256: hostedSha256(submitted), model_sha256: hostedSha256(submitted), usage: response.usage ?? null, providerEstimatedCost: response.usage?.estimated_cost ?? null, normalizedUsage: normalizeDeepInfraUsage(response.usage), retry_recovered: repair === 1, warnings });
          Object.assign(record, deepinfraAttemptMetrics(record));
          this.pending.set(key, record);
          await this.persist(journal, key, record);
          if (repair) onProgress('retry_recovered'); onProgress('done'); return raw;
        }
      } catch (error) {
        if (record.status !== 'completed') { record.status = 'held'; record.heldAt = new Date(this.now()).toISOString(); record.reason = isProviderHold(error) ? error.message : 'Ambiguous transport or persistence failure; no automatic resubmission.'; record.error_code = isProviderHold(error) ? error.code : 'DEEPINFRA_HELD'; if (error.repairSuggestion) record.repair_suggestion = error.repairSuggestion; Object.assign(record, deepinfraAttemptMetrics(record)); await this.persist(journal, key, record); }
        throw isProviderHold(error) ? error : deepinfraHeld('DeepInfra request held; inspect the private receipt before further paid work.');
      }
    };
    try { return await (journal.withLock ? journal.withLock(key, work) : work()); }
    catch (error) { throw isProviderHold(error) ? error : deepinfraHeld('DeepInfra private persistence failed; paid work remains held.'); }
  }
  async persist(journal, key, record) { try { await journal.save(key, record); } catch { throw deepinfraHeld('DeepInfra private persistence failed; paid work remains held.'); } }
}
