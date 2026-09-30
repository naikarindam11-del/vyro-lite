import type { PolicyFile } from "../config.ts";
import type { PolicyDecision, SourceTrust, ToolManifest } from "../types.ts";

export class PolicyEngine {
  private readonly calls = new Map<string, number[]>();
  private readonly file: PolicyFile;
  private readonly tools: Map<string, ToolManifest>;

  constructor(file: PolicyFile, tools: Map<string, ToolManifest>) {
    this.file = file;
    this.tools = tools;
  }

  evaluate(toolName: string, args: Record<string, unknown>, sourceTrust: SourceTrust = "user"): PolicyDecision {
    if (this.file.denyTools.includes(toolName)) {
      return { effect: "deny", ring: 0, note: `${toolName} is forbidden`, ruleId: "deny-list" };
    }
    const tool = this.tools.get(toolName);
    if (!tool) return { effect: "deny", ring: 0, note: `Unknown tool: ${toolName}`, ruleId: "unknown-deny" };
    if (!this.allowRate(toolName, tool.rateLimit)) {
      return { effect: "rate_limit", ring: this.file.rings[tool.class], note: `Rate limit ${tool.rateLimit}/min`, ruleId: "rate" };
    }
    for (const rule of this.file.rules) {
      if (this.matches(rule.when, tool, sourceTrust)) {
        return { effect: rule.effect, ring: rule.ring, approval: rule.approval, ttlMinutes: rule.ttlMinutes, note: rule.note, ruleId: rule.id };
      }
    }
    return { effect: this.file.defaultEffect, ring: 0, note: "default policy", ruleId: "default" };
  }

  private matches(when: PolicyFile["rules"][number]["when"], tool: ToolManifest | undefined, sourceTrust: SourceTrust): boolean {
    if (when.unknownTool) return !tool;
    if (when.sourceTrust && when.sourceTrust !== sourceTrust) return false;
    if (when.toolClass && tool?.class !== when.toolClass) return false;
    if (when.toolClassIn && (!tool || !when.toolClassIn.includes(tool.class))) return false;
    if (when.sourceTrust && when.toolClassIn) return true;
    if (when.sourceTrust && !when.toolClass && !when.toolClassIn) return true;
    if (when.toolClass || when.toolClassIn) return true;
    return false;
  }

  private allowRate(tool: string, perMinute: number): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    const prev = (this.calls.get(tool) ?? []).filter((t) => t > windowStart);
    if (prev.length >= perMinute) { this.calls.set(tool, prev); return false; }
    prev.push(now);
    this.calls.set(tool, prev);
    return true;
  }
}
