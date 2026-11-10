import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const STATUSES = ["idea", "active", "blocked", "done"] as const;
export type Status = (typeof STATUSES)[number];

/** planned → in_progress (Claude working) → review (on an unmerged branch) → built (merged / shipped) */
export const FEATURE_STATUSES = ["planned", "in_progress", "review", "built"] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export const RUN_STATUSES = ["running", "succeeded", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** A code project = a git repo found under the projects root. */
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(), // folder name
  name: text("name").notNull(),
  path: text("path").notNull(),
  description: text("description").notNull().default(""),
  status: text("status", { enum: STATUSES }).notNull().default("active"),
  nextAction: text("next_action").notNull().default(""),
  stack: text("stack", { mode: "json" }).$type<string[]>().notNull().default([]),
  remoteUrl: text("remote_url"),
  missing: integer("missing", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  graphX: real("graph_x"),
  graphY: real("graph_y"),
  model: text("model").notNull().default("claude-opus-5-5"),
  chatSessionId: text("chat_session_id"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  lastScanAt: integer("last_scan_at", { mode: "timestamp_ms" }),
  lastActivity: integer("last_activity", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const features = sqliteTable("features", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  area: text("area").notNull().default(""),
  status: text("status", { enum: FEATURE_STATUSES }).notNull().default("planned"),
  source: text("source", { enum: ["scan", "manual", "chat"] }).notNull().default("manual"),
  branch: text("branch"), // branch of the latest implementation run
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** A Claude Code session started from the app: an implementation (in a worktree) or a read-only feature scan. */
export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  featureId: integer("feature_id").references(() => features.id, { onDelete: "set null" }),
  kind: text("kind", { enum: ["implement", "scan"] }).notNull(),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  model: text("model").notNull(),
  status: text("status", { enum: RUN_STATUSES }).notNull().default("running"),
  branch: text("branch"),
  baseSha: text("base_sha"),
  worktreePath: text("worktree_path"),
  sessionId: text("session_id"),
  pid: integer("pid"), // Claude Code process id while running (Next dev may use several server processes)
  summary: text("summary"),
  error: text("error"),
  costUsd: real("cost_usd").notNull().default(0),
  numTurns: integer("num_turns").notNull().default(0),
  filesChanged: integer("files_changed").notNull().default(0),
  insertions: integer("insertions").notNull().default(0),
  deletions: integer("deletions").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

export const runEvents = sqliteTable("run_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["text", "tool", "error", "result", "info"] }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  source: text("source", { enum: ["manual", "chat"] }).notNull().default("manual"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  model: text("model"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Connection between projects. `fromId` depends on / uses `toId`. Auto links come from repos mentioning each other. */
export const links = sqliteTable("links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromId: integer("from_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  toId: integer("to_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  label: text("label").notNull().default("depends on"),
  kind: text("kind", { enum: ["manual", "auto"] }).notNull().default("manual"),
});

export type Project = typeof projects.$inferSelect;
export type Feature = typeof features.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Link = typeof links.$inferSelect;
