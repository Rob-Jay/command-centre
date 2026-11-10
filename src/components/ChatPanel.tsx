"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Send, Sparkles, StickyNote, ListPlus, RefreshCw, Eraser, Square, Check } from "lucide-react";
import type { Feature, Message } from "@/db/schema";
import { formatCost, formatTokens, modelInfo, suggestModel } from "@/lib/models";
import { ModelPicker } from "./ModelPicker";
import { splitToolMarks, streamText } from "@/lib/stream-client";
import { addNote, clearChat, updateProject } from "@/app/actions";
import { applyProposal, featuresFromText, proposeFromChat, type Proposal } from "@/app/ai-actions";
import { ProposalDialog } from "./ProposalDialog";

type Totals = { input: number; output: number; cost: number };

export function ChatPanel({
  projectId,
  initialModel,
  messages,
  features,
  totals,
}: {
  projectId: number;
  initialModel: string;
  messages: Message[];
  features: Pick<Feature, "id" | "title" | "status">[];
  totals: Totals;
}) {
  const router = useRouter();
  const [model, setModel] = useState(initialModel);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<{ user: string; reply: string } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<number[]>([]);
  const [, startTransition] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Saved messages arrived from the server: drop the optimistic copy.
  const [prevMessages, setPrevMessages] = useState(messages);
  if (messages !== prevMessages && !streaming) {
    setPrevMessages(messages);
    setPending(null);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending?.reply]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError(null);
    setPending({ user: text, reply: "" });
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamText(`/api/chat/${projectId}`, { message: text, model }, (reply) => setPending({ user: text, reply }), ctrl.signal);
    } catch (err) {
      if (!ctrl.signal.aborted) setError((err as Error).message);
    } finally {
      setStreaming(false);
      startTransition(() => router.refresh());
    }
  };

  const runProposal = async (label: string, fn: () => ReturnType<typeof proposeFromChat>) => {
    setWorking(label);
    setError(null);
    const res = await fn();
    setWorking(null);
    if (res.ok) setProposal(res.data);
    else setError(res.error);
  };

  const live = pending ? splitToolMarks(pending.reply) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <Sparkles size={15} className="text-indigo-400" />
        <span className="text-sm font-medium text-zinc-200">Claude</span>
        <ModelPicker
          value={model}
          suggestion={suggestModel("chat", input)}
          onChange={(id) => {
            setModel(id);
            startTransition(() => updateProject(projectId, { model: id }));
          }}
        />
        <span className="font-mono text-[11px] text-zinc-500" title="All Claude usage for this project (chat, scans, runs)">
          {formatTokens(totals.input)} in · {formatTokens(totals.output)} out · {formatCost(totals.cost)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={!!working || streaming || messages.length === 0}
            onClick={() => runProposal("Reading the chat…", () => proposeFromChat(projectId))}
            title="Claude proposes status, next action and feature changes from this chat; you approve them"
            className="flex items-center gap-1 rounded-md bg-indigo-600/90 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            <RefreshCw size={12} className={working ? "animate-spin" : ""} /> Update from chat
          </button>
          <button
            type="button"
            title="Clear chat and start a new Claude session"
            disabled={streaming || messages.length === 0}
            onClick={() => confirm("Clear this project's chat and start a fresh session? Usage totals are kept.") && startTransition(() => clearChat(projectId))}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
          >
            <Eraser size={14} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !pending && (
          <div className="mx-auto mt-10 max-w-sm text-center text-sm text-zinc-500">
            <p className="mb-2 text-zinc-300">Ask Claude about this codebase.</p>
            <p>It runs as a read-only Claude Code session in the repo, so it can open files and read git history. Try “How is the data layer structured?” or “What would it take to add login?”</p>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <UserBubble key={m.id} text={m.content} />
          ) : (
            <div key={m.id}>
              <AssistantBubble text={m.content} />
              <div className="mt-1 flex items-center gap-3 pl-1 text-[11px] text-zinc-600">
                <span className="font-mono">
                  {modelInfo(m.model).label} · {formatCost(m.costUsd)}
                </span>
                <button
                  type="button"
                  disabled={savedIds.includes(m.id)}
                  onClick={() => {
                    setSavedIds((s) => [...s, m.id]);
                    startTransition(() => addNote(projectId, m.content, "chat"));
                  }}
                  className="flex items-center gap-1 hover:text-zinc-200 disabled:text-emerald-400"
                >
                  {savedIds.includes(m.id) ? <Check size={11} /> : <StickyNote size={11} />}
                  {savedIds.includes(m.id) ? "Saved" : "Save as note"}
                </button>
                <button
                  type="button"
                  disabled={!!working}
                  onClick={() => runProposal("Extracting features…", () => featuresFromText(projectId, m.content))}
                  className="flex items-center gap-1 hover:text-zinc-200 disabled:opacity-40"
                >
                  <ListPlus size={11} /> Add as features
                </button>
              </div>
            </div>
          ),
        )}
        {pending && live && (
          <>
            <UserBubble text={pending.user} />
            {live.text.trim() && <AssistantBubble text={live.text} />}
            {streaming && (
              <p className="animate-pulse truncate pl-1 font-mono text-xs text-zinc-500">
                {live.tools.length ? `→ ${live.tools[live.tools.length - 1]}` : "Claude is thinking…"}
              </p>
            )}
          </>
        )}
        {working && <p className="animate-pulse text-center text-xs text-indigo-300">{working}</p>}
        {error && <p className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-end gap-2 border-t border-[var(--border)] p-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={Math.min(6, Math.max(1, input.split("\n").length))}
          placeholder="Ask about this codebase… (Shift+Enter for a new line)"
          className="max-h-40 flex-1 resize-none rounded-lg border border-[var(--border)] bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        {streaming ? (
          <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop" className="grid h-9 w-9 place-items-center rounded-lg bg-zinc-700 text-white hover:bg-zinc-600">
            <Square size={14} />
          </button>
        ) : (
          <button disabled={!input.trim()} aria-label="Send" className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40">
            <Send size={15} />
          </button>
        )}
      </form>

      {proposal && (
        <ProposalDialog
          proposal={proposal}
          features={features}
          busy={working !== null}
          onClose={() => setProposal(null)}
          onApply={async (accepted) => {
            setWorking("Applying changes…");
            await applyProposal(projectId, accepted);
            setWorking(null);
            setProposal(null);
          }}
        />
      )}
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-indigo-600/25 px-3.5 py-2 text-sm text-zinc-100 ring-1 ring-indigo-500/30">{text}</div>
    </div>
  );
}

function AssistantBubble({ text }: { text: string }) {
  return (
    <div className="prose-chat max-w-[95%] rounded-2xl rounded-bl-sm bg-zinc-900 px-3.5 py-2 text-sm leading-relaxed text-zinc-300 ring-1 ring-zinc-800">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}
