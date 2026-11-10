import fs from "node:fs";
import path from "node:path";
import { eq, max } from "drizzle-orm";
import { db, schema } from "@/db";
import { git, gitSummary, remoteUrl } from "./git";

const { projects, links } = schema;

/** Folder holding the repos. Defaults to the parent of this app (C:\Projects). */
export const PROJECTS_ROOT = process.env.CC_PROJECTS_ROOT ?? path.dirname(process.cwd());

const STACK_RULES: [string, string][] = [
  ["next", "Next.js"],
  ["vite", "Vite"],
  ["react", "React"],
  ["typescript", "TypeScript"],
  ["tailwindcss", "Tailwind"],
  ["drizzle-orm", "Drizzle"],
  ["@supabase/supabase-js", "Supabase"],
  ["postgres", "Postgres"],
  ["better-sqlite3", "SQLite"],
  ["dexie", "IndexedDB"],
  ["@anthropic-ai/sdk", "Claude API"],
  ["ai", "AI SDK"],
  ["leaflet", "Leaflet"],
  ["recharts", "Recharts"],
  ["@xyflow/react", "React Flow"],
  ["pdf-lib", "pdf-lib"],
  ["zod", "Zod"],
];

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function detectStack(dir: string): string[] {
  const pkg = readJson(path.join(dir, "package.json")) as { dependencies?: object; devDependencies?: object } | null;
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) } as Record<string, string>;
  let stack = STACK_RULES.filter(([dep]) => dep in deps).map(([, label]) => label);
  if (stack.includes("Next.js")) stack = stack.filter((s) => s !== "React"); // implied
  if (!Object.keys(deps).length && fs.existsSync(path.join(dir, "index.html"))) stack.push("HTML/CSS/JS");
  if (fs.existsSync(path.join(dir, "pyproject.toml")) || fs.existsSync(path.join(dir, "requirements.txt"))) stack.push("Python");
  if (fs.existsSync(path.join(dir, ".vercel"))) stack.push("Vercel");
  if (fs.existsSync(path.join(dir, ".github", "workflows"))) stack.push("GitHub Actions");
  return stack;
}

/** Title (first H1) and first prose paragraph of the README. */
export function readmeInfo(dir: string): { title: string | null; description: string } {
  let text = "";
  for (const f of ["README.md", "readme.md", "Readme.md"]) {
    try {
      text = fs.readFileSync(path.join(dir, f), "utf8");
      break;
    } catch {}
  }
  if (!text) return { title: null, description: "" };
  const title = text.match(/^#\s+(.+)$/m)?.[1].trim() ?? null;
  const para = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .find((b) => b && !b.startsWith("#") && !b.startsWith("![") && !b.startsWith("[![") && !b.startsWith("```") && !b.startsWith("|") && !b.startsWith("<"));
  const description = (para ?? "").replace(/\r?\n/g, " ").replace(/\*\*/g, "").slice(0, 320);
  return { title, description };
}

function listRepos(): { slug: string; dir: string }[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_") && e.name !== "node_modules")
    .map((e) => ({ slug: e.name, dir: path.join(PROJECTS_ROOT, e.name) }))
    .filter((r) => fs.existsSync(path.join(r.dir, ".git")));
}

const g = globalThis as unknown as { __ccSync?: Promise<{ added: number; total: number }> | null };

/** Find repos under the root, upsert them, flag missing ones, and refresh auto-detected connections. Single-flight. */
export function syncProjects(): Promise<{ added: number; total: number }> {
  if (!g.__ccSync) g.__ccSync = doSync().finally(() => (g.__ccSync = null));
  return g.__ccSync;
}

async function doSync(): Promise<{ added: number; total: number }> {
  const repos = listRepos();
  const existing = new Map(db.select().from(projects).all().map((p) => [p.slug, p]));
  let nextOrder = (db.select({ m: max(projects.sortOrder) }).from(projects).get()?.m ?? -1) + 1;
  let added = 0;

  for (const r of repos) {
    const [summary, remote] = await Promise.all([gitSummary(r.dir), remoteUrl(r.dir)]);
    const stack = detectStack(r.dir);
    const { title, description } = readmeInfo(r.dir);
    const prev = existing.get(r.slug);
    if (prev) {
      db.update(projects)
        .set({ path: r.dir, stack, remoteUrl: remote, missing: false, description: prev.description || description })
        .where(eq(projects.id, prev.id))
        .run();
    } else {
      const now = new Date();
      db.insert(projects)
        .values({
          slug: r.slug,
          name: title ?? r.slug,
          path: r.dir,
          description,
          stack,
          remoteUrl: remote,
          sortOrder: nextOrder++,
          lastActivity: summary.lastCommitAt ? new Date(summary.lastCommitAt) : now,
          createdAt: now,
        })
        .onConflictDoNothing({ target: projects.slug })
        .run();
      added++;
    }
  }
  const found = new Set(repos.map((r) => r.slug));
  for (const p of existing.values()) {
    if (!found.has(p.slug)) db.update(projects).set({ missing: true }).where(eq(projects.id, p.id)).run();
  }

  await refreshAutoLinks();
  return { added, total: repos.length };
}

/** A repo "mentions" another when its tracked files contain the other's folder or GitHub repo name. */
async function refreshAutoLinks() {
  const all = db.select().from(projects).where(eq(projects.missing, false)).all();
  const terms = new Map(
    all.map((p) => {
      const repoName = p.remoteUrl?.split("/").pop();
      return [p.id, [...new Set([p.slug, repoName].filter((t): t is string => Boolean(t && t.length >= 5)))]];
    }),
  );
  const found: { fromId: number; toId: number; files: number }[] = [];
  await Promise.all(
    all.flatMap((a) =>
      all
        .filter((b) => b.id !== a.id)
        .map(async (b) => {
          const args = ["grep", "-I", "-l", "-i", "-F"];
          for (const t of terms.get(b.id) ?? []) args.push("-e", t);
          args.push("--", ".", ":(exclude)package-lock.json", ":(exclude)*.lock", ":(exclude)**/node_modules/**");
          const out = await git(a.path, args);
          const files = out.split("\n").filter(Boolean).length;
          if (files) found.push({ fromId: a.id, toId: b.id, files });
        }),
    ),
  );
  db.transaction((tx) => {
    tx.delete(links).where(eq(links.kind, "auto")).run();
    const manual = tx.select().from(links).all();
    for (const f of found) {
      if (manual.some((m) => m.fromId === f.fromId && m.toId === f.toId)) continue;
      tx.insert(links).values({ fromId: f.fromId, toId: f.toId, kind: "auto", label: `mentions (${f.files} file${f.files > 1 ? "s" : ""})` }).run();
    }
  });
}
