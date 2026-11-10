"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Plus, ScanSearch, X, GitBranch, ChevronRight } from "lucide-react";
import { FEATURE_STATUSES, type Feature, type FeatureStatus, type Run } from "@/db/schema";
import { addFeatures, deleteFeature, scanProject, updateFeature } from "@/app/actions";
import { relativeTime } from "@/lib/dates";
import { suggestModel } from "@/lib/models";

const SCAN = suggestModel("scan");
import { Editable, Section } from "./Editable";
import { FeatureBar, FeatureDot, FEATURE_HEX, FEATURE_LABEL } from "./ui";

const ORDER: FeatureStatus[] = ["in_progress", "review", "planned", "built"];

export function FeatureMap({
  projectId,
  features,
  counts,
  runs,
  lastScanAt,
  onImplement,
  onShowRun,
}: {
  projectId: number;
  features: Feature[];
  counts: Record<FeatureStatus, number>;
  runs: Run[];
  lastScanAt: Date | null;
  onImplement: (f: Feature) => void;
  onShowRun: (runId: number) => void;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [showBuilt, setShowBuilt] = useState(features.length <= 12);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanning = runs.find((r) => r.kind === "scan" && r.status === "running");
  const runFor = (f: Feature) => runs.find((r) => r.featureId === f.id && r.kind === "implement");

  const scan = async () => {
    setScanError(null);
    const res = await scanProject(projectId);
    if (!res.ok) setScanError(res.error);
    else onShowRun(res.data);
    router.refresh();
  };

  return (
    <Section
      title={`Feature map · ${counts.built}/${features.length} built`}
      action={
        <button
          type="button"
          onClick={scan}
          disabled={!!scanning}
          title={`${lastScanAt ? `Last scanned ${relativeTime(lastScanAt)}. ` : "Claude reads the repo (read-only) and drafts the feature map. "}Uses ${SCAN.label}: ${SCAN.reason}.`}
          className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-zinc-900 px-2 py-1 text-xs text-zinc-300 hover:text-white disabled:opacity-50"
        >
          <ScanSearch size={13} className={scanning ? "animate-pulse text-sky-300" : ""} />
          {scanning ? "Scanning repo…" : features.length ? "Rescan with Claude" : "Scan repo with Claude"}
        </button>
      }
    >
      <div className="mb-3">
        <FeatureBar counts={counts} />
        <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-zinc-500">
          {ORDER.map((s) => (
            <span key={s} className="flex items-center gap-1">
              <FeatureDot status={s} /> {counts[s]} {FEATURE_LABEL[s].toLowerCase()}
            </span>
          ))}
          {lastScanAt && <span className="ml-auto" suppressHydrationWarning>scanned {relativeTime(lastScanAt)}</span>}
        </div>
      </div>
      {scanError && <p className="mb-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{scanError}</p>}

      {features.length === 0 && !scanning && (
        <p className="mb-3 rounded-md border border-dashed border-[var(--border)] p-4 text-center text-sm text-zinc-500">
          No features yet. “Scan repo with Claude” reads the code and drafts a map of what’s built, in progress and planned.
        </p>
      )}

      <div className="space-y-3">
        {ORDER.map((status) => {
          const group = features.filter((f) => f.status === status);
          if (!group.length) return null;
          const collapsed = status === "built" && !showBuilt;
          return (
            <div key={status}>
              <button
                type="button"
                onClick={() => status === "built" && setShowBuilt((v) => !v)}
                className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: FEATURE_HEX[status] }}
              >
                {status === "built" && <ChevronRight size={12} className={showBuilt ? "rotate-90 transition-transform" : "transition-transform"} />}
                {FEATURE_LABEL[status]} · {group.length}
              </button>
              {!collapsed && (
                <ul className="space-y-0.5">
                  {group.map((f) => {
                    const run = runFor(f);
                    const busy = run?.status === "running";
                    return (
                      <li key={f.id} className="group rounded-md px-1 py-0.5 hover:bg-zinc-900">
                        <div className="flex items-center gap-2">
                          <FeatureDot status={f.status} />
                          <div className="min-w-0 flex-1">
                            <Editable value={f.title} ariaLabel="Feature title" onSave={(t) => start(() => updateFeature(f.id, { title: t }))} className="text-sm text-zinc-200" />
                          </div>
                          {f.area && <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{f.area}</span>}
                          {run && (
                            <button type="button" onClick={() => onShowRun(run.id)} className="flex shrink-0 items-center gap-1 text-[11px] text-indigo-300 hover:underline" title={f.branch ?? ""}>
                              <GitBranch size={11} /> {busy ? "running" : "run"}
                            </button>
                          )}
                          <select
                            value={f.status}
                            aria-label="Feature status"
                            onChange={(e) => start(() => updateFeature(f.id, { status: e.target.value as FeatureStatus }))}
                            className="shrink-0 rounded bg-transparent text-[11px] text-zinc-500 outline-none hover:text-zinc-300"
                          >
                            {FEATURE_STATUSES.map((s) => (
                              <option key={s} value={s} className="bg-zinc-900">
                                {FEATURE_LABEL[s]}
                              </option>
                            ))}
                          </select>
                          {f.status !== "built" && !busy && (
                            <button
                              type="button"
                              onClick={() => onImplement(f)}
                              className="flex shrink-0 items-center gap-1 rounded-md bg-indigo-600/80 px-2 py-0.5 text-[11px] font-medium text-white opacity-80 hover:bg-indigo-500 group-hover:opacity-100"
                            >
                              <Play size={10} /> Implement
                            </button>
                          )}
                          <button type="button" aria-label="Delete feature" onClick={() => start(() => deleteFeature(f.id))} className="shrink-0 text-zinc-700 opacity-0 hover:text-rose-400 group-hover:opacity-100">
                            <X size={13} />
                          </button>
                        </div>
                        {f.description && <p className="ml-4 pl-2 text-xs text-zinc-500">{f.description}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          start(() => addFeatures(projectId, [{ title, area }]));
          setTitle("");
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a feature to build" className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-zinc-900 px-2 py-1 text-sm outline-none focus:border-indigo-500" />
        <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Area" className="w-24 rounded-md border border-[var(--border)] bg-zinc-900 px-2 py-1 text-sm outline-none focus:border-indigo-500" />
        <button className="rounded-md bg-zinc-800 px-2 text-zinc-300 hover:bg-zinc-700" aria-label="Add feature">
          <Plus size={15} />
        </button>
      </form>
    </Section>
  );
}
