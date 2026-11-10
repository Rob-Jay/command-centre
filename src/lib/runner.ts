import fs from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Feature, FeatureStatus, Project } from "@/db/schema";
import { blocks, describeTool, killPid, killTree, startClaude, toolResultText, type StreamLine } from "./claude-cli";
import { branchExists, diffStat, git, headSha } from "./git";
import { featureMapText } from "./prompts";

const { runs, runEvents, features, projects } = schema;

const g = globalThis as unknown as { __ccChildren?: Map<number, ChildProcess> };
/**
 * Claude processes started by THIS server process. Next dev runs several server processes,
 * so the source of truth is the run row (status + pid), not this map.
 */
const localChildren: Map<number, ChildProcess> = g.__ccChildren ?? (g.__ccChildren = new Map());

/** pid = -1 while the finish handler commits and computes the diff. */
const FINISHING = -1;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Close out runs whose Claude process is gone (e.g. the server restarted mid-run). */
export function reapStaleRuns() {
  const live = db.select().from(runs).where(eq(runs.status, "running")).all();
  const now = Date.now();
  for (const r of live) {
    const age = now - r.startedAt.getTime();
    const dead =
      r.pid === null ? age > 120_000 : r.pid === FINISHING ? age > 30 * 60_000 : !isAlive(r.pid);
    if (!dead) continue;
    db.update(runs)
      .set({ status: "failed", error: "Interrupted: the Claude Code process ended unexpectedly (was the server restarted?)", finishedAt: new Date(), pid: null })
      .where(and(eq(runs.id, r.id), eq(runs.status, "running")))
      .run();
    if (r.featureId) {
      db.update(features).set({ status: "planned" }).where(and(eq(features.id, r.featureId), eq(features.status, "in_progress"))).run();
    }
  }
}

function currentStatus(runId: number) {
  return db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId)).get()?.status;
}

export const WORKTREES_DIR = path.join(process.cwd(), "data", "worktrees");

/** What an implementation run may do without asking: edit files, build, test, use git locally. */
const IMPLEMENT_ALLOWED = [
  "Read", "Edit", "Write", "Glob", "Grep", "TodoWrite", "NotebookEdit",
  "Bash(npm *)", "Bash(npx *)", "Bash(node *)", "Bash(git *)",
  "Bash(ls *)", "Bash(ls)", "Bash(pwd)", "Bash(cat *)", "Bash(head *)", "Bash(tail *)", "Bash(wc *)", "Bash(mkdir *)", "Bash(echo *)", "Bash(cd *)",
];
const IMPLEMENT_DENIED = [
  "Bash(git push *)", "Bash(git push)", "Bash(git remote *)", "Bash(git worktree *)",
  "Bash(git merge *)", "Bash(git rebase *)", "Bash(git reset --hard *)", "Bash(npm publish *)",
];

function event(runId: number, kind: "text" | "tool" | "error" | "result" | "info", content: string) {
  db.insert(runEvents).values({ runId, kind, content, createdAt: new Date() }).run();
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "task";
}

/** Shared handling of Claude's stream for a run: log text, tool calls and tool errors. */
function onStream(runId: number, cwd: string) {
  return (line: StreamLine) => {
    if (line.type === "system" && line.subtype === "init") {
      db.update(runs).set({ sessionId: String(line.session_id) }).where(eq(runs.id, runId)).run();
      event(runId, "info", `Claude Code session started (${line.model ?? "model"})`);
      return;
    }
    for (const b of blocks(line)) {
      if (line.type === "assistant" && b.type === "text" && b.text?.trim()) event(runId, "text", b.text.trim());
      if (line.type === "assistant" && b.type === "tool_use") event(runId, "tool", describeTool(b.name ?? "tool", b.input, cwd));
      if (line.type === "user" && b.type === "tool_result" && b.is_error) event(runId, "error", toolResultText(b).slice(0, 600));
    }
  };
}

function addProjectCost(projectId: number, cost: number, usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }) {
  const p = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!p) return;
  const inTok = usage ? usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) : 0;
  db.update(projects)
    .set({
      costUsd: p.costUsd + cost,
      inputTokens: p.inputTokens + inTok,
      outputTokens: p.outputTokens + (usage?.output_tokens ?? 0),
      lastActivity: new Date(),
    })
    .where(eq(projects.id, projectId))
    .run();
}

/** Make sure a node_modules junction inside a worktree is never committed (git sees it as a file, not a folder). */
async function excludeNodeModulesLink(repo: string) {
  const commonDir = (await git(repo, ["rev-parse", "--git-common-dir"])).trim();
  if (!commonDir) return;
  const file = path.resolve(repo, commonDir, "info", "exclude");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!/^\/node_modules\s*$/m.test(current)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${current.endsWith("\n") || !current ? "" : "\n"}# added by Command Centre (agent worktrees link node_modules)\n/node_modules\n`);
  }
}

