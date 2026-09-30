import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FleetUnit, MemoryNote, Plan } from "./types.ts";

export class Store {
  readonly db: DatabaseSync;
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "vyro-lite.db"));
    this.db.exec("PRAGMA journal_mode = DELETE");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, plan_id TEXT, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, json TEXT NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memory (id TEXT PRIMARY KEY, text TEXT NOT NULL, tags TEXT NOT NULL, created_at INTEGER NOT NULL, valid_to INTEGER, trust TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, plan_id TEXT, path TEXT NOT NULL, previous TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, result TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS fleet (label TEXT PRIMARY KEY, status TEXT NOT NULL, last_kick INTEGER);
      CREATE TABLE IF NOT EXISTS grants (plan_id TEXT PRIMARY KEY, tool TEXT NOT NULL, expires_at INTEGER NOT NULL);
    `);
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM fleet").get() as { n: number };
    if (count.n === 0) {
      const seed = this.db.prepare("INSERT INTO fleet (label, status) VALUES (?, ?)");
      seed.run("vyro.lite", "running");
      seed.run("vyro.vault", "running");
      seed.run("vyro.briefing", "stopped");
    }
  }
  appendEvent(kind: string, payload: unknown, planId?: string): void {
    this.db.prepare("INSERT INTO events (ts, kind, plan_id, payload) VALUES (?, ?, ?, ?)").run(Date.now(), kind, planId ?? null, JSON.stringify(payload));
  }
  listEvents(limit = 50) {
    const rows = this.db.prepare("SELECT id, ts, kind, plan_id AS planId, payload FROM events ORDER BY id DESC LIMIT ?").all(limit) as Array<{ id: number; ts: number; kind: string; planId: string | null; payload: string }>;
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }
  savePlan(plan: Plan): void {
    this.db.prepare("INSERT INTO plans (id, json, status, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, status = excluded.status, updated_at = excluded.updated_at").run(plan.id, JSON.stringify(plan), plan.status, plan.updatedAt);
  }
  getPlan(id: string): Plan | undefined {
    const row = this.db.prepare("SELECT json FROM plans WHERE id = ?").get(id) as { json: string } | undefined;
    return row ? JSON.parse(row.json) as Plan : undefined;
  }
  listPlans(limit = 20): Plan[] {
    return (this.db.prepare("SELECT json FROM plans ORDER BY updated_at DESC LIMIT ?").all(limit) as Array<{ json: string }>).map((r) => JSON.parse(r.json) as Plan);
  }
  remember(note: MemoryNote): void {
    this.db.prepare("INSERT INTO memory (id, text, tags, created_at, valid_to, trust) VALUES (?, ?, ?, ?, ?, ?)").run(note.id, note.text, JSON.stringify(note.tags), note.createdAt, note.validTo ?? null, note.trust);
  }
  recall(query: string, limit = 8): MemoryNote[] {
    const q = `%${query.toLowerCase()}%`;
    const rows = this.db.prepare("SELECT id, text, tags, created_at AS createdAt, valid_to AS validTo, trust FROM memory WHERE lower(text) LIKE ? OR lower(tags) LIKE ? ORDER BY created_at DESC LIMIT ?").all(q, q, limit) as Array<{ id: string; text: string; tags: string; createdAt: number; validTo: number | null; trust: MemoryNote["trust"] }>;
    return rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) as string[], validTo: r.validTo ?? undefined }));
  }
  recentMemory(limit = 8): MemoryNote[] {
    const rows = this.db.prepare("SELECT id, text, tags, created_at AS createdAt, valid_to AS validTo, trust FROM memory ORDER BY created_at DESC LIMIT ?").all(limit) as Array<{ id: string; text: string; tags: string; createdAt: number; validTo: number | null; trust: MemoryNote["trust"] }>;
    return rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) as string[], validTo: r.validTo ?? undefined }));
  }
  saveSnapshot(id: string, filePath: string, previous: string | null, planId?: string): void {
    this.db.prepare("INSERT INTO snapshots (id, plan_id, path, previous, created_at) VALUES (?, ?, ?, ?, ?)").run(id, planId ?? null, filePath, previous, Date.now());
  }
  lastSnapshot() {
    return this.db.prepare("SELECT id, path, previous FROM snapshots ORDER BY created_at DESC LIMIT 1").get() as { id: string; path: string; previous: string | null } | undefined;
  }
  getIdempotent(key: string): unknown | undefined {
    const row = this.db.prepare("SELECT result FROM idempotency WHERE key = ?").get(key) as { result: string } | undefined;
    return row ? JSON.parse(row.result) : undefined;
  }
  putIdempotent(key: string, result: unknown): void {
    this.db.prepare("INSERT INTO idempotency (key, result, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET result = excluded.result").run(key, JSON.stringify(result), Date.now());
  }
  fleet(): FleetUnit[] {
    return this.db.prepare("SELECT label, status, last_kick AS lastKick FROM fleet ORDER BY label").all() as FleetUnit[];
  }
  kickUnit(label: string): FleetUnit | undefined {
    const unit = this.db.prepare("SELECT label, status, last_kick AS lastKick FROM fleet WHERE label = ?").get(label) as FleetUnit | undefined;
    if (!unit) return undefined;
    this.db.prepare("UPDATE fleet SET status = 'running', last_kick = ? WHERE label = ?").run(Date.now(), label);
    return { label, status: "running", lastKick: Date.now() };
  }
  grant(planId: string, tool: string, expiresAt: number): void {
    this.db.prepare("INSERT INTO grants (plan_id, tool, expires_at) VALUES (?, ?, ?) ON CONFLICT(plan_id) DO UPDATE SET tool = excluded.tool, expires_at = excluded.expires_at").run(planId, tool, expiresAt);
  }
  hasGrant(planId: string, tool: string): boolean {
    const row = this.db.prepare("SELECT expires_at AS expiresAt FROM grants WHERE plan_id = ? AND tool = ?").get(planId, tool) as { expiresAt: number } | undefined;
    return Boolean(row && row.expiresAt > Date.now());
  }
  close(): void { this.db.close(); }
}
