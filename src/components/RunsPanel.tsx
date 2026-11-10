"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Bot, ScanSearch, Plus, Square, FileDiff, Copy, Code2, FolderX, Trash2, X, Check, GitBranch } from "lucide-react";
import type { Run, RunEvent, RunStatus } from "@/db/schema";
import { relativeTime } from "@/lib/dates";
import { formatCost, modelInfo } from "@/lib/models";
import { cancelRunAction, discardRunAction, removeWorktreeAction } from "@/app/actions";

const STATUS_STYLE: Record<RunStatus, string> = {
  running: "bg-sky-500/15 text-sky-300",
  succeeded: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-rose-500/15 text-rose-300",
  cancelled: "bg-zinc-500/15 text-zinc-400",
};

function StatusPill({ status }: { status: RunStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status]} ${status === "running" ? "animate-pulse" : ""}`}>{status}</span>;
}

export function RunsPanel({ runs, selected, onSelect, onNewTask }: { runs: Run[]; selected: number | null; onSelect: (id: number) => void; onNewTask: () => void }) {
  const current = runs.find((r) => r.id === selected) ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <Bot size={15} className="text-indigo-400" />
        <span className="text-sm font-medium text-zinc-200">Claude Code runs</span>
        <button type="button" onClick={onNewTask} className="ml-auto flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500">
          <Plus size={12} /> New task
        </button>
      </div>
      {runs.length === 0 ? (
        <div className="m-auto max-w-sm p-6 text-center text-sm text-zinc-500">
          <p className="mb-2 text-zinc-300">No runs yet.</p>
          <p>Click “Implement” on a feature, or “New task”, and Claude Code builds it on its own branch while you watch here.</p>
        </div>
      ) : (
        <>
          <ul className="max-h-48 shrink-0 overflow-y-auto border-b border-[var(--border)]">
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onSelect(r.id)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-900 ${r.id === selected ? "bg-zinc-900" : ""}`}
                >
                  {r.kind === "scan" ? <ScanSearch size={13} className="shrink-0 text-zinc-500" /> : <Bot size={13} className="shrink-0 text-zinc-500" />}
                  <span className="min-w-0 flex-1 truncate text-zinc-200">{r.title}</span>
                  {r.kind === "implement" && r.status !== "running" && (r.insertions > 0 || r.deletions > 0) && (
                    <span className="shrink-0 font-mono text-[11px]">
                      <span className="text-emerald-400">+{r.insertions}</span> <span className="text-rose-400">-{r.deletions}</span>
                    </span>
                  )}
                  <StatusPill status={r.status} />
                  <span className="w-14 shrink-0 text-right text-[11px] text-zinc-600" suppressHydrationWarning>
                    {relativeTime(r.startedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {current ? <RunDetail key={current.id} initial={current} /> : <p className="m-auto text-sm text-zinc-500">Select a run.</p>}
        </>
      )}
    </div>
  );
}