// ---------------------------------------------------------------------------
// Implementation runs
// ---------------------------------------------------------------------------

export async function startImplementRun(opts: { project: Project; feature?: Feature | null; title: string; details: string; model: string }): Promise<number> {
  const { project, feature } = opts;
  if (feature && db.select().from(runs).where(and(eq(runs.featureId, feature.id), eq(runs.status, "running"))).get()) {
    throw new Error("Claude is already working on this feature.");
  }
  const base = await headSha(project.path);
  const now = new Date();
  const run = db
    .insert(runs)
    .values({ projectId: project.id, featureId: feature?.id ?? null, kind: "implement", title: opts.title, prompt: opts.details, model: opts.model, baseSha: base, startedAt: now })
    .returning()
    .get();

  let branch = `agent/${slugify(opts.title)}-${run.id}`;
  if (await branchExists(project.path, branch)) branch = `${branch}-${Date.now()}`;
  const wt = path.join(WORKTREES_DIR, `${project.slug}-${run.id}`);
  db.update(runs).set({ branch, worktreePath: wt }).where(eq(runs.id, run.id)).run();
  const prevStatus: FeatureStatus | null = feature?.status ?? null;
  if (feature) db.update(features).set({ status: "in_progress", branch, updatedAt: now }).where(eq(features.id, feature.id)).run();

  try {
    fs.mkdirSync(WORKTREES_DIR, { recursive: true });
    await git(project.path, ["worktree", "add", "-b", branch, wt, base], { strict: true, timeoutMs: 120_000 });
    event(run.id, "info", `Created worktree on branch ${branch} from ${base.slice(0, 7)}. Your main checkout is untouched.`);
    const nm = path.join(project.path, "node_modules");
    if (fs.existsSync(nm)) {
      await excludeNodeModulesLink(project.path);
      fs.symlinkSync(nm, path.join(wt, "node_modules"), "junction");
    }
    for (const f of [".env", ".env.local", ".env.development.local"]) {
      const src = path.join(project.path, f);
      if (fs.existsSync(src) && !fs.existsSync(path.join(wt, f))) fs.copyFileSync(src, path.join(wt, f));
    }
  } catch (err) {
    finishRun(run.id, { status: "failed", error: `Could not create worktree: ${(err as Error).message}` });
    if (feature && prevStatus) db.update(features).set({ status: prevStatus }).where(eq(features.id, feature.id)).run();
    return run.id;
  }

  const prompt = implementPrompt(project, opts.title, opts.details, branch);
  const proc = startClaude({
    cwd: wt,
    prompt,
    args: [
      "--model", opts.model,
      "--permission-mode", "acceptEdits",
      "--permission-prompts", "none",
      "--allowedTools", ...IMPLEMENT_ALLOWED,
      "--disallowedTools", ...IMPLEMENT_DENIED,
      "--name", `Command Centre: ${opts.title}`.slice(0, 80),
    ],
    onLine: onStream(run.id, wt),
  });
  localChildren.set(run.id, proc.child);
  db.update(runs).set({ pid: proc.child.pid ?? null }).where(eq(runs.id, run.id)).run();

  void proc.done.then(async ({ code, stderr, result }) => {
    localChildren.delete(run.id);
    const cancelled = currentStatus(run.id) === "cancelled";
    if (!cancelled) db.update(runs).set({ pid: FINISHING }).where(eq(runs.id, run.id)).run();
    try {
      // Commit anything Claude left uncommitted, so the branch holds all of its work.
      const dirty = (await git(wt, ["status", "--porcelain"])).trim();
      if (dirty) {
        await git(wt, ["add", "-A", "--", ".", ":(exclude)node_modules", ":(exclude).env*"]);
        const out = await git(wt, ["commit", "-m", `agent: ${opts.title}`, "-m", "Committed by Command Centre after a Claude Code run."]);
        if (out) event(run.id, "info", "Committed remaining changes on the branch.");
      }
    } catch {}
    const stat = await diffStat(wt, base, "HEAD");
    const ok = !cancelled && code === 0 && result !== null && !result.is_error;
    const status = cancelled ? "cancelled" : ok ? "succeeded" : "failed";
    const lastText = db.select().from(runEvents).where(and(eq(runEvents.runId, run.id), eq(runEvents.kind, "text"))).orderBy(desc(runEvents.id)).limit(1).get();
    if (result?.result && lastText?.content !== result.result.trim()) event(run.id, "result", result.result);
    finishRun(run.id, {
      status,
      summary: result?.result ?? null,
      error: ok || cancelled ? null : (result?.result ?? stderr.trim()) || `Claude exited with code ${code}`,
      costUsd: result?.total_cost_usd ?? 0,
      numTurns: result?.num_turns ?? 0,
      filesChanged: stat.files,
      insertions: stat.insertions,
      deletions: stat.deletions,
    });
    addProjectCost(project.id, result?.total_cost_usd ?? 0, result?.usage);
    if (feature) {
      const next: FeatureStatus = status === "succeeded" && stat.files > 0 ? "review" : prevStatus ?? "planned";
      db.update(features).set({ status: next, updatedAt: new Date() }).where(eq(features.id, feature.id)).run();
    }
  });

  return run.id;
}

