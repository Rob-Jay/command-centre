import type { FeatureStatus, Status } from "@/db/schema";
import type { HealthLevel } from "@/lib/health";

export const STATUS_LABEL: Record<Status, string> = {
  idea: "Idea",
  active: "Active",
  blocked: "Blocked",
  done: "Done",
};

export const STATUS_STYLE: Record<Status, string> = {
  idea: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  active: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  blocked: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
  done: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/30",
};

/** Hex colours for places Tailwind classes can't reach (React Flow, SVG). */
export const STATUS_HEX: Record<Status, string> = {
  idea: "#38bdf8",
  active: "#34d399",
  blocked: "#fb7185",
  done: "#71717a",
};

const HEALTH_STYLE: Record<HealthLevel, string> = {
  green: "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60",
  amber: "bg-amber-400 shadow-[0_0_8px] shadow-amber-400/60",
  red: "bg-rose-500 shadow-[0_0_8px] shadow-rose-500/60",
  grey: "bg-zinc-500",
  blue: "bg-sky-400 shadow-[0_0_10px] shadow-sky-400/80 animate-pulse",
};

export const FEATURE_LABEL: Record<FeatureStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  review: "Review",
  built: "Built",
};

export const FEATURE_HEX: Record<FeatureStatus, string> = {
  planned: "#71717a",
  in_progress: "#38bdf8",
  review: "#fbbf24",
  built: "#34d399",
};

export function FeatureDot({ status }: { status: FeatureStatus }) {
  return (
    <span
      title={FEATURE_LABEL[status]}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${status === "in_progress" ? "animate-pulse" : ""}`}
      style={{ background: FEATURE_HEX[status] }}
    />
  );
}

/** Stacked bar of feature statuses. */
export function FeatureBar({ counts }: { counts: Record<FeatureStatus, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return <div className="h-1.5 w-full rounded-full bg-zinc-800" />;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
      {(["built", "review", "in_progress", "planned"] as const).map((s) =>
        counts[s] ? <div key={s} title={`${counts[s]} ${FEATURE_LABEL[s].toLowerCase()}`} style={{ width: `${(counts[s] / total) * 100}%`, background: FEATURE_HEX[s] }} /> : null,
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function HealthDot({ level, reason }: { level: HealthLevel; reason: string }) {
  return (
    <span title={reason} aria-label={`Health: ${reason}`} className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${HEALTH_STYLE[level]}`} />
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400 transition-all" style={{ width: `${value}%` }} />
    </div>
  );
}

export function TagPill({ name, active, onClick }: { name: string; active?: boolean; onClick?: () => void }) {
  const cls = `rounded-md px-1.5 py-0.5 text-[11px] ${active ? "bg-indigo-500/25 text-indigo-200 ring-1 ring-indigo-400/40" : "bg-zinc-800 text-zinc-400"}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} hover:text-zinc-200`}>
      {name}
    </button>
  ) : (
    <span className={cls}>{name}</span>
  );
}
