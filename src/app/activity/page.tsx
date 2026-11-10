import { desc, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import { Activity, type ActivityRow, type FeedItem } from "@/components/Activity";
import { listProjects } from "@/lib/queries";
import { commitTimes, recentCommits } from "@/lib/git";

export const dynamic = "force-dynamic";

const DAYS = 84;

async function loadActivity() {
  const projects = (await listProjects()).filter((p) => !p.missing);
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const runs = db.select().from(schema.runs).where(gte(schema.runs.startedAt, since)).orderBy(desc(schema.runs.startedAt)).all();

  const rows: ActivityRow[] = await Promise.all(
    projects.map(async (p) => ({
      id: p.id,
      name: p.name,
      health: p.health,
      commits: await commitTimes(p.path, DAYS),
      runs: runs.filter((r) => r.projectId === p.id).map((r) => ({ at: r.startedAt.getTime(), status: r.status, title: r.title, kind: r.kind })),
    })),
  );

  const feedCutoff = Date.now() - 21 * 86_400_000;
  const commitFeed: FeedItem[] = (
    await Promise.all(
      projects.map(async (p) =>
        (await recentCommits(p.path, 25, "--all"))
          .filter((c) => c.at >= feedCutoff)
          .map((c) => ({ kind: "commit" as const, at: c.at, projectId: p.id, project: p.name, text: c.subject, sha: c.sha })),
      ),
    )
  ).flat();
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const runFeed: FeedItem[] = runs
    .filter((r) => names.has(r.projectId))
    .map((r) => ({ kind: "run" as const, at: r.startedAt.getTime(), projectId: r.projectId, project: names.get(r.projectId)!, text: r.title, status: r.status, runKind: r.kind }));
  const feed = [...commitFeed, ...runFeed].sort((a, b) => b.at - a.at).slice(0, 80);

  return { rows, feed };
}

export default async function ActivityPage() {
  const { rows, feed } = await loadActivity();
  return <Activity rows={rows} feed={feed} days={DAYS} />;
}
