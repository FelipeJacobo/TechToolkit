#!/usr/bin/env tsx
/**
 * E2E API Tests — Flow completo del producto
 *
 * Flujo: register → login → create-project → run-task → check-result
 *
 * Ejecutar:
 *   API_URL=http://localhost:8081 tsx tests/e2e/full-flow.test.ts
 */
import { test as baseTest, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";

// ============================================================
// Config
// ============================================================

const API = process.env.API_URL ?? "http://localhost:8081";

// Test helpers
const testEmail = `test-${randomUUID().slice(0, 8)}@e2e.dev`;
const testPassword = "e2e-test-password-123!";
const testOrgName = `E2E Org ${randomUUID().slice(0, 6)}`;

type Tokens = { accessToken: string; refreshToken: string };

// ============================================================
// API client
// ============================================================

async function api<T = unknown>(
  method: string,
  path: string,
  opts: {
    body?: object;
    token?: string;
    expectStatus?: number;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });

  const status = opts.expectStatus ?? 200;
  assert.equal(res.status, status, `Expected ${status} but got ${res.status} on ${method} ${path}`);

  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // Non-JSON response (e.g. 204 or plain text)
    return { text } as unknown as T;
  }
}

// ============================================================
// Test: Full Product Flow
// ============================================================

describe("E2E: Full Product Flow", () => {
  let tokens: Tokens | null = null;
  let projectId = "";
  let runId = "";

  describe("1. Registration", () => {
    baseTest("should register a new user", async () => {
      const data = await api<{
        user: { id: string; email: string };
        accessToken: string;
        refreshToken: string;
        organizationId: string;
      }>("POST", "/auth/register", {
        body: {
          email: testEmail,
          password: testPassword,
          organizationName: testOrgName,
        },
      });

      assert.ok(data.user, "Should return user object");
      assert.equal(data.user.email, testEmail, "Email should match");
      assert.ok(data.accessToken, "Should return access token");
      assert.ok(data.refreshToken, "Should return refresh token");
      assert.ok(data.organizationId, "Should return organization ID");

      tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken };
    });

    baseTest("should reject duplicate email registration", async () => {
      await api(
        "POST",
        "/auth/register",
        {
          body: { email: testEmail, password: testPassword },
          expectStatus: 409,
        }
      );
    });

    baseTest("should reject weak password", async () => {
      await api(
        "POST",
        "/auth/register",
        {
          body: { email: "weak@e2e.dev", password: "short" },
          expectStatus: 400,
        }
      );
    });
  });

  describe("2. Login", () => {
    baseTest("should login with correct credentials", async () => {
      const data = await api<{
        user: { id: string; email: string };
        accessToken: string;
        refreshToken: string;
      }>("POST", "/auth/login", {
        body: { email: testEmail, password: testPassword },
      });

      assert.ok(data.accessToken);
      assert.ok(data.refreshToken);
      assert.equal(data.user.email, testEmail);

      tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken };
    });

    baseTest("should reject wrong password", async () => {
      await api(
        "POST",
        "/auth/login",
        {
          body: { email: testEmail, password: "wrong-password" },
          expectStatus: 401,
        }
      );
    });

    baseTest("should reject nonexistent email", async () => {
      await api(
        "POST",
        "/auth/login",
        {
          body: { email: "nonexistent@e2e.dev", password: testPassword },
          expectStatus: 401,
        }
      );
    });
  });

  describe("3. Auth me endpoint", () => {
    baseTest("should return current user", async () => {
      const data = await api<{ user: { email: string }; organizationId: string }>(
        "GET",
        "/auth/me",
        { token: tokens!.accessToken }
      );

      assert.equal(data.user.email, testEmail);
      assert.ok(data.organizationId);
    });

    baseTest("should reject without token", async () => {
      await api(
        "GET",
        "/auth/me",
        { expectStatus: 401 }
      );
    });
  });

  describe("4. Token refresh", () => {
    baseTest("should refresh tokens", async () => {
      const data = await api<{ accessToken: string; refreshToken: string }>(
        "POST",
        "/auth/refresh",
        { body: { refreshToken: tokens!.refreshToken } }
      );

      assert.ok(data.accessToken, "Should return new access token");
      assert.ok(data.refreshToken, "Should return new refresh token");

      tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken };
    });
  });

  describe("5. Create Project", () => {
    baseTest("should create a project", async () => {
      const data = await api<{ project: { id: string; name: string } }>(
        "POST",
        "/projects",
        {
          token: tokens!.accessToken,
          body: {
            name: "E2E Test Project",
            repo: "https://github.com/e2e/test-repo",
            description: "Project created by E2E test",
          },
        }
      );

      assert.ok(data.project, "Should return project");
      assert.equal(data.project.name, "E2E Test Project");
      projectId = data.project.id;
    });

    baseTest("should reject project without name", async () => {
      await api(
        "POST",
        "/projects",
        {
          token: tokens!.accessToken,
          body: { repo: "https://github.com/e2e/repo" },
          expectStatus: 400,
        }
      );
    });

    baseTest("should list projects", async () => {
      const data = await api<{ projects: Array<{ id: string }> }>(
        "GET",
        "/projects",
        { token: tokens!.accessToken }
      );

      assert.ok(data.projects, "Should return projects array");
      assert.ok(data.projects.length >= 1, "Should have at least 1 project");
    });
  });

  describe("6. Upload files", () => {
    baseTest("should upload a file", async () => {
      const content = `export function hello(name: string): string {
  return \`Hello, \${name}!\`;
}

export function add(a: number, b: number): number {
  return a + b;
}
`;
      // Use FormData for multipart upload
      const formData = new FormData();
      formData.append("file", new Blob([content], { type: "text/typescript" }), "hello.ts");

      const res = await fetch(`${API}/projects/${projectId}/files`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens!.accessToken}` },
        body: formData,
      });

      // Accept 200 or 201
      assert.ok(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}`);

      const data = await res.json();
      assert.ok(data.file, "Should return file object");
    });
  });

  describe("7. Run task", () => {
    baseTest("should create and queue a run", async () => {
      const data = await api<{ run: { id: string; status: string } }>(
        "POST",
        "/agent/run-task",
        {
          token: tokens!.accessToken,
          body: {
            projectId,
            goal: "Analyze the uploaded code for bugs",
            files: ["hello.ts"],
          },
        }
      );

      assert.ok(data.run, "Should return run object");
      assert.ok(data.run.id, "Run should have an ID");
      runId = data.run.id;

      // Initial status should be pending or running
      assert.ok(
        ["pending", "running", "completed"].includes(data.run.status),
        `Run status should be pending/running/completed, got: ${data.run.status}`
      );
    });
  });

  describe("8. Check run result", () => {
    baseTest("should get run status", async () => {
      // Poll until completed (max 5 times, 2s apart)
      let status = "";
      for (let i = 0; i < 5; i++) {
        const data = await api<{ run: { id: string; status: string; logs?: Array<{ level: string; message: string }> } }>(
          "GET",
          `/agent/runs/${runId}`,
          { token: tokens!.accessToken }
        );

        status = data.run.status;
        assert.ok(data.run.id === runId, "Run ID should match");

        if (status === "completed" || status === "failed") break;
        if (i < 4) await new Promise((r) => setTimeout(r, 2000));
      }

      // In E2E without Agent Core, it might stay pending — that's OK
      assert.ok(
        ["pending", "running", "completed", "failed"].includes(status),
        `Run status should be valid, got: ${status}`
      );
    });

    baseTest("should list runs for project", async () => {
      const data = await api<{ runs: Array<{ id: string; status: string }> }>(
        "GET",
        `/projects/${projectId}/runs`,
        { token: tokens!.accessToken }
      );

      assert.ok(data.runs, "Should return runs array");
      assert.ok(data.runs.length >= 1, "Should have at least 1 run");
    });
  });

  describe("9. Logout", () => {
    baseTest("should logout and invalidate refresh token", async () => {
      const oldRefresh = tokens!.refreshToken;

      await api(
        "POST",
        "/auth/logout",
        { token: tokens!.accessToken, body: { refreshToken: tokens!.refreshToken } }
      );

      // Old refresh token should be invalid now
      await api(
        "POST",
        "/auth/refresh",
        {
          body: { refreshToken: oldRefresh },
          expectStatus: 401,
        }
      );
    });

    baseTest("should not access protected routes after logout", async () => {
      await api(
        "GET",
        "/auth/me",
        { token: tokens!.accessToken, expectStatus: 401 }
      );
    });
  });

  describe("10. Route protection", () => {
    const protectedRoutes = [
      "GET /projects",
      "POST /projects { body: { name: 'test' } }",
      "GET /agent/runs",
      "POST /agent/run-task { body: { projectId: 'x', goal: 'test' } }",
      "POST /uploads",
    ];

    for (const route of protectedRoutes) {
      const [method, pathWithBody] = route.split(" ");
      const [path, ...bodyParts] = pathWithBody.split(" { ");
      const hasBody = bodyParts.length > 0;
      const body = hasBody ? JSON.parse(`{ ${bodyParts.join(" { ")}`.replace(" }", "}")) : undefined;

      baseTest(`${method} ${path} requires auth`, async () => {
        await api(
          method,
          path,
          { body, expectStatus: 401 }
        );
      });
    }
  });
});
