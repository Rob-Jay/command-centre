"use client";

import Link from "next/link";
import { Bot, GitCommitHorizontal, ScanSearch } from "lucide-react";
import type { RunStatus } from "@/db/schema";
import type { Health } from "@/lib/health";
import { relativeTime, todayISO, addDays, formatDate } from "@/lib/dates";
import { HealthDot } from "./ui";

export type ActivityRow = {
  id: number;
  name: string;
  health: Health;
  commits: number[];
  runs: { at: number; status: RunStatus; title: string; kind: "implement" | "scan" }[];
};

export type FeedItem =
  | { kind: "commit"; at: number; projectId: number; project: string; text: string; sha: string }
  | { kind: "run"; at: number; projectId: number; project: string; text: string; status: RunStatus; runKind: "implement" | "scan" };

const RUN_COLOR: Record<RunStatus, string> = { running: "#38bdf8", succeeded: "#34d399", failed: "#fb7185", cancelled: "#71717a" };

export function Activity({ rows, feed, days }: { rows: ActivityRow[]; feed: FeedItem[]; days: number }) {
  const today = todayISO();
  const start = addDays(today, -(days - 1));
  const dayIndex = (ms: number) => {
    const iso = todayISO(new Date(ms));
    const d = Math.round((new Date(iso).getTime() - new Date(start).getTime()) / 86_400_000);
    return d >= 0 && d < days ? d : -1;
  };
  const weekLabels = Array.from({ length: Math.ceil(days / 7) }, (_, w) => addDays(start, w * 7));

  return (
    <div className="mx-auto grid w-full max-w-[1600px] gap-6 px-4 py-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Activity</h1>
        <p className="mb-4 text-sm text-zinc-500">Commits per day across all branches for the last {days / 7} weeks, with Claude Code runs marked underneath.</p>

        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="min-w-[760px]">
            <div className="mb-1 flex pl-[200px] text-[10px] text-zinc-600">
              {weekLabels.map((w) => (
                <span key={w} className="flex-1">
                  {formatDate(w).replace(/ \d{4}$/, "")}
                </span>
              ))}
            </div>
            {rows.map((r) => {
              const counts = new Array(days).fill(0);
              r.commits.forEach((t) => {
                const i = dayIndex(t);
                if (i >= 0) counts[i]++;
              });
              const max = Math.max(1, ...counts);
              const total = counts.reduce((a, b) => a + b, 0);
              return (
                <div key={r.id} className="flex items-start border-t border-zinc-800/60 py-2 first:border-t-0">
                  <Link href={`/projects/${r.id}`} className="flex w-[200px] shrink-0 items-center gap-2 truncate pr-3 text-sm text-zinc-200 hover:text-white hover:underline">
                    <HealthDot level={r.health.level} reason={r.health.reason} />
                    <span className="truncate">{r.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-zinc-600">{total}</span>
                  </Link>
                  <div className="flex-1">
                    <div className="flex gap-[2px]">
                      {counts.map((c, i) => (
                        <span
                          key={i}
                          title={`${formatDate(addDays(start, i))}: ${c} commit${c === 1 ? "" : "s"}`}
                          className="h-4 flex-1 rounded-[2px]"
                          style={{ background: c ? `rgba(129,140,248,${0.25 + 0.75 * (c / max)})` : "#18181b" }}
                        />
                      ))}
                    </div>
                    <div className="relative mt-1 h-3">
                      {r.runs.map((run, i) => {
                        const d = dayIndex(run.at);
                        if (d < 0) return null;
                        return (
                          <span
                            key={i}
                            title={`${run.kind === "scan" ? "Scan" : "Claude run"}: ${run.title} (${run.status})`}
                            className="absolute top-0 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[2px]"
                            style={{ left: `${((d + 0.5) / days) * 100}%`, background: RUN_COLOR[run.status] }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 flex flex-wrap gap-4 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-[2px]" style={{ background: "rgba(129,140,248,0.9)" }} /> commits
            </span>
            {(["succeeded", "failed", "running"] as const).map((s) => (
              <span key={s} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rotate-45 rounded-[2px]" style={{ background: RUN_COLOR[s] }} /> Claude run {s}
              </span>
            ))}
          </p>
        </div>
      </div>

      <aside className="min-w-0">
        <h2 className="mb-2 mt-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Recent (3 weeks)</h2>
        <ul className="divide-y divide-zinc-800/70 rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          {feed.length === 0 && <li className="p-4 text-sm text-zinc-600">Nothing in the last 3 weeks.</li>}
          {feed.map((f, i) => (
            <li key={i} className="flex items-start gap-2 px-3 py-2 text-sm">
              {f.kind === "commit" ? (
                <GitCommitHorizontal size={14} className="mt-0.5 shrink-0 text-indigo-400" />
              ) : f.runKind === "scan" ? (
                <ScanSearch size={14} className="mt-0.5 shrink-0" style={{ color: RUN_COLOR[f.status] }} />
              ) : (
                <Bot size={14} className="mt-0.5 shrink-0" style={{ color: RUN_COLOR[f.status] }} />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-zinc-300" title={f.text}>
                  {f.text}
                </p>
                <p className="text-[11px] text-zinc-600" suppressHydrationWarning>
                  <Link href={`/projects/${f.projectId}`} className="hover:text-zinc-300 hover:underline">
                    {f.project}
                  </Link>{" "}
                  · {relativeTime(f.at)}
                  {f.kind === "run" && ` · ${f.status}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
