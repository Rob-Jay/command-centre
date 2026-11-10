"use client";

import { useState } from "react";

/** Text input / textarea that keeps local state and calls `onSave` on blur (or Enter for single-line). */
export function Editable({
  value,
  onSave,
  multiline,
  placeholder,
  className = "",
  ariaLabel,
}: {
  value: string;
  onSave: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    // Server value changed (e.g. after a refresh): adopt it.
    setPrev(value);
    setV(value);
  }
  const commit = () => {
    if (v !== value) onSave(v);
  };
  const base = `w-full rounded-md border border-transparent bg-transparent px-2 py-1 outline-none transition-colors hover:border-zinc-800 focus:border-indigo-500 focus:bg-zinc-900 ${className}`;
  return multiline ? (
    <textarea
      value={v}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      rows={Math.max(2, v.split("\n").length)}
      className={`${base} resize-y`}
    />
  ) : (
    <input
      value={v}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setV(value);
      }}
      className={base}
    />
  );
}

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
