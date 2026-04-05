import { describe, it, expect } from "vitest";
import { IsolatedVMSandbox } from "../../src/sandbox/sandbox.js";

describe("Sandbox", () => {
  it("blocks dynamic import", async () => {
    const sandbox = new IsolatedVMSandbox();
    await expect(
      sandbox.execute("import('fs')", { allowFs: false, allowNetwork: false, allowShell: false })
    ).rejects.toThrow();
  });
});
