/**
 * analyzeCode.ts — Herramienta de análisis de código con IA (v2 mejorada)
 *
 * Estructura de detección:
 *   1. Scan estático: bugs, vulnerabilidades, performance, anti-patterns
 *   2. Análisis arquitectónico: acoplamiento, responsabilidades, patrones
 *   3. Fixes concretos: código de reemplazo listo para aplicar
 *
 * Motor: OpenAI API (GPT-4o recomendado)
 */

import { z } from "zod";

// ============================================================
// Schemas
// ============================================================

const CodeFixSchema = z.object({
  file: z.string(),
  line: z.number().describe("Línea donde empieza el cambio"),
  endLine: z.number().optional().describe("Línea donde termina el cambio"),
  original: z.string().describe("Código original a reemplazar"),
  replacement: z.string().describe("Código de reemplazo listo para aplicar"),
  description: z.string().describe("Por qué este cambio y qué soluciona"),
});

const IssueSchema = z.object({
  file: z.string(),
  line: z.number().optional().describe("Línea exacta del problema"),
  type: z.enum([
    "bug",
    "vulnerability",
    "code_smell",
    "performance",
    "architecture",
    "style",
  ]),
  severity: z.enum(["critical", "high", "medium", "low"]).describe("Prioridad del issue"),
  title: z.string().describe("Título descriptivo del problema"),
  description: z.string().describe("Explicación detallada del problema y por qué es un problema"),
  impact: z.string().describe("Qué pasa si no se arregla"),
  fix: CodeFixSchema.optional().describe("Fix concreto con código de reemplazo"),
  rule: z.string().optional().describe("Regla o patrón que detectó el problema"),
});

const ArchitectureConcernSchema = z.object({
  concern: z.string(),
  files: z.array(z.string()).describe("Archivos involucrados"),
  description: z.string().describe("Por qué es un problema arquitectónico"),
  recommendation: z.string().describe("Cómo resolverlo"),
  priority: z.enum(["high", "medium", "low"]),
});

const AnalysisResultSchema = z.object({
  language: z.string(),
  filesAnalyzed: z.number(),
  linesOfCode: z.number(),
  score: z.number().min(0).max(100).describe("Overall code quality 0-100"),
  scoreBreakdown: z.object({
    security: z.number().min(0).max(100),
    bugs: z.number().min(0).max(100),
    performance: z.number().min(0).max(100),
    maintainability: z.number().min(0).max(100),
    architecture: z.number().min(0).max(100),
  }),
  criticalCount: z.number(),
  highCount: z.number(),
  mediumCount: z.number(),
  lowCount: z.number(),
  summary: z.string().describe("2-3 sentence executive summary"),
  issues: z.array(IssueSchema),
  architectureConcerns: z.array(ArchitectureConcernSchema),
  topPriority: z.string().describe("El issue más importante a resolver primero"),
});

export type CodeIssue = z.infer<typeof IssueSchema>;
export type CodeFix = z.infer<typeof CodeFixSchema>;
export type ArchitectureConcern = z.infer<typeof ArchitectureConcernSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

// ============================================================
// Input
// ============================================================

export type AnalyzeCodeInput = {
  files: Array<{ path: string; content: string }>;
  language: string;
  focus?: string; // "security", "performance", "bugs", etc.
  maxIssues?: number;
  framework?: string;
};

// ============================================================
// Prompt Engineering
// ============================================================

