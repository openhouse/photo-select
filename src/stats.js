import { writeFile } from 'node:fs/promises';

export async function writeStats(data) {
  await writeFile('.ps-stats.json', JSON.stringify(data, null, 2), 'utf8');
}
