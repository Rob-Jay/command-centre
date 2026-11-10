# Project Command Centre

A local dashboard over the code projects in `C:\Projects`, with Claude Code built in: see what each repo does and how far along it is, chat with Claude about the code, and have Claude Code implement features on their own branches while you watch.

Next.js 16 (App Router) · TypeScript · Tailwind 4 · SQLite (better-sqlite3 + Drizzle) · React Flow · Claude Code CLI.

## Setup

```bash
npm install
npm run dev       # http://localhost:3000
```

Needs `git` and the [Claude Code CLI](https://code.claude.com) (`claude`) on your PATH, logged in. All AI features run through Claude Code, so they use your Claude Code login; no API key is needed.

Optional settings in `.env.local`:

| Variable | Default | Purpose |
|---|---|---|
| `CC_PROJECTS_ROOT` | parent folder of this app | Folder whose git repos are tracked |
| `CLAUDE_BIN` | `claude` | Path to the Claude Code CLI |
| `CC_USE_API_KEY` | off | Set to `1` to let child sessions use `ANTHROPIC_API_KEY` instead of your Claude Code login |

## What it does

| View | |
|---|---|
| **Dashboard** `/` | Every git repo under the projects folder (auto-discovered; **Sync repos** to refresh): status, health, feature progress, last commit, branch, uncommitted changes, unmerged agent branches, detected stack. Drag to reorder; filter by status or tech. |
| **Project** `/projects/:id` | Description, next action, **feature map**, git history, connections, notes. Right side: **Chat** and **Claude Code runs**. |
| **Graph** `/graph` | Every project as a card with its feature map. Solid arrows are connections you draw; dashed arrows are detected (one repo mentions another). |
| **Activity** `/activity` | 12-week commit heatmap per repo with Claude runs marked, plus a feed of recent commits and runs. |
| **Ctrl/Cmd+K** | Jump to a project, or ask Claude a question across all projects. |

### Feature map
**Scan repo with Claude** runs a read-only Claude Code session that reads the README, docs, routes, components and git log, then drafts features as *built*, *in progress* or *planned*. Rescans keep your manual features and anything Claude is working on. You can edit, add or delete features by hand.

### Implement
**Implement** on a feature, or **New task**, starts a Claude Code run:
- It runs in a **separate git worktree** (`data/worktrees/…`) on a new `agent/<task>-<id>` branch, so your checkout and uncommitted work are never touched. `node_modules` is linked from the main checkout, and `/node_modules` is added to the repo's `.git/info/exclude` so the link is never committed.
- Permissions: Claude may edit files and run `npm`, `npx`, `node`, `git` and basic read commands. It can't push, merge, rebase, change remotes or run anything else; any other action is denied automatically.
- Progress streams into the **Runs** tab (messages, files touched, commands, errors). Claude commits its work on the branch; anything left uncommitted is committed for it.
- The feature moves to **Review**. Use **View diff**, **Open worktree**, then merge it yourself (**Copy merge command**). Once the branch is merged into your checkout, the feature becomes **Built** automatically. **Discard** deletes the branch and worktree.

### Chat
A read-only Claude Code session in the repo (it can read files and git history), resumed across messages. **Update from chat** proposes status, next-action and feature changes for you to approve. Under any reply: **Save as note** or **Add as features**.

Cost for every chat, scan and run (as reported by Claude Code) is added to the project's usage counter.

## Data

SQLite at `data/cc.db`, plus agent worktrees in `data/worktrees/` (all git-ignored). Tables: `projects`, `features`, `runs`, `run_events`, `messages`, `notes`, `links`. Migrations in `drizzle/` run automatically on startup; after editing `src/db/schema.ts`, run `npm run db:generate`.
