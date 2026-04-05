import { z } from "zod";
import { ToolPermissionSchema, ToolVersionSchema } from "../core/types.js";

export const ToolMetadataSchema = z.object({
  name: z.string().min(3),
  namespace: z.string().min(2),
  version: ToolVersionSchema,
  permissions: z.array(ToolPermissionSchema),
  handler: z.custom<ToolHandler>((val) => typeof val === "function")
});

export type ToolMetadata = z.infer<typeof ToolMetadataSchema>;

export type ToolHandler = (input: unknown) => Promise<unknown>;

const toolKey = (namespace: string, name: string, version: string) =>
  `${namespace}:${name}@${version}`;

const semverCompare = (a: string, b: string) => {
  const pa = a.split(".").map((n) => Number(n));
  const pb = b.split(".").map((n) => Number(n));
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

export class ToolRegistry {
  private tools = new Map<string, ToolMetadata>();

  register(metadata: ToolMetadata): void {
    const parsed = ToolMetadataSchema.safeParse(metadata);
    if (!parsed.success) {
      throw new Error("Invalid tool metadata");
    }
    const key = toolKey(metadata.namespace, metadata.name, metadata.version.version);
    this.tools.set(key, metadata);
  }

  list(): ToolMetadata[] {
    return Array.from(this.tools.values());
  }

  resolve(name: string, namespace: string, version?: string): ToolMetadata {
    if (version) {
      const key = toolKey(namespace, name, version);
      const tool = this.tools.get(key);
      if (!tool) throw new Error("Tool not found");
      return tool;
    }

    const candidates = Array.from(this.tools.values()).filter(
      (tool) => tool.name === name && tool.namespace === namespace
    );
    if (candidates.length === 0) throw new Error("Tool not found");
    candidates.sort((a, b) => semverCompare(b.version.version, a.version.version));
    return candidates[0];
  }

  async execute(
    name: string,
    namespace: string,
    version: string | undefined,
    input: unknown,
    enforcer: import("./permissions.js").ToolPermissionEnforcer
  ): Promise<unknown> {
    const tool = this.resolve(name, namespace, version);
    const toolId = `${tool.namespace}:${tool.name}`;
    if (!enforcer.check(toolId)) {
      throw new Error("tool_denied");
    }
    return tool.handler(input);
  }
}
