import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ProjectDetail, ProjectSummary } from "./queries";
import type { Link } from "@/db/schema";
import { todayISO } from "./dates";

export function featureMapText(projectId: number): string {
  const fs = db.select().from(schema.features).where(eq(schema.features.projectId, projectId)).orderBy(asc(schema.features.sortOrder)).all();
  if (!fs.length) return "(no features recorded yet)";
  return fs.map((f) => `- [${f.status}] ${f.title}${f.area ? ` (${f.area})` : ""}${f.description ? `: ${f.description}` : ""}`).join("\n");
}

/** Prepended to the first message of a project chat session. */
export function projectChatContext(p: ProjectDetail): string {
  return `<command_centre_context>
You are chatting with the user from their "Project Command Centre" dashboard about the "${p.name}" repository (your working directory).
You have read-only access: you can read files and the git history, but you cannot edit anything in this chat.
To change code, the user clicks "Implement" in the dashboard, which starts a separate Claude Code run on its own branch.
Be concise and practical. Ground answers in the actual code and cite file paths.

Today: ${todayISO()}
Status: ${p.status} | Health: ${p.health.reason}
Stack: ${p.stack.join(", ") || "unknown"}
Description: ${p.description || "(none)"}
Next action: ${p.nextAction || "(none)"}
Git: branch ${p.git.branch}, ${p.git.commitCount} commits, ${p.git.dirty} uncommitted changes, agent branches: ${p.git.agentBranches.join(", ") || "none"}
Feature map:
${featureMapText(p.id)}
Notes:
${p.notes.slice(0, 10).map((n) => `- ${n.content.replace(/\n+/g, " ").slice(0, 300)}`).join("\n") || "(none)"}
</command_centre_context>

`;
}

/** Context for cross-project questions from the command bar. */
export function portfolioContext(projects: ProjectSummary[], links: Link[]): string {
  const name = new Map(projects.map((p) => [p.id, p.name]));
  const blocks = projects.map((p) => {
    const conns = links
      .filter((l) => l.fromId === p.id)
      .map((l) => `${name.get(l.toId)} (${l.kind === "auto" ? l.label : l.label})`)
      .join(", ");
    const open = p.features.filter((f) => f.status !== "built");
    return `## ${p.name}  [folder: ${p.slug}]
status: ${p.status} | health: ${p.health.reason} | features built: ${p.progress}% | stack: ${p.stack.join(", ") || "-"}
git: last commit ${p.git.lastCommitAt ? todayISO(new Date(p.git.lastCommitAt)) : "never"} "${p.git.lastCommitMsg}", ${p.git.dirty} uncommitted, agent branches: ${p.git.agentBranches.length}
running Claude runs: ${p.runningRuns}
next action: ${p.nextAction || "-"}
connections: ${conns || "-"}
open features: ${open.map((f) => `${f.title} [${f.status}]`).join("; ") || "-"}`;
  });
  return `<command_centre_context>
The user is asking from their "Project Command Centre", a dashboard over the code repositories in this folder.
Answer across ALL projects, naming them. You have read-only access and may look into the repos if needed, but prefer the summary below.
Today: ${todayISO()}

${blocks.join("\n\n")}
</command_centre_context>

Question: `;
}
