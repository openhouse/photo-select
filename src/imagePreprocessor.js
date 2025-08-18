import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

function numEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

const CACHE_DIR = path.join(process.cwd(), '.cache', 'images');

export async function getSurrogateImage(file) {
  const info = await fs.stat(file);
  const maxEdge = numEnv('PHOTO_SELECT_IMAGE_MAX_EDGE', 1600);
  const quality = numEnv('PHOTO_SELECT_JPEG_QUALITY', 75);
  const hash = crypto
    .createHash('sha1')
    .update(file)
    .update(String(info.mtimeMs))
    .update(String(info.size))
    .update(String(maxEdge))
    .update(String(quality))
    .digest('hex');
  const cachePath = path.join(CACHE_DIR, `${hash}.jpg`);
  try {
    return await fs.readFile(cachePath);
  } catch {}
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const buf = await sharp(file)
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' })
    .toBuffer();
  await fs.writeFile(cachePath, buf);
  return buf;
}
