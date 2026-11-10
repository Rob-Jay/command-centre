import { and, asc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { getRun } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Run status plus events newer than ?after=<eventId>. Polled by the Runs panel while a run is live. */
export async function GET(req: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const id = Number((await ctx.params).id);
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
  const run = getRun(id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  const events = db
    .select()
    .from(schema.runEvents)
    .where(and(eq(schema.runEvents.runId, id), gt(schema.runEvents.id, after)))
    .orderBy(asc(schema.runEvents.id))
    .all();
  return Response.json({ run, events });
}
