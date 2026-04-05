/**
 * searchResultSchema — Zod schema for semantic search results
 */
import { z } from "zod";

export const searchResultSchema = z.object({
  id: z.string(),
  filePath: z.string(),
  content: z.string(),
  language: z.string(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  similarity: z.number().min(0).max(1),
  fileId: z.string(),
  projectId: z.string().uuid(),
});
