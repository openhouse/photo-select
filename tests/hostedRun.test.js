import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHostedJournal } from '../src/hostedRun.js';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hosted-journal-')); roots.push(root);
  const source = path.join(root, 'photos'); await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'a.jpg'), 'original image bytes');
  const args = { source, base: path.join(root, 'private'), codeRevision: 'fixture-revision', ...options };
  return { source, args, journal: await createHostedJournal(args) };
}
const completed = () => ({ status: 'completed', request_sha256: 'a'.repeat(64),
  raw: JSON.stringify({ minutes: [{ speaker: 'Reader', text: 'Where next?' }], decisions: [{ filename: 'a.jpg', decision: 'keep', reason: 'Visible gesture.' }] }),
  json: { minutes: [{ speaker: 'Reader', text: 'Where next?' }], decisions: [{ filename: 'a.jpg', decision: 'keep', reason: 'Visible gesture.' }] },
  usage: { prompt_tokens: 100, completion_tokens: 20 } });

it('resumes a stable private journal and preserves an immutable workflow snapshot', async () => {
  const { args, journal } = await fixture();
  expect(await journal.load('hosted-v1-first')).toBeNull();
  await journal.save('hosted-v1-first', { status: 'prepared', request_sha256: 'a'.repeat(64) });
  expect(await journal.workflowSnapshot('level-first', { queue: ['b.jpg', 'a.jpg'] })).toEqual({ queue: ['b.jpg', 'a.jpg'] });
  const resumed = await createHostedJournal(args);
  expect(resumed.root).toBe(journal.root);
  expect((await resumed.load('hosted-v1-first')).status).toBe('prepared');
  expect(await resumed.workflowSnapshot('level-first', { queue: ['a.jpg', 'b.jpg'] })).toEqual({ queue: ['b.jpg', 'a.jpg'] });
  expect((await fs.stat(journal.root)).mode & 0o777).toBe(0o700);
});
it('commits the model response and notebook together and records corpus image hashes', async () => {
  const { journal } = await fixture();
  await journal.save('hosted-v1-first', completed());
  const changed = execFileSync('git', ['-C', journal.root, 'show', '--pretty=', '--name-only', 'HEAD'], { encoding: 'utf8' });
  expect(changed).toContain('requests/hosted-v1-first.json'); expect(changed).toContain('field-notes.md');
  expect(await fs.readFile(path.join(journal.root, 'field-notes.md'), 'utf8')).toContain('Visible gesture.');
  const corpus = JSON.parse(await fs.readFile(path.join(journal.root, 'corpus.json'), 'utf8'));
  expect(corpus.images[0]).toMatchObject({ filename: 'a.jpg' });
  expect(corpus.images[0].sha256).toMatch(/^[a-f0-9]{64}$/); expect(corpus.images[0].filename_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect((await fs.stat(path.join(journal.root, 'requests/hosted-v1-first.json'))).mode & 0o777).toBe(0o600);
});
it('retries persistence of a completed receipt without replacing it with a held state', async () => {
  let fail = true;
  const execute = async (file, args, options) => {
    if (args.includes('commit') && fail) { fail = false; throw new Error('synthetic persistence failure'); }
    return { stdout: execFileSync(file, args, { ...options, encoding: 'utf8' }) };
  };
  const { journal } = await fixture({ execute });
  const record = completed();
  await expect(journal.save('hosted-v1-first', record)).rejects.toThrow('synthetic persistence failure');
  expect((await journal.load('hosted-v1-first')).status).toBe('completed');
  await expect(journal.save('hosted-v1-first', { status: 'held' })).rejects.toThrow(/completed/i);
  await journal.save('hosted-v1-first', record);
  expect(execFileSync('git', ['-C', journal.root, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('');
});
it('blocks concurrent processes for the same request and releases locks after failure', async () => {
  const { args, journal } = await fixture(), other = await createHostedJournal(args);
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const pending = journal.withLock('hosted-v1-first', async () => { entered(); await new Promise(resolve => { release = resolve; }); });
  await ready;
  await expect(other.withLock('hosted-v1-first', async () => {})).rejects.toThrow(/locked/i);
  release(); await pending;
  await expect(journal.withLock('hosted-v1-first', async () => { throw new Error('synthetic failure'); })).rejects.toThrow('synthetic failure');
  await other.withLock('hosted-v1-first', async () => {});
});
it('commits Act II markdown as the notebook without inventing triage minutes', async () => {
  const { journal } = await fixture();
  await journal.save('hosted-v1-first', completed());
  await journal.save('hosted-v1-second', { status: 'completed', raw: '{"field_notes_md":"# Next\n\nA careful edit."}', json: { field_notes_md: '# Next\n\nA careful edit.' } });
  expect(await fs.readFile(path.join(journal.root, 'field-notes.md'), 'utf8')).toBe('# Next\n\nA careful edit.\n');
});
it('rejects public-checkout and symlink destinations and path-traversal request keys', async () => {
  const { source, args, journal } = await fixture();
  const checkout = path.join(path.dirname(source), 'checkout'); await fs.mkdir(checkout);
  execFileSync('git', ['init', '--quiet', checkout]);
  await expect(createHostedJournal({ ...args, base: path.join(checkout, 'private') })).rejects.toThrow(/Git checkout/i);
  const link = path.join(path.dirname(source), 'alias'); await fs.symlink(args.base, link);
  await expect(createHostedJournal({ ...args, base: link })).rejects.toThrow(/symlink/i);
  await expect(journal.save('../escape', completed())).rejects.toThrow(/key/i);
  expect(journal.identity.codeRevision).toBe('fixture-revision'); expect(journal.identity.codeSha256).toMatch(/^[a-f0-9]{64}$/);
});
it('preserves the exact completed receipt against replacement by different model output', async () => {
  const { journal } = await fixture();
  await journal.save('hosted-v1-first', completed());
  const changed = completed(); changed.json.decisions[0].reason = 'Different interpretation.';
  await expect(journal.save('hosted-v1-first', changed)).rejects.toThrow(/completed/i);
  expect((await journal.load('hosted-v1-first')).json.decisions[0].reason).toBe('Visible gesture.');
});
it('holds if a private record directory is replaced by a symlink', async () => {
  const { journal, source } = await fixture();
  const outside = path.join(path.dirname(source), 'outside'); await fs.mkdir(outside);
  await fs.rm(path.join(journal.root, 'requests'), { recursive: true });
  await fs.symlink(outside, path.join(journal.root, 'requests'));
  await expect(journal.save('hosted-v1-first', completed())).rejects.toThrow(/symlink/i);
  expect(await fs.readdir(outside)).toEqual([]);
});
it('binds previously uncommitted completed responses to the next notebook commit', async () => {
  let fail = true;
  const execute = async (file, args, options) => {
    if (args.includes('add') && fail) { fail = false; throw new Error('synthetic commit interruption'); }
    return { stdout: execFileSync(file, args, { ...options, encoding: 'utf8' }) };
  };
  const { journal } = await fixture({ execute });
  await expect(journal.save('hosted-v1-first', completed())).rejects.toThrow('synthetic commit interruption');
  const second = completed(); second.json.minutes[0].speaker = 'Second reader';
  await journal.save('hosted-v1-second', second);
  const tree = execFileSync('git', ['-C', journal.root, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' });
  expect(tree).toContain('requests/hosted-v1-first.json'); expect(tree).toContain('requests/hosted-v1-second.json');
  const notes = execFileSync('git', ['-C', journal.root, 'show', 'HEAD:field-notes.md'], { encoding: 'utf8' });
  expect(notes).toContain('**Reader:**'); expect(notes).toContain('**Second reader:**');
});
