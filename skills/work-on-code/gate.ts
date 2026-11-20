#!/usr/bin/env bun
// The work-on-code gate: a PreToolUse hook for Claude Code and Codex, and (`gate.ts pre-push`) git's pre-push hook for any
// harness (gate.md). As a tool hook it reads the tool call on
// stdin and refuses (exit 2, the reason on stderr) a plan with no debt plan section, a merge whose PR carries no
// passing debt verdict of its current head, and a push of code to a repository's default branch (a data-only
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
  console.error(`work-on-code gate: ${why}`);
  process.exit(2);
}

/**
 * The simple commands of a script: split on ; && || | & and newlines outside quotes, as words with quotes removed.
 * A heredoc's body is text, not commands, and is skipped. `stdin`: the command's input is not the caller's (an
 * unquoted `<` redirection, a heredoc or here-string, or a pipe into it).
 */
export function commands(script: string) {
  const out: (string[] & { stdin?: true })[] = [];
  let words: string[] & { stdin?: true } = [];
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
    } else if (c === "<" && script.startsWith("<<<", i)) {
      words.stdin = true; // a here-string; its word follows
      endWord();
      i += 2;
    } else if (c === "<" && script[i + 1] === "<") {
      const m = script.slice(i + 2).match(/^-?\s*(['"]?)([A-Za-z_][\w-]*)\1/);
      heredoc = m?.[2] ?? "";
      words.stdin = true;
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
      if (c === "|" && script[i - 1] !== "|" && script[i + 1] !== "|") {
        words.stdin = true; // piped into
      }
    } else {
      if (c === "<" && script[i + 1] !== "&" && !/^\d+$/.test(word.replace(/^0$/, ""))) {
        words.stdin = true; // `<f`, `0<f`, `x</dev/null`: an unquoted `<` (not `<&`, not `3<`) redirects stdin
      }
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
 * Agent instructions are functional (they steer agents), so they stay gated wherever they live. A repository holding
 * only data (a `.data-repo` file at its root) counts every non-script file as data, wherever it lives.
 */
const DOC = /\.(md|mdx|txt|csv|jsonl|log)$/;
const DATA_DIR = /^(docs|memory|data|reports)\//;
const SCRIPT = /\.(ts|tsx|js|jsx|mjs|cjs|py|sh|rb|go|rs|swift|kt|sql)$/;
const INSTRUCTIONS = /(^|\/)(AGENTS|CLAUDE|SKILL)\.md$|(^|\/)(prompts|\.claude|\.agents|\.cursor)\/|(^|\/)docs\/agents\//;
export const isData = (path: string, inDataRepo = false) =>
  !INSTRUCTIONS.test(path) && (DOC.test(path) || ((inDataRepo || DATA_DIR.test(path)) && !SCRIPT.test(path)));

/** Whether `base` (a default branch as its remote has it) carries `.data-repo`: committed and reviewed, never a stray local file. */
const dataRepo = (dir: string, base: string) => base !== "" && run(dir, ["git", "cat-file", "-e", `${base}:.data-repo`]) !== null;

/** The files the commits of `range` (by default those of `src` not yet on origin) change that are not data, as `base` decides it. */
function codeIn(dir: string, base: string, src: string, range = [src, "--not", "--remotes=origin"]) {
  const files = run(dir, ["git", "log", "--format=", "--name-only", ...range]);
  if (files === null) {
    return ["(could not list the commits being pushed)"];
  }
  const all = dataRepo(dir, base);
  return [...new Set(files.split("\n").filter(Boolean))].filter((f) => !isData(f, all));
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
    refuseCode(branch, codeIn(dir, `origin/${branch}`, from === "" || refspecs.length === 0 ? "HEAD" : from));
  }
}

function refuseCode(branch: string, code: string[]) {
  if (code.length > 0) {
    deny(
      `pushing code to ${branch}, the default branch, is not allowed (${code.slice(0, 5).join(", ")}${code.length > 5 ? ", …" : ""}). Push a branch, open a PR, run work-on-code, then merge with gh pr merge. Docs, memory and data (not agent instructions) may go straight to ${branch}.`
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
    refuseCode(branch, codeIn(dir, named ? `${remote}/${branch}` : "", local, range));
  }
}

/**
 * Whether a verdict of `reviewed` still holds at `head`: `head` holds exactly `reviewed` merged cleanly with `base`
 * (the same tree), and the base's commits since touch none of the files the reviewed PR changed (renames count as
 * both paths). Read from local git; anything it cannot read is a no.
 */
export function carries(dir: string, reviewed: string, head: string, base: string) {
  const merged = run(dir, ["git", "merge-tree", "--write-tree", reviewed, base]);
  const tree = run(dir, ["git", "rev-parse", `${head}^{tree}`]);
  const ours = run(dir, ["git", "diff", "--no-renames", "--name-only", `${base}...${reviewed}`]);
  const theirs = run(dir, ["git", "diff", "--no-renames", "--name-only", `${reviewed}...${base}`]);
  if (!tree || merged?.split("\n")[0] !== tree || ours === null || theirs === null) {
    return false;
  }
  const touched = new Set(theirs.split("\n"));
  return !ours.split("\n").some((f) => f !== "" && touched.has(f));
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
    deny("could not read the PR to check its debt verdict (gh pr view failed: offline, not signed in, or no PR).");
  }
  const pr = JSON.parse(json) as {
    baseRefName: string;
    body: string | null;
    files: { path: string }[];
    headRefOid: string;
    url: string;
  };
  const local = !repo && repoFlag.length === 0; // the PR's repo is this checkout, so its git can be read
  const all = local && dataRepo(dir, `origin/${pr.baseRefName}`);
  if (pr.files.length > 0 && pr.files.every((f) => isData(f.path, all))) {
    return; // documentation, memory or data only: nothing functional to review
  }
  const section = (pr.body ?? "").split(/^## Debt verdict\s*$/m)[1] ?? "";
  const reviewed = section.match(/^Reviewed:\s*`?([0-9a-f]{7,40})/m)?.[1];
  const verdict = section.match(/^Verdict:\s*(.+)$/m)?.[1]?.trim();
  if (!(reviewed && verdict)) {
    deny(
      `${pr.url} has no debt verdict. Run work-on-code: a fresh reviewer, its findings applied, and its verdict written into the PR as "## Debt verdict" with "Reviewed: <head sha>".`
    );
  }
  if (/rework needed/i.test(verdict)) {
    deny(`${pr.url}'s debt verdict says "rework needed". Do the rework (here or as its own PR) and review again.`);
  }
  // The base as GitHub has it, never a local ref, which may name another remote's commits or be forged.
  const repoPath = pr.url.replace(/^https:\/\/github\.com\//, "").replace(/\/pull\/\d+$/, "");
  const [behind, baseSha] = (run(dir, [
    "gh", "api", `repos/${repoPath}/compare/${pr.baseRefName}...${pr.headRefOid}`, "-q", "[.behind_by, .base_commit.sha] | @tsv",
  ]) ?? "").split("\t");
  if (!(pr.headRefOid.startsWith(reviewed) || (local && baseSha && carries(dir, reviewed, pr.headRefOid, baseSha)))) {
    deny(
      `${pr.url}'s debt verdict is for ${reviewed.slice(0, 12)}, but the PR's head is now ${pr.headRefOid.slice(0, 12)} and is not a clean merge of ${pr.baseRefName} into it that leaves the PR's files alone (checked from the PR's checkout). Review the new commits (work-on-code) and update the verdict.`
    );
  }
  // The base moved since the merge: the result was never checked or reviewed.
  if (!behind || Number(behind) > 0) {
    deny(
      `${pr.url} is ${behind || "maybe"} commit(s) behind ${pr.baseRefName}: take the landing lock, merge origin/${pr.baseRefName} into the branch, push (the check runs), confirm or redo the verdict (work-on-code), then merge.`
    );
  }
  const pinned = values.get("--match-head-commit");
  if (args.includes("--auto") && !(pinned && pr.headRefOid.startsWith(pinned))) {
    deny(`gh pr merge --auto would merge commits pushed after the review. Add --match-head-commit ${pr.headRefOid}.`);
  }
}

/** What every `codex exec` must set, so its commands never see the login shell's secrets: key, value, the flag to add. */
const CODEX_ENV_FLAGS = [
  ["allow_login_shell", "false", "-c allow_login_shell=false"],
  ["shell_environment_policy.inherit", "core", `-c 'shell_environment_policy.inherit="core"'`],
] as const;

/** Refuses a `codex exec` (or `codex e`, global options first) with an open stdin or without CODEX_ENV_FLAGS. */
function checkCodexExec(launched: string[], stdin: boolean) {
  // `exec` or `e` after nothing but options and their values (a boolean option's next word counts as one: fail closed).
  const isExec = launched.some(
    (w, i) => (w === "exec" || w === "e") && launched.slice(1, i).every((x, j) => x.startsWith("-") || launched[j]?.startsWith("-"))
  );
  if (launched[0] !== "codex" || !isExec) {
    return;
  }
  if (!stdin) {
    deny("`codex exec` with an open stdin waits on it forever. Pass the prompt as an argument and add `</dev/null`.");
  }
  // Each `-c`/`--config` value, quotes, spaces and a glued `</dev/null` removed; the last one per key wins, as in Codex.
  const set = new Map<string, string>();
  const end = launched.indexOf("--");
  launched.slice(0, end < 0 ? undefined : end).forEach((w, i) => {
    const v = ["-c", "--config"].includes(launched[i - 1] ?? "") ? w : w.match(/^(?:-c=?|--config=)(.+)$/)?.[1];
    const [key, ...value] = (v ?? "").replace(/[<>].*$/s, "").replace(/["'\s]/g, "").split("=");
    if (key && value.length > 0) {
      set.set(key, value.join("="));
    }
  });
  const missing = CODEX_ENV_FLAGS.filter(([key, value]) => set.get(key) !== value).map(([, , flag]) => flag);
  if (missing.length > 0) {
    deny(
      `\`codex exec\` without ${missing.join(" and ")} runs its commands with your login shell's environment, secrets included, and sends what they print to OpenAI. Add: ${missing.join(" ")}`
    );
  }
}

/** One simple command at a time, following `cd`; `sh -c "<script>"` is checked as its own script. */
function check(script: string, from: string, split = commands(script)) {
  let cwd = from;
  for (const raw of split) {
    const w = program(raw);
    const [cmd, ...args] = w;
    // The program `timeout <duration>` runs (options before the duration are not read), else the command's own.
    checkCodexExec(cmd === "timeout" ? w.slice(2) : w, raw.stdin === true);
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
        deny("merge through `gh pr merge`, so the debt verdict can be checked.");
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
      if (!/^#{1,6}\s*Debt plan\b/im.test(String(input.tool_input?.plan ?? ""))) {
        deny(
          'this plan has no "## Debt plan" section. Add it as the work-on-code skill says.'
        );
      }
      process.exit(0);
    }
    const raw = input.tool_input?.command ?? input.tool_input?.cmd ?? "";
    // Codex sends argv, usually ["bash", "-lc", "<script>"]; other argv is one command's words, never shell syntax.
    const cwd = input.cwd ?? process.cwd();
    if (Array.isArray(raw) && !(raw.length >= 3 && /^-\w*c$/.test(String(raw[1])))) {
      check("", cwd, [raw.map(String)]);
    } else {
      check(Array.isArray(raw) ? String(raw[2]) : String(raw), cwd);
    }
  } catch (e) {
    // A gate that crashes must not let the command through.
    deny(`could not check this command (${(e as Error).message}).`);
  }
}
