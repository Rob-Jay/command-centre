import { existsSync } from "node:fs";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Project, Feature, Note, Message, Link, Run } from "@/db/schema";
import { computeHealth, progressOf, type Health } from "./health";
import { gitSummary, mergedBranches, recentCommits, type Commit, type GitSummary } from "./git";
import { reapStaleRuns } from "./runner";

const { projects, features, notes, messages, links, runs } = schema;

export type ProjectSummary = Project & {
  features: Feature[];
  progress: number;
  counts: Record<Feature["status"], number>;
  git: GitSummary;
  health: Health;
  runningRuns: number;
  lastRun: Run | null;
};

export type Connection = { linkId: number; id: number; name: string; label: string; kind: Link["kind"] };

export type ProjectDetail = ProjectSummary & {
  notes: Note[];
  messages: Message[];
  runs: Run[];
  commits: Commit[];
  uses: Connection[]; // this project depends on / mentions
  usedBy: Connection[];
};

const EMPTY_GIT: GitSummary = { isRepo: false, branch: "", lastCommitAt: null, lastCommitMsg: "", commitCount: 0, dirty: 0, agentBranches: [] };

async function summarise(project: Project, fs: Feature[], rs: Run[]): Promise<ProjectSummary> {
  // A folder deleted since the last sync counts as missing straight away.
  const p = project.missing || existsSync(project.path) ? project : { ...project, missing: true };
  const g = p.missing ? EMPTY_GIT : await gitSummary(p.path);
  const counts = { planned: 0, in_progress: 0, review: 0, built: 0 };
  for (const f of fs) counts[f.status]++;
  return {
    ...p,
    features: fs,
    progress: progressOf(fs),
    counts,
    git: g,
    health: computeHealth(p, g, fs, rs),
    runningRuns: rs.filter((r) => r.status === "running").length,
    lastRun: rs[0] ?? null,
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  reapStaleRuns();
  const ps = db.select().from(projects).orderBy(asc(projects.sortOrder), asc(projects.id)).all();
  const ids = ps.map((p) => p.id);
  const fs = ids.length ? db.select().from(features).where(inArray(features.projectId, ids)).orderBy(asc(features.sortOrder), asc(features.id)).all() : [];
  const rs = ids.length ? db.select().from(runs).where(inArray(runs.projectId, ids)).orderBy(desc(runs.startedAt)).all() : [];
  return Promise.all(ps.map((p) => summarise(p, fs.filter((f) => f.projectId === p.id), rs.filter((r) => r.projectId === p.id))));
}

export async function getProject(id: number): Promise<ProjectDetail | null> {
  reapStaleRuns();
  const p = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!p) return null;
  if (!p.missing) await promoteMergedFeatures(p);
  const fs = db.select().from(features).where(eq(features.projectId, id)).orderBy(asc(features.sortOrder), asc(features.id)).all();
  const rs = db.select().from(runs).where(eq(runs.projectId, id)).orderBy(desc(runs.startedAt)).limit(50).all();
  const all = db.select({ id: projects.id, name: projects.name }).from(projects).all();
  const byId = new Map(all.map((x) => [x.id, x.name]));
  const ls = db.select().from(links).all();
  const conn = (l: Link, other: number): Connection => ({ linkId: l.id, id: other, name: byId.get(other) ?? "?", label: l.label, kind: l.kind });
  return {
    ...(await summarise(p, fs, rs)),
    notes: db.select().from(notes).where(eq(notes.projectId, id)).orderBy(desc(notes.createdAt)).all(),
    messages: db.select().from(messages).where(eq(messages.projectId, id)).orderBy(asc(messages.createdAt), asc(messages.id)).all(),
    runs: rs,
    commits: p.missing ? [] : await recentCommits(p.path, 12),
    uses: ls.filter((l) => l.fromId === id && byId.has(l.toId)).map((l) => conn(l, l.toId)),
    usedBy: ls.filter((l) => l.toId === id && byId.has(l.fromId)).map((l) => conn(l, l.fromId)),
  };
}

/** A feature in review whose branch has been merged into the main checkout is now built. */
async function promoteMergedFeatures(p: Project) {
  const inReview = db.select().from(features).where(and(eq(features.projectId, p.id), eq(features.status, "review"))).all();
  const withBranch = inReview.filter((f) => f.branch);
  if (!withBranch.length) return;
  const merged = await mergedBranches(p.path);
  for (const f of withBranch) {
    if (merged.has(f.branch!)) db.update(features).set({ status: "built", updatedAt: new Date() }).where(eq(features.id, f.id)).run();
  }
}

/** Cheap list for the command bar (no git calls). */
export function listProjectNames() {
  return db
    .select({ id: projects.id, name: projects.name, slug: projects.slug, status: projects.status })
    .from(projects)
    .where(eq(projects.missing, false))
    .orderBy(asc(projects.sortOrder))
    .all();
}

export function projectCount(): number {
  return db.select({ id: projects.id }).from(projects).all().length;
}

export function listLinks(): Link[] {
  return db.select().from(links).all();
}

export function getRun(id: number) {
  reapStaleRuns();
  return db.select().from(runs).where(eq(runs.id, id)).get() ?? null;
}

export function touch(projectId: number) {
  db.update(projects).set({ lastActivity: new Date() }).where(eq(projects.id, projectId)).run();
}
