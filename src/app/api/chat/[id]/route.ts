import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getProject, touch } from "@/lib/queries";
import { projectChatContext } from "@/lib/prompts";
import { modelInfo } from "@/lib/models";
import { streamClaudeResponse } from "@/lib/chat-stream";

export const dynamic = "force-dynamic";

/** Chat about a project through a read-only Claude Code session in the repo, resumed across messages. */
export async function POST(req: Request, ctx: RouteContext<"/api/chat/[id]">) {
  const projectId = Number((await ctx.params).id);
  const { message, model: requested } = (await req.json()) as { message?: string; model?: string };
  const text = message?.trim();
  if (!text) return new Response("Empty message", { status: 400 });

  const project = await getProject(projectId);
  if (!project) return new Response("Project not found", { status: 404 });
  if (project.missing) return new Response("This project's folder no longer exists.", { status: 409 });

  const model = modelInfo(requested ?? project.model).id;
  db.insert(schema.messages).values({ projectId, role: "user", content: text, createdAt: new Date() }).run();
  db.update(schema.projects).set({ model }).where(eq(schema.projects.id, projectId)).run();
  touch(projectId);

  const resuming = Boolean(project.chatSessionId);
  const sessionId = project.chatSessionId ?? randomUUID();
  if (!resuming) db.update(schema.projects).set({ chatSessionId: sessionId }).where(eq(schema.projects.id, projectId)).run();

  return streamClaudeResponse({
    cwd: project.path,
    prompt: resuming ? text : projectChatContext(project) + text,
    args: ["--model", model, ...(resuming ? ["--resume", sessionId] : ["--session-id", sessionId, "--name", `Command Centre chat: ${project.name}`.slice(0, 80)])],
    signal: req.signal,
    onDone: (reply, result, stderr) => {
      if (!result && /no conversation found|session.*not found/i.test(stderr)) {
        // The stored session is gone (e.g. Claude Code history cleared): start fresh next time.
        db.update(schema.projects).set({ chatSessionId: null }).where(eq(schema.projects.id, projectId)).run();
      }
      if (!reply && !result) return;
      const u = result?.usage;
      const inTok = u ? u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : 0;
      const cost = result?.total_cost_usd ?? 0;
      db.insert(schema.messages)
        .values({
          projectId,
          role: "assistant",
          content: reply || result?.result || "(no reply)",
          model,
          inputTokens: inTok,
          outputTokens: u?.output_tokens ?? 0,
          costUsd: cost,
          createdAt: new Date(),
        })
        .run();
      const p = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
      if (p) {
        db.update(schema.projects)
          .set({ costUsd: p.costUsd + cost, inputTokens: p.inputTokens + inTok, outputTokens: p.outputTokens + (u?.output_tokens ?? 0), lastActivity: new Date() })
          .where(eq(schema.projects.id, projectId))
          .run();
      }
    },
  });
}
