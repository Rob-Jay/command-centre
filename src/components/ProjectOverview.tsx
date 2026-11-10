"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2, X, ExternalLink, Sparkles, StickyNote, Code2, GitBranch, GitCommitHorizontal, FolderOpen } from "lucide-react";
import { STATUSES, type Feature, type Status } from "@/db/schema";
import type { ProjectDetail } from "@/lib/queries";
import { updateProject, forgetProject, addNote, deleteNote, addLink, deleteLinks } from "@/app/actions";
import { relativeTime } from "@/lib/dates";
import { formatCost, formatTokens } from "@/lib/models";
import { Editable, Section } from "./Editable";
import { FeatureMap } from "./FeatureMap";
import { HealthDot, STATUS_LABEL, STATUS_STYLE, TagPill } from "./ui";

const inputCls = "rounded-md border border-[var(--border)] bg-zinc-900 px-2 py-1 text-sm outline-none focus:border-indigo-500";

export function ProjectOverview({
  project: p,
  others,
  onImplement,
  onShowRun,
}: {
  project: ProjectDetail;
  others: { id: number; name: string }[];
  onImplement: (f: Feature) => void;
  onShowRun: (runId: number) => void;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const run = (fn: () => Promise<unknown>) => start(async () => void (await fn()));
  const vscodeUrl = `vscode://file/${p.path.replaceAll("\\", "/")}`;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Editable value={p.name} ariaLabel="Project name" onSave={(name) => run(() => updateProject(p.id, { name }))} className="-ml-2 text-2xl font-semibold tracking-tight text-zinc-50" />
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
              <select
                value={p.status}
                aria-label="Status"
                onChange={(e) => run(() => updateProject(p.id, { status: e.target.value as Status }))}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset outline-none ${STATUS_STYLE[p.status]}`}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s} className="bg-zinc-900 text-zinc-200">
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                <HealthDot level={p.health.level} reason={p.health.reason} /> {p.health.reason}
              </span>
            </div>
          </div>
          {p.missing && (
            <button
              type="button"
              title="Remove from Command Centre (files are not touched)"
              onClick={() => confirm(`Remove “${p.name}” from the Command Centre? Its folder is already gone; nothing on disk is touched.`) && run(async () => { await forgetProject(p.id); router.push("/"); })}
              className="rounded-md p-1.5 text-zinc-600 hover:bg-rose-500/10 hover:text-rose-400"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span className="flex items-center gap-1 font-mono">
            <FolderOpen size={12} /> {p.path}
          </span>
          <a href={vscodeUrl} className="flex items-center gap-1 text-sky-300 hover:underline">
            <Code2 size={12} /> Open in VS Code
          </a>
          {p.remoteUrl?.startsWith("https://") && (
            <a href={p.remoteUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sky-300 hover:underline">
              <ExternalLink size={12} /> {p.remoteUrl.replace("https://", "")}
            </a>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {p.stack.map((t) => (
            <TagPill key={t} name={t} />
          ))}
        </div>
        <Editable multiline value={p.description} placeholder="What is this project?" onSave={(description) => run(() => updateProject(p.id, { description }))} className="-mx-2 mt-2 text-sm text-zinc-300" />
        <div className="mt-2 rounded-md bg-zinc-900/70 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Next action</p>
          <Editable value={p.nextAction} placeholder="The very next step" onSave={(nextAction) => run(() => updateProject(p.id, { nextAction }))} className="-mx-2 text-sm text-zinc-200" />
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          Claude usage on this project: {formatTokens(p.inputTokens)} in · {formatTokens(p.outputTokens)} out · {formatCost(p.costUsd)}
        </p>
      </div>

      <FeatureMap projectId={p.id} features={p.features} counts={p.counts} runs={p.runs} lastScanAt={p.lastScanAt} onImplement={onImplement} onShowRun={onShowRun} />

      <div className="grid gap-4 md:grid-cols-2">
        <GitSection p={p} />
        <Connections p={p} others={others} run={run} />
      </div>
      <Notes p={p} run={run} />
    </div>
  );
}

type Run = (fn: () => Promise<unknown>) => void;

function GitSection({ p }: { p: ProjectDetail }) {
  return (
    <Section title="Git">
      <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
        <span className="flex items-center gap-1">
          <GitBranch size={12} /> {p.git.branch}
        </span>
        <span>{p.git.commitCount} commits</span>
        <span className={p.git.dirty ? "text-amber-300" : ""}>{p.git.dirty} uncommitted</span>
      </p>
      {p.git.agentBranches.length > 0 && (
        <div className="mb-2">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Unmerged agent branches</p>
          <ul className="font-mono text-xs text-indigo-300">
            {p.git.agentBranches.map((b) => (
              <li key={b} className="truncate">
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="space-y-1">
        {p.commits.map((c) => (
          <li key={c.sha} className="flex items-start gap-2 text-xs">
            <GitCommitHorizontal size={12} className="mt-0.5 shrink-0 text-zinc-600" />
            <span className="min-w-0 flex-1 truncate text-zinc-300" title={c.subject}>
              {c.subject}
            </span>
            <span className="shrink-0 text-zinc-600" suppressHydrationWarning>
              {relativeTime(c.at)}
            </span>
          </li>
        ))}
        {!p.commits.length && <li className="text-xs text-zinc-600">No commits.</li>}
      </ul>
    </Section>
  );
}

function Connections({ p, others, run }: { p: ProjectDetail; others: { id: number; name: string }[]; run: Run }) {
  const linked = new Set(p.uses.map((d) => d.id));
  const options = others.filter((o) => !linked.has(o.id));
  const row = (c: ProjectDetail["uses"][number]) => (
    <li key={c.linkId} className="group flex items-center justify-between gap-2">
      <Link href={`/projects/${c.id}`} className="truncate text-zinc-300 hover:text-white hover:underline">
        {c.name}
      </Link>
      <span className="flex shrink-0 items-center gap-2 text-[11px] text-zinc-500">
        {c.kind === "auto" ? <span title="Detected: one repo mentions the other">{c.label}</span> : <span>{c.label}</span>}
        {c.kind === "manual" && (
          <button type="button" aria-label="Remove connection" onClick={() => run(() => deleteLinks([c.linkId]))} className="opacity-0 hover:text-rose-400 group-hover:opacity-100">
            <X size={13} />
          </button>
        )}
      </span>
    </li>
  );
  return (
    <Section title="Connections">
      <p className="mb-1 text-xs text-zinc-500">Uses / depends on</p>
      <ul className="mb-3 space-y-1 text-sm">{p.uses.length ? p.uses.map(row) : <li className="text-zinc-600">Nothing</li>}</ul>
      <p className="mb-1 text-xs text-zinc-500">Used by</p>
      <ul className="mb-3 space-y-1 text-sm">{p.usedBy.length ? p.usedBy.map(row) : <li className="text-zinc-600">Nothing</li>}</ul>
      {options.length > 0 && (
        <select value="" aria-label="Add connection" onChange={(e) => e.target.value && run(() => addLink(p.id, Number(e.target.value)))} className={`${inputCls} w-full text-xs text-zinc-400`}>
          <option value="">+ Add “depends on”…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
    </Section>
  );
}

function Notes({ p, run }: { p: ProjectDetail; run: Run }) {
  const [text, setText] = useState("");
  return (
    <Section title={`Notes · ${p.notes.length}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          run(() => addNote(p.id, text));
          setText("");
        }}
        className="mb-3 flex gap-2"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
          }}
          rows={2}
          placeholder="Write a note… (Ctrl+Enter to save)"
          className={`${inputCls} flex-1 resize-y`}
        />
        <button className="self-end rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700">Save</button>
      </form>
      <ul className="space-y-2">
        {p.notes.map((n) => (
          <li key={n.id} className="group rounded-md border border-[var(--border)] bg-zinc-900/60 p-3">
            <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
              <span className="flex items-center gap-1" suppressHydrationWarning>
                {n.source === "chat" ? <Sparkles size={11} className="text-indigo-400" /> : <StickyNote size={11} />}
                {n.source === "chat" ? "From chat" : "Note"} · {relativeTime(n.createdAt)}
              </span>
              <button type="button" aria-label="Delete note" onClick={() => run(() => deleteNote(n.id))} className="opacity-0 hover:text-rose-400 group-hover:opacity-100">
                <Trash2 size={12} />
              </button>
            </div>
            <p className="whitespace-pre-wrap text-sm text-zinc-300">{n.content}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
