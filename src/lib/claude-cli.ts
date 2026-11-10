import { spawn, execFile, type ChildProcess } from "node:child_process";
import path from "node:path";

/** Claude Code CLI binary. Uses your Claude Code login (subscription or API key it is configured with). */
export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

/** Environment for child sessions: drop Next.js / parent-session variables that would confuse them. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k === "NODE_OPTIONS" || k === "NODE_ENV" || k === "PORT" || k.startsWith("__NEXT") || k.startsWith("NEXT_")) delete env[k];
    if (k === "CLAUDECODE" || k === "CLAUDE_CODE_ENTRYPOINT") delete env[k];
  }
  // An API key in .env.local would silently override the Claude Code login; only pass it when asked to.
  if (process.env.CC_USE_API_KEY !== "1") delete env.ANTHROPIC_API_KEY;
  return env;
}

export type StreamLine = Record<string, unknown> & { type: string };

export type ResultLine = {
  type: "result";
  subtype: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  structured_output?: unknown;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
};

export type ClaudeProcess = { child: ChildProcess; done: Promise<{ code: number | null; stderr: string; result: ResultLine | null }> };

/**
 * Start `claude -p` with stream-json output. The prompt goes in on stdin (no command-line length limit).
 * `onLine` receives every parsed JSON event.
 */
export function startClaude(opts: { cwd: string; args: string[]; prompt: string; onLine?: (l: StreamLine) => void }): ClaudeProcess {
  const child = spawn(CLAUDE_BIN, ["-p", "--output-format", "stream-json", "--verbose", ...opts.args], {
    cwd: opts.cwd,
    env: childEnv(),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin?.end(opts.prompt);

  let buf = "";
  let stderr = "";
  let result: ResultLine | null = null;
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const raw = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!raw) continue;
      try {
        const line = JSON.parse(raw) as StreamLine;
        if (line.type === "result") result = line as unknown as ResultLine;
        opts.onLine?.(line);
      } catch {
        /* non-JSON noise */
      }
    }
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (c: string) => {
    stderr = (stderr + c).slice(-8000);
  });

  const done = new Promise<{ code: number | null; stderr: string; result: ResultLine | null }>((resolve) => {
    child.on("error", (err) => resolve({ code: -1, stderr: `${stderr}\n${err.message}`, result }));
    child.on("close", (code) => resolve({ code, stderr, result }));
  });
  return { child, done };
}

/** Kill a process and its children (Claude spawns shells, npm, etc.). */
export function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") killPid(child.pid);
  else child.kill("SIGTERM");
}

/** Kill by pid, e.g. a Claude process started by another server process. */
export function killPid(pid: number) {
  if (process.platform === "win32") execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
  else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
}

/** Text deltas from `--include-partial-messages` stream events. */
export function textDelta(line: StreamLine): string | null {
  if (line.type !== "stream_event") return null;
  const ev = line.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
  if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") return ev.delta.text ?? "";
  return null;
}

type Block = { type: string; text?: string; name?: string; input?: Record<string, unknown>; is_error?: boolean; content?: unknown };

/** Content blocks of a complete assistant or user message line. */
export function blocks(line: StreamLine): Block[] {
  if (line.type !== "assistant" && line.type !== "user") return [];
  const msg = line.message as { content?: Block[] | string } | undefined;
  return Array.isArray(msg?.content) ? msg.content : [];
}

/** Short human description of a tool call, e.g. "Edit app/page.tsx" or "$ npm run build". */
export function describeTool(name: string, input: Record<string, unknown> = {}, cwd?: string): string {
  const rel = (p: unknown) => {
    const s = String(p ?? "");
    return cwd && path.isAbsolute(s) ? path.relative(cwd, s).replaceAll("\\", "/") || s : s;
  };
  switch (name) {
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return `${name} ${rel(input.file_path ?? input.notebook_path)}`;
    case "Bash":
    case "PowerShell":
      return `$ ${String(input.command ?? "").slice(0, 300)}`;
    case "Glob":
      return `Glob ${input.pattern ?? ""}`;
    case "Grep":
      return `Grep "${input.pattern ?? ""}"${input.path ? ` in ${rel(input.path)}` : ""}`;
    case "TodoWrite": {
      const todos = (input.todos as { content: string; status: string }[] | undefined) ?? [];
      return `Plan: ${todos.map((t) => `${t.status === "completed" ? "✓" : t.status === "in_progress" ? "→" : "·"} ${t.content}`).join("  ")}`;
    }
    case "WebFetch":
    case "WebSearch":
      return `${name} ${input.url ?? input.query ?? ""}`;
    case "Task":
    case "Agent":
      return `Sub-agent: ${input.description ?? ""}`;
    default:
      return name;
  }
}

/** Text of a tool_result block (for error reporting). */
export function toolResultText(b: Block): string {
  if (typeof b.content === "string") return b.content;
  if (Array.isArray(b.content)) return b.content.map((c: { text?: string }) => c.text ?? "").join("");
  return "";
}
