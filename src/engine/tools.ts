import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LiteConfig, PolicyFile } from "../config.ts";
import type { Store } from "../store.ts";
import type { ToolManifest } from "../types.ts";
import { SandboxError, assertNotDenied, resolveVaultPath, safeLabel } from "./sandbox.ts";

export class ToolRegistry {
  readonly manifest: Map<string, ToolManifest>;
  private readonly cfg: LiteConfig;
  private readonly policyFile: PolicyFile;
  private readonly store: Store;

  constructor(cfg: LiteConfig, policyFile: PolicyFile, store: Store, manifest: Map<string, ToolManifest>) {
    this.cfg = cfg; this.policyFile = policyFile; this.store = store; this.manifest = manifest;
  }

  list(): ToolManifest[] { return [...this.manifest.values()]; }
  get(name: string): ToolManifest | undefined { return this.manifest.get(name); }

  async call(name: string, args: Record<string, unknown>, ctx: { planId?: string; idempotencyKey?: string } = {}): Promise<unknown> {
    const key = ctx.idempotencyKey ?? (typeof args.idempotencyKey === "string" ? args.idempotencyKey : undefined);
    if (key) { const hit = this.store.getIdempotent(key); if (hit !== undefined) return { cached: true, result: hit }; }
    let result: unknown;
    switch (name) {
      case "vault.read": result = await this.vaultRead(String(args.path ?? "")); break;
      case "vault.write": result = await this.vaultWrite(String(args.path ?? ""), String(args.content ?? ""), ctx.planId); break;
      case "vault.undo": result = await this.vaultUndo(); break;
      case "vault.list": result = await this.vaultList(String(args.path ?? ".")); break;
      case "memory.remember": result = this.remember(String(args.text ?? ""), Array.isArray(args.tags) ? args.tags as string[] : []); break;
      case "memory.recall": result = this.store.recall(String(args.query ?? args.text ?? ""), Number(args.limit ?? 8)); break;
      case "fleet.status": result = { units: this.store.fleet() }; break;
      case "fleet.kickstart": result = this.kick(String(args.label ?? "")); break;
      case "briefing.compile": result = this.briefing(); break;
      case "web.search": result = { query: String(args.query ?? ""), trust: "untrusted", results: [], note: "Lite has no live web adapter." }; break;
      default: throw new Error(`No handler for tool: ${name}`);
    }
    if (key) this.store.putIdempotent(key, result);
    return result;
  }

  private vaultFile(raw: string): string {
    const target = resolveVaultPath(this.cfg.vaultDir, raw);
    assertNotDenied(target, process.env.HOME ?? "", this.policyFile.denyPathPrefixes);
    return target;
  }
  private async vaultRead(raw: string) {
    const target = this.vaultFile(raw);
    return { path: path.relative(this.cfg.vaultDir, target), content: await readFile(target, "utf8") };
  }
  private async vaultWrite(raw: string, content: string, planId?: string) {
    const target = this.vaultFile(raw);
    await mkdir(path.dirname(target), { recursive: true });
    let previous: string | null = null;
    try { previous = await readFile(target, "utf8"); } catch { previous = null; }
    const snapshotId = crypto.randomUUID();
    this.store.saveSnapshot(snapshotId, target, previous, planId);
    await writeFile(target, content, "utf8");
    return { path: path.relative(this.cfg.vaultDir, target), bytes: Buffer.byteLength(content), snapshotId };
  }
  private async vaultUndo() {
    const snap = this.store.lastSnapshot();
    if (!snap) throw new SandboxError("Nothing to undo");
    const target = this.vaultFile(snap.path);
    if (snap.previous === null) {
      const { unlink } = await import("node:fs/promises");
      await unlink(target).catch(() => undefined);
    } else {
      await writeFile(target, snap.previous, "utf8");
    }
    return { path: path.relative(this.cfg.vaultDir, target), restored: true };
  }
  private async vaultList(raw: string) {
    const target = this.vaultFile(raw);
    const entries = await readdir(target);
    return { path: path.relative(this.cfg.vaultDir, target) || ".", entries };
  }
  private remember(text: string, tags: string[]) {
    if (!text.trim()) throw new Error("text required");
    const id = crypto.randomUUID();
    this.store.remember({ id, text: text.trim(), tags, createdAt: Date.now(), trust: "user" });
    return { id };
  }
  private kick(label: string) {
    const safe = safeLabel(label);
    if (!new Set(this.store.fleet().map((u) => u.label)).has(safe)) throw new SandboxError(`Unit not allowlisted: ${safe}`);
    return { ok: true, unit: this.store.kickUnit(safe) };
  }
  private briefing() {
    const units = this.store.fleet();
    const notes = this.store.recentMemory(5);
    const running = units.filter((u) => u.status === "running").length;
    return {
      clauses: [
        `Vyro Lite briefing · ${new Date().toISOString().slice(0, 16)}Z`,
        `Fleet: ${running}/${units.length} running.`,
        notes.length ? `Recent notes: ${notes.map((n) => n.text).join(" · ")}` : "No notes in memory yet.",
      ],
      compiledAt: Date.now(),
    };
  }
}