function implementPrompt(p: Project, title: string, details: string, branch: string): string {
  return `Implement this change in the "${p.name}" project.

## Task
${title}
${details ? `\n${details}\n` : ""}
## Project context
${p.description ? `${p.description}\n` : ""}Current feature map:
${featureMapText(p.id)}

## How to work
- You are in a git worktree on branch \`${branch}\`. The user's main checkout is untouched, so work freely here.
- node_modules is shared with the main checkout. Don't run npm install unless you add or change a dependency.
- Follow the repo's CLAUDE.md / AGENTS.md conventions if present.
- Verify your work with the project's own checks (typecheck, lint, tests, build) where they exist.
- When done, commit to the current branch with a clear message. Do not push, merge or switch branches.
- Finish with a short summary: what you changed, how you verified it, and anything left for the user.`;
}

export function finishRun(
  runId: number,
  patch: Partial<Pick<typeof runs.$inferInsert, "status" | "summary" | "error" | "costUsd" | "numTurns" | "filesChanged" | "insertions" | "deletions">>,
) {
  db.update(runs).set({ ...patch, pid: null, finishedAt: new Date() }).where(eq(runs.id, runId)).run();
  if (patch.error) event(runId, "error", patch.error);
}

export function cancelRun(runId: number): boolean {
  const run = db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run || run.status !== "running") return false;
  db.update(runs).set({ status: "cancelled", finishedAt: new Date() }).where(eq(runs.id, runId)).run();
  event(runId, "info", "Stopped by you.");
  const child = localChildren.get(runId);
  if (child) killTree(child);
  else if (run.pid && run.pid > 0) killPid(run.pid); // started by another server process
  return true;
}

/** Remove a run's worktree folder (the branch and its commits stay). */
export async function removeWorktree(runId: number) {
  const run = db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run?.worktreePath) return;
  const project = db.select().from(projects).where(eq(projects.id, run.projectId)).get();
  const link = path.join(run.worktreePath, "node_modules");
  try {
    // Unlink the junction first so nothing can follow it into the real node_modules.
    if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
  } catch {}
  if (project) await git(project.path, ["worktree", "remove", "--force", run.worktreePath]);
  if (fs.existsSync(run.worktreePath)) {
    try {
      fs.rmSync(run.worktreePath, { recursive: true, force: true });
      if (project) await git(project.path, ["worktree", "prune"]);
    } catch {}
  }
  db.update(runs).set({ worktreePath: null }).where(eq(runs.id, runId)).run();
}

/** Remove the worktree and delete the run's branch (its commits are discarded). */
export async function discardRun(runId: number) {
  const run = db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run || run.status === "running") return;
  await removeWorktree(runId);
  const project = db.select().from(projects).where(eq(projects.id, run.projectId)).get();
  if (project && run.branch) await git(project.path, ["branch", "-D", run.branch]);
  if (run.featureId) {
    db.update(features)
      .set({ status: "planned", branch: null, updatedAt: new Date() })
      .where(and(eq(features.id, run.featureId), inArray(features.status, ["review", "in_progress"])))
      .run();
  }
  event(runId, "info", `Discarded: removed worktree and deleted branch ${run.branch}.`);
  db.update(runs).set({ branch: null }).where(eq(runs.id, runId)).run();
}

// ---------------------------------------------------------------------------
// Feature scans (read-only)
// ---------------------------------------------------------------------------

const SCAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "nextAction", "features"],
  properties: {
    summary: { type: "string", description: "2-3 sentences: what the project is and its current state" },
    nextAction: { type: "string", description: "The single most useful next step for the project" },
    features: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "area", "status"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          area: { type: "string" },
          status: { type: "string", enum: ["built", "in_progress", "planned"] },
        },
      },
    },
  },
};

type ScanOutput = { summary: string; nextAction: string; features: { title: string; description: string; area: string; status: "built" | "in_progress" | "planned" }[] };

