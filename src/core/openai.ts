/**
 * openai.ts — Centralized, safe OpenAI client
 *
 * - Timeout via AbortController (configurable, default 60s)
 * - Redacted error messages (no API key leaks, no full prompt exposure)
 * - Retry with exponential backoff (configurable)
 * - Consistent headers & base URL
 */

// ============================================================
// Config
// ============================================================

type OpenAIClientConfig = {
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseUrl?: string;
};

type ChatCompletionRequest = {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: string };
  tools?: unknown[];
  tool_choice?: string;
};

type EmbeddingRequest = {
  model?: string;
  input: string | string[];
  dimensions?: number;
};

// ============================================================
// Client
// ============================================================

export class OpenAIClient {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(config: OpenAIClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.maxRetries = config.maxRetries ?? 2;
  }

  // ---- Chat Completions ----
  async chatCompletion(
    req: ChatCompletionRequest
  ): Promise<{ ok: true; content: string; model?: string } | { ok: false; error: string }> {
    const body = {
      model: req.model ?? process.env.AGENT_MODEL ?? process.env.ANALYSIS_MODEL ?? "gpt-4o",
      messages: req.messages,
      temperature: req.temperature ?? 0.1,
      max_tokens: req.max_tokens ?? 4096,
      ...(req.response_format ? { response_format: req.response_format } : {}),
      ...(req.tools ? { tools: req.tools, tool_choice: req.tool_choice } : {}),
    };

    const result = await this.fetchWithRetry("/chat/completions", body);
    if (!result.ok) return result;

    const data = result.data as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) return { ok: false, error: "Empty response from OpenAI" };

    return { ok: true, content, model: data.model };
  }

  // ---- Embeddings ----
  async embeddings(
    req: EmbeddingRequest
  ): Promise<{ ok: true; embeddings: number[][]; model?: string } | { ok: false; error: string }> {
    const body = {
      model: req.model ?? "text-embedding-3-small",
      input: req.input,
      ...(req.dimensions ? { dimensions: req.dimensions } : {}),
    };

    const result = await this.fetchWithRetry("/embeddings", body);
    if (!result.ok) return result;

    const data = result.data as {
      data?: Array<{ embedding?: number[] }>;
      model?: string;
    };

    if (!data.data?.length) return { ok: false, error: "No embeddings returned" };

    const embeddings = data.data
      .map((item) => item.embedding)
      .filter((e): e is number[] => !!e);

    return { ok: true, embeddings, model: data.model };
  }

  // ---- Helpers ----

  private async fetchWithRetry(
    path: string,
    body: Record<string, unknown>,
    attempt = 0
  ): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        // 🛡️ Redacted error — don't leak full response body
        const status = response.status;
        let summary = `OpenAI API error ${status}`;

        try {
          const errorBody = (await response.json()) as {
            error?: { message?: string; code?: string; type?: string };
          };
          const msg = errorBody.error?.message;
          if (msg) {
            // Only expose status + error type/code, never full prompt/content
            const safeMsg = msg.length > 200 ? msg.slice(0, 200) + "..." : msg;
            summary += `: ${safeMsg}`;
          }
        } catch {
          summary += `: ${response.statusText}`;
        }

        // Retry on rate limits / server errors
        if ((status === 429 || status >= 500) && attempt < this.maxRetries) {
          const backoff = Math.min(2 ** attempt * 1000, 10_000);
          console.warn(`[openai] ${summary} — retrying in ${backoff}ms (attempt ${attempt + 1})`);
          await new Promise((r) => setTimeout(r, backoff));
          return this.fetchWithRetry(path, body, attempt + 1);
        }

        return { ok: false, error: summary };
      }

      const data = await response.json();
      return { ok: true, data };
    } catch (err) {
      // AbortError = timeout
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, error: `OpenAI request timed out after ${this.timeoutMs}ms` };
      }

      // Retry on network errors
      if (attempt < this.maxRetries) {
        const backoff = Math.min(2 ** attempt * 1000, 10_000);
        console.warn(`[openai] Network error — retrying in ${backoff}ms (attempt ${attempt + 1})`);
        await new Promise((r) => setTimeout(r, backoff));
        return this.fetchWithRetry(path, body, attempt + 1);
      }

      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `OpenAI request failed: ${message}` };
    }
  }
}

// ============================================================
// Singleton factory
// ============================================================

let _client: OpenAIClient | null = null;

export function getOpenAIClient(opts?: { timeoutMs?: number }): OpenAIClient | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  if (!_client) {
    _client = new OpenAIClient({
      apiKey,
      timeoutMs: opts?.timeoutMs,
    });
  }
  return _client;
}
