import { access, constants } from "node:fs/promises";
import type { LiteConfig } from "../config.ts";
import type { Store } from "../store.ts";
import type { HealthComponent } from "../types.ts";

export async function health(cfg: LiteConfig, store: Store): Promise<{ ok: boolean; components: HealthComponent[] }> {
  const components: HealthComponent[] = [];
  components.push({ name: "engine", ok: true, detail: `${cfg.env} @ ${cfg.host}:${cfg.port}` });
  try {
    await access(cfg.vaultDir, constants.R_OK | constants.W_OK);
    components.push({ name: "vault", ok: true, detail: cfg.vaultDir });
  } catch (err) {
    components.push({ name: "vault", ok: false, detail: String(err) });
  }
  try {
    store.listEvents(1);
    components.push({ name: "store", ok: true, detail: "sqlite" });
  } catch (err) {
    components.push({ name: "store", ok: false, detail: String(err) });
  }
  components.push({
    name: "auth",
    ok: cfg.host === "127.0.0.1" || cfg.host === "localhost" || Boolean(cfg.agentToken),
    detail: cfg.agentToken ? "token set" : "loopback demo (set AGENT_TOKEN)",
  });
  components.push({ name: "ollama", ok: true, detail: cfg.ollamaBaseUrl ?? "optional, unused" });
  return { ok: components.every((c) => c.ok), components };
}
