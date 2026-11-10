import { listLinks, listProjects } from "@/lib/queries";
import { portfolioContext } from "@/lib/prompts";
import { modelInfo } from "@/lib/models";
import { PROJECTS_ROOT } from "@/lib/discover";
import { streamClaudeResponse } from "@/lib/chat-stream";

export const dynamic = "force-dynamic";

/** Cross-project question from the command bar. Runs read-only in the projects folder; not stored. */
export async function POST(req: Request) {
  const { question, model } = (await req.json()) as { question?: string; model?: string };
  const q = question?.trim();
  if (!q) return new Response("Empty question", { status: 400 });
  const projects = (await listProjects()).filter((p) => !p.missing);
  return streamClaudeResponse({
    cwd: PROJECTS_ROOT,
    prompt: portfolioContext(projects, listLinks()) + q,
    args: ["--model", modelInfo(model).id, "--no-session-persistence"],
    signal: req.signal,
  });
}
