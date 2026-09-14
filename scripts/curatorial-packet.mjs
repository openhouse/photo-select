import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPacket, verifyPacket } from './lib/curatorialPacket.mjs';
const [command, input, output] = process.argv.slice(2);
try {
  if (command === 'build' && input && output) console.log(JSON.stringify(await buildPacket(JSON.parse(await readFile(input, 'utf8')), output), null, 2));
  else if (command === 'verify' && input) {
    const report = await verifyPacket(input);
    await writeFile(path.join(input, 'manifests/verification.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2)); if (report.errors.length) process.exitCode = 1;
  } else throw new Error('Usage: node scripts/curatorial-packet.mjs build private-config.json new-directory | verify directory');
} catch (error) { console.error(error.message); process.exitCode = 1; }
