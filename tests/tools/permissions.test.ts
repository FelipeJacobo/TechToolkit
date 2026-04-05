import { describe, it, expect } from "vitest";
import { ToolPermissionEnforcer } from "../../src/tools/permissions.js";

describe("Tool permissions", () => {
  it("denies by default", () => {
    const enforcer = new ToolPermissionEnforcer([{ tool: "tool:default", allow: false }]);
    expect(enforcer.check("tool:default")).toBe(false);
  });
});
