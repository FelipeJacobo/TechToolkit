/**
 * vscode-extension/src/providers/sidebarProvider.ts
 *
 * Sidebar webview panel for analysis results
 */
import * as vscode from "vscode";
import { AIClient, AnalysisResult, FixResult } from "../api/client";
import { AuthManager } from "../utils/auth";
import { DiagnosticProvider } from "./diagnosticProvider";

// ============================================================
// Types
// ============================================================

type RunEntry = {
  id: string;
  goal: string;
  status: "running" | "completed" | "failed";
  timestamp: number;
  error?: string;
  result?: unknown;
};

// ============================================================
// Sidebar Provider
// ============================================================

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "aiclew.sidebar";

  private view?: vscode.WebviewView;
  private runs: RunEntry[] = [];
  private runCounter = 0;

  constructor(
    private context: vscode.ExtensionContext,
    private client: AIClient,
    private auth: AuthManager,
    private diagnostics: DiagnosticProvider
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getHtml();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "login":
          await this.auth.loginPrompt(this.client, this);
          break;
        case "logout":
          await this.auth.logout(this);
          break;
        case "refresh":
          this.render();
          break;
        case "openSettings":
          vscode.commands.executeCommand("workbench.action.openSettings", "aiclew");
          break;
        case "applyFix": {
          // Handled by extension commands
          break;
        }
      }
    });

    this.render();
  }

  // =========================================================================
  // Update methods (called from extension.ts)
  // =========================================================================

  addRun(goal: string, status: RunEntry["status"], error?: string) {
    this.runCounter++;
    const run: RunEntry = {
      id: `run-${this.runCounter}`,
      goal,
      status,
      timestamp: Date.now(),
      error,
    };
    this.runs = [run, ...this.runs.slice(0, 49)]; // Keep last 50
    this.render();
    this.view?.show(true);
  }

  addAnalysisResult(result: AnalysisResult, filePath: string) {
    this.runCounter++;
    const run: RunEntry = {
      id: `run-${this.runCounter}`,
      goal: `Analysis: ${filePath}`,
      status: "completed",
      timestamp: Date.now(),
      result,
    };
    this.runs = [run, ...this.runs.slice(0, 49)];
    this.render();
  }

  addFixResult(result: FixResult) {
    this.runCounter++;
    const run: RunEntry = {
      id: `run-${this.runCounter}`,
      goal: `Fixes: ${result.appliedCount} applied`,
      status: "completed",
      timestamp: Date.now(),
      result,
    };
    this.runs = [run, ...this.runs.slice(0, 49)];
    this.render();
  }

  updateRunStatus(result: unknown) {
    if (this.runs.length > 0) {
      this.runs[0].result = result;
      this.runs[0].status = "completed";
      this.render();
    }
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  private render() {
    if (!this.view) return;
    this.view.webview.html = this.getHtml();

    // Send current state to webview
    const isLoggedIn = this.auth.isLoggedIn();
    this.view.webview.postMessage({
      type: "state",
      runs: this.runs,
      isLoggedIn,
      user: this.auth.getUserInfo(),
    });
  }

  private getHtml(): string {
    const nonce = getNonce();
    const isLoggedIn = this.auth.isLoggedIn();
    const user = this.auth.getUserInfo();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${this.view?.webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Dev Assistant</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 8px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 4px;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 8px;
    }
    .header h2 { font-size: 14px; font-weight: 600; }
    .header .actions { display: flex; gap: 4px; }
    .btn {
      padding: 4px 8px;
      font-size: 11px;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn.icon { padding: 4px 6px; font-size: 13px; }
    .user-badge {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-right: 8px;
    }
    .section { margin-bottom: 12px; }
    .section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
    }
    .run-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 4px;
    }
    .run-card .goal {
      font-weight: 500;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .run-card .meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      gap: 8px;
    }
    .status {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: middle;
    }
    .status.completed { background: var(--vscode-testing-iconPassed); }
    .status.failed { background: var(--vscode-testing-iconFailed); }
    .status.running { background: var(--vscode-testing-iconUnset); animation: pulse 1s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .score-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
    }
    .score-high { background: #238636; color: white; }
    .score-medium { background: #d29922; color: #1a1a1a; }
    .score-low { background: #da3633; color: white; }
    .issue-count { font-size: 11px; }
    .issue-count .critical { color: var(--vscode-testing-iconFailed); }
    .issue-count .high { color: #d29922; }
    .empty-state {
      text-align: center;
      padding: 24px 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .empty-state .icon { font-size: 32px; margin-bottom: 8px; }
    .login-prompt {
      text-align: center;
      padding: 24px 8px;
    }
    .login-prompt p {
      margin-bottom: 12px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .analysis-detail {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div style="display:flex;align-items:center;">
      <h2>🤖 AI Dev Assistant</h2>
      ${isLoggedIn && user ? `<span class="user-badge">${user.email}</span>` : ""}
    </div>
    <div class="actions">
      ${isLoggedIn
        ? `<button class="btn icon" onclick="logout()" title="Logout">🚪</button>`
        : `<button class="btn" onclick="login()" title="Login">Login</button>`
      }
      <button class="btn icon" onclick="refresh()" title="Refresh">🔄</button>
    </div>
  </div>

  ${!isLoggedIn ? `
  <div class="login-prompt">
    <div class="icon">🔐</div>
    <p>Login to enable full analysis and task execution</p>
    <button class="btn" onclick="login()">Connect</button>
    <br><br>
    <button class="btn secondary" onclick="openSettings()">⚙️ Settings (set API key)</button>
  </div>
  ` : `
  <div class="section">
    <div class="section-title">Quick Actions</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;">
      <button class="btn secondary" onclick="vscode.postMessage({type:'openSettings'})">⚙️ Settings</button>
    </div>
  </div>
  `}

  <div class="section">
    <div class="section-title">Recent Runs (${this.runs.length})</div>
    ${this.runs.length === 0
      ? `<div class="empty-state">
          <div class="icon">📋</div>
          <p>No analysis runs yet.<br><br>
          Right-click code → <strong>"Analyze with AI"</strong><br>
          or right-click file → <strong>"Analyze Current File"</strong></p>
         </div>`
      : this.runs.map((run) => this.renderRunCard(run)).join("")
    }
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function login() { vscode.postMessage({ type: "login" }); }
    function logout() { vscode.postMessage({ type: "logout" }); }
    function refresh() { vscode.postMessage({ type: "refresh" }); }
    function openSettings() { vscode.postMessage({ type: "openSettings" }); }

    // Listen for state updates
    window.addEventListener("message", (event) => {
      // State updates handled by full re-render
      const msg = event.data;
      if (msg.type === "state") {
        // State sent from extension
      }
    });
  </script>
</body>
</html>`;
  }

  private renderRunCard(run: RunEntry): string {
    const time = new Date(run.timestamp).toLocaleTimeString();
    const statusIcon = `<span class="status ${run.status}"></span>`;

    let detail = "";
    const result = run.result as AnalysisResult | undefined;
    if (result && "score" in result) {
      const score = result.score;
      const scoreClass = score >= 75 ? "score-high" : score >= 50 ? "score-medium" : "score-low";
      detail = `
        <div class="analysis-detail">
          <span class="score-badge ${scoreClass}">${score}/100</span>
          &nbsp;
          <span class="issue-count">
            ${result.criticalCount > 0 ? `<span class="critical">● ${result.criticalCount} critical</span> ` : ""}
            ${result.highCount > 0 ? `<span class="high">● ${result.highCount} high</span>` : ""}
          </span>
        </div>`;
    }

    if (run.status === "failed" && run.error) {
      detail = `<div class="analysis-detail" style="color:var(--vscode-testing-iconFailed);">❌ ${run.error}</div>`;
    }

    return `
      <div class="run-card">
        <div class="goal">${statusIcon} ${escapeHtml(run.goal)}</div>
        <div class="meta">
          <span>${time}</span>
          <span style="text-transform:capitalize;">${run.status}</span>
        </div>
        ${detail}
      </div>
    `;
  }
}

// ============================================================
// Helpers
// ============================================================

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}
