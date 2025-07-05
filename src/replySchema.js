import { z } from 'zod';

export const Reply = z.object({
  minutes: z.array(z.object({ speaker: z.string(), text: z.string() })),
  decision: z.object({
    keep: z.union([z.array(z.string()), z.record(z.string(), z.string())]),
    aside: z.union([z.array(z.string()), z.record(z.string(), z.string())])
  }),
  field_notes_diff: z.string().optional(),
  field_notes_md: z.string().optional(),
});
