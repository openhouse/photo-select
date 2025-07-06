import { z } from 'zod';

export const Reply = z.object({
  minutes: z.array(z.object({ speaker: z.string(), text: z.string() })),
  decision: z.object({
    keep: z.record(z.string(), z.string()).optional(),
    aside: z.record(z.string(), z.string()).optional()
  }),
  field_notes_diff: z.string().optional(),
  field_notes_md: z.string().optional(),
});

export type Reply = z.infer<typeof Reply>;
