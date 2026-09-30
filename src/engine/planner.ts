import type { Store } from "../store.ts";
import type { Lane, Plan, PlanStep, SourceTrust } from "../types.ts";
import type { Brain } from "./brain.ts";
import type { PolicyEngine } from "./policy.ts";
import type { Router } from "./router.ts";
import type { ToolRegistry } from "./tools.ts";

export class Planner {
  private readonly store: Store;
  private readonly router: Router;
  private readonly brain: Brain;
  private readonly tools: ToolRegistry;
  private readonly policy: PolicyEngine;

  constructor(store: Store, router: Router, brain: Brain, tools: ToolRegistry, policy: PolicyEngine) {
    this.store = store; this.router = router; this.brain = brain; this.tools = tools; this.policy = policy;
  }

  async ask(text: string, sourceTrust: SourceTrust = "user"): Promise<Plan> {
    const route = this.router.route(text);
    const plan: Plan = { id: crypto.randomUUID(), text, lane: route.lane, status: "pending", steps: [], createdAt: Date.now(), updatedAt: Date.now() };
    this.store.appendEvent("ask", { text, route }, plan.id);
    if (route.actions?.length) {
      plan.steps = route.actions.map((a) => this.step(a.tool, a.args, sourceTrust));
    } else if (route.say === "health") {
      plan.steps.push({ id: crypto.randomUUID(), say: "health", status: "pending" });
    } else {
      const recalled = this.store.recall(text, 5).map((n) => n.text);
      const brain = await this.brain.ask(text, route.lane, recalled);
      plan.lane = brain.lane as Lane;
      if (brain.say) plan.steps.push({ id: crypto.randomUUID(), say: brain.say, status: "pending" });
      for (const action of brain.actions) plan.steps.push(this.step(action.tool, action.args, action.sourceTrust ?? sourceTrust));
    }
    this.store.appendEvent("plan.created", { lane: plan.lane, steps: plan.steps.length }, plan.id);
    return this.execute(plan);
  }

  async approve(planId: string): Promise<Plan> {
    const plan = this.store.getPlan(planId);
    if (!plan) throw new Error("plan not found");
    if (plan.status !== "blocked_on_approval") throw new Error(`plan is ${plan.status}, not blocked`);
    for (const step of plan.steps) {
      if (step.status === "blocked" && step.tool) {
        this.store.grant(plan.id, step.tool, Date.now() + (step.policy?.ttlMinutes ?? 5) * 60_000);
      }
    }
    this.store.appendEvent("approval.granted", {}, plan.id);
    return this.execute(plan);
  }

  async deny(planId: string): Promise<Plan> {
    const plan = this.store.getPlan(planId);
    if (!plan) throw new Error("plan not found");
    plan.status = "cancelled"; plan.error = "denied by operator"; plan.updatedAt = Date.now();
    for (const step of plan.steps) {
      if (step.status === "blocked" || step.status === "pending") { step.status = "failed"; step.error = "denied by operator"; }
    }
    this.store.savePlan(plan);
    this.store.appendEvent("approval.denied", {}, plan.id);
    return plan;
  }

  private step(tool: string, args: Record<string, unknown>, sourceTrust: SourceTrust): PlanStep {
    return { id: crypto.randomUUID(), tool, args, status: "pending", sourceTrust };
  }

  private async execute(plan: Plan): Promise<Plan> {
    plan.status = "running"; plan.updatedAt = Date.now();
    const spoken: string[] = [];
    for (const step of plan.steps) {
      if (step.status === "done" || step.status === "failed") continue;
      if (step.say && !step.tool) { step.status = "done"; spoken.push(step.say); continue; }
      if (!step.tool) { step.status = "done"; continue; }
      const decision = this.policy.evaluate(step.tool, step.args ?? {}, step.sourceTrust ?? "user");
      step.policy = decision;
      this.store.appendEvent("policy", { tool: step.tool, decision }, plan.id);
      if (decision.effect === "deny" || decision.effect === "rate_limit") {
        step.status = "failed"; step.error = decision.note ?? decision.effect; plan.status = "failed"; plan.error = step.error; break;
      }
      if (decision.effect === "require_approval" && !this.store.hasGrant(plan.id, step.tool)) {
        step.status = "blocked"; plan.status = "blocked_on_approval";
        plan.say = `Approval required for ${step.tool} (ring ${decision.ring}).`;
        this.store.savePlan(plan);
        this.store.appendEvent("approval.required", { tool: step.tool, decision }, plan.id);
        return plan;
      }
      step.status = "running";
      try {
        const result = await this.tools.call(step.tool, step.args ?? {}, {
          planId: plan.id,
          idempotencyKey: typeof step.args?.idempotencyKey === "string" ? step.args.idempotencyKey : `${plan.id}:${step.id}`,
        });
        step.result = result; step.status = "done";
        this.store.appendEvent("tool.done", { tool: step.tool, result }, plan.id);
        spoken.push(this.summarize(step.tool, result));
      } catch (err) {
        step.status = "failed"; step.error = err instanceof Error ? err.message : String(err);
        plan.status = "failed"; plan.error = step.error;
        this.store.appendEvent("tool.failed", { tool: step.tool, error: step.error }, plan.id);
        break;
      }
    }
    if (plan.status === "running") plan.status = "done";
    plan.say = spoken.filter(Boolean).join("\n") || plan.say;
    plan.updatedAt = Date.now();
    this.store.savePlan(plan);
    this.store.appendEvent("plan.finished", { status: plan.status }, plan.id);
    return plan;
  }

  private summarize(tool: string, result: unknown): string {
    if (tool === "briefing.compile" && result && typeof result === "object" && "clauses" in result) return (result as { clauses: string[] }).clauses.join(" ");
    if (tool === "fleet.status" && result && typeof result === "object" && "units" in result) {
      return (result as { units: Array<{ label: string; status: string }> }).units.map((u) => `${u.label}:${u.status}`).join(" · ");
    }
    if (tool === "memory.recall" && Array.isArray(result)) return result.length ? result.map((n: { text: string }) => n.text).join(" · ") : "No matching notes.";
    if (tool === "vault.read" && result && typeof result === "object" && "content" in result) return String((result as { content: string }).content).slice(0, 400);
    return `${tool} ok`;
  }
}
