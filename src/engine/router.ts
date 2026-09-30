import type { RouteDecision } from "../types.ts";

const GRAMMAR: Array<{ pattern: RegExp; build: (m: RegExpMatchArray, text: string) => RouteDecision }> = [
  { pattern: /^(status|fleet|fleet status)$/i, build: () => ({ lane: "fast", reason: "grammar:fleet", confidence: 1, actions: [{ tool: "fleet.status", args: {} }] }) },
  { pattern: /^(health|ping)$/i, build: () => ({ lane: "fast", reason: "grammar:health", confidence: 1, say: "health" }) },
  { pattern: /^(brief|briefing|good morning)$/i, build: () => ({ lane: "fast", reason: "grammar:brief", confidence: 1, actions: [{ tool: "briefing.compile", args: {} }] }) },
  { pattern: /^restart\s+(\S+)$/i, build: (m) => ({ lane: "fast", reason: "grammar:kickstart", confidence: 1, actions: [{ tool: "fleet.kickstart", args: { label: m[1] } }] }) },
  { pattern: /^(undo|vault undo)$/i, build: () => ({ lane: "fast", reason: "grammar:undo", confidence: 1, actions: [{ tool: "vault.undo", args: {} }] }) },
  { pattern: /^list(?:\s+vault)?(?:\s+(.+))?$/i, build: (m) => ({ lane: "fast", reason: "grammar:list", confidence: 1, actions: [{ tool: "vault.list", args: { path: m[1]?.trim() || "." } }] }) },
  { pattern: /^read\s+(.+)$/i, build: (m) => ({ lane: "fast", reason: "grammar:read", confidence: 1, actions: [{ tool: "vault.read", args: { path: m[1].trim() } }] }) },
  { pattern: /^write\s+(\S+)\s+([\s\S]+)$/i, build: (m) => ({ lane: "fast", reason: "grammar:write", confidence: 1, actions: [{ tool: "vault.write", args: { path: m[1], content: m[2] } }] }) },
  { pattern: /^remember\s+([\s\S]+)$/i, build: (m) => ({ lane: "fast", reason: "grammar:remember", confidence: 1, actions: [{ tool: "memory.remember", args: { text: m[1].trim() } }] }) },
  { pattern: /^(recall|what do you know about)\s+([\s\S]+)$/i, build: (m) => ({ lane: "fast", reason: "grammar:recall", confidence: 1, actions: [{ tool: "memory.recall", args: { query: m[2].trim() } }] }) },
];

export class Router {
  route(text: string): RouteDecision {
    const trimmed = text.trim();
    for (const g of GRAMMAR) {
      const m = trimmed.match(g.pattern);
      if (m) return g.build(m, trimmed);
    }
    const words = trimmed.split(/\s+/).filter(Boolean).length;
    if (words <= 6) return { lane: "local", reason: "local:short", confidence: 0.7 };
    return { lane: "deep", reason: "default:deep", confidence: 0.5 };
  }
}
