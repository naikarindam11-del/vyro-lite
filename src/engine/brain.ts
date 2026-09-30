import type { LiteConfig } from "../config.ts";
import type { BrainResponse, Lane, ToolManifest } from "../types.ts";

const TOOL_HINT = /(\bwrite\b|\bsave\b|\bremember\b|\brestart\b|\bread\b|\blist\b|\bbrief)/i;

export class Brain {
  private readonly cfg: LiteConfig;
  private readonly tools: ToolManifest[];
  constructor(cfg: LiteConfig, tools: ToolManifest[]) {
    this.cfg = cfg;
    this.tools = tools;
  }
  async ask(text: string, lane: Lane, recalled: string[]): Promise<BrainResponse> {
    if (this.cfg.ollamaBaseUrl && lane !== "fast") {
      try { return await this.viaOllama(text, lane, recalled); } catch { /* local */ }
    }
    return this.heuristic(text, lane, recalled);
  }
  private heuristic(text: string, lane: Lane, recalled: string[]): BrainResponse {
    const citations = recalled.slice(0, 3).map((src) => ({ src }));
    if (!TOOL_HINT.test(text)) {
      const memoryBit = recalled.length ? ` I remember: ${recalled[0]}` : "";
      return { say: `${text}${memoryBit}`.slice(0, 400), actions: [], citations, confidence: 0.55, lane };
    }
    return {
      say: "I can do that if you use a concrete command: read <file>, write <file> <text>, remember <note>, recall <q>, brief, status, restart <unit>, undo.",
      actions: [], citations, confidence: 0.6, lane,
    };
  }
  private async viaOllama(text: string, lane: Lane, recalled: string[]): Promise<BrainResponse> {
    const names = this.tools.map((t) => t.name).join(", ");
    const res = await fetch(`${this.cfg.ollamaBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.cfg.localModel,
        temperature: 0.2,
        messages: [
          { role: "system", content: `You are Vyro Lite. Reply with JSON only: {\"say\":string,\"actions\":[{\"tool\":string,\"args\":object}],\"confidence\":number}. Tools: ${names}. Never invent a tool name. Never send email.` },
          { role: "user", content: `Memory:\n${recalled.join("\n") || "(empty)"}\n\nAsk:\n${text}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as BrainResponse;
    const allowed = new Set(this.tools.map((t) => t.name));
    parsed.actions = (parsed.actions ?? []).filter((a) => allowed.has(a.tool));
    parsed.citations = recalled.slice(0, 3).map((src) => ({ src }));
    parsed.lane = lane;
    parsed.say = parsed.say ?? "";
    parsed.confidence = parsed.confidence ?? 0.5;
    return parsed;
  }
}
