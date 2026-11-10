"use server";

import { and, eq, inArray, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { STATUSES, FEATURE_STATUSES, type Status, type FeatureStatus } from "@/db/schema";
import { touch } from "@/lib/queries";
import { syncProjects } from "@/lib/discover";
import { modelInfo, suggestModel } from "@/lib/models";
import { cancelRun, discardRun, removeWorktree, startImplementRun, startScanRun } from "@/lib/runner";

const { projects, features, notes, messages, links } = schema;

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

function refresh() {
  revalidatePath("/", "layout");
}

function getProjectRow(id: number) {
  const p = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!p) throw new Error("Project not found");
  return p;
}

// ---------- Projects ----------

export async function syncProjectsAction(): Promise<{ added: number; total: number }> {
  const res = await syncProjects();
  refresh();
  return res;
}

export type ProjectPatch = Partial<{ name: string; status: Status; description: string; nextAction: string; model: string }>;

export async function updateProject(id: number, patch: ProjectPatch) {
  if (patch.status !== undefined && !STATUSES.includes(patch.status)) throw new Error("Invalid status");
  if (patch.model !== undefined) patch.model = modelInfo(patch.model).id;
  db.update(projects).set({ ...patch, lastActivity: new Date() }).where(eq(projects.id, id)).run();
  refresh();
}

/** Remove a project from the Command Centre database only. Files on disk are never touched. */
export async function forgetProject(id: number) {
  db.delete(projects).where(eq(projects.id, id)).run();
  refresh();
}

export async function reorderProjects(orderedIds: number[]) {
  db.transaction((tx) => {
    orderedIds.forEach((id, i) => tx.update(projects).set({ sortOrder: i }).where(eq(projects.id, id)).run());
  });
  refresh();
}

export async function setGraphPosition(id: number, x: number, y: number) {
  db.update(projects).set({ graphX: x, graphY: y }).where(eq(projects.id, id)).run();
}

// ---------- Features ----------

export type NewFeature = { title: string; description?: string; area?: string; status?: FeatureStatus };

export async function addFeatures(projectId: number, items: NewFeature[], source: "manual" | "chat" = "manual") {
  const start = (db.select({ m: max(features.sortOrder) }).from(features).where(eq(features.projectId, projectId)).get()?.m ?? -1) + 1;
  const now = new Date();
  const rows = items
    .filter((i) => i.title.trim())
    .map((i, k) => ({
      projectId,
      title: i.title.trim(),
      description: i.description?.trim() ?? "",
      area: i.area?.trim() ?? "",
      status: i.status && FEATURE_STATUSES.includes(i.status) ? i.status : ("planned" as const),
      source,
      sortOrder: start + k,
      createdAt: now,
      updatedAt: now,
    }));
  if (rows.length) db.insert(features).values(rows).run();
  touch(projectId);
  refresh();
}

export async function updateFeature(id: number, patch: Partial<{ title: string; description: string; area: string; status: FeatureStatus }>) {
  if (patch.status !== undefined && !FEATURE_STATUSES.includes(patch.status)) throw new Error("Invalid feature status");
  const row = db.update(features).set({ ...patch, updatedAt: new Date() }).where(eq(features.id, id)).returning({ projectId: features.projectId }).get();
  if (row) touch(row.projectId);
  refresh();
}

export async function deleteFeature(id: number) {
  db.delete(features).where(eq(features.id, id)).run();
  refresh();
}

// ---------- Claude Code runs ----------

export async function implementFeature(featureId: number, extra: string, model: string): Promise<Result<number>> {
  try {
    const f = db.select().from(features).where(eq(features.id, featureId)).get();
    if (!f) return { ok: false, error: "Feature not found" };
    const p = getProjectRow(f.projectId);
    const details = [f.description, extra.trim()].filter(Boolean).join("\n\n");
    const runId = await startImplementRun({ project: p, feature: f, title: f.title, details, model: modelInfo(model).id });
    refresh();
    return { ok: true, data: runId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function implementTask(projectId: number, title: string, details: string, model: string): Promise<Result<number>> {
  try {
    if (!title.trim()) return { ok: false, error: "Describe what to build." };
    const runId = await startImplementRun({ project: getProjectRow(projectId), title: title.trim(), details: details.trim(), model: modelInfo(model).id });
    refresh();
    return { ok: true, data: runId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function scanProject(projectId: number): Promise<Result<number>> {
  try {
    const p = getProjectRow(projectId);
    const runId = startScanRun(p, suggestModel("scan").id);
    refresh();
    return { ok: true, data: runId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function cancelRunAction(runId: number) {
  cancelRun(runId);
}

export async function removeWorktreeAction(runId: number) {
  await removeWorktree(runId);
  refresh();
}

export async function discardRunAction(runId: number) {
  await discardRun(runId);
  refresh();
}

// ---------- Notes ----------

export async function addNote(projectId: number, content: string, source: "manual" | "chat" = "manual") {
  if (!content.trim()) return;
  db.insert(notes).values({ projectId, content: content.trim(), source, createdAt: new Date() }).run();
  touch(projectId);
  refresh();
}

export async function deleteNote(id: number) {
  db.delete(notes).where(eq(notes.id, id)).run();
  refresh();
}

// ---------- Connections ----------

/** Manual connection: `fromId` depends on / uses `toId`. */
export async function addLink(fromId: number, toId: number): Promise<number | null> {
  if (fromId === toId) return null;
  const existing = db.select().from(links).where(and(eq(links.fromId, fromId), eq(links.toId, toId))).get();
  if (existing?.kind === "manual") return existing.id;
  if (existing) db.delete(links).where(eq(links.id, existing.id)).run(); // manual replaces auto
  const row = db.insert(links).values({ fromId, toId, kind: "manual" }).returning({ id: links.id }).get();
  refresh();
  return row.id;
}

export async function deleteLinks(ids: number[]) {
  if (!ids.length) return;
  db.delete(links).where(and(inArray(links.id, ids), eq(links.kind, "manual"))).run();
  refresh();
}

// ---------- Chat ----------

/** Clears the stored chat and starts a fresh Claude Code session next time. */
export async function clearChat(projectId: number) {
  db.delete(messages).where(eq(messages.projectId, projectId)).run();
  db.update(projects).set({ chatSessionId: null }).where(eq(projects.id, projectId)).run();
  refresh();
}
