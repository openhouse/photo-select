import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

const ollamaModel =
  typeof process.env.OLLAMA_MODEL === 'string'
    ? process.env.OLLAMA_MODEL.trim()
    : '';

const shouldRun = process.env.OLLAMA_E2E === '1' && ollamaModel.length > 0;

const NONCE_LENGTH = 12;

const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomNonce(length = NONCE_LENGTH) {
  let output = '';
  for (let i = 0; i < length; i += 1) {
    let candidate;
    do {
      candidate = SAFE_ALPHABET.charAt(
        Math.floor(Math.random() * SAFE_ALPHABET.length)
      );
    } while (i > 0 && candidate === output[i - 1]);
    output += candidate;
  }
  return output;
}

function canonicalizeOcr(text) {
  const upper = String(text ?? '').toUpperCase();
  const alphanumeric = upper.replace(/[^A-Z0-9]/g, '');
  return alphanumeric.replace(/(.)\1+/g, '$1');
}

async function renderHighContrastPng(text) {
  const safeText = String(text ?? '');
  const length = Math.max(safeText.length, 1);
  const horizontalPadding = 160;
  const charWidth = 180;
  const width = Math.max(1280, length * charWidth + horizontalPadding * 2);
  const height = 640;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision">
    <rect width="100%" height="100%" fill="white"/>
    <text x="${width / 2}" y="${height / 2}"
          font-family="DejaVu Sans Mono, Menlo, Consolas, monospace"
          font-size="220" font-weight="700" letter-spacing="8"
          style="font-variant-ligatures:none"
          text-anchor="middle" dominant-baseline="middle" fill="black">${safeText}</text>
  </svg>`;
  return sharp(Buffer.from(svg), { density: 300 })
    .png({ compressionLevel: 0 })
    .toBuffer();
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
    nonce = randomNonce(NONCE_LENGTH);
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

  const basePrompt = [
    'OCR TASK:',
    `Read the text in the image and output EXACTLY ${NONCE_LENGTH} characters.`,
    'Use only uppercase letters A-Z and digits 2-9 on a single line with no spaces.',
    'Do NOT output JSON, code fences, quotes, or extra commentary.',
    'If nothing is legible, output NONE.'
  ].join(' ');

  it(
    'returns the nonce only when the clear image is provided',
    { timeout: 120_000 },
    async () => {
      const pngBuffer = await renderHighContrastPng(nonce);
      const imagePath = await writeTempImage(pngBuffer, tempDirs);
      let capturedPayload;
      const reply = await provider.chat({
        prompt: basePrompt,
        images: [imagePath],
        model: ollamaModel,
        options: {
          temperature: 0,
          num_predict: 24,
          top_p: 0.1,
          top_k: 1,
          repeat_penalty: 1.2,
        },
        savePayload: async (payload) => {
          capturedPayload = payload;
        },
      });

      expect(typeof reply).toBe('string');
      expect(canonicalizeOcr(reply)).toBe(nonce);
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
        model: ollamaModel,
        options: {
          temperature: 0,
          num_predict: 24,
          top_p: 0.1,
          top_k: 1,
          repeat_penalty: 1.2,
        },
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
        model: ollamaModel,
        options: {
          temperature: 0,
          num_predict: 24,
          top_p: 0.1,
          top_k: 1,
          repeat_penalty: 1.2,
        },
      });
      expect(typeof reply).toBe('string');
      expect(canonicalizeOcr(reply)).not.toBe(nonce);
    }
  );
});

