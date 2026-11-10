"use client";

import { useState } from "react";
import { X, Check } from "lucide-react";
import type { Proposal } from "@/app/ai-actions";
import { FEATURE_STATUSES, type Feature, type FeatureStatus } from "@/db/schema";
import { FEATURE_LABEL, STATUS_LABEL } from "./ui";

/** Shows Claude's proposed changes as a checklist. Only ticked items are applied. */
export function ProposalDialog({
  proposal,
  features,
  onApply,
  onClose,
  busy,
}: {
  proposal: Proposal;
  features: Pick<Feature, "id" | "title" | "status">[];
  onApply: (accepted: Proposal) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [useStatus, setUseStatus] = useState(proposal.status !== null);
  const [useNext, setUseNext] = useState(proposal.nextAction !== null);
  const [nextAction, setNextAction] = useState(proposal.nextAction ?? "");
  const [updates, setUpdates] = useState(proposal.featureUpdates.map((u) => ({ ...u, keep: true })));
  const [newFs, setNewFs] = useState(proposal.newFeatures.map((f) => ({ ...f, keep: true })));

  const byId = new Map(features.map((f) => [f.id, f]));
  const nothing = proposal.status === null && proposal.nextAction === null && !proposal.featureUpdates.length && !proposal.newFeatures.length;

  const apply = () =>
    onApply({
      summary: proposal.summary,
      status: useStatus ? proposal.status : null,
      nextAction: useNext && nextAction.trim() ? nextAction.trim() : null,
      featureUpdates: updates.filter((u) => u.keep).map(({ id, status }) => ({ id, status })),
      newFeatures: newFs.filter((f) => f.keep && f.title.trim()).map(({ title, description, area, status }) => ({ title, description, area, status })),
    });

  const row = "flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-900";
  const box = "mt-0.5 h-4 w-4 shrink-0 accent-indigo-500";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Review proposed changes">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Review proposed changes</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[65vh] space-y-3 overflow-y-auto p-4 text-sm">
          <p className="text-zinc-400">{proposal.summary}</p>
          {nothing && <p className="text-zinc-500">Claude found nothing to change.</p>}

          {proposal.status && (
            <label className={row}>
              <input type="checkbox" className={box} checked={useStatus} onChange={(e) => setUseStatus(e.target.checked)} />
              <span>
                Set project status to <strong className="text-zinc-100">{STATUS_LABEL[proposal.status]}</strong>
              </span>
            </label>
          )}

          {proposal.nextAction !== null && (
            <div className={row}>
              <input type="checkbox" className={box} checked={useNext} onChange={(e) => setUseNext(e.target.checked)} aria-label="Update next action" />
              <div className="flex-1">
                <p className="mb-1 text-zinc-300">Update next action</p>
                <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} className="w-full rounded-md border border-[var(--border)] bg-zinc-900 px-2 py-1 outline-none focus:border-indigo-500" />
              </div>
            </div>
          )}

          {updates.length > 0 && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Feature status changes</p>
              {updates.map((u, i) => (
                <label key={u.id} className={row}>
                  <input type="checkbox" className={box} checked={u.keep} onChange={(e) => setUpdates((all) => all.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                  <span className="text-zinc-300">
                    {byId.get(u.id)?.title ?? `#${u.id}`}: {FEATURE_LABEL[byId.get(u.id)?.status ?? "planned"]} → <strong className="text-zinc-100">{FEATURE_LABEL[u.status]}</strong>
                  </span>
                </label>
              ))}
            </div>
          )}

          {newFs.length > 0 && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">New features</p>
              {newFs.map((f, i) => (
                <div key={i} className={row}>
                  <input type="checkbox" className={box} checked={f.keep} aria-label={`Add ${f.title}`} onChange={(e) => setNewFs((all) => all.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                  <div className="min-w-0 flex-1">
                    <input
                      value={f.title}
                      onChange={(e) => setNewFs((all) => all.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                      className="w-full rounded border border-transparent bg-transparent px-1 outline-none hover:border-zinc-800 focus:border-indigo-500"
                    />
                    {f.description && <p className="px-1 text-xs text-zinc-500">{f.description}</p>}
                  </div>
                  <select
                    value={f.status}
                    aria-label="Status"
                    onChange={(e) => setNewFs((all) => all.map((x, j) => (j === i ? { ...x, status: e.target.value as FeatureStatus } : x)))}
                    className="rounded bg-transparent text-xs text-zinc-400 outline-none"
                  >
                    {FEATURE_STATUSES.map((s) => (
                      <option key={s} value={s} className="bg-zinc-900">
                        {FEATURE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">
            Cancel
          </button>
          <button type="button" disabled={busy || nothing} onClick={apply} className="flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
            <Check size={14} /> Apply selected
          </button>
        </div>
      </div>
    </div>
  );
}
