#!/usr/bin/env bun
// Claude Code's PostToolUse hook (matcher Bash), registered per repo: after a command that pushed or edited a PR, it
// shows the work-on-code gate on the PR as two commit statuses on its head (gate.md): `<prefix>/debt-verdict`, the
// gate's rule on its debt verdict at that moment, and `<prefix>/check`, whether the repo's `bun run check` passed on
// that tree (recorded by the pre-push hook in `<git dir>/check-passed`; only in repos with a `check` script).
// Display only: the gate stays the PreToolUse hook. Never fails the command: every error is silent.
//   bun pr-status.ts <prefix>   (the tool call on stdin)
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaults, gitCall, PR_FIELDS, type Pr, run, verdictOf, walk } from "./gate";

/** A PR a command touched: its folder, and its repo and number when the command named them (else the branch's PR). */
type Target = { dir: string; repo?: string; number?: string };

const PR_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/;

/** The PRs a script pushed or edited, in order; a push of tags only, a deletion or a dry run is none. */
export function touched(script: string, from: string) {
  const hits: Target[] = [];
  for (const { w, cwd } of walk(script, from)) {
    const git = gitCall(w, cwd);
    if (git?.args[0] === "push") {
      if (!git.args.some((a) => ["--dry-run", "-n", "--tags", "--delete", "-d"].includes(a))) {
        hits.push({ dir: git.dir });
      }
    } else if (w[0] === "gh" && w[1] === "pr" && ["create", "edit", "ready"].includes(w[2] ?? "")) {
      const r = w.findIndex((a) => a === "-R" || a === "--repo");
      const repo = r >= 0 ? w[r + 1] : w.find((a) => a.startsWith("--repo="))?.slice(7);
      const arg = w[2] === "create" ? undefined : w[3];
      const url = PR_URL.exec(arg ?? "");
      if (url) {
        hits.push({ dir: cwd, repo: url[1], number: url[2] });
      } else if (/^\d+$/.test(arg ?? "")) {
        hits.push({ dir: cwd, repo, number: arg });
      } else if (!repo) {
        hits.push({ dir: cwd }); // the branch's PR (a number after a flag is read as this too)
      }
    } else if (w[0] === "gh" && w[1] === "api" && w.some((a) => /^PATCH$/i.test(a))) {
      // The documented fallback for writing the verdict: `gh api -X PATCH repos/{owner}/{repo}/pulls/<n>`.
      const m = w.map((a) => /^\/?repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(a)).find(Boolean);
      if (m) {
        hits.push({ dir: cwd, repo: m[1]?.includes("{") ? undefined : m[1], number: m[2] });
      }
    }
  }
  return hits;
}

/** The GitHub owner each prefix may post on: statuses go only on repos we own, never on a client's own repo. */
const OWNERS: Record<string, string> = { mad: "MAD-repos" };

export const owned = (prefix: string, repo: string) =>
  repo.split("/")[0]?.toLowerCase() === OWNERS[prefix]?.toLowerCase();

function post(prefix: string, t: Target) {
  const top = run(t.dir, ["git", "rev-parse", "--show-toplevel"]);
  if (!top) {
    return;
  }
  const origin = run(top, ["git", "remote", "get-url", "origin"])?.replace(/\.git$/, "").toLowerCase() ?? "";
  const ours = (repo: string) => origin.endsWith(`github.com/${repo}`.toLowerCase()) || origin.endsWith(`:${repo}`.toLowerCase());
  if (t.repo && !ours(t.repo)) {
    return; // another repo's PR: not this hook's to show
  }
  const head = run(top, ["git", "rev-parse", "HEAD"]);
  const branch = run(top, ["git", "symbolic-ref", "--short", "-q", "HEAD"]);
  if (!(t.number || (branch && !defaults(top).includes(branch)))) {
    return; // no PR on the default branch or a detached head: fast and silent
  }
  const json = run(top, ["gh", "pr", "view", ...(t.number ? [t.number] : []), "--json", `${PR_FIELDS},state`]);
  if (!json) {
    return;
  }
  const pr = JSON.parse(json) as Pr & { state: string };
  const repo = pr.url.replace(/^https:\/\/github\.com\//, "").replace(/\/pull\/\d+$/, "");
  // The branch's PR counts only when this checkout holds its pushed head (a push of another ref says nothing of it).
  if (pr.state !== "OPEN" || !ours(repo) || !owned(prefix, repo) || (!t.number && head !== pr.headRefOid)) {
    return;
  }
  const status = (context: string, state: string, why: string) =>
    run(top, [
      "gh", "api", `repos/${repo}/statuses/${pr.headRefOid}`,
      "-f", `state=${state}`, "-f", `context=${prefix}/${context}`,
      "-f", `description=${why.length > 140 ? `${why.slice(0, 139)}…` : why}`, "-f", `target_url=${pr.url}`,
    ]);
  // This checkout is the PR's repo, as for `gh pr merge` run here; a refusal without its how-to.
  const verdict = verdictOf(top, pr, true);
  const why = verdict.why.replace(pr.url, "this PR");
  status("debt-verdict", verdict.state, verdict.state === "success" ? why : (why.split(/(?<=\.) /)[0] as string));
  // The check speaks for the head only from its clean checkout, the tree the pre-push hook saw pass.
  const pkg = join(top, "package.json");
  const clean = head === pr.headRefOid && run(top, ["git", "status", "--porcelain", "--untracked-files=normal"]) === "";
  if (!(clean && existsSync(pkg) && JSON.parse(readFileSync(pkg, "utf8")).scripts?.check)) {
    return;
  }
  const record = resolve(top, run(top, ["git", "rev-parse", "--git-dir"]) ?? ".git", "check-passed");
  const tree = run(top, ["git", "rev-parse", `${pr.headRefOid}^{tree}`]);
  const passed = tree !== null && existsSync(record) && readFileSync(record, "utf8").trim() === tree;
  status(
    "check",
    passed ? "success" : "pending",
    passed ? "bun run check passed on this head" : "bun run check has not passed on this head (it runs before each push)"
  );
}

if (import.meta.main) {
  try {
    const input = JSON.parse((await Bun.stdin.text()) || "{}");
    const script = input.tool_input?.command;
    const prefix = process.argv[2];
    if (prefix && typeof script === "string") {
      const seen = new Set<string>();
      for (const t of touched(script, input.cwd ?? process.cwd())) {
        const key = JSON.stringify(t);
        if (!seen.has(key)) {
          seen.add(key);
          post(prefix, t);
        }
      }
    }
  } catch {
    // A status is display only: never in the way of the command.
  }
  process.exit(0);
}
