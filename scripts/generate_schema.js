#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

async function main() {
  const mdPath = path.resolve('docs/agents.md');
  const md = await fs.readFile(mdPath, 'utf8');
  const tokens = Array.from(md.matchAll(/`([a-zA-Z0-9_]+)`/g)).map(m => m[1]);
  const keys = new Set(['minutes', 'decision', 'keep', 'aside', ...tokens]);

  const decision = z.object({
    keep: z.record(z.string(), z.string()).optional(),
    aside: z.record(z.string(), z.string()).optional(),
  });
  const shape = {
    minutes: z.array(z.object({ speaker: z.string(), text: z.string() })),
    decision
  };
  if (keys.has('field_notes_diff')) shape.field_notes_diff = z.string().optional();
  if (keys.has('field_notes_md')) shape.field_notes_md = z.string().optional();
  const Reply = z.object(shape);

  const tsLines = [
    "import { z } from 'zod';",
    '',
    'export const Reply = z.object({',
    '  minutes: z.array(z.object({ speaker: z.string(), text: z.string() })),',
    '  decision: z.object({',
    '    keep: z.record(z.string(), z.string()).optional(),',
    '    aside: z.record(z.string(), z.string()).optional()',
    '  }),'
  ];
  if (keys.has('field_notes_diff')) tsLines.push("  field_notes_diff: z.string().optional(),");
  if (keys.has('field_notes_md')) tsLines.push("  field_notes_md: z.string().optional(),");
  tsLines.push('});', '', 'export type Reply = z.infer<typeof Reply>;');
  await fs.writeFile(path.resolve('src/replySchema.ts'), tsLines.join('\n'));

  const jsLines = tsLines.filter(l => !l.startsWith('export type')); // remove type line
  await fs.writeFile(path.resolve('src/replySchema.js'), jsLines.join('\n'));

  const json = zodToJsonSchema(Reply, 'Reply');
  await fs.writeFile(path.resolve('reply.schema.json'), JSON.stringify(json, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
