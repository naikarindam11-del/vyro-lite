import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export function resolveVaultPath(vaultRoot: string, raw: string): string {
  if (!raw || typeof raw !== "string") throw new SandboxError("Path required");
  if (raw.includes("\0")) throw new SandboxError("Invalid path");
  const expanded = raw.startsWith("~") ? path.join(process.env.HOME ?? "", raw.slice(1)) : raw;
  let rootReal = path.resolve(vaultRoot);
  try { rootReal = realpathSync(vaultRoot); } catch { /* new vault */ }
  const targetGuess = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(rootReal, expanded);
  const parent = path.dirname(targetGuess);
  const base = path.basename(targetGuess);
  let parentReal = parent;
  try { parentReal = realpathSync(parent); } catch { parentReal = path.resolve(parent); }
  let target = path.join(parentReal, base);
  try { if (lstatSync(target).isSymbolicLink()) target = realpathSync(target); } catch { /* new file */ }
  const rel = path.relative(rootReal, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new SandboxError(`Path escapes vault: ${raw}`);
  return target;
}

export function assertNotDenied(target: string, home: string, denyPrefixes: string[]): void {
  const resolvedHome = path.resolve(home || process.env.HOME || "/");
  for (const prefix of denyPrefixes) {
    const denied = path.resolve(resolvedHome, prefix.replace(/^~\/?/, ""));
    const rel = path.relative(denied, target);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      throw new SandboxError(`Path denied by policy: ${target}`);
    }
  }
}

export function safeLabel(label: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(label)) throw new SandboxError(`Invalid unit label: ${label}`);
  return label;
}
