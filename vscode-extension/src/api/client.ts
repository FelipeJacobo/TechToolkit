/**
 * vscode-extension/src/api/client.ts
 *
 * Client para el API de AI Dev Assistant V4
 */
import axios from "axios";

export type AnalysisResult = {
  language: string;
  filesAnalyzed: number;
  linesOfCode: number;
  score: number;
  scoreBreakdown: Record<string, number>;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  summary: string;
  topPriority: string;
  issues: Array<{
    file: string;
    line?: number;
    endLine?: number;
    type: string;
    severity: string;
    title: string;
    description: string;
    impact: string;
    fix?: {
      file: string;
      line?: number;
      original: string;
      replacement: string;
      description: string;
    };
    rule?: string;
  }>;
  architectureConcerns: Array<{
    concern: string;
    files: string[];
    description: string;
    recommendation: string;
    priority: string;
  }>;
};

export type FixResult = {
  fixedFiles: Array<{
    path: string;
    originalContent: string;
    fixedContent: string;
  }>;
  applied: Array<{ title: string; file: string; status: string; reason: string }>;
  skipped: Array<{ title: string; file: string; reason: string }>;
  totalIssues: number;
  appliedCount: number;
  skippedCount: number;
  summary: string;
};

export type TaskResult = {
  run: {
    id: string;
    status: string;
    traceId?: string;
  };
};

export type AuthResult = {
  user: { id: string; email: string };
  accessToken: string;
  refreshToken: string;
  organizationId: string;
};

export class AIClient {
  private axios;

  constructor(
    baseUrl: string,
    private apiKey: string
  ) {
    this.axios = axios.create({
      baseURL: baseUrl,
      timeout: 60000,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    });
  }

  setApiKey(key: string) {
    this.apiKey = key;
    this.axios.defaults.headers["Authorization"] = `Bearer ${key}`;
  }

  clearApiKey() {
    this.apiKey = "";
    delete this.axios.defaults.headers["Authorization"];
  }

  // ── Auth ──

  async login(email: string, password: string): Promise<AuthResult> {
    const { data } = await this.axios.post("/auth/login", { email, password });
    return data;
  }

  async me(): Promise<{ user: { email: string }; organizationId: string }> {
    const { data } = await this.axios.get("/auth/me");
    return data;
  }

  // ── Direct analysis (via API tool endpoint) ──

  async analyzeCode(input: {
    files: Array<{ path: string; content: string }>;
    language: string;
    focus?: string;
    maxIssues?: number;
  }): Promise<{ ok: true; result: AnalysisResult } | { ok: false; error: string }> {
    try {
      const { data } = await this.axios.post("/agent/analyze", input);
      return data;
    } catch (err: any) {
      return {
        ok: false,
        error: err.response?.data?.message ?? err.message ?? "Analysis failed",
      };
    }
  }

  // ── Fix code ──

  async fixCode(input: {
    files: Array<{ path: string; content: string }>;
    issues: Array<{
      file: string;
      line?: number;
      fix?: { original: string; replacement: string; description: string };
    }>;
  }): Promise<{ ok: true; result: FixResult } | { ok: false; error: string }> {
    try {
      const { data } = await this.axios.post("/agent/fix", input);
      return data;
    } catch (err: any) {
      return {
        ok: false,
        error: err.response?.data?.message ?? err.message ?? "Fix failed",
      };
    }
  }

  // ── Send task (agent run) ──

  async sendTask(input: {
    goal: string;
    projectId: string;
    files?: string[];
  }): Promise<TaskResult> {
    const { data } = await this.axios.post("/agent/run-task", input);
    return data;
  }

  // ── Get run status ──

  async getRunStatus(runId: string): Promise<{ run: { id: string; status: string; logs?: Array<{ level: string; message: string }> } }> {
    const { data } = await this.axios.get(`/agent/runs/${runId}`);
    return data;
  }

  // ── Projects ──

  async getProjects(): Promise<{ projects: Array<{ id: string; name: string; repo?: string }> }> {
    const { data } = await this.axios.get("/projects");
    return data;
  }
}
