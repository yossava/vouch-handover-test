import { z } from "zod";

/** Closed set of issue kinds. The model free-texts enums, so Zod rejects anything off-list. */
export const KINDS = [
  "maintenance",
  "compliance",
  "finance",
  "complaint",
  "safety",
  "security",
  "guest_request",
  "operational",
  "other",
] as const;
export const kindSchema = z.enum(KINDS);
export type Kind = z.infer<typeof kindSchema>;

export const claimSchema = z.object({
  text: z.string().min(1),
  source_ids: z.array(z.string().min(1)).min(1),
  evidence_quote: z.string().min(1), // must be a verbatim substring of a cited source (checked by the grounding validator)
});
export type Claim = z.infer<typeof claimSchema>;

export const translationSchema = z.object({
  english: z.string().min(1),
  original_quote: z.string().min(1),
});

export const entrySchema = z.object({
  kind: kindSchema,
  summary: z.string().min(1),
  language: z.string().optional(),
  translation: translationSchema.nullable().optional(),
  thread_hint: z
    .object({ room: z.string().nullable().optional(), rationale: z.string().optional() })
    .optional(),
  claims: z.array(claimSchema).min(1),
});
export type Entry = z.infer<typeof entrySchema>;

export const blockEnrichmentSchema = z.object({
  entries: z.array(entrySchema),
});
export type BlockEnrichment = z.infer<typeof blockEnrichmentSchema>;
