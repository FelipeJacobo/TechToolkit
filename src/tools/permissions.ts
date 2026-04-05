export type ToolPermissionRule = {
  tool: string;
  allow: boolean;
};

export class ToolPermissionEnforcer {
  constructor(private rules: ToolPermissionRule[]) {}

  check(tool: string): boolean {
    const rule = this.rules.find((r) => r.tool === tool);
    return rule ? rule.allow : false;
  }
}
