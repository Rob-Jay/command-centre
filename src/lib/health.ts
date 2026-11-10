import type { Feature, Run, Status } from "@/db/schema";
import type { GitSummary } from "./git";

export type HealthLevel = "green" | "amber" | "red" | "grey" | "blue";
export type Health = { level: HealthLevel; reason: string };

const QUIET_DAYS = 21;

/** Traffic-light health for a code project, with a short human reason. */
export function computeHealth(
  p: { status: Status; missing: boolean },
  git: GitSummary,
  features: Pick<Feature, "status">[],
  runs: Pick<Run, "status" | "kind">[], // newest first
  now = Date.now(),
): Health {
  if (p.missing) return { level: "red", reason: "Folder not found" };
  if (!git.isRepo) return { level: "red", reason: "Not a git repo" };
  if (runs.some((r) => r.status === "running")) return { level: "blue", reason: "Claude is working" };
  if (p.status === "blocked") return { level: "red", reason: "Blocked" };
  const lastImpl = runs.find((r) => r.kind === "implement");
  if (lastImpl?.status === "failed") return { level: "red", reason: "Last Claude run failed" };
  if (p.status === "done") return { level: "grey", reason: "Done" };
  if (p.status === "idea") return { level: "grey", reason: "Idea" };
  const review = features.filter((f) => f.status === "review").length;
  if (review) return { level: "amber", reason: `${review} feature${review > 1 ? "s" : ""} awaiting review` };
  if (git.dirty) return { level: "amber", reason: `${git.dirty} uncommitted change${git.dirty > 1 ? "s" : ""}` };
  if (git.lastCommitAt) {
    const days = Math.floor((now - git.lastCommitAt) / 86_400_000);
    if (days >= QUIET_DAYS) return { level: "amber", reason: `No commits for ${days} days` };
  }
  return { level: "green", reason: "On track" };
}

export function progressOf(features: Pick<Feature, "status">[]): number {
  if (!features.length) return 0;
  return Math.round((features.filter((f) => f.status === "built").length / features.length) * 100);
}
