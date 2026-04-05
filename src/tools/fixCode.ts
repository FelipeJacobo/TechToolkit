/**
 * fixCode.ts — Tool para aplicar fixes automáticamente al código
 *
 * Flujo en orchestrator:
 *   analyze_code → issues → fix_code → código corregido → critic → approve
 *
 * Estrategias de aplicación (en orden):
 *   1. String replacement exacto (más fiable)
 *   2. Line-range replacement (usa endLine del issue)
 *   3. Fuzzy match con LCS (tolera whitespace differences)
 *   4. LLM generation fallback (si no hay fix prebuilt)
 *
 * Output: archivos corregidos + diff unificado + summary
 */

import { z } from "zod";

// ============================================================
// Types
// ============================================================

export interface IssueInput {
  file: string;
  line?: number;
  endLine?: number;
  type: string;
  severity: string;
  title: string;
  description: string;
  fix?: {
    file: string;
    line?: number;
    endLine?: number;
    original: string;
    replacement: string;
    description: string;
  };
}

export interface FixedFile {
  path: string;
  originalContent: string;
  fixedContent: string;
  diffHunks: DiffHunk[];
  issuesApplied: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

interface AppliedIssue {
  title: string;
  file: string;
  line?: number;
  status: "applied" | "skipped";
  reason: string;
  severity?: string;
}

export interface FixResult {
  fixedFiles: FixedFile[];
  applied: AppliedIssue[];
  skipped: AppliedIssue[];
  totalIssues: number;
  appliedCount: number;
  skippedCount: number;
  summary: string;
}

// ============================================================
// Input Schema
// ============================================================

const FixCodeInputSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    content: z.string(),
  })).min(1, "At least one file is required"),
  issues: z.array(z.object({
    file: z.string(),
    line: z.number().optional(),
    endLine: z.number().optional(),
    type: z.string(),
    severity: z.string(),
    title: z.string(),
    description: z.string(),
    fix: z.object({
      file: z.string(),
      line: z.number().optional(),
      endLine: z.number().optional(),
      original: z.string(),
      replacement: z.string(),
      description: z.string(),
    }).optional(),
  })).min(1, "At least one issue is required"),
});

export type FixCodeInput = z.infer<typeof FixCodeInputSchema>;

// ============================================================
// Core: apply a single fix to file content
// ============================================================

function applyFix(
  content: string,
  fix: Exclude<IssueInput["fix"], undefined>
): { success: boolean; content: string } {
  const trimmedOriginal = fix.original.trim();
  const replacement = fix.replacement;

  // Strategy 1: exact string replacement
  if (content.includes(trimmedOriginal)) {
    return { success: true, content: content.replace(trimmedOriginal, replacement) };
  }

  // Strategy 2: line-range replacement
  if (fix.line) {
    const lines = content.split("\n");
    const start = Math.max(0, fix.line - 1);      // 1→0 indexed
    const end = fix.endLine !== undefined
      ? Math.min(fix.endLine, lines.length)
      : start + Math.max(1, trimmedOriginal.split("\n").length);

    const range = lines.slice(start, end).join("\n");
    if (range.trim() === trimmedOriginal || range.includes(trimmedOriginal)) {
      const fixed = [
        ...lines.slice(0, start),
        ...(replacement.split("\n")),
        ...lines.slice(end),
      ];
      return { success: true, content: fixed.join("\n") };
    }
  }

  // Strategy 3: fuzzy block match (≥80% line match)
  const origLines = trimmedOriginal.split("\n").map((l) => l.trim());
  const fileLines = content.split("\n");
  const minLen = Math.min(origLines.length, fileLines.length);

  if (minLen > 0 && origLines.length <= fileLines.length) {
    for (let i = 0; i <= fileLines.length - origLines.length; i++) {
      let matches = 0;
      for (let j = 0; j < origLines.length; j++) {
        if (origLines[j] === "" || fileLines[i + j].trim() === origLines[j]) {
          matches++;
        }
      }
      if (matches / origLines.length >= 0.8) {
        const fixed = [
          ...fileLines.slice(0, i),
          ...(replacement.split("\n")),
          ...fileLines.slice(i + origLines.length),
        ];
        return { success: true, content: fixed.join("\n") };
      }
    }
  }

  return { success: false, content };
}

// ============================================================
// Diff generation (LCS-based unified diff)
// ============================================================