function buildAnalysisPrompt(
  input: AnalyzeCodeInput,
  maxIssues: number
): string {
  const filesSection = input.files
    .map((f) =>
      `\n### File: \`${f.path}\`\n\`\`\`${input.language}\n${f.content}\n\`\`\``
    )
    .join("\n");

  const focus = input.focus
    ? `\n## Foco prioritario del análisis\n${input.focus}\n`
    : "";

  const framework = input.framework
    ? `Framework/Lib: ${input.framework}. Considera las convenciones y mejores prácticas de este framework.`
    : "";

  return `Eres un Staff Engineer con 15+ años de experiencia. Has revisado miles de codebases y encontrado bugs que causaron outages. No das feedback genérico — cada punto que mencionas es específico, con línea, contexto, y fix listo para aplicar.

${focus}
${framework}

## Código a analizar (${input.language}):

${filesSection}

---

## Tu misión: análisis exhaustivo

Analiza el código en 3 niveles:

### Nivel 1: Bugs y Vulnerabilidades (prioridad máxima)
- SQL Injection, XSS, command injection, SSRF
- Credenciales hardcodeadas, tokens expuestos
- Race conditions, null dereferences, off-by-one, unhandled exceptions
- Lógica de negocio incorrecta (pagos, auth, permissions bypass)
- Deserialización insegura, prototype pollution
- Input validation faltante en endpoints públicos
- Error handling que expone información sensible

### Nivel 2: Performance y Recursos
- N+1 queries, queries sin índice
- Unbounded loops o recursión sin límite
- Memory leaks: listeners no removidos, streams no cerrados
- Conexiones a DB/HTTP no liberadas en finally/using
- Serialización innecesaria o falta de caché donde importa
- Operaciones síncronas en path crítico (fI/O, crypto en request handler)

### Nivel 3: Arquitectura y Acoplamiento
- God classes / funciones de 100+ líneas
- Violaciones de SRP (una clase hace 3+ cosas distintas)
- Acoplamiento alto entre módulos (import circular, shared mutable state)
- Anti-patterns: singleton abuse, global state, tight coupling a implementación
- Missing abstractions en patrones que se repiten 3+ veces
- Capas mezcladas (lógica de negocio en controllers, queries en handlers)

---

## Formato de salida

Devuelve SOLO JSON válido. Sin markdown, sin explicación, sin preámbulo. Sin \`\`\`json.

{
  "language": "${input.language}",
  "filesAnalyzed": ${input.files.length},
  "linesOfCode": ${input.files.reduce((acc, f) => acc + f.content.split("\n").length, 0)},
  "score": 0,
  "scoreBreakdown": {
    "security": 0,
    "bugs": 0,
    "performance": 0,
    "maintainability": 0,
    "architecture": 0
  },
  "criticalCount": 0,
  "highCount": 0,
  "mediumCount": 0,
  "lowCount": 0,
  "summary": "Executive summary en 2-3 frases. Qué es el código y cuáles son los problemas más serios.",
  "topPriority": "El issue #1 que debes resolver antes que nada",
  "issues": [
    {
      "file": "ruta relativa del archivo",
      "line": 42,
      "endLine": 45,
      "type": "bug",
      "severity": "critical",
      "title": "title corto del problema",
      "description": "Explicación detallada. Por qué es un problema. Qué puede pasar.",
      "impact": "Qué pasa en producción si no se arregla",
      "fix": {
        "file": "ruta del archivo",
        "line": 42,
        "original": "const query = 'SELECT * FROM users WHERE id = ' + req.params.id;",
        "replacement": "const query = 'SELECT * FROM users WHERE id = $1';\nconst result = await pool.query(query, [req.params.id]);",
        "description": "Usar query parametrizada previene SQL injection"
      },
      "rule": "SE-01: SQL Injection - nunca concatenar input del usuario en queries"
    }
  ],
  "architectureConcerns": [
    {
      "concern": "Título del problema arquitectónico",
      "files": ["file1.ts", "file2.ts"],
      "description": "Por qué es un problema de arquitectura",
      "recommendation": "Cómo resolverlo concretamente",
      "priority": "high"
    }
  ]
}

---

## Reglas estrictas

1. **Cada issue debe ser específico.** "Agregar validación" es inútil. "Validar que \`amount\` sea positivo antes de \`stripe.charges.create\` en línea 89" es accionable.
2. **Line numbers siempre que sea posible.** Busca en el código el patrón exacto.
3. **Los fixes deben ser código listo para copiar/pegar.** No descripciones textuales del fix.
4. **Prioriza por impacto real.** Un SQL injection es critical. Un naming inconsistente es low.
5. **No inventes código que no existe.** Analiza solo lo que ves. No asumas imports missing ni funciones que no están.
6. **Si no hay issues, arrays vacíos.** No fuerces problemas donde no los hay.
7. **Máximo ${maxIssues} issues en total.**
8. **Score breakdown debe ser consistente con issues encontrados.** Si hay 3 vulnerabilidades críticas, security score debe ser <30.
9. **No seas condescendiente.** Sé directo y profesional, como un review de código serio.
10. **Devuelve SOLO JSON.** Si devuelves algo más, el parseo falla y el análisis se pierde.`;
}

