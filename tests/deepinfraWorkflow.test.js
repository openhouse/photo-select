import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
vi.mock('../src/chatClient.js', async () => ({
  ...await vi.importActual('../src/chatClient.js'),
  prefetchPeople: vi.fn().mockResolvedValue({ mode: 'bulk', names: 0 }),
  getPeople: vi.fn().mockResolvedValue(['Tagged Guest', '_UNKNOWN_']),
}));
import { triageDirectory } from '../src/orchestrator.js';
import { getPeople, prefetchPeople } from '../src/chatClient.js';
const priorDebugDirectory = process.env.PHOTO_SELECT_DEBUG_DIR;
let root, prompt;
beforeEach(async () => {
  getPeople.mockResolvedValue(['Tagged Guest', '_UNKNOWN_']);
  prefetchPeople.mockResolvedValue({ mode: 'bulk', names: 0 });
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'deepinfra-workflow-'));
  process.env.PHOTO_SELECT_DEBUG_DIR = root;
  prompt = path.join(root, 'custom.hbs');
  await fs.writeFile(prompt, 'Original exhibition.\nCurators: {{curators}}\n{{context}}\n{{#each images}}- {{this}}\n{{/each}}{{#if hasFieldNotes}}Notebook: {{fieldNotes}}{{/if}}');
  await Promise.all(['one.jpg', 'two.jpg'].map(name => fs.writeFile(path.join(root, name), name)));
});
afterEach(async () => { vi.restoreAllMocks(); if (priorDebugDirectory === undefined) delete process.env.PHOTO_SELECT_DEBUG_DIR; else process.env.PHOTO_SELECT_DEBUG_DIR = priorDebugDirectory; await fs.rm(root, { recursive: true, force: true }); });
function provider(reply) {
  return { name: 'deepinfra', preventAutomaticResubmit: true,
    submit: vi.fn(async options => ({ options })),
    collect: vi.fn(async ({ options }) => typeof reply === 'function' ? reply(options) : reply),
  };
}
function triage(driver, options = {}) {
  return triageDirectory({ dir: root, promptPath: prompt, provider: driver, model: 'XiaomiMiMo/MiMo-V2.6-Pro', recurse: false, ...options });
}
const valid = options => ({ minutes: [{ speaker: options.curators[0], text: 'Which image should lead the next sequence?' }], decisions: options.images.map((file, index) => ({ filename: path.basename(file), decision: index === 0 ? 'keep' : 'aside', reason: 'Visible photographic evidence.' })) });

