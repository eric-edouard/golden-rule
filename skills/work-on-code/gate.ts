#!/usr/bin/env bun
// The work-on-code gate: a PreToolUse hook for Claude Code and Codex, and (`gate.ts pre-push`) git's pre-push hook for any
// harness (gate.md). As a tool hook it reads the tool call on
// stdin and refuses (exit 2, the reason on stderr) a plan with no debt plan section, a merge whose PR carries no
// passing debt verdict of its current head, and a push of code to a repository's default branch (a data-only
// push, a job's report or log, goes through). Every other call passes untouched. The proof trusts its publisher. Anyone with that token can script a status.
import { resolve } from "node:path";

/** A command's output, or null when it fails or cannot start (e.g. a folder an earlier part of the command creates). */
export const run = (cwd: string, cmd: string[]) => {
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
      if (script[i + 1] === ">" && !/^(\d*|&)[<>]*$/.test(word)) {
        endWord(); // `x&>out`: the word ends where its redirection starts
      }
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
      if ((c === "<" || c === ">") && !/^(\d*|&)[<>]*$/.test(word)) {
        endWord(); // `x</dev/null`: the word ends where its redirection starts
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
export function defaults(dir: string, remote = "origin") {
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
const INSTRUCTIONS = /(^|\/)(AGENTS|CLAUDE|SKILL)\.md$|(^|\/)(prompts|skills|\.claude|\.agents|\.cursor)\/|(^|\/)docs\/agents\//;
export const isData = (path: string, inDataRepo = false) =>
  path !== ".work-on-code.json" && !INSTRUCTIONS.test(path) && (DOC.test(path) || ((inDataRepo || DATA_DIR.test(path)) && !SCRIPT.test(path)));

/** Whether `base` (a default branch as its remote has it) carries `.data-repo`: committed and reviewed, never a stray local file. */
const dataRepo = (dir: string, base: string) => base !== "" && run(dir, ["git", "cat-file", "-e", `${base}:.data-repo`]) !== null;

/** The files the commits of `range` (by default those of `src` not yet on origin) change that are not data, as `base` decides it. */
function codeIn(dir: string, base: string, src: string, range = [src, "--not", "--remotes=origin"]) {
  const files = run(dir, ["git", "log", "--format=", "--name-only", "--no-renames", ...range]);
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

/** How close (in lines) the base's change may come to the PR's own lines and still carry the verdict. */
const NEAR = 3;

/** Each changed file of a `-U0 --no-renames` diff (keyed by its `diff --git` line) as merge-base line spans; a mode change or a file with no hunk (binary) spans everything. */
function spansOf(diff: string) {
  const files = new Map<string, number[][]>();
  let spans: number[][] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      spans = [];
      files.set(line, spans);
    }
    if (/^(old|new|new file|deleted file) mode /.test(line)) {
      spans.push([0, Number.POSITIVE_INFINITY]);
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))?/.exec(line);
    if (hunk) {
      const start = Number(hunk[1]);
      spans.push([start, start + Math.max(Number(hunk[2] ?? 1), 1) - 1]);
    }
  }
  for (const s of files.values()) {
    if (s.length === 0) {
      s.push([0, Number.POSITIVE_INFINITY]);
    }
  }
  return files;
}

/**
 * Whether a verdict of `reviewed` still holds at `head`: `head` holds exactly `reviewed` merged cleanly with `base`
 * (the same tree), and no hunk the base brought in lies within `NEAR` lines of the PR's own changed lines (both
 * diffs count lines in the merge base). Read from local git; anything it cannot read is a no.
 */
export function carries(dir: string, reviewed: string, head: string, base: string) {
  const diff = (range: string) => run(dir, ["git", "diff", "-U0", "--inter-hunk-context=0", "--no-renames", "--no-color", "--no-ext-diff", "--no-textconv", range]);
  const merged = run(dir, ["git", "merge-tree", "--write-tree", reviewed, base]);
  const tree = run(dir, ["git", "rev-parse", `${head}^{tree}`]);
  const ours = diff(`${base}...${reviewed}`);
  const theirs = diff(`${reviewed}...${base}`);
  if (!tree || merged?.split("\n")[0] !== tree || ours === null || theirs === null) {
    return false;
  }
  const mine = spansOf(ours);
  return [...spansOf(theirs)].every(([file, spans]) =>
    spans.every(([a = 0, b = 0]) => !(mine.get(file) ?? []).some(([c = 0, d = 0]) => a <= d + NEAR && c <= b + NEAR))
  );
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

/** A PR as `gh pr view --json PR_FIELDS` gives it. */
export type Pr = { baseRefName: string; baseRefOid: string; headRefOid: string; url: string };
export const PR_FIELDS = "baseRefName,baseRefOid,headRefOid,url";
export const repoOf = (pr: Pick<Pr, "url">) => pr.url.replace(/^https:\/\/github\.com\//, "").replace(/\/pull\/\d+$/, "");

const MAX_WALK = 20;
export const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const VERDICTS = ["debt reduced", "no debt added", "debt added", "rework needed"];
export function reportVerdict(report: string) {
  const fields = report.split(/\r?\n/).filter((line) => line.startsWith("Verdict:"));
  const value = fields[0]?.slice("Verdict:".length).trim() ?? "";
  if (fields.length !== 1 || !VERDICTS.includes(value)) {
    throw new Error("review needs one plain Verdict: field with a known verdict");
  }
  return value;
}

/** Whether a review's model and effort meet a repo's reviewer policy (no policy: any review does). */
export const meets = (policy: Policy | undefined, r: { model: string; effort: string }) =>
  !policy || (policy.models.includes(r.model) && EFFORTS.indexOf(r.effort) >= EFFORTS.indexOf(policy.effort));

type Policy = { models: string[]; effort: string; publishers?: string[] };
type Status = { context: string; creator: { login: string }; state: string; description: string; created_at: string; id: number };

const names = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every(x => typeof x === "string" && x.length > 0);

/** The trusted review nearest the head, or null for a docs-and-data PR. Only an absent tree entry means no policy. */
export function proofOf(dir: string, pr: Pr) {
  const api = (endpoint: string, ...args: string[]) => {
    const result = run(dir, ["gh", "api", `repos/${repoOf(pr)}/${endpoint}`, ...args]);
    if (result === null) throw new Error(`cannot read ${endpoint} on GitHub`);
    return result;
  };
  const root = JSON.parse(api(`git/trees/${pr.baseRefOid}`));
  if (root.truncated !== false) throw new Error("cannot read the complete policy tree");
  const policyPath = ".work-on-code.json";
  const file = (root.tree as { path: string; mode: string }[]).find(entry => entry.path === policyPath);
  const data = root.tree.some((entry: { path: string }) => entry.path === ".data-repo");
  // One compare read gives both sides of every rename and each commit's parents.
  type Compare = { commits: { sha: string; parents: { sha: string }[] }[]; files?: { filename: string; previous_filename?: string }[] };
  const diff: Compare = JSON.parse(api(`compare/${pr.baseRefOid}...${pr.headRefOid}?per_page=100`));
  const paths = (diff.files ?? []).flatMap(f => f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]);
  if (paths.length && (diff.files ?? []).length < 300 && paths.every(path => isData(path, data))) return null;
  let policy: Policy | undefined;
  if (file) {
    if (!["100644", "100755"].includes(file.mode)) throw new Error("the reviewer policy must be a regular file");
    policy = JSON.parse(api(`contents/${policyPath}?ref=${pr.baseRefOid}`, "-H", "Accept: application/vnd.github.raw+json")).reviewer;
    if (!policy || !names(policy.models) || !EFFORTS.includes(policy.effort) ||
        (policy.publishers !== undefined && !names(policy.publishers))) throw new Error("invalid .work-on-code.json reviewer policy");
  }
  const publishers = policy?.publishers ?? [run(dir, ["gh", "api", "user", "-q", ".login"])];
  if (!publishers[0]) throw new Error("cannot identify the gate's GitHub login");
  // The nearest review by first-parent distance, at most MAX_WALK commits back, so the hook stays inside its timeout.
  const parent = new Map(diff.commits.map(c => [c.sha, c.parents[0]?.sha]));
  function* candidates() {
    for (let sha: string | undefined = pr.headRefOid, steps = 0; sha && steps < MAX_WALK; sha = parent.get(sha), steps++) yield sha;
  }
  type Review = { reviewed: string; verdict: string; model: string; effort: string; baseRef: string; baseSha: string; state: string; confirm: boolean };
  let nearestConfirm: Review | undefined;
  let confirms = 0;
  for (const reviewed of candidates()) {
    const pages: Status[][] = JSON.parse(api(`commits/${reviewed}/statuses?per_page=100`, "--paginate", "--slurp"));
    const trusted = pages.flat().filter(s => s.context === "debt-verdict" && publishers.includes(s.creator.login));
    const status = trusted.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0];
    if (!status) continue;
    const fields = /^(confirm )?(.*?) \| (\S+) (\S+) \| (.+)@([0-9a-f]{40})$/.exec(status.description);
    if (!fields) throw new Error("malformed debt-verdict status");
    const [, confirm, verdict = "", model = "", effort = "", baseRef = "", baseSha = ""] = fields;
    if (!VERDICTS.includes(verdict) || !EFFORTS.includes(effort)) throw new Error("unknown verdict or effort");
    const review = { reviewed, verdict, model, effort, baseRef, baseSha, state: status.state, confirm: !!confirm };
    // A confirm review saw only the fixes since the nearest full review behind it: both make the proof.
    // A confirm below the policy proves nothing and uses no round: it is skipped.
    if (review.confirm) {
      if (!meets(policy, review)) continue;
      nearestConfirm ??= review;
      confirms += trusted.filter(s => s.description.startsWith("confirm ")).length; // a rerun on one commit counts too
      continue;
    }
    return { ...(nearestConfirm ?? review), policy, full: review, confirms };
  }
  throw new Error(`${pr.url} has no trusted full debt-verdict status${nearestConfirm ? " behind its confirm" : ""}. Run review.ts on its pushed head.`);
}

export function verdictOf(dir: string, pr: Pr, local: boolean, proof = proofOf(dir, pr)) {
  if (!proof) return { state: "success", why: "docs and data only" };
  const { reviewed, verdict, policy, full } = proof;
  if (proof.state !== "success" || verdict === "rework needed") return { state: "failure", why: "the latest review did not pass" };
  if (proof.baseRef !== pr.baseRefName || full.baseRef !== pr.baseRefName) return { state: "pending", why: "the PR was retargeted; run review.ts again" };
  // The policy binds the full review and any confirm after it: a confirm judges fixes of any size (gate.md).
  if (!meets(policy, full) || !meets(policy, proof)) {
    return { state: "failure", why: "reviewer model or effort does not meet the base policy" };
  }
  if (reviewed !== pr.headRefOid && !(local && carries(dir, reviewed, pr.headRefOid, pr.baseRefOid))) {
    return { state: "pending", why: `the debt verdict is for ${reviewed}; run review.ts confirm on the new head` };
  }
  const behind = run(dir, ["gh", "api", `repos/${repoOf(pr)}/compare/${pr.baseRefOid}...${pr.headRefOid}`, "-q", ".behind_by"]);
  if (behind !== "0") return { state: "pending", why: `cannot confirm the head is up to date with ${pr.baseRefName}; run land.ts` };
  return { state: "success", why: verdict };
}

function checkMerge(dir: string, args: string[], repoFlag: string[]) {
  const positional: string[] = [];
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] as string;
    if (a.startsWith("-R") && a.length > 2) {
      values.set("--repo", a.slice(2).replace(/^=/, ""));
      continue;
    }
    const eq = a.indexOf("=");
    const flag = eq > 0 ? a.slice(0, eq) : a;
    if (VALUED.has(flag)) {
      values.set(flag === "-R" ? "--repo" : flag, eq > 0 ? a.slice(eq + 1) : (args[i + 1] ?? ""));
      i += eq > 0 ? 0 : 1;
    } else if (!a.startsWith("-")) {
      positional.push(a);
    }
  }
  if (positional.length > 1) {
    deny(`more than one PR named (${positional.join(", ")}); merge one PR at a time.`);
  }
  const repo = values.get("--repo");
  const json = run(dir, ["gh", ...repoFlag, "pr", "view", ...positional, ...(repo ? ["-R", repo] : []), "--json", PR_FIELDS]);
  if (!json) {
    deny("could not read the PR to check its debt verdict (gh pr view failed: offline, not signed in, or no PR).");
  }
  const pr = JSON.parse(json) as Pr;
  const { state, why } = verdictOf(dir, pr, !repo && repoFlag.length === 0);
  if (state !== "success") {
    deny(why);
  }
  const pinned = values.get("--match-head-commit");
  if (!/^[0-9a-f]{40}$/.test(pr.headRefOid) || pinned !== pr.headRefOid) {
    deny(`Pin the merge to the checked head. Add --match-head-commit ${pr.headRefOid}.`);
  }
}

