import { z } from "zod";

export const searchConfigurationSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    source: z.literal("google_maps"),
  })
  .strict();

export type ValidSearchConfiguration = z.infer<typeof searchConfigurationSchema>;
