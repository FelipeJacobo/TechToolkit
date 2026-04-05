/**
 * vscode-extension/src/extension.ts
 *
 * VS Code extension para AI Dev Assistant V4
 * Conecta con el API SaaS y muestra análisis en panel lateral.
 */
import * as vscode from "vscode";
import { AIClient } from "./api/client";
import { SidebarProvider } from "./providers/sidebarProvider";
import { DiagnosticProvider } from "./providers/diagnosticProvider";
import { AuthManager } from "./utils/auth";

// ============================================================
// Constants
// ============================================================

const EXTENSION_ID = "aiclew-dev-assistant";

// ============================================================
// Activate
// ============================================================

export function activate(context: vscode.ExtensionContext) {
  console.log(`${EXTENSION_ID} activated`);

  const config = vscode.workspace.getConfiguration("aiclew");
  const apiUrl = config.get<string>("apiUrl", "http://localhost:8081");

  // 🔒 Use SecretStorage for the API key (not settings.json)
  // Fallback: check settings only if SecretStorage is empty (migration path)
  const auth = new AuthManager(context);
  let apiKey = auth.getApiKey();
  if (!apiKey) {
    // One-time migration: move plain-text apiKey to SecretStorage, then delete from settings
    const legacyKey = config.get<string>("apiKey", "");
    if (legacyKey) {
      (async () => {
        await auth.setApiKey(legacyKey);
        await config.update("apiKey", undefined, vscode.ConfigurationTarget.Global);
        console.log("Migrated API key from settings to SecretStorage");
      })();
      apiKey = legacyKey;
    }
  }

  const client = new AIClient(apiUrl, apiKey ?? "");
  const diagnostics = new DiagnosticProvider();
  const sidebar = new SidebarProvider(context, client, auth, diagnostics);

  // Register sidebar webview
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "aiclew.sidebar",
      sidebar
    )
  );

  // ── Commands ──

  // Analyze selected code
  context.subscriptions.push(
    vscode.commands.registerCommand("aiclew.analyzeSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showErrorMessage("No text selected");
        return;
      }

      const text = editor.document.getText(selection);
      const fileName = editor.document.fileName;
      const language = editor.document.languageId;

      await runAnalysis(client, sidebar, diagnostics, {
        files: [{ path: fileName, content: text }],
        language,
        focus: `Analysis of selected code (${selection.start.line + 1}-${selection.end.line + 1})`,
      });
    })
  );

  // Analyze current file
  context.subscriptions.push(
    vscode.commands.registerCommand("aiclew.analyzeFile", async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!targetUri) {
        vscode.window.showErrorMessage("No file selected");
        return;
      }

      const document = await vscode.workspace.openTextDocument(targetUri);
      const content = document.getText();

      await runAnalysis(client, sidebar, diagnostics, {
        files: [{ path: document.fileName, content }],
        language: document.languageId,
        focus: "Full file analysis",
      });
    })
  );

  // Analyze entire project
  context.subscriptions.push(
    vscode.commands.registerCommand("aiclew.analyzeProject", async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace folder open");
        return;
      }

      const root = workspaceFolders[0].uri.fsPath;
      const config = vscode.workspace.getConfiguration("aiclew");
      const projectId = config.get<string>("projectId", "");

      if (!projectId) {
        const input = await vscode.window.showInputBox({
          prompt: "Enter project ID (or create one in the web app first)",
          placeHolder: "e.g. abc123def456",
          validateInput: (v) => v.trim().length > 0 ? null : "Project ID is required",
        });

        if (!input) return;
        await config.update("projectId", input.trim(), vscode.ConfigurationTarget.Workspace);

        vscode.window.showInformationMessage(
          "Project ID saved. You can change it in Settings.",
          "Open Settings"
        ).then((action) => {
          if (action === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "aiclew.projectId"
            );
          }
        });
      }

      // Send run-task to the SaaS API (full project analysis)
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "AI Dev Assistant: Sending project analysis task...",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: "Sending to agent..." });

          try {
            const result = await client.sendTask({
              goal: `Full project analysis: find vulnerabilities, bugs, and code smells in the workspace.`,
              projectId: config.get<string>("projectId", ""),
            });

            progress.report({ message: "Task queued — check the sidebar for results" });

            // Refresh sidebar with run ID
            sidebar.updateRunStatus(result);

            vscode.window.showInformationMessage(
              "Analysis task sent! Results will appear in the sidebar.",
              "Open Panel"
            ).then(() => {
              vscode.commands.executeCommand("aiclew.showPanel");
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to send task: ${message}`);
          }
        }
      );
    })
  );

  // Quick Analysis: selected text (command palette)
  context.subscriptions.push(
    vscode.commands.registerCommand("aiclew.quickAnalysis", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        // Analyze the whole current file
        const document = editor?.document;
        if (!document) return;

        await runAnalysis(client, sidebar, diagnostics, {
          files: [{ path: document.fileName, content: document.getText() }],
          language: document.languageId,
          focus: "Quick analysis",
        });
        return;
      }

      // Analyze selection
      await vscode.commands.executeCommand("aiclew.analyzeSelection");
    })
  );

  // Show sidebar panel
  context.subscriptions.push(
    vscode.commands.registerCommand("aiclew.showPanel", () => {
      vscode.commands.executeCommand("aiclew.sidebar.focus");
    })
  );

  // Login
  context.subscriptions.push(
    vscode.commands.registerCommand("aiclew.login", async () => {
      await auth.loginPrompt(client, sidebar);
    })
  );

  // Logout
  context.subscriptions.push(
    vscode.commands.registerCommand("aiclew.logout", async () => {
      await auth.logout(sidebar);
      vscode.window.showInformationMessage("Logged out from AI Dev Assistant");
    })
  );

  // ── Status bar ──
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.text = "$(copilot) AI Dev Assistant";
  statusBar.tooltip = "AI Dev Assistant — Click to analyze";
  statusBar.command = "aiclew.showPanel";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // ── File watcher for diagnostic updates ──
  context.subscriptions.push(diagnostics);
}

export function deactivate() {}

// ============================================================
// Core: run analysis on code
// ============================================================

async function runAnalysis(
  client: AIClient,
  sidebar: SidebarProvider,
  diagnostics: DiagnosticProvider,
  input: {
    files: Array<{ path: string; content: string }>;
    language: string;
    focus: string;
  }
) {
  const fileName = input.files[0]?.path.split("/").pop() ?? "unknown";

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `AI Dev Assistant: Analyzing ${fileName}...`,
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Sending to analysis engine..." });
      sidebar.addRun(input.focus, "running");

      try {
        const result = await client.analyzeCode(input);

        if (result.ok && result.result) {
          const analysis = result.result;

          progress.report({ message: `Found ${analysis.issues.length} issues` });

          // Update sidebar
          sidebar.addAnalysisResult(analysis, input.files[0]?.path);

          // Apply diagnostics to editor
          diagnostics.applyToEditor(analysis.issues, input.files);

          // Show summary
          vscode.window.showInformationMessage(
            `AI Dev Assistant: ${analysis.issues.length} issues found (score: ${analysis.score}/100)`,
            "View Results",
            "Apply Fixes"
          ).then(async (action) => {
            if (action === "View Results") {
              vscode.commands.executeCommand("aiclew.showPanel");
            } else if (action === "Apply Fixes") {
              await applyFixes(client, sidebar, analysis, input.files);
            }
          });
        } else {
          progress.report({ message: "Analysis failed" });
          sidebar.addRun(input.focus, "failed", result.error);
          vscode.window.showErrorMessage(`Analysis failed: ${result.error}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        progress.report({ message: `Error: ${message}` });
        sidebar.addRun(input.focus, "failed", message);
        vscode.window.showErrorMessage(`Analysis error: ${message}`);
      }
    }
  );
}

