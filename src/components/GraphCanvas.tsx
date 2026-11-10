"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
} from "@xyflow/react";
import { Trash2, Bot } from "lucide-react";
import type { FeatureStatus, Link, Status } from "@/db/schema";
import type { Health } from "@/lib/health";
import { addLink, deleteLinks, setGraphPosition } from "@/app/actions";
import { FeatureBar, FeatureDot, HealthDot, STATUS_HEX, StatusBadge } from "./ui";

export type GraphProject = {
  id: number;
  name: string;
  status: Status;
  progress: number;
  health: Health;
  counts: Record<FeatureStatus, number>;
  running: number;
  stack: string[];
  features: { id: number; title: string; status: FeatureStatus }[];
  more: number;
  x: number | null;
  y: number | null;
};
type NodeData = Omit<GraphProject, "id" | "x" | "y">;
type ProjectNode = Node<NodeData, "project">;

function ProjectNodeView({ data, selected }: NodeProps<ProjectNode>) {
  return (
    <div
      className={`w-64 cursor-pointer rounded-xl border bg-[var(--panel)] p-3 shadow-lg transition-colors ${
        selected ? "border-indigo-500" : data.running ? "border-sky-500/60" : "border-zinc-700 hover:border-zinc-500"
      }`}
      style={{ borderLeft: `3px solid ${STATUS_HEX[data.status]}` }}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-zinc-900 !bg-zinc-400" />
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-tight text-zinc-100">{data.name}</span>
        <HealthDot level={data.health.level} reason={data.health.reason} />
      </div>
      <div className="mb-2 flex items-center justify-between">
        <StatusBadge status={data.status} />
        <span className="flex items-center gap-2 font-mono text-[11px] text-zinc-400">
          {data.running > 0 && (
            <span className="flex items-center gap-0.5 text-sky-300">
              <Bot size={11} /> {data.running}
            </span>
          )}
          {data.progress}%
        </span>
      </div>
      <FeatureBar counts={data.counts} />
      {data.features.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {data.features.map((f) => (
            <li key={f.id} className="flex items-center gap-1.5 truncate text-[11px] text-zinc-400">
              <FeatureDot status={f.status} />
              <span className="truncate">{f.title}</span>
            </li>
          ))}
          {data.more > 0 && <li className="pl-3.5 text-[11px] text-zinc-600">+{data.more} more</li>}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] text-zinc-600">No feature map yet</p>
      )}
      {data.stack.length > 0 && <p className="mt-2 truncate text-[10px] text-zinc-500">{data.stack.join(" · ")}</p>}
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-zinc-900 !bg-indigo-400" />
    </div>
  );
}

const nodeTypes = { project: ProjectNodeView };

/** Edges point from a project to the ones that use / depend on / mention it. */
function toEdge(l: Link): Edge {
  const manual = l.kind === "manual";
  const color = manual ? "#818cf8" : "#52525b";
  return {
    id: String(l.id),
    source: String(l.toId),
    target: String(l.fromId),
    label: manual ? undefined : l.label,
    labelStyle: { fill: "#a1a1aa", fontSize: 10 },
    labelBgStyle: { fill: "#111114" },
    deletable: manual,
    style: { stroke: color, strokeWidth: manual ? 2 : 1.5, strokeDasharray: manual ? undefined : "5 4" },
    markerEnd: { type: MarkerType.ArrowClosed, color },
  };
}

function toNodes(projects: GraphProject[]): ProjectNode[] {
  return projects.map((p, i) => ({
    id: String(p.id),
    type: "project",
    position: { x: p.x ?? (i % 3) * 340, y: p.y ?? Math.floor(i / 3) * 300 },
    data: { name: p.name, status: p.status, progress: p.progress, health: p.health, counts: p.counts, running: p.running, stack: p.stack, features: p.features, more: p.more },
  }));
}

export function GraphCanvas({ projects, links }: { projects: GraphProject[]; links: Link[] }) {
  const router = useRouter();
  const ids = useMemo(() => new Set(projects.map((p) => String(p.id))), [projects]);
  const visibleLinks = useMemo(() => links.filter((l) => ids.has(String(l.fromId)) && ids.has(String(l.toId))), [links, ids]);
  const [nodes, setNodes, onNodesChange] = useNodesState<ProjectNode>(toNodes(projects));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(visibleLinks.map(toEdge));
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);

  useEffect(() => setNodes(toNodes(projects)), [projects, setNodes]);
  useEffect(() => setEdges(visibleLinks.map(toEdge)), [visibleLinks, setEdges]);

  const onConnect = useCallback(
    async (c: Connection) => {
      // Dragging from A's right dot to B's left dot means "B depends on / uses A".
      if (!c.source || !c.target || c.source === c.target) return;
      await addLink(Number(c.target), Number(c.source));
      router.refresh();
    },
    [router],
  );

  const removeEdges = useCallback(
    async (edgeIds: string[]) => {
      if (!edgeIds.length) return;
      await deleteLinks(edgeIds.map(Number));
      setSelectedEdges([]);
      router.refresh();
    },
    [router],
  );

  // Must be stable: React Flow re-fires selection callbacks whose identity changes.
  const onSelectionChange = useCallback(({ edges: es }: { edges: Edge[] }) => {
    const sel = es.filter((e) => e.deletable !== false).map((e) => e.id);
    setSelectedEdges((cur) => (cur.length === sel.length && cur.every((id, i) => id === sel[i]) ? cur : sel));
  }, []);

  return (
    <div className="relative flex-1" style={{ height: "calc(100vh - 3rem)" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={(es) => removeEdges(es.map((e) => e.id))}
        onSelectionChange={onSelectionChange}
        onNodeClick={(_, n) => router.push(`/projects/${n.id}`)}
        onNodeDragStop={(_, n) => setGraphPosition(Number(n.id), n.position.x, n.position.y)}
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#27272a" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(n) => STATUS_HEX[(n.data as NodeData).status]} maskColor="rgba(9,9,11,0.7)" style={{ background: "#111114" }} />
      </ReactFlow>

      <div className="pointer-events-none absolute right-4 top-4 max-w-xs rounded-lg border border-[var(--border)] bg-[var(--panel)]/90 p-3 text-xs text-zinc-400 backdrop-blur">
        <p className="mb-1 font-medium text-zinc-200">Project map</p>
        <p>Each card shows what’s built (green), in review (amber), in progress (blue) and planned (grey).</p>
        <p className="mt-1">
          <span className="text-indigo-300">Solid arrows</span> are connections you added. <span className="text-zinc-300">Dashed arrows</span> are detected: one repo mentions the other.
        </p>
        <p className="mt-1">Drag from a card’s right dot to another’s left dot to connect them. Select a solid arrow and press Delete to remove it.</p>
      </div>

      {selectedEdges.length > 0 && (
        <button
          type="button"
          onClick={() => removeEdges(selectedEdges)}
          className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg hover:bg-rose-500"
        >
          <Trash2 size={14} /> Remove {selectedEdges.length} connection{selectedEdges.length > 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}
