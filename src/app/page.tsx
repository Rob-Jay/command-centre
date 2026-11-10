import { Dashboard } from "@/components/Dashboard";
import { listProjects, projectCount } from "@/lib/queries";
import { PROJECTS_ROOT, syncProjects } from "@/lib/discover";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (projectCount() === 0) await syncProjects(); // first run: discover repos
  const projects = await listProjects();
  return <Dashboard projects={projects} root={PROJECTS_ROOT} />;
}
