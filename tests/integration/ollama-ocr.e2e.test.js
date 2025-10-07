import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

const shouldRun =
  process.env.OLLAMA_E2E === '1' && typeof process.env.OLLAMA_MODEL === 'string';

function randomNonce(length = 10) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () =>
    alphabet.charAt(Math.floor(Math.random() * alphabet.length))
  ).join('');
}

async function renderHighContrastPng(text) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512">
    <rect width="100%" height="100%" fill="white"/>
    <text x="50%" y="50%" font-family="DejaVu Sans, Arial, sans-serif"
          font-size="160" text-anchor="middle" dominant-baseline="middle" fill="black">${text}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 0 }).toBuffer();
}

async function renderBlurredPng(text) {
  const base = await renderHighContrastPng(text);
  return sharp(base)
    .blur(25)
    .modulate({ saturation: 0.05, brightness: 1 })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

async function writeTempImage(buffer, tempDirs, filename = 'frame.png') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ollama-ocr-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

const describeIf = shouldRun ? describe : describe.skip;

describeIf('OllamaProvider OCR end-to-end', () => {
  let Provider;
  let provider;
  let nonce;
  const tempDirs = [];
  let originalFormat;

  beforeAll(async () => {
    nonce = randomNonce(12);
    originalFormat = process.env.PHOTO_SELECT_OLLAMA_FORMAT;
    process.env.PHOTO_SELECT_OLLAMA_FORMAT = '';
    const mod = await import('../../src/providers/ollama.js');
    Provider = mod.default;
    provider = new Provider();
  });

  afterAll(async () => {
    if (originalFormat === undefined) {
      delete process.env.PHOTO_SELECT_OLLAMA_FORMAT;
    } else {
      process.env.PHOTO_SELECT_OLLAMA_FORMAT = originalFormat;
    }
    await Promise.all(
      tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }))
    );
  });

  const basePrompt =
    'Read the text in the image; output only that text; else output NONE.';

  it(
    'returns the nonce only when the clear image is provided',
    { timeout: 60_000 },
    async () => {
      const pngBuffer = await renderHighContrastPng(nonce);
      const imagePath = await writeTempImage(pngBuffer, tempDirs);
      let capturedPayload;
      const reply = await provider.chat({
        prompt: basePrompt,
        images: [imagePath],
        model: process.env.OLLAMA_MODEL,
        options: { temperature: 0 },
        savePayload: async (payload) => {
          capturedPayload = payload;
        },
      });

      expect(typeof reply).toBe('string');
      expect(reply.trim()).toBe(nonce);
      expect(capturedPayload).toBeTruthy();
      const imageList = capturedPayload?.messages?.[1]?.images || [];
      expect(imageList).toHaveLength(1);
      const encoded = imageList[0];
      expect(typeof encoded).toBe('string');
      expect(encoded.length).toBeGreaterThan(200);
      const decoded = Buffer.from(encoded, 'base64');
      const { getSurrogateImage } = await import('../../src/imagePreprocessor.js');
      const expectedBytes = await getSurrogateImage(imagePath);
      expect(decoded.equals(expectedBytes)).toBe(true);
      const systemText = String(capturedPayload.messages?.[0]?.content || '');
      const userText = String(capturedPayload.messages?.[1]?.content || '');
      expect(systemText).not.toContain(nonce);
      expect(userText).not.toContain(nonce);
    }
  );

  it(
    'does not return the nonce when no image is provided',
    { timeout: 30_000 },
    async () => {
      const reply = await provider.chat({
        prompt: basePrompt,
        images: [],
        model: process.env.OLLAMA_MODEL,
        options: { temperature: 0 },
      });
      expect(typeof reply).toBe('string');
      expect(reply.trim()).toBe('NONE');
    }
  );

  it(
    'fails to recover the nonce from a blurred image',
    { timeout: 60_000 },
    async () => {
      const blurredBuffer = await renderBlurredPng(nonce);
      const blurredPath = await writeTempImage(blurredBuffer, tempDirs, 'blurred.png');
      const reply = await provider.chat({
        prompt: basePrompt,
        images: [blurredPath],
        model: process.env.OLLAMA_MODEL,
        options: { temperature: 0 },
      });
      expect(typeof reply).toBe('string');
      expect(reply.trim()).not.toBe(nonce);
    }
  );
});

