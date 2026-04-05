import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../../src/tools/registry.js";

describe("ToolRegistry", () => {
  it("resolves latest version", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "default",
      namespace: "tool",
      version: { name: "default", version: "1.0.0" },
      permissions: [{ tool: "tool:default", allow: true }],
      handler: async () => ({ ok: true })
    });
    registry.register({
      name: "default",
      namespace: "tool",
      version: { name: "default", version: "1.1.0" },
      permissions: [{ tool: "tool:default", allow: true }],
      handler: async () => ({ ok: true })
    });

    const tool = registry.resolve("default", "tool");
    expect(tool.version.version).toBe("1.1.0");
  });
});
