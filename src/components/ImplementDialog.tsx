"use client";

import { useState } from "react";
import { Bot, X, Play } from "lucide-react";
import type { Feature } from "@/db/schema";
import { suggestModel } from "@/lib/models";
import { ModelPicker } from "./ModelPicker";
import { implementFeature, implementTask } from "@/app/actions";

/** Start a Claude Code implementation run for a feature, or for a free-form task. */
export function ImplementDialog({
  projectId,
  projectName,
  feature,
  defaultModel,
  onStarted,
  onClose,
}: {
  projectId: number;
  projectName: string;
  feature: Feature | null; // null = free-form task
  defaultModel: string;
  onStarted: (runId: number) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(feature?.title ?? "");
  const [details, setDetails] = useState("");
  // Follow the suggestion until the user picks a model themselves.
  const [picked, setPicked] = useState<string | null>(null);
  const suggestion = suggestModel("implement", `${feature?.title ?? title} ${feature?.description ?? ""} ${details}`);
  const model = picked ?? suggestion.id ?? defaultModel;
  const setModel = setPicked;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    const res = feature ? await implementFeature(feature.id, details, model) : await implementTask(projectId, title, details, model);
    setBusy(false);
    if (res.ok) onStarted(res.data);
    else setError(res.error);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Implement with Claude Code">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Bot size={16} className="text-indigo-400" /> Implement with Claude Code
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 p-4 text-sm">
          <p className="text-xs text-zinc-500">Project: {projectName}</p>
          {feature ? (
            <div>
              <p className="font-medium text-zinc-100">{feature.title}</p>
              {feature.description && <p className="mt-0.5 text-zinc-400">{feature.description}</p>}
            </div>
          ) : (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What should Claude build or fix?"
              className="w-full rounded-md border border-[var(--border)] bg-zinc-900 px-3 py-2 outline-none focus:border-indigo-500"
            />
          )}
          <textarea
            autoFocus={!!feature}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={4}
            placeholder="Extra instructions (optional): acceptance criteria, files to touch, things to avoid…"
            className="w-full resize-y rounded-md border border-[var(--border)] bg-zinc-900 px-3 py-2 outline-none focus:border-indigo-500"
          />
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            Model
            <ModelPicker value={model} onChange={setModel} suggestion={suggestion} showReason />
          </div>
          <ul className="space-y-1 rounded-md bg-zinc-900/70 p-3 text-xs text-zinc-400">
            <li>• Runs in a separate git worktree on a new <span className="font-mono text-zinc-300">agent/…</span> branch. Your checkout is untouched.</li>
            <li>• Claude can edit files and run npm, npx, node and git. It can’t push, merge, or run anything else.</li>
            <li>• You review the diff afterwards. The feature moves to “Built” once you merge the branch.</li>
          </ul>
          {error && <p className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-300">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || (!feature && !title.trim())}
            onClick={start}
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            <Play size={13} /> {busy ? "Starting…" : "Start run"}
          </button>
        </div>
      </div>
    </div>
  );
}
