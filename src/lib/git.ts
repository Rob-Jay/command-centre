import { execFile } from "node:child_process";

/** Run git in `cwd`. Resolves stdout ("" on failure unless `strict`). */
export function git(cwd: string, args: string[], opts: { strict?: boolean; timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", "core.quotepath=off", ...args],
      { cwd, timeout: opts.timeoutMs ?? 15_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          if (opts.strict) reject(new Error(stderr.trim() || err.message));
          else resolve("");
        } else resolve(stdout);
      },
    );
  });
}

export type GitSummary = {
  isRepo: boolean;
  branch: string;
  lastCommitAt: number | null; // ms
  lastCommitMsg: string;
  commitCount: number;
  dirty: number;
  agentBranches: string[]; // unmerged agent/* branches
};

export async function gitSummary(path: string): Promise<GitSummary> {
  const [log, count, status, branches] = await Promise.all([
    git(path, ["log", "-1", "--format=%ct%x1f%s"]),
    git(path, ["rev-list", "--count", "HEAD"]),
    git(path, ["status", "--porcelain=v1", "-b"]),
    // Only agent branches not yet merged into the current branch: work still waiting for review.
    git(path, ["branch", "--list", "agent/*", "--no-merged", "HEAD", "--format=%(refname:short)"]),
  ]);
  const [ct, msg] = log.trim().split("\x1f");
  const statusLines = status.split("\n").filter(Boolean);
  const head = statusLines[0]?.startsWith("## ") ? statusLines[0].slice(3) : "";
  return {
    isRepo: Boolean(head || log),
    branch: head.split("...")[0].replace(/^No commits yet on /, "") || "(detached)",
    lastCommitAt: ct ? Number(ct) * 1000 : null,
    lastCommitMsg: msg ?? "",
    commitCount: Number(count.trim()) || 0,
    dirty: statusLines.filter((l) => !l.startsWith("## ")).length,
    agentBranches: branches.split("\n").map((b) => b.trim()).filter(Boolean),
  };
}

export type Commit = { sha: string; at: number; author: string; subject: string; branch?: string };

export async function recentCommits(path: string, n = 10, ref = "HEAD"): Promise<Commit[]> {
  const out = await git(path, ["log", ref, `-${n}`, "--format=%h%x1f%ct%x1f%an%x1f%s"]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, ct, author, subject] = l.split("\x1f");
      return { sha, at: Number(ct) * 1000, author, subject };
    });
}

/** Commit timestamps (ms) across all local branches since `days` ago. */
export async function commitTimes(path: string, days: number): Promise<number[]> {
  const out = await git(path, ["log", "--all", `--since=${days}.days`, "--format=%ct"]);
  return out.split("\n").filter(Boolean).map((s) => Number(s) * 1000);
}

export async function remoteUrl(path: string): Promise<string | null> {
  const url = (await git(path, ["remote", "get-url", "origin"])).trim();
  if (!url) return null;
  // Strip any credentials and normalise SSH remotes to https for linking.
  return url
    .replace(/^https:\/\/[^@/]+@/, "https://")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "");
}

export async function headSha(path: string): Promise<string> {
  return (await git(path, ["rev-parse", "HEAD"], { strict: true })).trim();
}

export async function branchExists(path: string, branch: string): Promise<boolean> {
  return (await git(path, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).trim().length > 0;
}

/** Branches whose tip is already contained in the current HEAD of the main checkout. */
export async function mergedBranches(path: string): Promise<Set<string>> {
  const out = await git(path, ["branch", "--merged", "HEAD", "--format=%(refname:short)"]);
  return new Set(out.split("\n").map((b) => b.trim()).filter(Boolean));
}

export type DiffStat = { files: number; insertions: number; deletions: number };

export async function diffStat(path: string, from: string, to: string): Promise<DiffStat> {
  const out = await git(path, ["diff", "--numstat", `${from}..${to}`]);
  const rows = out.split("\n").filter(Boolean);
  let insertions = 0;
  let deletions = 0;
  for (const r of rows) {
    const [a, d] = r.split("\t");
    insertions += Number(a) || 0;
    deletions += Number(d) || 0;
  }
  return { files: rows.length, insertions, deletions };
}

export async function diffText(path: string, from: string, to: string, maxChars = 400_000): Promise<string> {
  const out = await git(path, ["diff", "--no-color", `${from}..${to}`]);
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n\n… diff truncated (${out.length.toLocaleString()} chars total)` : out;
}
