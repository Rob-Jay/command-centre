"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import ReactMarkdown from "react-markdown";
import { Sparkles, FolderKanban, LayoutGrid, Network, Activity, ArrowLeft } from "lucide-react";
import type { Status } from "@/db/schema";
import { StatusBadge } from "./ui";
import { splitToolMarks, streamText } from "@/lib/stream-client";
import { suggestModel } from "@/lib/models";
import { ModelPicker } from "./ModelPicker";

type P = { id: number; name: string; slug: string; status: Status };

const PAGES = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/graph", label: "Graph view", icon: Network },
  { href: "/activity", label: "Activity", icon: Activity },
];

export function CommandBar({ projects }: { projects: P[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const suggestion = suggestModel("ask", query);
  const model = picked ?? suggestion.id;
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-bar", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-bar", onOpen);
    };
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setAsked(null);
    setAnswer("");
    setBusy(false);
  }, []);

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      reset();
      setQuery("");
      setPicked(null);
    }
  };

  const go = (href: string) => {
    close(false);
    router.push(href);
  };

  const ask = async (q: string) => {
    if (!q.trim()) return;
    reset();
    setAsked(q);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamText("/api/ask", { question: q, model }, setAnswer, ctrl.signal);
    } catch (err) {
      if (!ctrl.signal.aborted) setAnswer(`**Error:** ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const itemCls =
    "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-300 data-[selected=true]:bg-zinc-800 data-[selected=true]:text-zinc-50";

  return (
    <Command.Dialog
      open={open}
      onOpenChange={close}
      label="Command bar"
      shouldFilter={asked === null}
      // The "ask" item always shows, ranked below any matching project or view.
      filter={(value, search) => (value.startsWith("ask:") ? 0.01 : value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
      overlayClassName="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[12vh] z-50 w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3">
        {asked !== null ? (
          <button type="button" onClick={reset} className="text-zinc-400 hover:text-zinc-100" aria-label="Back">
            <ArrowLeft size={16} />
          </button>
        ) : (
          <Sparkles size={16} className="text-indigo-400" />
        )}
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Jump to a project, or ask Claude about all projects…"
          className="h-12 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          onKeyDown={(e) => {
            if (asked !== null && e.key === "Enter") {
              e.preventDefault();
              ask(query);
            }
          }}
        />
        <ModelPicker value={model} onChange={setPicked} suggestion={suggestion} className="max-w-[45%] shrink-0" />
      </div>

      {asked !== null ? (
        <div className="max-h-[60vh] overflow-y-auto p-4">
          <p className="mb-3 text-xs uppercase tracking-wide text-zinc-500">Across all projects</p>
          <p className="mb-3 text-sm font-medium text-zinc-200">{asked}</p>
          {(() => {
            const { text, tools } = splitToolMarks(answer);
            return (
              <>
                {text.trim() && (
                  <div className="prose-chat text-sm leading-relaxed text-zinc-300">
                    <ReactMarkdown>{text}</ReactMarkdown>
                  </div>
                )}
                {busy && (
                  <p className="mt-2 animate-pulse truncate font-mono text-xs text-zinc-500">
                    {tools.length ? `→ ${tools[tools.length - 1]}` : "Thinking…"}
                  </p>
                )}
              </>
            );
          })()}
          {!busy && <p className="mt-4 text-xs text-zinc-500">Edit the text above and press Enter to ask again, or Esc to close.</p>}
        </div>
      ) : (
        <Command.List className="max-h-[60vh] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-zinc-500">No matches.</Command.Empty>
          <Command.Group heading="Projects" className="text-xs text-zinc-500 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            {projects.map((p) => (
              <Command.Item key={p.id} value={`${p.name} ${p.slug} ${p.id}`} onSelect={() => go(`/projects/${p.id}`)} className={itemCls}>
                <FolderKanban size={14} className="text-zinc-500" />
                <span className="flex-1 truncate">{p.name}</span>
                <StatusBadge status={p.status} />
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Views" className="text-xs text-zinc-500 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            {PAGES.map(({ href, label, icon: Icon }) => (
              <Command.Item key={href} value={label} onSelect={() => go(href)} className={itemCls}>
                <Icon size={14} className="text-zinc-500" />
                {label}
              </Command.Item>
            ))}
          </Command.Group>
          {query.trim() && (
            <Command.Group heading="Claude" className="text-xs text-zinc-500 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
              <Command.Item value={`ask:${query}`} onSelect={() => ask(query)} className={itemCls}>
                <Sparkles size={14} className="text-indigo-400" />
                Ask Claude across all projects: <span className="truncate text-zinc-100">“{query}”</span>
              </Command.Item>
            </Command.Group>
          )}
        </Command.List>
      )}
    </Command.Dialog>
  );
}
