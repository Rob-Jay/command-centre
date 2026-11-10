import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getRun } from "@/lib/queries";
import { diffText } from "@/lib/git";

export const dynamic = "force-dynamic";

/** Unified diff of everything the run committed on its branch. */
export async function GET(_req: Request, ctx: RouteContext<"/api/runs/[id]/diff">) {
  const run = getRun(Number((await ctx.params).id));
  if (!run?.branch || !run.baseSha) return new Response("No branch for this run.", { status: 404 });
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, run.projectId)).get();
  if (!project) return new Response("Project not found", { status: 404 });
  const diff = await diffText(project.path, run.baseSha, run.branch);
  return new Response(diff || "(no changes)", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
