import { blocks, describeTool, killTree, startClaude, textDelta, type ResultLine } from "./claude-cli";
import { TOOL_MARK } from "./stream-client";

/** Tools for chat and questions: read the code and git history, change nothing. */
export const READ_ONLY_ARGS = [
  "--permission-prompts", "none",
  "--tools", "Read,Glob,Grep,Bash",
  "--allowedTools", "Read", "Glob", "Grep",
  "Bash(git log *)", "Bash(git log)", "Bash(git show *)", "Bash(git diff *)", "Bash(git status)", "Bash(git branch *)", "Bash(git branch)", "Bash(ls *)", "Bash(ls)",
  "--strict-mcp-config",
  "--include-partial-messages",
];

/**
 * Run Claude Code read-only and stream its text (plus tool markers) as a plain-text Response.
 * `onDone` gets the reply text (without markers) and the final result line.
 */
export function streamClaudeResponse(opts: {
  cwd: string;
  prompt: string;
  args: string[];
  signal: AbortSignal;
  onDone?: (reply: string, result: ResultLine | null, stderr: string) => void;
}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let reply = "";
      let closed = false;
      const write = (s: string) => {
        if (!closed) controller.enqueue(encoder.encode(s));
      };
      const proc = startClaude({
        cwd: opts.cwd,
        prompt: opts.prompt,
        args: [...READ_ONLY_ARGS, ...opts.args],
        onLine: (line) => {
          const t = textDelta(line);
          if (t) {
            reply += t;
            write(t);
            return;
          }
          if (line.type === "assistant") {
            for (const b of blocks(line)) {
              if (b.type === "tool_use") write(`${TOOL_MARK}${describeTool(b.name ?? "tool", b.input, opts.cwd)}\n`);
            }
            // Separate text from consecutive assistant turns (before/after tool use).
            if (reply && !reply.endsWith("\n\n")) {
              reply += "\n\n";
              write("\n\n");
            }
          }
        },
      });
      opts.signal.addEventListener("abort", () => killTree(proc.child));
      void proc.done.then(({ code, stderr, result }) => {
        if (!result || result.is_error) {
          const msg = result?.result || stderr.trim().split("\n").slice(-3).join(" ") || `Claude Code exited with code ${code}`;
          write(`\n\n**Error:** ${msg}`);
        }
        opts.onDone?.(reply.trim(), result, stderr);
        closed = true;
        controller.close();
      });
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