/** What every `codex exec` must set, so its commands never see the login shell's secrets: key, its values as TOML, the flag to add. */
export const CODEX_ENV_FLAGS = [
  ["allow_login_shell", ["false"], "-c allow_login_shell=false"],
  ["shell_environment_policy.inherit", ["core", '"core"', "'core'"], `-c 'shell_environment_policy.inherit="core"'`],
] as const;

/** A shell that runs `-c <script>`: the script is checked as its own. */
const SHELL = /(^|\/)(ba|z|da)?sh$/;

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
  // Each `-c`/`--config` key=value; the last one per key wins, as in Codex, and one setting a key's enclosing table unsets it.
  const set = new Map<string, string>();
  const end = launched.indexOf("--");
  launched.slice(0, end < 0 ? undefined : end).forEach((w, i) => {
    const v = ["-c", "--config"].includes(launched[i - 1] ?? "") ? w : w.match(/^(?:-c=?|--config=)(.+)$/)?.[1];
    const eq = v?.indexOf("=") ?? -1;
    if (v && eq > 0) {
      const key = v.slice(0, eq).trim();
      for (const k of set.keys()) {
        if (k.startsWith(`${key}.`)) {
          set.delete(k);
        }
      }
      set.set(key, v.slice(eq + 1).trim());
    }
  });
  const missing = CODEX_ENV_FLAGS.filter(([key, values]) => !(values as readonly string[]).includes(set.get(key) ?? "")).map(([, , flag]) => flag);
  if (missing.length > 0) {
    deny(
      `\`codex exec\` without ${missing.join(" and ")} runs its commands with your login shell's environment, secrets included, and sends what they print to OpenAI. Add: ${missing.join(" ")}`
    );
  }
}

