import { readFile, writeFile, readdir, lstat, realpath, mkdir, rm, copyFile, utimes } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planIntegratedSelection, isIntegrationImage, integrationGameStatus } from '../../src/core/planIntegratedSelection.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const number = n => String(n).padStart(2, '0');
async function absent(file) {
  try { await lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Output already exists: ' + file);
}
async function inventory(directory, rows) {
  const status = await lstat(directory);
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('A regular directory is required; symlinks are refused.');
  const actual = (await readdir(directory)).filter(isIntegrationImage).sort();
  if (!same(actual, rows.map(r => r.filename).sort())) throw new Error('Image inventory differs: ' + directory);
  for (const row of rows) {
    const file = path.join(directory, row.filename); const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Image must be regular, not a symlink: ' + row.filename);
    if (stat.size !== row.bytes || hash(await readFile(file)) !== row.sha256) throw new Error('Image changed from frozen hash: ' + row.filename);
  }
}
async function inputs(config, output) {
  const plan = planIntegratedSelection(config);
  if (path.basename(output) !== number(config.step) || (config.step > 1 && path.basename(config.previous.directory) !== number(config.step - 1))) throw new Error('Output and preceding directory must be consecutive numbered siblings.');
  const parent = await realpath(path.dirname(output));
  if (config.step > 1 && parent !== await realpath(path.dirname(config.previous.directory))) throw new Error('Output must be a sibling of the preceding directory.');
  if (config.step > 1) {
    try {
      const previous = JSON.parse(await readFile(config.previous.directory + '.integration.json', 'utf8'));
      const prior = previous.configuration;
      const planned = planIntegratedSelection(prior);
      if (previous.schemaVersion !== 2 || previous.output !== path.resolve(config.previous.directory) || prior.step !== config.step - 1 || hash(JSON.stringify(prior)) !== previous.configurationSha256 || !same(planned.photos, previous.photos)) throw new Error('identity');
      const records = rows => rows.map(({ filename, sha256, bytes }) => ({ filename, sha256, bytes })).sort((a, b) => a.filename.localeCompare(b.filename));
      if (!same(records(config.previous.files), records(planned.photos))) throw new Error('inherited inventory');
      if (prior.sources.length !== config.sources.length || config.sources.some(source => !prior.sources.some(old => old.id === source.id && old.terminalLevel === source.terminalLevel && old.level === source.level + 1))) throw new Error('source level continuity');
    } catch (error) { throw new Error('Preceding integration receipt missing or invalid: ' + error.message); }
  }
  if (config.step > 1) {
    await inventory(config.previous.directory, config.previous.files);
    if (integrationGameStatus({ count: config.previous.files.length, verified: true }) === 'complete') throw new Error('Integration game already complete: preceding verified level has 500 or more photos.');
  }
  for (const source of config.sources) {
    if (path.basename(source.directory) !== `_level-${String(source.level).padStart(3, '0')}`) throw new Error('Source directory does not match declared level.');
    const root = await realpath(source.directory);
    const relative = path.relative(root, path.join(parent, path.basename(output)));
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Output must be outside source directories.');
    await inventory(source.directory, source.files);
  }
  return plan;
}
export async function buildIntegration(config, output) {
  output = path.resolve(output); config = structuredClone(config);
  const receiptPath = output + '.integration.json';
  await absent(output); await absent(receiptPath);
  const plan = await inputs(config, output);
  let created = false;
  try {
    await mkdir(output); created = true;
    for (const photo of plan.photos) {
      const directory = photo.inherited ? config.previous.directory : photo.witnesses[0].directory;
      const source = path.join(directory, photo.filename); const target = path.join(output, photo.filename);
      await copyFile(source, target, constants.COPYFILE_EXCL);
      const stat = await lstat(source); await utimes(target, stat.atime, stat.mtime);
    }
    await inventory(output, plan.photos);
    await inputs(config, output);
    const report = { schemaVersion: 2, output, ...plan, configuration: config, configurationSha256: hash(JSON.stringify(config)) };
    await writeFile(receiptPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    return report;
  } catch (error) {
    if (created) await rm(output, { recursive: true, force: true });
    throw error;
  }
}
export async function verifyIntegration(output) {
  output = path.resolve(output);
  try {
    const report = JSON.parse(await readFile(output + '.integration.json', 'utf8'));
    if (report.schemaVersion !== 2) throw new Error('Legacy or unsupported receipt schema; a reviewed rebuild is required for the bounded-count procedure.');
    if (report.output !== output || hash(JSON.stringify(report.configuration)) !== report.configurationSha256) throw new Error('Receipt identity or configuration hash differs.');
    const plan = await inputs(report.configuration, output);
    for (const key of Object.keys(plan)) if (!same(plan[key], report[key])) throw new Error('Receipt plan differs: ' + key);
    await inventory(output, plan.photos);
    return { errors: [], gameStatus: integrationGameStatus({ count: plan.count, verified: true }), sourceCounts: plan.sourceCounts, bounds: plan.bounds, count: plan.count, previousCount: plan.previousCount, addedCount: plan.addedCount, candidateCount: plan.candidateCount };
  } catch (error) { return { errors: [error.message] }; }
}
