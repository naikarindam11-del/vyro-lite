import { mkdir } from "node:fs/promises";
import { loadConfig, loadPolicyFile, loadToolsManifest } from "./config.ts";
import { Brain } from "./engine/brain.ts";
import { Planner } from "./engine/planner.ts";
import { PolicyEngine } from "./engine/policy.ts";
import { Router } from "./engine/router.ts";
import { ToolRegistry } from "./engine/tools.ts";
import { createServerApp } from "./server/app.ts";
import { Store } from "./store.ts";

async function main(): Promise<void> {
  const cfg = loadConfig();
  await mkdir(cfg.dataDir, { recursive: true });
  await mkdir(cfg.vaultDir, { recursive: true });

  const store = new Store(cfg.dataDir);
  const toolsList = loadToolsManifest(cfg.toolsPath);
  const policyFile = loadPolicyFile(cfg.policyPath);
  const manifest = new Map(toolsList.map((t) => [t.name, t]));

  const tools = new ToolRegistry(cfg, policyFile, store, manifest);
  const policy = new PolicyEngine(policyFile, manifest);
  const router = new Router();
  const brain = new Brain(cfg, toolsList);
  const planner = new Planner(store, router, brain, tools, policy);
  const server = createServerApp(cfg, store, planner, tools);

  server.listen(cfg.port, cfg.host, () => {
    console.log(`Vyro Lite listening on http://${cfg.host}:${cfg.port}`);
    console.log(`Cockpit: http://${cfg.host}:${cfg.port}/`);
    console.log(`Health:  http://${cfg.host}:${cfg.port}/api/health`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
