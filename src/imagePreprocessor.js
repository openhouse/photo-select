import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

function numEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

const CACHE_DIR = path.join(process.cwd(), '.cache', 'images');

function shouldUseLosslessFormat(metadata, filePath) {
  // PNG inputs (or any asset with transparency) tend to contain graphic or
  // high-contrast elements where JPEG compression introduces ringing
  // artifacts. Those artifacts were corrupting OCR runs in the Ollama E2E
  // tests, so prefer a lossless surrogate for such cases.
  if (metadata) {
    if (metadata.format === 'png') return true;
    if (metadata.hasAlpha) return true;
    if (metadata.isOpaque === false) return true;
  }

  if (typeof filePath === 'string') {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png' || ext === '.apng') {
      return true;
    }
  }

  return false;
}

export async function getSurrogateImage(file) {
  const info = await fs.stat(file);
  const maxEdge = numEnv('PHOTO_SELECT_IMAGE_MAX_EDGE', 1600);
  const quality = numEnv('PHOTO_SELECT_JPEG_QUALITY', 75);
  const source = sharp(file);
  let metadata;
  try {
    metadata = await source.metadata();
  } catch {
    metadata = undefined;
  }
  const lossless = shouldUseLosslessFormat(metadata, file);
  const targetFormat = lossless ? 'png' : 'jpeg';
  const targetExt = lossless ? 'png' : 'jpg';
  const hash = crypto
    .createHash('sha1')
    .update(file)
    .update(String(info.mtimeMs))
    .update(String(info.size))
    .update(String(maxEdge))
    .update(String(quality))
    .update(targetFormat)
    .digest('hex');
  const cachePath = path.join(CACHE_DIR, `${hash}.${targetExt}`);
  try {
    return await fs.readFile(cachePath);
  } catch {}
  await fs.mkdir(CACHE_DIR, { recursive: true });
  let transformer = source.clone().rotate();
  transformer = transformer.resize({
    width: maxEdge,
    height: maxEdge,
    fit: 'inside',
    withoutEnlargement: true,
  });
  if (lossless) {
    transformer = transformer.png({
      compressionLevel: 0,
      adaptiveFiltering: false,
    });
  } else {
    transformer = transformer.jpeg({
      quality,
      mozjpeg: true,
      chromaSubsampling: '4:2:0',
    });
  }
  const buf = await transformer.toBuffer();
  await fs.writeFile(cachePath, buf);
  return buf;
}
