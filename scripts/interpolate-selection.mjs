import { readFile } from 'node:fs/promises';
import { buildIntermediateSelection, verifyIntermediateSelection } from './lib/integratedSelection.mjs';
const [command, input, output] = process.argv.slice(2);
try {
  if (command === 'build' && input && output) {
    const { photos, configuration, ...report } = await buildIntermediateSelection(JSON.parse(await readFile(input, 'utf8')), output);
    console.log(JSON.stringify(report, null, 2));
  } else if (command === 'verify' && input && !output) {
    const report = await verifyIntermediateSelection(input); console.log(JSON.stringify(report, null, 2));
    if (report.errors.length) process.exitCode = 1;
  } else throw new Error('Usage: node scripts/interpolate-selection.mjs build private-config.json NN.5 | verify NN.5');
} catch (error) { console.error(error.message); process.exitCode = 1; }
