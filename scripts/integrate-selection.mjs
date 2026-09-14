import { readFile } from 'node:fs/promises';
import { buildIntegration, verifyIntegration } from './lib/integratedSelection.mjs';
const [command, input, output] = process.argv.slice(2);
try {
  if (command === 'build' && input && output) {
    const report = await buildIntegration(JSON.parse(await readFile(input, 'utf8')), output);
    console.log(JSON.stringify({ output: report.output, count: report.count, bounds: report.bounds, inherited: report.previousCount, added: report.addedCount }, null, 2));
  } else if (command === 'verify' && input && !output) {
    const report = await verifyIntegration(input); console.log(JSON.stringify(report, null, 2));
    if (report.errors.length) process.exitCode = 1;
  } else throw new Error('Usage: node scripts/integrate-selection.mjs build private-config.json new-numbered-directory | verify numbered-directory');
} catch (error) { console.error(error.message); process.exitCode = 1; }
