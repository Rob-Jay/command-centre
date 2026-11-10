"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Network, Activity, Command } from "lucide-react";

const LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/graph", label: "Graph", icon: Network },
  { href: "/activity", label: "Activity", icon: Activity },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-[1600px] items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-100">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-indigo-500 to-sky-400 text-[11px] font-bold text-white">CC</span>
          Command Centre
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                <Icon size={15} />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("open-command-bar"))}
          className="ml-auto flex items-center gap-2 rounded-md border border-[var(--border)] bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
        >
          <span className="hidden sm:inline">Search or ask Claude…</span>
          <kbd className="flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px]">
            <Command size={10} />K
          </kbd>
        </button>
      </div>
    </header>
  );
}