function RunDetail({ initial }: { initial: Run }) {
  const router = useRouter();
  const [run, setRun] = useState(initial);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [showDiff, setShowDiff] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [poll, setPoll] = useState(0); // bump to refetch after actions
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastEventId = useRef(0);

  useEffect(() => {
    let stop = false;
    let wasRunning = initial.status === "running";
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(`/api/runs/${initial.id}?after=${lastEventId.current}`, { cache: "no-store" });
        const data = (await res.json()) as { run: Run; events: RunEvent[] };
        if (stop || !data.run) return;
        if (data.events.length) {
          lastEventId.current = data.events[data.events.length - 1].id;
          setEvents((cur) => [...cur, ...data.events]);
        }
        setRun(data.run);
        if (data.run.status === "running") {
          wasRunning = true;
          timer = setTimeout(tick, 1500);
        } else if (wasRunning) {
          wasRunning = false;
          router.refresh(); // feature statuses, health, diff stats changed
        }
      } catch {
        if (!stop) timer = setTimeout(tick, 3000);
      }
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [initial.id, initial.status, poll, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
    setPoll((n) => n + 1);
    router.refresh();
  };

  const secs = run.finishedAt ? Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000) : null;
  const duration = secs === null ? `started ${relativeTime(run.startedAt)}` : secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const btn = "flex items-center gap-1 rounded-md border border-[var(--border)] bg-zinc-900 px-2 py-1 text-xs text-zinc-300 hover:text-white disabled:opacity-40";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">{run.title}</span>
          <StatusPill status={run.status} />
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
          <span>{modelInfo(run.model).label}</span>
          <span suppressHydrationWarning>{duration}</span>
          {run.numTurns > 0 && <span>{run.numTurns} turns</span>}
          {run.costUsd > 0 && <span>{formatCost(run.costUsd)}</span>}
          {run.branch && (
            <span className="flex items-center gap-1 font-mono text-indigo-300">
              <GitBranch size={11} /> {run.branch}
            </span>
          )}
          {run.kind === "implement" && run.status !== "running" && (
            <span>
              {run.filesChanged} files <span className="text-emerald-400">+{run.insertions}</span> <span className="text-rose-400">-{run.deletions}</span>
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {run.status === "running" && (
            <button type="button" disabled={busy} onClick={() => act(() => cancelRunAction(run.id))} className={btn}>
              <Square size={11} /> Stop
            </button>
          )}
          {run.kind === "implement" && run.branch && run.status !== "running" && (
            <>
              <button type="button" onClick={() => setShowDiff(true)} className={btn}>
                <FileDiff size={12} /> View diff
              </button>
              <button
                type="button"
                className={btn}
                title="Run this in the project folder to merge the work"
                onClick={async () => {
                  await navigator.clipboard.writeText(`git merge ${run.branch}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy merge command"}
              </button>
              {run.worktreePath && (
                <>
                  <a href={`vscode://file/${run.worktreePath.replaceAll("\\", "/")}`} className={btn}>
                    <Code2 size={12} /> Open worktree
                  </a>
                  <button type="button" disabled={busy} onClick={() => act(() => removeWorktreeAction(run.id))} className={btn} title="Delete the worktree folder; the branch and its commits stay">
                    <FolderX size={12} /> Remove worktree
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => confirm(`Discard this run? This deletes branch ${run.branch} and its commits, and removes the worktree. It can’t be undone.`) && act(() => discardRunAction(run.id))}
                className={`${btn} hover:border-rose-500/50 hover:text-rose-300`}
              >
                <Trash2 size={12} /> Discard
              </button>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
        {run.kind === "implement" && run.prompt && (
          <details className="mb-2 text-xs text-zinc-500">
            <summary className="cursor-pointer">Task details</summary>
            <p className="mt-1 whitespace-pre-wrap text-zinc-400">{run.prompt}</p>
          </details>
        )}
        {events.map((e) => (
          <EventRow key={e.id} e={e} />
        ))}
        {run.status === "running" && <p className="animate-pulse text-xs text-sky-300">Claude is working…</p>}
        <div ref={bottomRef} />
      </div>

      {showDiff && <DiffModal runId={run.id} title={run.title} onClose={() => setShowDiff(false)} />}
    </div>
  );
}

function EventRow({ e }: { e: RunEvent }) {
  switch (e.kind) {
    case "tool":
      return <p className="truncate font-mono text-[11px] text-zinc-500" title={e.content}>{e.content}</p>;
    case "info":
      return <p className="text-[11px] italic text-zinc-500">{e.content}</p>;
    case "error":
      return <p className="whitespace-pre-wrap rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1 font-mono text-[11px] text-rose-300">{e.content}</p>;
    case "result":
      return (
        <div className="prose-chat rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-zinc-200">
          <ReactMarkdown>{e.content}</ReactMarkdown>
        </div>
      );
    default:
      return (
        <div className="prose-chat text-sm text-zinc-300">
          <ReactMarkdown>{e.content}</ReactMarkdown>
        </div>
      );
  }
}

function DiffModal({ runId, title, onClose }: { runId: number; title: string; onClose: () => void }) {
  const [diff, setDiff] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/runs/${runId}/diff`)
      .then((r) => r.text())
      .then(setDiff)
      .catch((e) => setDiff(`Could not load diff: ${e}`));
  }, [runId]);
  const lineCls = (l: string) =>
    l.startsWith("+++") || l.startsWith("---")
      ? "text-zinc-400 font-semibold"
      : l.startsWith("diff --git")
        ? "mt-3 border-t border-zinc-800 pt-2 text-sky-300 font-semibold"
        : l.startsWith("@@")
          ? "text-indigo-300"
          : l.startsWith("+")
            ? "bg-emerald-500/10 text-emerald-300"
            : l.startsWith("-")
              ? "bg-rose-500/10 text-rose-300"
              : "text-zinc-400";
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Diff">
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
          <h2 className="truncate text-sm font-semibold text-zinc-100">Diff · {title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
          {diff === null ? (
            <span className="text-zinc-500">Loading…</span>
          ) : (
            diff.split("\n").map((l, i) => (
              <div key={i} className={`whitespace-pre px-1 ${lineCls(l)}`}>
                {l || " "}
              </div>
            ))
          )}
        </pre>
      </div>
    </div>
  );
}
