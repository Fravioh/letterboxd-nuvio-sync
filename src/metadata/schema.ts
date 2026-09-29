import { z } from 'zod';
export const candidateSchema = z.object({
  tmdb: z.number().int().positive().safe(),
  imdb: z
    .string()
    .regex(/^tt\d{7,12}$/)
    .optional(),
  title: z.string().min(1).max(500),
  originalTitle: z.string().max(500),
  year: z.number().int().min(1880).max(2200).optional(),
  posterPath: z.string().max(500).optional(),
});
export const metadataRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('search'),
      title: z.string().trim().min(1).max(500),
      year: z.number().int().min(1880).max(2200).optional(),
    })
    .strict(),
  z.object({ operation: z.literal('movie'), id: z.number().int().positive().safe() }).strict(),
  z.object({ operation: z.literal('find'), imdb: z.string().regex(/^tt\d{7,12}$/) }).strict(),
]);
export type MetadataRequest = z.infer<typeof metadataRequestSchema>;