// ============================================================
// Core: apply fixes from analysis
// ============================================================

async function applyFixes(
  client: AIClient,
  sidebar: SidebarProvider,
  analysis: {
    issues: Array<{
      file: string;
      line?: number;
      fix?: { original: string; replacement: string };
    }>;
  },
  files: Array<{ path: string; content: string }>
) {
  const fixableIssues = analysis.issues.filter((i) => i.fix);

  if (fixableIssues.length === 0) {
    vscode.window.showInformationMessage("No automatic fixes available");
    return;
  }

  const confirmed = await vscode.window.showInformationMessage(
    `Apply ${fixableIssues.length} fixes?`,
    "Yes",
    "No"
  );

  if (confirmed !== "Yes") return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "AI Dev Assistant: Applying fixes...",
      cancellable: false,
    },
    async (progress) => {
      try {
        const fixResult = await client.fixCode({ files, issues: fixableIssues });

        if (fixResult.ok && fixResult.result) {
          for (const fixed of fixResult.result.fixedFiles) {
            // Find the matching editor
            const editors = vscode.workspace.textDocuments.filter(
              (d) => d.fileName === fixed.path || d.uri.fsPath === fixed.path
            );

            for (const doc of editors) {
              const editor = await vscode.window.showTextDocument(doc);
              await editor.edit((editBuilder) => {
                const fullRange = new vscode.Range(
                  doc.positionAt(0),
                  doc.positionAt(doc.getText().length)
                );
                editBuilder.replace(fullRange, fixed.fixedContent);
              });
              await doc.save();
            }
          }

          progress.report({
            message: `Applied ${fixResult.result.appliedCount} fixes`,
          });

          vscode.window.showInformationMessage(
            `✅ ${fixResult.result.appliedCount} fixes applied successfully`
          );

          sidebar.addFixResult(fixResult.result);
        } else {
          vscode.window.showErrorMessage(
            `Fix failed: ${fixResult.error}`
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Fix error: ${message}`);
      }
    }
  );
}