/**
 * Each simple command of a script: its program's words, the folder it runs in (following `cd`) and whether its stdin is
 * not the caller's; `sh -c "<script>"` is walked as its own script.
 */
export function* walk(script: string, from: string, split = commands(script)): Generator<{ w: string[]; cwd: string; stdin: boolean }> {
  let cwd = from;
  for (const raw of split) {
    const w = program(raw);
    const [cmd, ...args] = w;
    const c = SHELL.test(cmd ?? "") ? args.findIndex((a) => /^-\w*c$/.test(a)) : -1;
    if (cmd === "cd" && args[0]) {
      cwd = resolve(cwd, args[0].replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
    } else if (c >= 0) {
      yield* walk(args[c + 1] ?? "", cwd);
    } else {
      yield { w, cwd, stdin: raw.stdin === true };
    }
  }
}

/** A `git [options] <subcommand> ...` command's folder (after `-C`) and its words from the subcommand on; null for another program. */
export function gitCall(w: string[], cwd: string) {
  if (w[0] !== "git") {
    return null;
  }
  let i = 1;
  let dir = cwd;
  while (w[i]?.startsWith("-")) {
    if (["-C", "-c", "--git-dir", "--work-tree"].includes(w[i] as string) && w[i + 1]) {
      if (w[i] === "-C") {
        dir = resolve(cwd, w[i + 1] as string);
      }
      i += 1;
    }
    i += 1;
  }
  return { dir, args: w.slice(i) };
}

function check(script: string, from: string, split = commands(script)) {
  for (const { w, cwd, stdin } of walk(script, from, split)) {
    const [cmd, ...args] = w;
    // The program `timeout <duration>` runs (options before the duration are not read), else the command's own.
    checkCodexExec(cmd === "timeout" ? w.slice(2) : w, stdin);
    const git = gitCall(w, cwd);
    if (git?.args[0] === "push") {
      checkPush(git.dir, git.args.slice(1));
    } else if (cmd === "gh") {
      const p = args.indexOf("pr");
      const before = args.slice(0, Math.max(p, 0));
      if (p >= 0 && args[p + 1] === "merge") {
        checkMerge(cwd, args.slice(p + 2), before);
      } else if (args[0] === "api" && args.some(x => /\/statuses\//.test(x)) &&
                 args.some(x => /^(?:-[fF]=?|--(?:raw-)?field=)?context=debt-verdict$/.test(x))) {
        deny("run review.ts to post the debt-verdict status.");
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
    if (Array.isArray(raw) && !(raw.length >= 3 && SHELL.test(String(raw[0])) && /^-\w*c$/.test(String(raw[1])))) {
      check("", cwd, [raw.map(String)]);
    } else {
      check(Array.isArray(raw) ? String(raw[2]) : String(raw), cwd);
    }
  } catch (e) {
    // A gate that crashes must not let the command through.
    deny(`could not check this command (${(e as Error).message}).`);
  }
}