describe('hosted workflow isolation and safe stopping', () => {
  it('freezes the default roster with repeated tags before rendering a custom prompt', async () => {
    const driver = provider(options => { const json = valid(options); return { raw: JSON.stringify(json), json }; });
    await triage(driver);
    const sent = driver.submit.mock.calls[0][0];
    expect(sent.curators).toEqual(['Ingeborg Gerdes', 'Alexandra Munroe', 'Deborah Treisman', 'Warren Sack', 'Tagged Guest']);
    expect(sent.prompt).toContain('Curators: Ingeborg Gerdes, Alexandra Munroe, Deborah Treisman, Warren Sack, Tagged Guest');
    expect(sent.photoPeople.every(photo => photo.people.join(',') === 'Tagged Guest')).toBe(true);
    expect((await fs.readdir(root)).filter(name => name.endsWith('.jpg'))).toEqual([]);
    expect((await fs.readdir(path.join(root, '_level-001'))).filter(name => name.endsWith('.jpg')).sort()).toEqual(['one.jpg', 'two.jpg']);
  });
  it.each(['HOSTED_PERSISTENCE_FAILED', 'DEEPINFRA_TIMEOUT_AMBIGUOUS', 'BILLING_LIMIT'])('stops on %s without a second paid submission or moving originals', async code => {
    const failure = Object.assign(new Error('Synthetic provider hold.'), { code });
    const driver = provider(() => { throw failure; });
    await expect(triage(driver)).rejects.toBeTruthy();
    expect(driver.submit).toHaveBeenCalledTimes(1);
    expect((await fs.readdir(root)).filter(name => name.endsWith('.jpg')).sort()).toEqual(['one.jpg', 'two.jpg']);
  });
  it('does not run the generic decisions-only paid repair after a hosted validation failure', async () => {
    const driver = provider({ raw: '{"minutes":[],"decisions":[]}', json: { minutes: [], decisions: [] } });
    await expect(triage(driver)).rejects.toMatchObject({ code: 'INVALID_DECISIONS' });
    expect(driver.submit).toHaveBeenCalledTimes(1);
    expect((await fs.readdir(root)).filter(name => name.endsWith('.jpg')).sort()).toEqual(['one.jpg', 'two.jpg']);
  });
  it('holds generic NEEDS_REVIEW retries before a hosted request', async () => {
    const driver = provider(options => ({ raw: JSON.stringify(valid(options)) }));
    await expect(triage(driver, { retryNeedsReview: true })).rejects.toThrow(/retry-needs-review/);
    expect(driver.submit).not.toHaveBeenCalled();
  });
  it('completes Act II with the same images, metadata, roster and context before sorting', async () => {
    const contextPath = path.join(root, 'brief.txt'); await fs.writeFile(contextPath, 'Original complete context.');
    const driver = provider(async options => {
      if (options.expectFieldNotesMd) {
        expect((await fs.readdir(root)).filter(name => name.endsWith('.jpg'))).toHaveLength(2);
        return { raw: '{"field_notes_md":"# Sequence\n\nVisible evidence and an open question."}', json: { field_notes_md: '# Sequence\n\nVisible evidence and an open question.' } };
      }
      const json = { ...valid(options), field_notes_diff: '--- notes\n+++ notes\n@@ -0,0 +1 @@\n+# Sequence' };
      return { raw: JSON.stringify(json), json };
    });
    await triage(driver, { fieldNotes: true, contextPath, curators: ['Base Curator'] });
    expect(driver.submit).toHaveBeenCalledTimes(2);
    const [first, second] = driver.submit.mock.calls.map(([options]) => options);
    expect(first.expectFieldNotesDiff).toBe(true);
    expect(second.expectFieldNotesMd).toBe(true);
    expect(second.images).toEqual(first.images);
    expect(second.curators).toEqual(['Base Curator', 'Tagged Guest']);
    expect(second.photoPeople).toEqual(first.photoPeople);
    expect(second.prompt).toContain('Original complete context.');
    expect(second.fieldNotesText).toBe(first.fieldNotesText);
    expect(await fs.readFile(path.join(root, '_level-001', 'field-notes.md'), 'utf8')).toContain('# Sequence');
    expect((await fs.readdir(root)).filter(name => name.endsWith('.jpg'))).toEqual([]);
  });
});

it('shared image construction uses supplied frozen people without re-reading mutable metadata', async () => {
  const sharp = (await import('sharp')).default;
  const file = path.join(root, 'one.jpg');
  await sharp({ create: { width: 2, height: 2, channels: 3, background: '#807060' } }).jpeg().toFile(file + '.tmp.jpg');
  await fs.rename(file + '.tmp.jpg', file);
  const previous = process.env.PHOTO_SELECT_DISABLE_PEOPLE; process.env.PHOTO_SELECT_DISABLE_PEOPLE = '1';
  try {
    const { buildMessages } = await vi.importActual('../src/chatClient.js');
    const { messages } = await buildMessages('Original prompt.', [file], ['Base'], { photoPeople: [{ file: 'one.jpg', people: ['Frozen Guest'] }] });
    expect(JSON.parse(messages[1].content[1].text)).toEqual({ filename: 'one.jpg', people: ['Frozen Guest'] });
  } finally { if (previous === undefined) delete process.env.PHOTO_SELECT_DISABLE_PEOPLE; else process.env.PHOTO_SELECT_DISABLE_PEOPLE = previous; }
});

