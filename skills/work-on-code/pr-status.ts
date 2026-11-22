#!/usr/bin/env bun
// Claude Code's PostToolUse hook (matcher Bash), registered per repo: after a command that pushed or edited a PR, it
// shows the work-on-code gate on the PR as two commit statuses on its head (gate.md): `<prefix>/debt-verdict`, the
// gate's rule on its debt verdict at that moment, and `<prefix>/check`, whether the repo's `bun run check` passed on
// that tree (recorded by the pre-push hook in `<git dir>/check-passed`; only in repos with a `check` script).
// Display only: the gate stays the PreToolUse hook. Never fails the command: every error is silent.
//   bun pr-status.ts <prefix>   (the tool call on stdin)
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaults, gitCall, PR_FIELDS, type Pr, verdictOf, walk } from "./gate";

const out = (cwd: string, cmd: string[]) => {
  const p = Bun.spawnSync(cmd, { cwd, stderr: "pipe", stdout: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString().trim() : null;
};

/** The folder and PR number (when named) of the last command in `script` that pushed or edited a PR of the folder's repo. */
export function touched(script: string, from: string) {
  let hit: { dir: string; pr: string[] } | null = null;
  for (const { w, cwd } of walk(script, from)) {
    const git = gitCall(w, cwd);
    if (git?.args[0] === "push" && !git.args.includes("--dry-run") && !git.args.includes("-n")) {
      hit = { dir: git.dir, pr: [] };
    } else if (w[0] === "gh" && w[1] === "pr" && ["create", "edit", "ready"].includes(w[2] ?? "")) {
      // Another repo's PR (-R) is not this hook's repo: skipped.
      if (!w.some((a) => a === "-R" || a.startsWith("--repo"))) {
        hit = { dir: cwd, pr: w[2] !== "create" && /^\d+$/.test(w[3] ?? "") ? [w[3] as string] : [] };
      }
    } else if (w[0] === "gh" && w[1] === "api" && w.some((a) => /^PATCH$/i.test(a)) && w.some((a) => /pulls\/\d+$/.test(a))) {
      const n = w.find((a) => /pulls\/\d+$/.test(a))?.match(/(\d+)$/)?.[1] as string;
      hit = { dir: cwd, pr: [n] }; // the documented fallback for writing the verdict; its repo is checked below
    }
  }
  return hit;
}

function post(prefix: string, dir: string, prArgs: string[]) {
  const top = out(dir, ["git", "rev-parse", "--show-toplevel"]);
  if (!top) {
    return;
  }
  const branch = out(top, ["git", "symbolic-ref", "--short", "-q", "HEAD"]);
  if (prArgs.length === 0 && (!branch || defaults(top).includes(branch))) {
    return; // no PR on the default branch or a detached head: fast and silent
  }
  const json = out(top, ["gh", "pr", "view", ...prArgs, "--json", `${PR_FIELDS},state`]);
  if (!json) {
    return;
  }
  const pr = JSON.parse(json) as Pr & { state: string };
  const repo = pr.url.replace(/^https:\/\/github\.com\//, "").replace(/\/pull\/\d+$/, "");
  const origin = out(top, ["git", "remote", "get-url", "origin"])?.replace(/\.git$/, "").toLowerCase() ?? "";
  const ours = origin.endsWith(`github.com/${repo}`.toLowerCase()) || origin.endsWith(`:${repo}`.toLowerCase());
  if (pr.state !== "OPEN" || !ours) {
    return;
  }
  // This checkout is the PR's pushed head, clean: its git and its check record speak for the PR.
  const local =
    out(top, ["git", "rev-parse", "HEAD"]) === pr.headRefOid &&
    out(top, ["git", "status", "--porcelain", "--untracked-files=normal"]) === "";
  const status = (context: string, state: string, why: string) =>
    out(top, [
      "gh", "api", `repos/${repo}/statuses/${pr.headRefOid}`,
      "-f", `state=${state}`, "-f", `context=${prefix}/${context}`,
      "-f", `description=${why.length > 140 ? `${why.slice(0, 139)}…` : why}`, "-f", `target_url=${pr.url}`,
    ]);
  const verdict = verdictOf(top, pr, local);
  status("debt-verdict", verdict.state, verdict.why.replace(`${pr.url}`, "this PR"));
  const pkg = join(top, "package.json");
  if (!(local && existsSync(pkg) && JSON.parse(readFileSync(pkg, "utf8")).scripts?.check)) {
    return;
  }
  const record = resolve(top, out(top, ["git", "rev-parse", "--git-dir"]) ?? ".git", "check-passed");
  const passed = existsSync(record) && readFileSync(record, "utf8").trim() === out(top, ["git", "rev-parse", "HEAD^{tree}"]);
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
    const hit = prefix && typeof script === "string" ? touched(script, input.cwd ?? process.cwd()) : null;
    if (hit) {
      post(prefix as string, hit.dir, hit.pr);
    }
  } catch {
    // A status is display only: never in the way of the command.
  }
  process.exit(0);
}
