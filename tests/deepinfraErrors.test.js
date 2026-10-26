import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import DeepInfraProvider from '../src/providers/deepinfra.js';

describe('DeepInfra HTTP error receipts', () => {
  let directory, image, values, requests, options;
  const apiKey = 'error-receipt-test-key';
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'photo-select-http-errors-'));
    image = path.join(directory, 'one.jpg'); await writeFile(image, 'fixture image');
    values = new Map(); requests = 0;
    options = { prompt: 'Review the supplied photograph.', images: [image], curators: ['A'], journal: { load: async key => values.get(key), save: async (key, value) => values.set(key, structuredClone(value)) } };
    vi.stubEnv('DEEPINFRA_API_KEY', apiKey); vi.stubEnv('DEEPINFRA_BASE_URL', '');
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
  const provider = response => new DeepInfraProvider({
    buildMessages: async () => ({ used: [image], messages: [{ role: 'system', content: 'Review.' }, { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,eA==' } }] }] }),
    fetch: async () => { requests++; return response(); }, sleep: async () => {},
  });
  const saved = () => [...values.values()][0];

  it('retains a provider rejection diagnostic and does not resubmit its held receipt', async () => {
    const p = provider(() => new Response(JSON.stringify({ error: 'Too many images in request: 6 > 4' }), { status: 400 }));
    await expect(p.chat(options)).rejects.toThrow(/HTTP 400/);
    expect(saved()).toMatchObject({ status: 'held', error_code: 'DEEPINFRA_HELD', attempts: [{ status: 400, usage: null, response: { error: 'Too many images in request: 6 > 4' } }] });
    await expect(p.chat(options)).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' });
    expect(requests).toBe(1);
  });
  it('redacts an echoed exact host key from diagnostics and records safe finding metadata', async () => {
    const p = provider(() => new Response(JSON.stringify({ error: { message: `Invalid credential ${apiKey}` } }), { status: 401 }));
    await expect(p.chat(options)).rejects.toThrow(/HTTP 401/);
    expect(saved().attempts[0]).toMatchObject({ status: 401, redacted: true, response: { error: { message: '[credential-like content redacted]' } }, credentialFindings: [{ path: ['error', 'message'], kind: 'deepinfra-token' }] });
    expect(JSON.stringify(saved())).not.toContain(apiKey);
  });
  it.each([400, 402])('keeps HTTP %s status when its diagnostic body is not JSON', async status => {
    const p = provider(() => new Response(`Private non-JSON failure ${apiKey}`, { status }));
    await expect(p.chat(options)).rejects.toMatchObject({ code: status === 402 ? 'BILLING_LIMIT' : 'DEEPINFRA_HELD', message: expect.stringContaining(`HTTP ${status}`) });
    expect(saved().attempts[0]).toMatchObject({ status, responseBodyUnreadable: true, usage: null });
    expect(JSON.stringify(saved())).not.toContain(apiKey); expect(requests).toBe(1);
  });
  it('preserves a billing pause while retaining its sanitized JSON diagnostic', async () => {
    const p = provider(() => new Response(JSON.stringify({ error: 'Balance exhausted', detail: apiKey }), { status: 402 }));
    await expect(p.chat(options)).rejects.toMatchObject({ code: 'BILLING_LIMIT' });
    expect(saved()).toMatchObject({ status: 'held', error_code: 'BILLING_LIMIT', attempts: [{ response: { error: 'Balance exhausted', detail: '[credential-like content redacted]' }, redacted: true }] });
    await expect(p.chat(options)).rejects.toMatchObject({ code: 'BILLING_LIMIT' }); expect(requests).toBe(1);
  });
  it('retains the final 429 diagnostic after the existing two definite-rejection retries', async () => {
    const p = provider(() => new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { 'retry-after': '0' } }));
    await expect(p.chat(options)).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' });
    expect(saved().attempts.at(-1)).toMatchObject({ status: 429, response: { error: 'Rate limit exceeded' } });
    expect(requests).toBe(3); expect(saved().transportRetries).toBe(2);
  });
});
