import { notFound } from "next/navigation";
import { getProject, listProjectNames } from "@/lib/queries";
import { ProjectWorkspace } from "@/components/ProjectWorkspace";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const project = await getProject(Number((await params).id));
  if (!project) notFound();
  const others = listProjectNames()
    .filter((p) => p.id !== project.id)
    .map((p) => ({ id: p.id, name: p.name }));
  return <ProjectWorkspace key={project.id} project={project} others={others} />;
}
