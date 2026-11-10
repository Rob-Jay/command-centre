"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ArrowRight, GitBranch, GitCommitHorizontal, Bot } from "lucide-react";
import type { ProjectSummary } from "@/lib/queries";
import { relativeTime } from "@/lib/dates";
import { FeatureBar, FEATURE_HEX, HealthDot, StatusBadge, TagPill } from "./ui";

export function ProjectCard({ project: p }: { project: ProjectSummary }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: p.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative flex flex-col rounded-xl border bg-[var(--panel)] p-4 transition-shadow hover:border-zinc-700 ${
        p.runningRuns ? "border-sky-500/40" : "border-[var(--border)]"
      } ${isDragging ? "z-10 shadow-2xl shadow-indigo-500/10 ring-1 ring-indigo-500/40" : ""} ${p.missing ? "opacity-60" : ""}`}
    >
      <div className="mb-3 flex items-start gap-2">
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${p.name}`}
          className="relative z-10 -ml-1 mt-0.5 cursor-grab touch-none rounded text-zinc-600 hover:text-zinc-300 active:cursor-grabbing"
        >
          <GripVertical size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <Link href={`/projects/${p.id}`} className="block truncate font-medium text-zinc-100 after:absolute after:inset-0 hover:text-white">
            {p.name}
          </Link>
          <p className="truncate font-mono text-[11px] text-zinc-600">{p.slug}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <StatusBadge status={p.status} />
            <span className="flex items-center gap-1.5 truncate text-xs text-zinc-500">
              <HealthDot level={p.health.level} reason={p.health.reason} />
              {p.health.reason}
            </span>
          </div>
        </div>
        {p.runningRuns > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300">
            <Bot size={12} /> {p.runningRuns} live
          </span>
        )}
      </div>

      {p.description && <p className="mb-3 line-clamp-2 text-sm text-zinc-400">{p.description}</p>}

      <div className="mb-3">
        <div className="mb-1 flex justify-between text-xs text-zinc-500">
          <span className="flex gap-2">
            {p.features.length ? (
              <>
                <span style={{ color: FEATURE_HEX.built }}>{p.counts.built} built</span>
                {p.counts.review > 0 && <span style={{ color: FEATURE_HEX.review }}>{p.counts.review} review</span>}
                {p.counts.in_progress > 0 && <span style={{ color: FEATURE_HEX.in_progress }}>{p.counts.in_progress} in progress</span>}
                {p.counts.planned > 0 && <span>{p.counts.planned} planned</span>}
              </>
            ) : (
              <span>No feature map yet. Open to scan with Claude.</span>
            )}
          </span>
          <span className="font-mono text-zinc-300">{p.progress}%</span>
        </div>
        <FeatureBar counts={p.counts} />
      </div>

      {p.nextAction && (
        <div className="mb-3 rounded-md bg-zinc-900/70 px-3 py-2">
          <p className="mb-0.5 flex items-center gap-1 text-[11px] uppercase tracking-wide text-zinc-500">
            <ArrowRight size={11} /> Next action
          </p>
          <p className="line-clamp-2 text-sm text-zinc-300">{p.nextAction}</p>
        </div>
      )}

      <div className="mt-auto space-y-2">
        <p className="flex items-center gap-1.5 truncate text-xs text-zinc-500" suppressHydrationWarning>
          <GitCommitHorizontal size={12} className="shrink-0" />
          {p.git.lastCommitAt ? (
            <>
              <span className="shrink-0 text-zinc-400">{relativeTime(p.git.lastCommitAt)}</span>
              <span className="truncate">{p.git.lastCommitMsg}</span>
            </>
          ) : (
            "No commits"
          )}
        </p>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-1">
            {p.stack.slice(0, 5).map((t) => (
              <TagPill key={t} name={t} />
            ))}
          </div>
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-zinc-500">
            <GitBranch size={11} /> {p.git.branch}
            {p.git.dirty > 0 && <span className="text-amber-300">· {p.git.dirty} changed</span>}
            {p.git.agentBranches.length > 0 && <span className="text-indigo-300">· {p.git.agentBranches.length} agent</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
