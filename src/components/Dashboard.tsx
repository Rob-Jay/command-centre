"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { RefreshCw } from "lucide-react";
import { STATUSES, type Status } from "@/db/schema";
import type { ProjectSummary } from "@/lib/queries";
import { reorderProjects, syncProjectsAction } from "@/app/actions";
import { ProjectCard } from "./ProjectCard";
import { STATUS_LABEL, TagPill } from "./ui";

export function Dashboard({ projects, root }: { projects: ProjectSummary[]; root: string }) {
  const router = useRouter();
  const [order, setOrder] = useState(projects);
  const [prevProjects, setPrevProjects] = useState(projects);
  if (projects !== prevProjects) {
    // Server data wins whenever it changes (after any mutation).
    setPrevProjects(projects);
    setOrder(projects);
  }
  const [status, setStatus] = useState<Status | "all">("all");
  const [activeTech, setActiveTech] = useState<string[]>([]);
  const [syncing, startSync] = useTransition();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const tech = useMemo(() => [...new Set(order.flatMap((p) => p.stack))].sort(), [order]);
  const visible = useMemo(
    () => order.filter((p) => (status === "all" || p.status === status) && activeTech.every((t) => p.stack.includes(t))),
    [order, status, activeTech],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: order.length };
    for (const s of STATUSES) c[s] = order.filter((p) => p.status === s).length;
    return c;
  }, [order]);
  const totals = useMemo(() => {
    const running = order.reduce((a, p) => a + p.runningRuns, 0);
    const review = order.reduce((a, p) => a + p.counts.review, 0);
    const features = order.reduce((a, p) => a + p.features.length, 0);
    const built = order.reduce((a, p) => a + p.counts.built, 0);
    return { running, review, features, built };
  }, [order]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.findIndex((p) => p.id === active.id), order.findIndex((p) => p.id === over.id));
    setOrder(next);
    startTransition(() => reorderProjects(next.map((p) => p.id)));
  };

  const sync = () =>
    startSync(async () => {
      const r = await syncProjectsAction();
      setSyncMsg(`Found ${r.total} repos${r.added ? `, ${r.added} new` : ""}.`);
      router.refresh();
    });

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Code projects</h1>
          <p className="text-sm text-zinc-500">
            Git repos in <span className="font-mono text-zinc-400">{root}</span> · {totals.built}/{totals.features} features built
            {totals.review > 0 && <> · <span className="text-amber-300">{totals.review} awaiting review</span></>}
            {totals.running > 0 && <> · <span className="text-sky-300">{totals.running} Claude run{totals.running > 1 ? "s" : ""} live</span></>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {syncMsg && <span className="text-xs text-zinc-500">{syncMsg}</span>}
          <button
            type="button"
            onClick={sync}
            disabled={syncing}
            className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--border)] bg-zinc-900 px-3 text-sm text-zinc-300 hover:text-white disabled:opacity-50"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} /> Sync repos
          </button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {(["all", ...STATUSES] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              status === s ? "bg-zinc-100 text-zinc-900" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {s === "all" ? "All" : STATUS_LABEL[s]} <span className="opacity-60">{counts[s]}</span>
          </button>
        ))}
        {tech.length > 0 && <span className="mx-1 h-4 w-px bg-zinc-800" />}
        {tech.map((t) => (
          <TagPill key={t} name={t} active={activeTech.includes(t)} onClick={() => setActiveTech((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))} />
        ))}
        {(status !== "all" || activeTech.length > 0) && (
          <button type="button" onClick={() => { setStatus("all"); setActiveTech([]); }} className="text-xs text-zinc-500 underline-offset-2 hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {order.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-10 text-center text-sm text-zinc-500">
          No git repos found in {root}. Add a project folder with a git repo, then press Sync repos.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-10 text-center text-sm text-zinc-500">No projects match these filters.</p>
      ) : (
        <DndContext id="dashboard-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((p) => p.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
