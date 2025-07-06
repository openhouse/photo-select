import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function sha256(filePath) {
  const buf = await readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}
