export type Lane = "fast" | "local" | "deep";
export type ToolClass = "read" | "write" | "destructive";
export type SourceTrust = "user" | "vault" | "web" | "untrusted";
export type PlanStatus = "pending" | "running" | "blocked_on_approval" | "done" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "done" | "failed" | "blocked";
export type PolicyEffect = "allow" | "deny" | "require_approval" | "rate_limit";

export interface ToolManifest {
  name: string;
  class: ToolClass;
  scopes: string[];
  description: string;
  idempotent: boolean;
  undo?: string;
  rateLimit: number;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  ring: number;
  approval?: string;
  ttlMinutes?: number;
  note?: string;
  ruleId?: string;
}

export interface PlanStep {
  id: string;
  tool?: string;
  args?: Record<string, unknown>;
  say?: string;
  status: StepStatus;
  result?: unknown;
  error?: string;
  policy?: PolicyDecision;
  sourceTrust?: SourceTrust;
}

export interface Plan {
  id: string;
  text: string;
  lane: Lane;
  status: PlanStatus;
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
  say?: string;
  error?: string;
}

export interface BrainResponse {
  say: string;
  actions: { tool: string; args: Record<string, unknown>; sourceTrust?: SourceTrust }[];
  citations: { src: string; span?: string }[];
  confidence: number;
  lane: Lane;
}

export interface RouteDecision {
  lane: Lane;
  reason: string;
  confidence: number;
  actions?: { tool: string; args: Record<string, unknown> }[];
  say?: string;
}

export interface MemoryNote {
  id: string;
  text: string;
  tags: string[];
  createdAt: number;
  validTo?: number;
  trust: SourceTrust;
}

export interface FleetUnit {
  label: string;
  status: "running" | "stopped" | "degraded";
  lastKick?: number;
}

export interface HealthComponent {
  name: string;
  ok: boolean;
  detail: string;
}

export interface EventRecord {
  id: number;
  ts: number;
  kind: string;
  planId?: string;
  payload: unknown;
}
