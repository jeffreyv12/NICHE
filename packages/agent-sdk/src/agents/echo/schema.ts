import { z } from 'zod';

export const EchoInputSchema = z.object({
  text: z.string().min(1).max(500),
});
export type EchoInput = z.infer<typeof EchoInputSchema>;

export const EchoOutputSchema = z.object({
  echoed: z.string(),
  received_chars: z.number().int().nonnegative(),
});
export type EchoOutput = z.infer<typeof EchoOutputSchema>;