// ============================================================
// Handler
// ============================================================

export async function analyzeCode(
  input: AnalyzeCodeInput
): Promise<
  { ok: true; result: AnalysisResult } | { ok: false; error: string }
> {
  if (input.files.length === 0) {
    return { ok: false, error: "No files provided" };
  }

  const totalSize = input.files.reduce(
    (acc, f) => acc + f.content.length,
    0
  );
  if (totalSize > 200_000) {
    return {
      ok: false,
      error: `Input too large (${totalSize.toLocaleString()} chars). Max 200KB for single analysis. Split into smaller batches.`,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "OPENAI_API_KEY not set" };
  }

  const model = process.env.ANALYSIS_MODEL ?? "gpt-4o";
  const maxIssues = input.maxIssues ?? 50;
  const prompt = buildAnalysisPrompt(input, maxIssues);

  try {
    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 8192,
          messages: [
            {
              role: "system",
              content:
                "You are a code analysis tool. You return ONLY valid JSON with code analysis results. Never add explanation outside the JSON object. Never use markdown formatting.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        ok: false,
        error: `OpenAI API error ${response.status}: ${errorBody}`,
      };
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return { ok: false, error: "Empty response from OpenAI" };
    }

    // Extract JSON from possible markdown wrapping
    let jsonStr = content.trim();
    if (jsonStr.startsWith("```")) {
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (match) jsonStr = match[0];
    }

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const result = AnalysisResultSchema.safeParse(parsed);

    if (!result.success) {
      // Try partial recovery
      const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
      const score = typeof parsed.score === "number" ? parsed.score : 50;
      return {
        ok: true,
        result: {
          language: input.language,
          filesAnalyzed: input.files.length,
          linesOfCode: input.files.reduce(
            (a, f) => a + f.content.split("\n").length,
            0
          ),
          score,
          scoreBreakdown: (parsed.scoreBreakdown as Record<string, number>) ?? {
            security: score,
            bugs: score,
            performance: score,
            maintainability: score,
            architecture: score,
          },
          criticalCount: issues.filter(
            (i: Record<string, string>) => i.severity === "critical"
          ).length,
          highCount: issues.filter(
            (i: Record<string, string>) => i.severity === "high"
          ).length,
          mediumCount: issues.filter(
            (i: Record<string, string>) => i.severity === "medium"
          ).length,
          lowCount: issues.filter(
            (i: Record<string, string>) => i.severity === "low"
          ).length,
          summary:
            typeof parsed.summary === "string"
              ? parsed.summary
              : "Analysis completed with partial validation",
          topPriority:
            typeof parsed.topPriority === "string"
              ? parsed.topPriority
              : "Check issues for highest severity",
          issues,
          architectureConcerns: Array.isArray(
            parsed.architectureConcerns
          )
            ? parsed.architectureConcerns
            : [],
        } as AnalysisResult,
      };
    }

    return { ok: true, result: result.data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Analysis failed: ${message}` };
  }
}

// ============================================================
// Tool registration (for use in toolRegistry)
// ============================================================

export default async (
  input: unknown
): Promise<{ ok: boolean; result?: AnalysisResult; error?: string }> => {
  try {
    const parsed = z
      .object({
        files: z.array(z.object({ path: z.string(), content: z.string() })),
        language: z.string(),
        focus: z.string().optional(),
        maxIssues: z.number().optional(),
        framework: z.string().optional(),
      })
      .safeParse(input);

    if (!parsed.success) {
      return {
        ok: false,
        error: `Invalid input: ${parsed.error.errors
          .map((e) => e.message)
          .join(", ")}`,
      };
    }

    return await analyzeCode(parsed.data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
};
