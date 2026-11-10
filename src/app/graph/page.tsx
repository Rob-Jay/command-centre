import { GraphCanvas, type GraphProject } from "@/components/GraphCanvas";
import { listLinks, listProjects } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function GraphPage() {
  const projects: GraphProject[] = (await listProjects())
    .filter((p) => !p.missing)
    .map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      progress: p.progress,
      health: p.health,
      counts: p.counts,
      running: p.runningRuns,
      stack: p.stack,
      features: [...p.features]
        .sort((a, b) => ["in_progress", "review", "planned", "built"].indexOf(a.status) - ["in_progress", "review", "planned", "built"].indexOf(b.status))
        .slice(0, 6)
        .map((f) => ({ id: f.id, title: f.title, status: f.status })),
      more: Math.max(0, p.features.length - 6),
      x: p.graphX,
      y: p.graphY,
    }));
  return <GraphCanvas projects={projects} links={listLinks()} />;
}
