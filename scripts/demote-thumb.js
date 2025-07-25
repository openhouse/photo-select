#!/usr/bin/env node
import fs from 'node:fs/promises';

const [,, file, image] = process.argv;
if (!file || !image) {
  console.error('Usage: demote-thumb <markdown-file> <image-filename>');
  process.exit(1);
}

const text = await fs.readFile(file, 'utf8');
const esc = image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const thumbRe = new RegExp(`!\\[([^\\]]*)\\]\\(${esc}\\)`, 'm');
const m = text.match(thumbRe);
if (!m) {
  console.error('Thumbnail not found');
  process.exit(2);
}
let updated = text.replace(thumbRe, `[${m[1]}](${image})`);

const summaryRe = /```Δ‑Summary([\s\S]*?)\n```/m;
if (summaryRe.test(updated)) {
  updated = updated.replace(summaryRe, (full, body) => {
    if (body.includes(`Demoted: ${image}`)) return full;
    return `\`\`\`Δ‑Summary${body}\n~ Demoted: ${image}\n\`\`\``;
  });
} else {
  updated += `\n\n\`\`\`Δ‑Summary\n~ Demoted: ${image}\n\`\`\``;
}

await fs.writeFile(file, updated);
