/**
 * vscode-extension/src/utils/auth.ts
 *
 * Manages auth state: API key storage + login state
 */
import * as vscode from "vscode";
import { AIClient } from "../api/client";
import { SidebarProvider } from "../providers/sidebarProvider";

const API_KEY_SECRET = "aiclewApiKey";
const REFRESH_TOKEN_SECRET = "aiclewRefreshToken";
const USER_INFO_SECRET = "aiclewUserInfo";

// ============================================================
// Auth Manager
// ============================================================

export class AuthManager {
  constructor(private context: vscode.ExtensionContext) {}

  // Get stored API key
  getApiKey(): string | undefined {
    return this.context.secrets.get(API_KEY_SECRET);
  }

  // Check if user is logged in (has API key or stored session)
  isLoggedIn(): boolean {
    const apiKey = this.getApiKey();
    if (apiKey) return true;

    // Also check extension config for apiKey
    const config = vscode.workspace.getConfiguration("aiclew");
    const configuredKey = config.get<string>("apiKey");
    return !!configuredKey;
  }

  // Get user info
  getUserInfo(): { email: string } | undefined {
    const userInfo = this.context.globalState.get<{ email: string }>(USER_INFO_SECRET);
    return userInfo;
  }

  // Set API key
  async setApiKey(key: string): Promise<void> {
    await this.context.secrets.store(API_KEY_SECRET, key);
  }

  // Login via prompt (email/password → API → store token)
  async loginPrompt(client: AIClient, sidebar: SidebarProvider): Promise<void> {
    const email = await vscode.window.showInputBox({
      prompt: "Email for AI Dev Assistant",
      placeHolder: "you@example.com",
      validateInput: (v) => (v.includes("@") ? null : "Enter a valid email"),
    });

    if (!email) return;

    const password = await vscode.window.showInputBox({
      prompt: "Password",
      password: true,
      placeHolder: "Enter your password",
      validateInput: (v) => (v.length >= 1 ? null : "Password is required"),
    });

    if (!password) return;

    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Logging in..." },
        async () => {
          const result = await client.login(email, password);

          await this.setApiKey(result.accessToken);
          if (result.refreshToken) {
            await this.context.secrets.store(REFRESH_TOKEN_SECRET, result.refreshToken);
          }
          await this.context.globalState.update(USER_INFO_SECRET, {
            email: result.user.email,
          });

          client.setApiKey(result.accessToken);

          vscode.window.showInformationMessage(
            `✅ Logged in as ${result.user.email}`
          );

          sidebar.render();
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Login failed: ${message}`);
    }
  }

  // Logout
  async logout(sidebar: SidebarProvider): Promise<void> {
    await this.context.secrets.delete(API_KEY_SECRET);
    await this.context.secrets.delete(REFRESH_TOKEN_SECRET);
    await this.context.globalState.update(USER_INFO_SECRET, undefined);
    sidebar.render();
  }
}
