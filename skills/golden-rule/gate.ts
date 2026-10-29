#!/usr/bin/env bun
// The golden-rule gate: a PreToolUse hook for Claude Code and Codex, and (`gate.ts pre-push`) git's pre-push hook for any
// harness (SKILL.md, "The gate"). As a tool hook it reads the tool call on
// stdin and refuses (exit 2, the reason on stderr) a plan with no golden-rule plan section, a merge whose PR carries no
// passing golden-rule verdict of its current head, and a push of code to a repository's default branch (a data-only
// push, a job's report or log, goes through). Every other call passes untouched. Parsing shell text cannot catch every bypass; it stops the ordinary ways of merging.
import { resolve } from "node:path";

/** A command's output, or null when it fails or cannot start (e.g. a folder an earlier part of the command creates). */
const run = (cwd: string, cmd: string[]) => {
  try {
    const p = Bun.spawnSync(cmd, { cwd, stderr: "pipe", stdout: "pipe" });
    return p.exitCode === 0 ? p.stdout.toString().trim() : null;
  } catch {
    return null;
  }
};

/** A refusal: why, and what to do instead. */
function deny(why: string): never {
  console.error(`golden-rule gate: ${why}`);
  process.exit(2);
}

/**
 * The simple commands of a script: split on ; && || | & and newlines outside quotes, as words with quotes removed.
 * A heredoc's body is text, not commands, and is skipped.
 */
export function commands(script: string) {
  const out: string[][] = [];
  let words: string[] = [];
  let word = "";
  let quote = "";
  let started = false;
  let heredoc = "";
  const endWord = () => {
    if (started) {
      words.push(word);
    }
    word = "";
    started = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) {
      out.push(words);
    }
    words = [];
  };
  for (let i = 0; i < script.length; i += 1) {
    const c = script[i] as string;
    if (quote) {
      if (c === quote) {
        quote = "";
      } else {
        word += c;
      }
    } else if (c === "<" && script[i + 1] === "<" && script[i + 2] !== "<") {
      const m = script.slice(i + 2).match(/^-?\s*(['"]?)([A-Za-z_][\w-]*)\1/);
      heredoc = m?.[2] ?? "";
      i += 1 + (m?.[0].length ?? 0);
    } else if (c === "\n" && heredoc) {
      // Skip the body up to the line holding only the delimiter.
      endCommand();
      const lines = script.slice(i + 1).split("\n");
      const end = lines.findIndex((l) => l.trim() === heredoc);
      i = end < 0 ? script.length : i + 1 + lines.slice(0, end + 1).join("\n").length;
      heredoc = "";
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (c === " " || c === "\t") {
      endWord();
    } else if (c === "&" && (script[i - 1] === ">" || script[i - 1] === "<" || script[i + 1] === ">")) {
      word += c; // part of a redirection (2>&1, &>), not a separator
      started = true;
    } else if (c === ";" || c === "\n" || c === "|" || c === "&") {
      endCommand();
    } else {
      word += c;
      started = true;
    }
  }
  endCommand();
  return out;
}

const REDIRECT = /^(\d*|&)(>>?|<<?|>&|<&)(.*)$/;

/** A command's words from the program on: no redirections, and no `env`, `VAR=x`, `command`, `exec`, `time`, `nohup` in front. */
function program(all: string[]) {
  const w = all.filter((x, i) => !(REDIRECT.test(x) || REDIRECT.exec(all[i - 1] ?? "")?.[3] === ""));
  let i = 0;
  while (
    w[i] !== undefined &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i] as string) ||
      ["env", "command", "exec", "time", "nohup"].includes(w[i] as string))
  ) {
    i += 1;
  }
  return w.slice(i);
}

