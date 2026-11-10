"use client";

import { useState } from "react";
import { MessageSquare, Bot } from "lucide-react";
import type { Feature } from "@/db/schema";
import type { ProjectDetail } from "@/lib/queries";
import { ProjectOverview } from "./ProjectOverview";
import { ChatPanel } from "./ChatPanel";
import { RunsPanel } from "./RunsPanel";
import { ImplementDialog } from "./ImplementDialog";

/** Project page: overview on the left, Claude chat / Claude Code runs on the right. */
export function ProjectWorkspace({ project, others }: { project: ProjectDetail; others: { id: number; name: string }[] }) {
  const [tab, setTab] = useState<"chat" | "runs">(project.runningRuns ? "runs" : "chat");
  const [selectedRun, setSelectedRun] = useState<number | null>(project.runs[0]?.id ?? null);
  const [implementing, setImplementing] = useState<{ feature: Feature | null } | null>(null);

  const showRun = (id: number) => {
    setSelectedRun(id);
    setTab("runs");
  };

  const tabCls = (t: "chat" | "runs") =>
    `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${tab === t ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:text-zinc-200"}`;

  return (
    <div className="mx-auto grid w-full max-w-[1600px] flex-1 grid-cols-1 gap-4 px-4 py-4 lg:h-[calc(100vh-3rem)] lg:grid-cols-[minmax(0,1.1fr)_minmax(400px,0.9fr)]">
      <section className="min-h-0 overflow-y-auto pr-1">
        <ProjectOverview project={project} others={others} onImplement={(feature) => setImplementing({ feature })} onShowRun={showRun} />
      </section>

      <section className="flex min-h-[75vh] flex-col gap-2 lg:min-h-0">
        <div className="flex items-center gap-1">
          <button type="button" className={tabCls("chat")} onClick={() => setTab("chat")}>
            <MessageSquare size={14} /> Chat
          </button>
          <button type="button" className={tabCls("runs")} onClick={() => setTab("runs")}>
            <Bot size={14} /> Claude Code runs
            {project.runningRuns > 0 && <span className="rounded-full bg-sky-500/20 px-1.5 text-[11px] text-sky-300">{project.runningRuns} live</span>}
          </button>
        </div>
        {tab === "chat" ? (
          <ChatPanel
            projectId={project.id}
            initialModel={project.model}
            messages={project.messages}
            features={project.features}
            totals={{ input: project.inputTokens, output: project.outputTokens, cost: project.costUsd }}
          />
        ) : (
          <RunsPanel
            runs={project.runs}
            selected={selectedRun}
            onSelect={setSelectedRun}
            onNewTask={() => setImplementing({ feature: null })}
          />
        )}
      </section>

      {implementing && (
        <ImplementDialog
          projectId={project.id}
          projectName={project.name}
          feature={implementing.feature}
          defaultModel={project.model}
          onClose={() => setImplementing(null)}
          onStarted={(id) => {
            setImplementing(null);
            showRun(id);
          }}
        />
      )}
    </div>
  );
}
