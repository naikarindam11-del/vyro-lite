import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LiteConfig } from "../config.ts";
import { health } from "../engine/health.ts";
import type { Planner } from "../engine/planner.ts";
import type { ToolRegistry } from "../engine/tools.ts";
import type { Store } from "../store.ts";

function send(res: ServerResponse, status: number, body: unknown, contentType = "application/json"): void {
  const raw = typeof body === "string" && contentType.includes("html") ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": contentType,
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization, x-vyro-token",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(raw ?? "");
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function authorized(req: IncomingMessage, cfg: LiteConfig, pathname: string): boolean {
  if (pathname === "/api/health") return true;
  const header = String(req.headers.authorization ?? req.headers["x-vyro-token"] ?? "");
  const token = header.replace(/^Bearer\s+/i, "");
  const loopback = cfg.host === "127.0.0.1" || cfg.host === "localhost";
  if (!cfg.agentToken) return loopback;
  return token === cfg.agentToken;
}

export function createServerApp(cfg: LiteConfig, store: Store, planner: Planner, tools: ToolRegistry) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${cfg.host}:${cfg.port}`);
      const pathname = url.pathname;
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization, x-vyro-token", "access-control-allow-methods": "GET,POST,OPTIONS" });
        res.end(); return;
      }
      if (pathname.startsWith("/api/") && pathname !== "/api/health" && !authorized(req, cfg, pathname)) {
        send(res, 401, { error: "unauthorized" }); return;
      }
      if (pathname === "/api/health" && req.method === "GET") { send(res, 200, await health(cfg, store)); return; }
      if (pathname === "/api/tools" && req.method === "GET") { send(res, 200, { tools: tools.list() }); return; }
      if (pathname === "/api/fleet" && req.method === "GET") { send(res, 200, { units: store.fleet() }); return; }
      if (pathname === "/api/events" && req.method === "GET") { send(res, 200, { events: store.listEvents(Number(url.searchParams.get("limit") ?? 40)) }); return; }
      if (pathname === "/api/plans" && req.method === "GET") { send(res, 200, { plans: store.listPlans(20) }); return; }
      const planMatch = pathname.match(/^\/api\/plans\/([^/]+)(?:\/(approve|deny))?$/);
      if (planMatch && req.method === "GET" && !planMatch[2]) {
        const plan = store.getPlan(planMatch[1]);
        send(res, plan ? 200 : 404, plan ?? { error: "not found" }); return;
      }
      if (planMatch && req.method === "POST" && planMatch[2] === "approve") { send(res, 200, await planner.approve(planMatch[1])); return; }
      if (planMatch && req.method === "POST" && planMatch[2] === "deny") { send(res, 200, await planner.deny(planMatch[1])); return; }
      if (pathname === "/api/ask" && req.method === "POST") {
        const body = await readJson(req);
        const text = String(body.text ?? "").trim();
        if (!text) { send(res, 400, { error: "text required" }); return; }
        send(res, 200, await planner.ask(text, "user")); return;
      }
      if (pathname === "/" && req.method === "GET") {
        const html = await readFile(path.join(cfg.root, "public", "index.html"), "utf8");
        send(res, 200, html, "text/html; charset=utf-8"); return;
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}