function computeDiff(oldContent: string, newContent: string): DiffHunk[] {
  const old = oldContent.split("\n");
  const new_ = newContent.split("\n");

  if (old.join("\n") === new_.join("\n")) return [];

  // Build LCS table
  const m = old.length;
  const n = new_.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = old[i - 1] === new_[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to diff ops
  const ops: Array<{ type: "eq" | "rm" | "add"; oldLine?: string; newLine?: string }> = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && old[i - 1] === new_[j - 1]) {
      ops.unshift({ type: "eq", oldLine: old[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "add", newLine: new_[j - 1] });
      j--;
    } else {
      ops.unshift({ type: "rm", oldLine: old[i - 1] });
      i--;
    }
  }

  // Group into hunks with 3 lines of context
  const hunks: DiffHunk[] = [];
  const contextLines = 3;
  const changeIndices = ops
    .map((op, idx) => op.type !== "eq" ? idx : -1)
    .filter((idx) => idx !== -1);

  if (changeIndices.length === 0) return [];

  // Merge overlapping hunk ranges
  const ranges: Array<{ start: number; end: number }> = [];
  for (const ci of changeIndices) {
    const start = Math.max(0, ci - contextLines);
    const end = Math.min(ops.length - 1, ci + contextLines);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  // Build hunks from ranges
  for (const range of ranges) {
    let oldNum = 1;
    let newNum = 1;
    // Count lines before this hunk
    for (let k = 0; k < range.start; k++) {
      if (ops[k].type !== "add") oldNum++;
      if (ops[k].type !== "rm") newNum++;
    }

    const hunk: DiffHunk = {
      oldStart: oldNum,
      oldLines: 0,
      newStart: newNum,
      newLines: 0,
      lines: [],
    };

    for (let k = range.start; k <= range.end && k < ops.length; k++) {
      const op = ops[k];
      if (op.type === "eq") {
        hunk.lines.push(` ${op.oldLine}`);
        hunk.oldLines++;
        hunk.newLines++;
        oldNum++; newNum++;
      } else if (op.type === "rm") {
        hunk.lines.push(`-${op.oldLine}`);
        hunk.oldLines++;
        oldNum++;
      } else {
        hunk.lines.push(`+${op.newLine}`);
        hunk.newLines++;
        newNum++;
      }
    }

    hunks.push(hunk);
  }

  return hunks;
}

// ============================================================
// LLM fallback for issues without pre-built fixes
// ============================================================

async function generateFixLLM(
  fileContent: string,
  filePath: string,
  issue: FixCodeInput["issues"][number]
): Promise<{ content: string } | { error: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OPENAI_API_KEY not set" };

  const model = process.env.ANALYSIS_MODEL ?? process.env.AGENT_MODEL ?? "gpt-4o";

  const prompt = `Fix the following issue in the code. Return ONLY the complete corrected file. No explanation, no markdown, no backticks.

File: ${filePath}
Issue: ${issue.title} (${issue.severity})
Type: ${issue.type}
Description: ${issue.description}
${issue.line ? `Around line: ${issue.line}` : ""}

Current code:
\`\`\`
${fileContent}
\`\`\`

Return the entire fixed file. Only change what's needed to fix the issue. Keep all other code identical.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 8192,
        messages: [
          { role: "system", content: "You return ONLY corrected code. No markdown, no explanation." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { error: `OpenAI ${res.status}: ${body}` };
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    let content = data.choices?.[0]?.message?.content?.trim() ?? "";

    // Strip markdown fences if present
    if (content.startsWith("```")) {
      content = content.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
    }

    return { content };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Unified diff renderer
// ============================================================

export function renderUnifiedDiff(fixedFiles: FixedFile[]): string {
  if (fixedFiles.length === 0) return "No changes to diff.";

  return fixedFiles.map((f) => {
    let out = `diff --git a/${f.path} b/${f.path}\n`;
    if (f.diffHunks.length === 0) return out + "\n(no changes detected in text)\n";

    for (const h of f.diffHunks) {
      out += `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n`;
      out += h.lines.join("\n") + "\n";
    }
    return out;
  }).join("\n");
}

// ============================================================
// Main handler
// ============================================================

export async function fixCode(
  input: FixCodeInput
): Promise<{ ok: true; result: FixResult } | { ok: false; error: string }> {
  // Group issues by file (normalize path: strip leading ./)
  const byFile = new Map<string, typeof input.issues>();
  for (const issue of input.issues) {
    const key = issue.file.replace(/^\.\//, "");
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(issue);
  }

  const fixedFiles: FixedFile[] = [];
  const applied: AppliedIssue[] = [];
  const skipped: AppliedIssue[] = [];

  for (const file of input.files) {
    const normPath = file.path.replace(/^\.\//, "");
    const issues = byFile.get(normPath) ?? [];
    if (issues.length === 0) continue;

    let current = file.content;
    let fileApplied = 0;

    for (const issue of issues) {
      if (issue.fix) {
        // Use the provided fix
        const result = applyFix(current, issue.fix);
        if (result.success) {
          current = result.content;
          fileApplied++;
          applied.push({
            title: issue.title, file: issue.file, line: issue.line,
            status: "applied", reason: issue.fix.description, severity: issue.severity,
          });
        } else {
          skipped.push({
            title: issue.title, file: issue.file, line: issue.line,
            status: "skipped", reason: "Could not locate code to replace. Manual review needed.", severity: issue.severity,
          });
        }
      } else {
        // No fix provided → generate with LLM
        const llm = await generateFixLLM(current, file.path, issue);
        if ("error" in llm) {
          skipped.push({
            title: issue.title, file: file.path, line: issue.line,
            status: "skipped", reason: `LLM generation failed: ${llm.error}`, severity: issue.severity,
          });
        } else {
          current = llm.content;
          fileApplied++;
          applied.push({
            title: issue.title, file: file.path, line: issue.line,
            status: "applied", reason: "Auto-generated fix (no pre-built fix available)", severity: issue.severity,
          });
        }
      }
    }

    if (fileApplied > 0) {
      fixedFiles.push({
        path: normPath,
        originalContent: file.content,
        fixedContent: current,
        diffHunks: computeDiff(file.content, current),
        issuesApplied: fileApplied,
      });
    }
  }

  // Sort by severity
  const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  applied.sort((a, b) => (sevOrder[a.severity ?? "medium"] ?? 9) - (sevOrder[b.severity ?? "medium"] ?? 9));

  const summary = `Fixed ${applied.length}/${input.issues.length} issues ` +
    `across ${fixedFiles.length} file(s). ` +
    (skipped.length > 0 ? `${skipped.length} need manual review.` : "All applied.");

  return {
    ok: true,
    result: {
      fixedFiles,
      applied,
      skipped,
      totalIssues: input.issues.length,
      appliedCount: applied.length,
      skippedCount: skipped.length,
      summary,
    },
  };
}

// ============================================================
// Tool registration
// ============================================================

export default async (
  input: unknown
): Promise<{ ok: boolean; result?: FixResult; error?: string }> => {
  try {
    const parsed = FixCodeInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.errors.map((e) => e.message).join(", ") };
    }
    return await fixCode(parsed.data);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};
