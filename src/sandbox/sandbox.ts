import ivm from "isolated-vm";

export type SandboxPolicy = {
  allowFs: boolean;
  allowNetwork: boolean;
  allowShell: boolean;
  timeoutMs?: number;
  memoryLimitMb?: number;
};

export interface Sandbox {
  execute(script: string, policy: SandboxPolicy): Promise<unknown>;
}

export class IsolatedVMSandbox implements Sandbox {
  async execute(script: string, policy: SandboxPolicy): Promise<unknown> {
    if (policy.allowShell || policy.allowFs || policy.allowNetwork) {
      throw new Error("Sandbox policy violation");
    }
    if (script.includes("require(") || script.includes("import(")) {
      throw new Error("Dynamic import not allowed");
    }

    const isolate = new ivm.Isolate({ memoryLimit: policy.memoryLimitMb ?? 64 });
    const context = await isolate.createContext();
    const jail = context.global;
    await jail.set("global", jail.derefInto());

    const compiled = await isolate.compileScript(`"use strict";${script}`);
    const result = await compiled.run(context, { timeout: policy.timeoutMs ?? 500 });
    return result;
  }
}
