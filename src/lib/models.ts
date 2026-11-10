// Models offered in the UI. Calls go through the Claude Code CLI, which reports the cost of each call.

export type ModelInfo = { id: string; label: string };

export const MODELS: ModelInfo[] = [
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
];

export const DEFAULT_MODEL = MODELS[0].id;

export function modelInfo(id: string | null | undefined): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export type TaskKind = "implement" | "chat" | "ask" | "scan";
export type Suggestion = { id: string; label: string; reason: string };

const HEAVY =
  /\b(refactor|re-?architect|architecture|redesign|rewrite|migrat\w*|auth\w*|security|oauth|payments?|concurren\w*|race|deadlock|perf\w*|optimi[sz]\w*|schema|database|multi-?(file|step)|across|end[- ]to[- ]end|integrat\w*|overhaul|framework|state management|design|plan|trade-?offs?|debug\w*|investigat\w*|root cause|why)\b/i;
const LIGHT =
  /\b(typo|rename|copy|wording|text|label|colou?r|padding|margin|spacing|icon|readme|docs?|comment|bump|version|lint|format\w*|tweak|small|quick|minor|what is|where is|which file|list|show me|summari[sz]e|how many)\b/i;

function pick(id: string, reason: string): Suggestion {
  return { id, label: modelInfo(id).label, reason };
}

/**
 * Suggest a model for a task from its wording. Heuristic, not a guarantee:
 * Haiku for small or lookup tasks, Sonnet for routine work, Opus for complex or cross-cutting work.
 */
export function suggestModel(kind: TaskKind, text = ""): Suggestion {
  if (kind === "scan") return pick("claude-sonnet-5-5", "Reading a repo and listing features is routine; Sonnet is accurate and cheaper");
  const t = text.trim();
  const words = t ? t.split(/\s+/).length : 0;
  const heavy = HEAVY.test(t);
  const light = LIGHT.test(t);

  if (kind === "implement") {
    if (heavy || words > 80) return pick("claude-opus-5-5", heavy ? "Cross-cutting or tricky change; Opus plans and checks its work best" : "Long, detailed brief; Opus handles multi-step work best");
    if (light && words < 30) return pick("claude-haiku-5-5", "Small, contained change; Haiku is fast and cheapest");
    return pick("claude-sonnet-5-5", "Routine feature work; Sonnet balances quality and cost");
  }
  // chat / ask
  if (!t) return pick("claude-sonnet-5-5", "Good default for questions about code");
  if (heavy || words > 60) return pick("claude-opus-5-5", "Design, debugging or 'why' question; Opus reasons deepest");
  if (light || words < 12) return pick("claude-haiku-5-5", "Quick lookup or summary; Haiku answers fastest");
  return pick("claude-sonnet-5-5", "General question about the code; Sonnet balances quality and cost");
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
