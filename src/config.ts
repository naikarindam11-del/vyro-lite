import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolManifest } from "./types.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type LiteConfig = {
  env: "development" | "production";
  logLevel: "debug" | "info" | "warn" | "error";
  host: string;
  port: number;
  agentToken: string;
  dataDir: string;
  vaultDir: string;
  localModel: string;
  ollamaBaseUrl?: string;
  root: string;
  policyPath: string;
  toolsPath: string;
};

export function expandUserPath(p: string): string {
  if (p.startsWith("~")) return path.join(process.env.HOME ?? "", p.slice(1));
  return p;
}

export function loadConfig(): LiteConfig {
  const dataDir = path.resolve(expandUserPath(process.env.VYRO_DATA_DIR ?? "/tmp/vyro-lite-data"));
  const vaultDir = path.resolve(expandUserPath(process.env.VYRO_VAULT_DIR ?? path.join(dataDir, "vault")));
  return {
    env: process.env.VYRO_ENV === "production" ? "production" : "development",
    logLevel: (process.env.VYRO_LOG_LEVEL as LiteConfig["logLevel"]) ?? "info",
    host: process.env.VYRO_HOST ?? ((process.env.FLY_APP_NAME || process.env.RENDER || process.env.VERCEL) ? "0.0.0.0" : "127.0.0.1"),
    port: Number(process.env.PORT ?? 8080),
    agentToken: process.env.AGENT_TOKEN ?? "",
    dataDir,
    vaultDir,
    localModel: process.env.VYRO_LOCAL_MODEL ?? "qwen2.5:7b",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    root,
    policyPath: path.join(root, "config", "policy.json"),
    toolsPath: path.join(root, "config", "tools.manifest.json"),
  };
}

export function loadToolsManifest(toolsPath: string): ToolManifest[] {
  const raw = JSON.parse(readFileSync(toolsPath, "utf8")) as { tools: ToolManifest[] };
  return raw.tools;
}

export interface PolicyFile {
  version: string;
  defaultEffect: "deny" | "allow";
  denyTools: string[];
  rings: { read: number; write: number; destructive: number; untrusted: number };
  denyPathPrefixes: string[];
  rules: Array<{
    id: string;
    when: { unknownTool?: boolean; toolClass?: string; toolClassIn?: string[]; sourceTrust?: string };
    effect: "allow" | "deny" | "require_approval" | "rate_limit";
    ring: number;
    approval?: string;
    ttlMinutes?: number;
    note?: string;
  }>;
}

export function loadPolicyFile(policyPath: string): PolicyFile {
  return JSON.parse(readFileSync(policyPath, "utf8")) as PolicyFile;
}
