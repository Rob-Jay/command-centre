"use client";

import { Lightbulb } from "lucide-react";
import { MODELS, type Suggestion } from "@/lib/models";

/** Model dropdown that marks the suggested model and offers a one-click switch to it. */
export function ModelPicker({
  value,
  onChange,
  suggestion,
  showReason = false,
  className = "",
}: {
  value: string;
  onChange: (id: string) => void;
  suggestion: Suggestion;
  showReason?: boolean;
  className?: string;
}) {
  const matches = value === suggestion.id;
  return (
    <span className={`flex min-w-0 items-center gap-1.5 text-xs ${className}`}>
      <select
        value={value}
        aria-label="Model"
        onChange={(e) => onChange(e.target.value)}
        className="rounded bg-zinc-800 px-1.5 py-1 text-zinc-200 outline-none"
      >
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
            {m.id === suggestion.id ? " (suggested)" : ""}
          </option>
        ))}
      </select>
      {matches ? (
        <span className="flex min-w-0 items-center gap-1 text-amber-300/80" title={suggestion.reason}>
          <Lightbulb size={12} className="shrink-0" />
          <span className={showReason ? "" : "truncate"}>{showReason ? suggestion.reason : "Suggested"}</span>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onChange(suggestion.id)}
          title={suggestion.reason}
          className="flex min-w-0 items-center gap-1 rounded px-1 text-amber-300 hover:bg-amber-500/10"
        >
          <Lightbulb size={12} className="shrink-0" />
          <span className={showReason ? "text-left" : "truncate"}>
            Use {suggestion.label}
            {showReason ? `: ${suggestion.reason}` : ""}
          </span>
        </button>
      )}
    </span>
  );
}