function snapshotJournal() {
  const snapshots = new Map();
  return { snapshots, identity: { codeRevision: 'synthetic-revision', codeSha256: 'a'.repeat(64) },
    workflowSnapshot: async (key, initial) => {
      if (!snapshots.has(key)) snapshots.set(key, structuredClone(initial));
      return structuredClone(snapshots.get(key));
    },
  };
}
it.each([
  ['deepinfra', [4, 2]],
  ['openai', [6]],
])('batches all six photos for %s without losing images or changing other providers', async (name, sizes) => {
  await Promise.all(['three.jpg', 'four.jpg', 'five.jpg', 'six.jpg'].map(file => fs.writeFile(path.join(root, file), file)));
  const driver = provider(options => { const json = valid(options); return { raw: JSON.stringify(json), json }; });
  driver.name = name;
  driver.journal = snapshotJournal();
  await triage(driver);
  const batches = driver.submit.mock.calls.map(([options]) => options.images);
  expect(batches.map(batch => batch.length)).toEqual(sizes);
  expect(batches.flat().map(file => path.basename(file)).sort()).toEqual(['five.jpg', 'four.jpg', 'one.jpg', 'six.jpg', 'three.jpg', 'two.jpg']);
  expect((await fs.readdir(root)).filter(file => file.endsWith('.jpg'))).toEqual([]);
  expect((await fs.readdir(path.join(root, '_keep'))).filter(file => file.endsWith('.jpg'))).toHaveLength(sizes.length);
  expect((await fs.readdir(path.join(root, '_aside'))).filter(file => file.endsWith('.jpg'))).toHaveLength(6 - sizes.length);
  if (name === 'deepinfra') {
    const plan = [...driver.journal.snapshots.entries()].find(([key]) => key.startsWith('plan-'))[1];
    expect(plan.binding.batchSize).toBe(4);
    expect(plan.batches.map(batch => batch.length)).toEqual([4, 2]);
  }
});
it('holds a partially moved hosted batch before another submission on restart', async () => {
  const driver = provider(async options => {
    await fs.mkdir(path.join(root, '_keep'), { recursive: true });
    await fs.rename(options.images[0], path.join(root, '_keep', path.basename(options.images[0])));
    throw Object.assign(new Error('Synthetic interruption after partial movement.'), { code: 'HOSTED_PERSISTENCE_FAILED' });
  });
  driver.journal = snapshotJournal();
  await expect(triage(driver)).rejects.toBeTruthy();
  expect(driver.submit).toHaveBeenCalledTimes(1);
  await expect(triage(driver)).rejects.toMatchObject({ code: 'HOSTED_PARTIAL_MOVE' });
  expect(driver.submit).toHaveBeenCalledTimes(1);
});
it('keeps the pending batch notebook and roster snapshot when a restart sees newer notes', async () => {
  let initial;
  const driver = provider(async options => {
    if (!initial) {
      initial = JSON.parse(JSON.stringify(options));
      await fs.writeFile(path.join(root, '_level-001', 'field-notes.md'), '# Newer notebook after a completed remote result.');
      throw Object.assign(new Error('Synthetic persistence interruption.'), { code: 'HOSTED_PERSISTENCE_FAILED' });
    }
    const json = valid(options); return { raw: JSON.stringify(json), json };
  });
  driver.journal = snapshotJournal();
  await expect(triage(driver, { fieldNotes: true })).rejects.toBeTruthy();
  getPeople.mockResolvedValue(['A changed metadata lookup']);
  await triage(driver, { fieldNotes: true });
  const resumed = driver.submit.mock.calls[1][0];
  expect(resumed.prompt).toBe(initial.prompt);
  expect(resumed.fieldNotesText).toBe(initial.fieldNotesText);
  expect(resumed.curators).toEqual(initial.curators);
  expect(resumed.photoPeople).toEqual(initial.photoPeople);
  expect(resumed.images).toEqual(initial.images);
});

it.each(['prompt', 'context', 'notebook', 'people'])('holds secret content in the %s before saving a workflow snapshot', async kind => {
  const secret = kind === 'prompt' ? 'sk-proj-' + 'x'.repeat(30) : 'synthetic-deepinfra-exact-secret';
  const previous = process.env.DEEPINFRA_API_KEY; process.env.DEEPINFRA_API_KEY = 'synthetic-deepinfra-exact-secret';
  const snapshots = [];
  const driver = provider(options => { const json = valid(options); return { raw: JSON.stringify(json), json }; });
  driver.journal = { identity: { codeRevision: 'test' }, workflowSnapshot: async (key, initial) => { snapshots.push(JSON.stringify(initial)); return initial; } };
  const options = {};
  if (kind === 'prompt') await fs.writeFile(prompt, 'A copied credential: ' + secret);
  if (kind === 'context') { options.contextPath = path.join(root, 'secret-context.txt'); await fs.writeFile(options.contextPath, secret); }
  if (kind === 'notebook') { options.fieldNotes = true; await fs.mkdir(path.join(root, '_level-001')); await fs.writeFile(path.join(root, '_level-001', 'field-notes.md'), '# Old notes\n' + secret); }
  if (kind === 'people') getPeople.mockResolvedValue([secret]);
  try {
    await expect(triage(driver, options)).rejects.toMatchObject({ code: 'DEEPINFRA_HELD' });
    expect(driver.submit).not.toHaveBeenCalled();
    expect(snapshots.join('\n')).not.toContain(secret);
  } finally { if (previous === undefined) delete process.env.DEEPINFRA_API_KEY; else process.env.DEEPINFRA_API_KEY = previous; }
});