export function startScanRun(project: Project, model: string): number {
  if (db.select().from(runs).where(and(eq(runs.projectId, project.id), eq(runs.kind, "scan"), eq(runs.status, "running"))).get()) {
    throw new Error("A scan is already running for this project.");
  }
  const run = db
    .insert(runs)
    .values({ projectId: project.id, kind: "scan", title: "Scan repo for features", prompt: "feature scan", model, startedAt: new Date() })
    .returning()
    .get();

  const prompt = `Map the features of the "${project.name}" repository in the current directory.

Explore it the way a new engineer would: README and docs (SPEC.md, CLAUDE.md, AGENTS.md), package.json scripts, the routes/pages/components, API handlers, data layer, tests, TODO/FIXME comments, and the recent git log.

Return a feature map of 8-25 items covering user-facing functionality and key technical capabilities:
- title: short (at most 6 words)
- description: one sentence on what it does and where it lives
- area: one word such as UI, API, Data, AI, Auth, Infra, Testing, DX
- status: "built" (works in the code now), "in_progress" (partly implemented, WIP or TODO-laden), or "planned" (described in docs/spec/TODOs but not implemented)

Current feature map (reuse these titles where they still apply):
${featureMapText(project.id)}

Do not modify anything.`;

  const proc = startClaude({
    cwd: project.path,
    prompt,
    args: [
      "--model", model,
      "--permission-prompts", "none",
      "--tools", "Read,Glob,Grep,Bash",
      "--allowedTools", "Read", "Glob", "Grep", "Bash(git log *)", "Bash(git log)", "Bash(git ls-files *)", "Bash(git ls-files)",
      "--strict-mcp-config",
      "--json-schema", JSON.stringify(SCAN_SCHEMA),
      "--name", `Command Centre: scan ${project.name}`.slice(0, 80),
    ],
    onLine: onStream(run.id, project.path),
  });
  localChildren.set(run.id, proc.child);
  db.update(runs).set({ pid: proc.child.pid ?? null }).where(eq(runs.id, run.id)).run();

  void proc.done.then(({ code, stderr, result }) => {
    localChildren.delete(run.id);
    const cancelled = currentStatus(run.id) === "cancelled";
    if (!cancelled) db.update(runs).set({ pid: FINISHING }).where(eq(runs.id, run.id)).run();
    let out: ScanOutput | null = null;
    try {
      out = (result?.structured_output as ScanOutput) ?? (result?.result ? JSON.parse(result.result) : null);
    } catch {}
    addProjectCost(project.id, result?.total_cost_usd ?? 0, result?.usage);
    if (cancelled || !out?.features) {
      finishRun(run.id, {
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? null : (result?.result ?? stderr.trim()) || `Scan failed (exit ${code})`,
        costUsd: result?.total_cost_usd ?? 0,
        numTurns: result?.num_turns ?? 0,
      });
      return;
    }
    const n = applyScan(project.id, out);
    finishRun(run.id, {
      status: "succeeded",
      summary: `${out.summary}\n\nFeature map updated: ${n.updated} updated, ${n.added} added, ${n.removed} removed.`,
      costUsd: result?.total_cost_usd ?? 0,
      numTurns: result?.num_turns ?? 0,
    });
    event(run.id, "result", `Feature map updated: ${n.updated} updated, ${n.added} added, ${n.removed} removed.`);
  });
  return run.id;
}

/** Merge a scan into the feature map. Manual features are never deleted; features with active work keep their status. */
function applyScan(projectId: number, out: ScanOutput) {
  const now = new Date();
  const counts = { added: 0, updated: 0, removed: 0 };
  db.transaction((tx) => {
    const existing = tx.select().from(features).where(eq(features.projectId, projectId)).all();
    const byTitle = new Map(existing.map((f) => [f.title.trim().toLowerCase(), f]));
    const seen = new Set<number>();
    out.features.forEach((f, i) => {
      const match = byTitle.get(f.title.trim().toLowerCase());
      if (match) {
        seen.add(match.id);
        const keep = match.status === "in_progress" && match.branch ? true : match.status === "review";
        tx.update(features)
          .set({ description: f.description, area: f.area, status: keep ? match.status : f.status, sortOrder: i, updatedAt: now })
          .where(eq(features.id, match.id))
          .run();
        counts.updated++;
      } else {
        tx.insert(features).values({ projectId, title: f.title, description: f.description, area: f.area, status: f.status, source: "scan", sortOrder: i, createdAt: now, updatedAt: now }).run();
        counts.added++;
      }
    });
    for (const f of existing) {
      if (!seen.has(f.id) && f.source === "scan" && (f.status === "planned" || f.status === "built")) {
        tx.delete(features).where(eq(features.id, f.id)).run();
        counts.removed++;
      }
    }
    const p = tx.select().from(projects).where(eq(projects.id, projectId)).get();
    tx.update(projects)
      .set({ description: out.summary, nextAction: p?.nextAction || out.nextAction, lastScanAt: now })
      .where(eq(projects.id, projectId))
      .run();
  });
  return counts;
}
