"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { FEATURE_STATUSES, STATUSES, type FeatureStatus, type Status } from "@/db/schema";
import { startClaude } from "@/lib/claude-cli";
import { featureMapText } from "@/lib/prompts";
import { touch } from "@/lib/queries";

const FEATURE_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "area", "status"],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    area: { type: "string" },
    status: { type: "string", enum: ["built", "in_progress", "planned"] },
  },
};

export type Proposal = {
  summary: string;
  status: Status | null;
  nextAction: string | null;
  featureUpdates: { id: number; status: FeatureStatus }[];
  newFeatures: { title: string; description: string; area: string; status: FeatureStatus }[];
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** One structured-output call through Claude Code. Adds the cost to the project. */
async function claudeJson<T>(projectId: number, cwd: string, prompt: string, schemaObj: object, extraArgs: string[]): Promise<Result<T>> {
  const p = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()!;
  const { done } = startClaude({
    cwd,
    prompt,
    args: ["--model", p.model, "--permission-prompts", "none", "--strict-mcp-config", "--json-schema", JSON.stringify(schemaObj), ...extraArgs],
  });
  const { code, stderr, result } = await done;
  if (result?.total_cost_usd) {
    db.update(schema.projects).set({ costUsd: p.costUsd + result.total_cost_usd }).where(eq(schema.projects.id, projectId)).run();
  }
  const data = (result?.structured_output as T | undefined) ?? null;
  if (!data) return { ok: false, error: result?.result || stderr.trim().slice(-400) || `Claude Code exited with code ${code}` };
  return { ok: true, data };
}

/** Propose status / next-action / feature changes from the project's chat. Nothing is written. */
export async function proposeFromChat(projectId: number): Promise<Result<Proposal>> {
  const p = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!p) return { ok: false, error: "Project not found" };
  if (!p.chatSessionId) return { ok: false, error: "There is no chat yet to update from." };

  const fs = db.select().from(schema.features).where(eq(schema.features.projectId, projectId)).all();
  const prompt = `Based ONLY on our conversation so far, propose updates to this project's tracking in the Command Centre.

Current status: ${p.status}
Current next action: ${p.nextAction || "(none)"}
Features (id, status, title):
${fs.map((f) => `- id ${f.id} [${f.status}] ${f.title}`).join("\n") || "(none)"}

Be conservative: leave status/nextAction null and lists empty unless the conversation clearly supports a change.
Only use feature ids from the list. newFeatures are features we agreed to build or discovered that are not in the list.`;

  const res = await claudeJson<Proposal>(
    projectId,
    p.path,
    prompt,
    {
      type: "object",
      additionalProperties: false,
      required: ["summary", "status", "nextAction", "featureUpdates", "newFeatures"],
      properties: {
        summary: { type: "string" },
        status: { anyOf: [{ type: "string", enum: [...STATUSES] }, { type: "null" }] },
        nextAction: { anyOf: [{ type: "string" }, { type: "null" }] },
        featureUpdates: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "status"],
            properties: { id: { type: "integer" }, status: { type: "string", enum: [...FEATURE_STATUSES] } },
          },
        },
        newFeatures: { type: "array", items: FEATURE_ITEM },
      },
    },
    // Fork the chat session so this request doesn't appear in the conversation.
    ["--resume", p.chatSessionId, "--fork-session", "--no-session-persistence", "--tools", ""],
  );
  if (!res.ok) return res;
  const ids = new Set(fs.map((f) => f.id));
  revalidatePath(`/projects/${projectId}`);
  return { ok: true, data: { ...res.data, featureUpdates: res.data.featureUpdates.filter((u) => ids.has(u.id)) } };
}

/** Turn a piece of text (e.g. a chat reply) into proposed features. Nothing is written. */
export async function featuresFromText(projectId: number, text: string): Promise<Result<Proposal>> {
  const p = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!p) return { ok: false, error: "Project not found" };
  const res = await claudeJson<{ features: Proposal["newFeatures"] }>(
    projectId,
    p.path,
    `Turn the text below into concrete features for the "${p.name}" project's feature map. Skip anything already in the map. Titles at most 6 words; status "planned" unless the text says it already exists.

Existing feature map:
${featureMapText(projectId)}

<text>
${text}
</text>`,
    { type: "object", additionalProperties: false, required: ["features"], properties: { features: { type: "array", items: FEATURE_ITEM } } },
    ["--tools", "", "--no-session-persistence"],
  );
  if (!res.ok) return res;
  return { ok: true, data: { summary: "Features extracted from the reply.", status: null, nextAction: null, featureUpdates: [], newFeatures: res.data.features } };
}

/** Apply the parts of a proposal the user approved. */
export async function applyProposal(projectId: number, accepted: Proposal) {
  const now = new Date();
  db.transaction((tx) => {
    const patch: Partial<typeof schema.projects.$inferInsert> = {};
    if (accepted.status && STATUSES.includes(accepted.status)) patch.status = accepted.status;
    if (accepted.nextAction) patch.nextAction = accepted.nextAction;
    if (Object.keys(patch).length) tx.update(schema.projects).set(patch).where(eq(schema.projects.id, projectId)).run();
    for (const u of accepted.featureUpdates) {
      if (FEATURE_STATUSES.includes(u.status)) tx.update(schema.features).set({ status: u.status, updatedAt: now }).where(eq(schema.features.id, u.id)).run();
    }
    const count = tx.select({ id: schema.features.id }).from(schema.features).where(eq(schema.features.projectId, projectId)).all().length;
    accepted.newFeatures
      .filter((f) => f.title.trim())
      .forEach((f, i) =>
        tx
          .insert(schema.features)
          .values({
            projectId,
            title: f.title.trim(),
            description: f.description ?? "",
            area: f.area ?? "",
            status: FEATURE_STATUSES.includes(f.status) ? f.status : "planned",
            source: "chat",
            sortOrder: count + i,
            createdAt: now,
            updatedAt: now,
          })
          .run(),
      );
  });
  touch(projectId);
  revalidatePath("/", "layout");
}
