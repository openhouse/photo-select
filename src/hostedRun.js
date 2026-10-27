import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { hostedNotebook } from './core/hostedJournal.js';

const executeDefault = promisify(execFile);
const codeRoot = fileURLToPath(new URL('..', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const queues = new Map();
async function atomic(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}
async function readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function noSymlink(file) {
  try { if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Hosted journal paths cannot contain a symlink.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function privateDestination(directory) {
  let current = path.resolve(directory);
  while (true) {
    try { if ((await fs.lstat(current)).isSymbolicLink() && !['/tmp', '/var'].includes(current)) throw new Error('Hosted journal destination cannot contain a symlink.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await fs.lstat(path.join(current, '.git')); throw new Error('Hosted journal must be outside a Git checkout.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
async function codeIdentity(codeRevision, execute, directory = codeRoot) {
  if (!codeRevision) { try { codeRevision = (await execute('git', ['-C', directory, 'rev-parse', 'HEAD'])).stdout.trim(); } catch { codeRevision = 'unavailable'; } }
  const files = [];
  async function walk(directory) { for (const entry of await fs.readdir(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isDirectory()) await walk(file); else if (entry.isFile()) files.push(file); } }
  await walk(path.join(directory, 'src')); await walk(path.join(directory, 'prompts'));
  files.push(path.join(directory, 'package.json'), path.join(directory, 'package-lock.json'));
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(path.relative(directory, file)).update('\0').update(await fs.readFile(file)).update('\0');
  return { codeRevision, codeSha256: hash.digest('hex') };
}
async function observeCorpus(source, previous) {
  const images = [...(previous?.images || [])], known = new Set(images.map(item => item.filename + '\0' + item.sha256));
  let directory = source;
  while (directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(?:jpe?g|png|gif|tiff?|heic|heif|webp)$/i.test(entry.name)) continue;
      const file = path.join(directory, entry.name), filename = path.relative(source, file), sha256 = digest(await fs.readFile(file));
      if (!known.has(filename + '\0' + sha256)) { images.push({ filename, filename_sha256: digest(filename), sha256 }); known.add(filename + '\0' + sha256); }
    }
    directory = entries.some(entry => entry.name === '_keep' && entry.isDirectory()) ? path.join(directory, '_keep') : null;
  }
  return { schemaVersion: 1, source, images };
}
export async function createHostedJournal({ source, base = process.env.PHOTO_SELECT_HOSTED_BASE, provider = 'deepinfra', codeRevision, codeDirectory = codeRoot, execute = executeDefault } = {}) {
  if (!['deepinfra', 'xiaomi'].includes(provider)) throw new Error('Unsupported hosted journal provider.');
  source = await fs.realpath(source);
  const volume = source.match(/^\/Volumes\/[^/]+/);
  base = path.resolve(base || path.join(volume ? volume[0] : os.homedir(), '.photo-select', 'hosted'));
  await privateDestination(base); await fs.mkdir(base, { recursive: true, mode: 0o700 });
  // Retain legacy DeepInfra paths while isolating every Xiaomi workflow and receipt.
  const root = path.join(base, (provider === 'deepinfra' ? 'source-' : 'xiaomi-source-') + digest(source));
  await noSymlink(root);
  await fs.mkdir(root, { mode: 0o700, recursive: true }); await fs.chmod(root, 0o700);
  for (const name of ['requests', 'workflows', '.locks']) { await noSymlink(path.join(root, name)); await fs.mkdir(path.join(root, name), { recursive: true, mode: 0o700 }); }
  for (const name of ['.git', 'corpus.json', 'session.json']) await noSymlink(path.join(root, name));
  const identity = await codeIdentity(codeRevision, execute, codeDirectory);
  const verifyCodeIdentity = async () => {
    let current;
    try { current = await codeIdentity(codeRevision, execute, codeDirectory); } catch { /* A missing source file is code drift too. */ }
    if (!current || current.codeRevision !== identity.codeRevision || current.codeSha256 !== identity.codeSha256) {
      const error = new Error('Hosted source code changed after journal preparation; no new paid request is permitted.');
      error.code = 'HOSTED_HELD'; throw error;
    }
  };
  const validKey = key => { if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(key)) throw new Error('Invalid hosted journal key.'); return key; };
  const recordPath = key => path.join(root, 'requests', validKey(key) + '.json');
  const safe = async (directory, file) => { await noSymlink(root); await noSymlink(path.join(root, directory)); if (file) await noSymlink(file); };
  const withLock = async (key, work) => {
    await safe('.locks');
    const lock = path.join(root, '.locks', validKey(key));
    try { await fs.mkdir(lock); } catch (error) { if (error.code !== 'EEXIST') throw error; const held = new Error('Hosted request is locked; another process or an interrupted request requires review.'); held.code = 'HOSTED_HELD'; throw held; }
    try { await atomic(path.join(lock, 'owner.json'), { pid: process.pid, createdAt: new Date().toISOString() }); return await work(); }
    finally { await fs.rm(lock, { recursive: true, force: true }); }
  };
  const load = async key => { const file = recordPath(key); await safe('requests', file); return readJson(file); };
  const serialized = work => {
    const previous = queues.get(root) || Promise.resolve();
    const pending = previous.catch(() => {}).then(() => withLock('journal-commit', work));
    queues.set(root, pending);
    return pending.finally(() => { if (queues.get(root) === pending) queues.delete(root); });
  };
  const save = (key, record) => serialized(async () => {
    const existing = await load(key);
    if (existing?.status === 'completed' && record.status !== 'completed') throw new Error('A completed hosted response cannot be replaced by a held state.');
    const content = value => { const { key: ignoredKey, recordedAt, ...rest } = value; return JSON.stringify(rest); };
    if (existing?.status === 'completed' && content(existing) !== content(record)) throw new Error('A completed hosted response is immutable.');
    const stored = { ...record, key, recordedAt: existing?.recordedAt || new Date().toISOString() };
    await atomic(recordPath(key), stored);
    if (!['completed', 'held'].includes(record.status)) return;
    // The same lock protects every record write and its derived notebook snapshot.
    const records = await Promise.all((await fs.readdir(path.join(root, 'requests'))).filter(name => name.endsWith('.json')).map(name => load(name.slice(0, -5))));
    records.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.key.localeCompare(b.key));
    await atomic(path.join(root, 'field-notes.md'), hostedNotebook(records));
    await execute('git', ['-C', root, 'add', '--', 'requests', 'field-notes.md', 'corpus.json', 'session.json', '.gitignore', 'workflows']);
    const changes = await execute('git', ['-C', root, 'diff', '--cached', '--name-only']);
    if (changes.stdout.trim()) await execute('git', ['-C', root, '-c', 'user.name=Photo Select', '-c', 'user.email=photo-select@localhost', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Record private hosted curation']);
  });
  const workflowSnapshot = (key, initial) => withLock('workflow-' + digest(validKey(key)), async () => {
    const file = path.join(root, 'workflows', key + '.json'); await safe('workflows', file);
    const previous = await readJson(file);
    if (previous !== null) return previous;
    await atomic(file, initial); return structuredClone(initial);
  });
  await serialized(async () => {
    await execute('git', ['init', '--quiet', root]);
    await atomic(path.join(root, '.gitignore'), '/.locks/\n*.tmp\n');
    const corpus = await observeCorpus(source, await readJson(path.join(root, 'corpus.json')));
    await atomic(path.join(root, 'corpus.json'), corpus);
    await atomic(path.join(root, 'session.json'), { schemaVersion: 1, source, provider, transport: 'chat-completions', identity });
  });
  return { root, identity, load, save, withLock, workflowSnapshot, verifyCodeIdentity };
}
