/**
 * vscode-extension/src/providers/diagnosticProvider.ts
 *
 * Convierte issues del análisis en VS Code diagnostics (squiggles rojos)
 */
import * as vscode from "vscode";

// ============================================================
// Diagnostic Provider
// ============================================================

const DIAGNOSTIC_COLLECTION = vscode.languages.createDiagnosticCollection(
  "aiclew-analysis"
);

export class DiagnosticProvider implements vscode.Disposable {
  private activeFiles = new Set<string>();

  dispose(): void {
    DIAGNOSTIC_COLLECTION.clear();
    DIAGNOSTIC_COLLECTION.dispose();
  }

  // Apply analysis issues as VS Code diagnostics
  applyToEditor(
    issues: Array<{
      file: string;
      line?: number;
      endLine?: number;
      severity: string;
      title: string;
      description: string;
    }>,
    files: Array<{ path: string; content: string }>
  ): void {
    // Group issues by file
    const byFile = new Map<string, typeof issues>();
    for (const issue of issues) {
      const key = this.normalizePath(issue.file);
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key)!.push(issue);
    }

    // Clear previous diagnostics
    DIAGNOSTIC_COLLECTION.clear();
    this.activeFiles.clear();

    for (const [filePath, fileIssues] of byFile) {
      const diagnostics: vscode.Diagnostic[] = [];

      for (const issue of fileIssues) {
        const severity = this.mapSeverity(issue.severity);
        const line = (issue.line ?? 1) - 1; // 1-indexed → 0-indexed
        const endLine = issue.endLine ? issue.endLine - 1 : line;

        diagnostics.push({
          range: new vscode.Range(
            new vscode.Position(line, 0),
            new vscode.Position(endLine, 999)
          ),
          message: `${issue.title}\n\n${issue.description}`,
          severity,
          source: "AI Dev Assistant",
          code: issue.severity,
        });
      }

      if (diagnostics.length > 0) {
        const uri = vscode.Uri.file(filePath);
        DIAGNOSTIC_COLLECTION.set(uri, diagnostics);
        this.activeFiles.add(filePath);
      }
    }
  }

  // Clear diagnostics for a specific file
  clearFile(filePath: string): void {
    const uri = vscode.Uri.file(filePath);
    DIAGNOSTIC_COLLECTION.delete(uri);
    this.activeFiles.delete(filePath);
  }

  // Clear all diagnostics
  clearAll(): void {
    DIAGNOSTIC_COLLECTION.clear();
    this.activeFiles.clear();
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private mapSeverity(severity: string): vscode.DiagnosticSeverity {
    switch (severity.toLowerCase()) {
      case "critical":
      case "high":
        return vscode.DiagnosticSeverity.Error;
      case "medium":
        return vscode.DiagnosticSeverity.Warning;
      case "low":
      case "info":
        return vscode.DiagnosticSeverity.Information;
      default:
        return vscode.DiagnosticSeverity.Warning;
    }
  }

  private normalizePath(path: string): string {
    // Try to resolve relative path to absolute
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!path.startsWith("/") && !path.includes(":") && workspaceFolders?.[0]) {
      return `${workspaceFolders[0].uri.fsPath}/${path}`;
    }
    return path;
  }
}