/** The default branch of the repo at `dir` (the remote's HEAD), or main and master when it cannot be read. */
function defaults(dir: string, remote = "origin") {
  const head = run(dir, ["git", "symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`]);
  return head ? [head.replace(/^[^/]+\//, "")] : ["main", "master"];
}

/**
 * Not functional code, so not gated: documentation, memory and data (what routines add: notes, recaps, logs, ledgers).
 * Agent instructions are functional (they steer agents), so they stay gated wherever they live.
 */
const DOC = /\.(md|mdx|txt|csv|jsonl|log)$/;
const DATA_DIR = /^(docs|memory|data|reports)\//;
const SCRIPT = /\.(ts|tsx|js|jsx|mjs|cjs|py|sh|rb|go|rs|swift|kt|sql)$/;
const INSTRUCTIONS = /(^|\/)(AGENTS|CLAUDE|SKILL)\.md$|(^|\/)(prompts|\.claude|\.agents|\.cursor)\/|(^|\/)docs\/agents\//;
export const isData = (path: string) =>
  !INSTRUCTIONS.test(path) && (DOC.test(path) || (DATA_DIR.test(path) && !SCRIPT.test(path)));

/** The files the commits of `range` (by default those of `src` not yet on origin) change that are not data. */
function codeIn(dir: string, src: string, range = [src, "--not", "--remotes=origin"]) {
  const files = run(dir, ["git", "log", "--format=", "--name-only", ...range]);
  if (files === null) {
    return ["(could not list the commits being pushed)"];
  }
  return [...new Set(files.split("\n").filter(Boolean))].filter((f) => !isData(f));
}

function checkPush(dir: string, args: string[]) {
  const opts = args.filter((a) => a.startsWith("-"));
  if (opts.includes("--dry-run") || opts.includes("-n")) {
    return;
  }
  if (opts.some((o) => o === "--all" || o === "--mirror")) {
    deny("push --all/--mirror would push the default branch. Push your branch alone.");
  }
  const [, ...refspecs] = args.filter((a) => !a.startsWith("-"));
  if (refspecs.length === 0 && opts.includes("--tags")) {
    return; // tags only
  }
  const protectedBranches = defaults(dir);
  const current = run(dir, ["git", "rev-parse", "--abbrev-ref", "HEAD"]);
  if (current === null && refspecs.length === 0) {
    deny("cannot tell which branch this push targets (its folder does not exist yet). Run the push as its own command.");
  }
  for (const spec of refspecs.length === 0 ? [current] : refspecs) {
    const [from = "", to = from] = spec.replace(/^\+/, "").split(":");
    const dst = to.replace(/^refs\/heads\//, "");
    const branch = dst === "HEAD" || dst === "" ? (current ?? "") : dst;
    if (!protectedBranches.includes(branch)) {
      continue;
    }
    // A data-only push (a job's report, log or recap) goes straight to the default branch; code goes through a PR.
    refuseCode(branch, codeIn(dir, from === "" || refspecs.length === 0 ? "HEAD" : from));
  }
}

function refuseCode(branch: string, code: string[]) {
  if (code.length > 0) {
    deny(
      `pushing code to ${branch}, the default branch, is not allowed (${code.slice(0, 5).join(", ")}${code.length > 5 ? ", …" : ""}). Push a branch, open a PR, run golden-rule-verdict, then merge with gh pr merge. Docs, memory and data (not agent instructions) may go straight to ${branch}.`
    );
  }
}

/**
 * git's pre-push hook, whatever harness pushes: `remote` is its first argument (a name, or a URL for an unnamed push),
 * `lines` its stdin, `<local ref> <local sha> <remote ref> <remote sha>` per ref. Code to the default branch is refused as
 * `checkPush` refuses it; tags, deletions and other branches pass.
 */
export function checkPrePush(dir: string, remote: string, lines: string) {
  const named = !/[/:]/.test(remote);
  const protectedBranches = defaults(dir, named ? remote : "origin");
  for (const line of lines.split("\n").filter(Boolean)) {
    const [, local = "", ref = "", remoteSha = ""] = line.split(" ");
    const branch = ref.replace(/^refs\/heads\//, "");
    if (/^0+$/.test(local) || branch === ref || !protectedBranches.includes(branch)) {
      continue;
    }
    const range = /^0+$/.test(remoteSha) ? [local, "--not", named ? `--remotes=${remote}` : "--remotes"] : [`${remoteSha}..${local}`];
    refuseCode(branch, codeIn(dir, local, range));
  }
}

/** `gh` flags that take a value, so the value is not mistaken for the PR. */
const VALUED = new Set([
  "-R",
  "--repo",
  "-t",
  "--subject",
  "-b",
  "--body",
  "-F",
  "--body-file",
  "-A",
  "--author-email",
  "--match-head-commit",
]);

function checkMerge(dir: string, args: string[], repoFlag: string[]) {
  const positional: string[] = [];
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] as string;
    const eq = a.indexOf("=");
    const flag = eq > 0 ? a.slice(0, eq) : a;
    if (VALUED.has(flag)) {
      values.set(flag, eq > 0 ? a.slice(eq + 1) : (args[i + 1] ?? ""));
      i += eq > 0 ? 0 : 1;
    } else if (!a.startsWith("-")) {
      positional.push(a);
    }
  }
  if (positional.length > 1) {
    deny(`more than one PR named (${positional.join(", ")}); merge one PR at a time.`);
  }
  const repo = values.get("-R") ?? values.get("--repo");
  const json = run(dir, [
    "gh",
    "pr",
    "view",
    ...positional,
    ...(repo ? ["-R", repo] : repoFlag),
    "--json",
    "baseRefName,body,files,headRefOid,url",
  ]);
  if (!json) {
    deny("could not read the PR to check its golden-rule verdict (gh pr view failed: offline, not signed in, or no PR).");
  }
  const pr = JSON.parse(json) as {
    baseRefName: string;
    body: string | null;
    files: { path: string }[];
    headRefOid: string;
    url: string;
  };
  if (pr.files.length > 0 && pr.files.every((f) => isData(f.path))) {
    return; // documentation, memory or data only: nothing functional to review
  }
  const section = (pr.body ?? "").split(/^## Golden rule verdict\s*$/m)[1] ?? "";
  const reviewed = section.match(/^Reviewed:\s*`?([0-9a-f]{7,40})/m)?.[1];
  const verdict = section.match(/^Verdict:\s*(.+)$/m)?.[1]?.trim();
  if (!(reviewed && verdict)) {
    deny(
      `${pr.url} has no golden-rule verdict. Run golden-rule-verdict: a fresh reviewer, its findings applied, and its verdict written into the PR as "## Golden rule verdict" with "Reviewed: <head sha>".`
    );
  }
  if (/rework needed/i.test(verdict)) {
    deny(`${pr.url}'s golden-rule verdict says "rework needed". Do the rework (here or as its own PR) and review again.`);
  }
  if (!pr.headRefOid.startsWith(reviewed)) {
    deny(
      `${pr.url}'s golden-rule verdict is for ${reviewed.slice(0, 12)}, but the PR's head is now ${pr.headRefOid.slice(0, 12)}. Review the new commits (golden-rule-verdict) and update the verdict.`
    );
  }
  // The base moved since the review: the merge result was never checked or reviewed.
  const repoPath = pr.url.replace(/^https:\/\/github\.com\//, "").replace(/\/pull\/\d+$/, "");
  const behind = run(dir, [
    "gh", "api", `repos/${repoPath}/compare/${pr.baseRefName}...${pr.headRefOid}`, "-q", ".behind_by",
  ]);
  if (behind === null || Number(behind) > 0) {
    deny(
      `${pr.url} is ${behind ?? "maybe"} commit(s) behind ${pr.baseRefName}: merge origin/${pr.baseRefName} into the branch, run the check, a full verdict again (golden-rule-verdict), then merge.`
    );
  }
  const pinned = values.get("--match-head-commit");
  if (args.includes("--auto") && !(pinned && pr.headRefOid.startsWith(pinned))) {
    deny(`gh pr merge --auto would merge commits pushed after the review. Add --match-head-commit ${pr.headRefOid}.`);
  }
}

/** One simple command at a time, following `cd`; `sh -c "<script>"` is checked as its own script. */
function check(script: string, from: string) {
  let cwd = from;
  for (const w of commands(script).map(program)) {
    const [cmd, ...args] = w;
    if (cmd === "cd" && args[0]) {
      cwd = resolve(cwd, args[0].replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
    } else if (["sh", "bash", "zsh"].includes(cmd ?? "")) {
      const c = args.findIndex((a) => /^-\w*c$/.test(a));
      if (c >= 0) {
        check(args[c + 1] ?? "", cwd);
      }
    } else if (cmd === "git") {
      let i = 0;
      let dir = cwd;
      while (args[i]?.startsWith("-")) {
        if (["-C", "-c", "--git-dir", "--work-tree"].includes(args[i] as string) && args[i + 1]) {
          if (args[i] === "-C") {
            dir = resolve(cwd, args[i + 1] as string);
          }
          i += 1;
        }
        i += 1;
      }
      if (args[i] === "push") {
        checkPush(dir, args.slice(i + 1));
      }
    } else if (cmd === "gh") {
      const p = args.indexOf("pr");
      const before = args.slice(0, Math.max(p, 0));
      const r = before.findIndex((a) => a === "-R" || a === "--repo");
      if (p >= 0 && args[p + 1] === "merge") {
        checkMerge(cwd, args.slice(p + 2), r >= 0 ? ["-R", before[r + 1] ?? ""] : []);
      } else if (
        args[0] === "api" &&
        args.some((x) => /pulls\/\d+\/merge|mergePullRequest|enablePullRequestAutoMerge/.test(x))
      ) {
        deny("merge through `gh pr merge`, so the golden-rule verdict can be checked.");
      }
    }
  }
}

if (import.meta.main && process.argv[2] === "pre-push") {
  try {
    checkPrePush(process.cwd(), process.argv[3] ?? "origin", await Bun.stdin.text());
  } catch (e) {
    deny(`could not check this push (${(e as Error).message}).`);
  }
} else if (import.meta.main) {
  try {
    const input = JSON.parse((await Bun.stdin.text()) || "{}");
    if (input.tool_name === "ExitPlanMode") {
      if (!/^#{1,6}\s*Golden[- ]rule plan\b/im.test(String(input.tool_input?.plan ?? ""))) {
        deny(
          'this plan has no "## Golden rule plan" section. Add it as the golden-rule-plan skill says.'
        );
      }
      process.exit(0);
    }
    const raw = input.tool_input?.command ?? input.tool_input?.cmd ?? "";
    // Codex sends argv, usually ["bash", "-lc", "<script>"].
    let script = String(raw);
    if (Array.isArray(raw)) {
      script =
        raw.length >= 3 && /^-\w*c$/.test(String(raw[1])) ? String(raw[2]) : raw.map(String).join(" ");
    }
    check(script, input.cwd ?? process.cwd());
  } catch (e) {
    // A gate that crashes must not let the command through.
    deny(`could not check this command (${(e as Error).message}).`);
  }
}
