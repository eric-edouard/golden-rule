#!/usr/bin/env bun
// Run a review from the pushed checkout. Only the wrapper writes the verdict status.
// Full: the PR's whole diff. Confirm: only the fixes since the nearest full review, when they are small (gate.md).
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CODEX_ENV_FLAGS, EFFORTS, type Pr, proofOf, repoOf, reportVerdict, run } from "./gate";

/** The most lines (added plus deleted) a confirm review may judge; a binary change is over it. */
const CONFIRM_MAX = 60;

async function review() {
  const args = process.argv.slice(2);
  const confirm = args[2] === "confirm";
  const [checkout, number, cli, model, effort, ...extra] = confirm ? [...args.slice(0, 2), ...args.slice(3)] : args;
  if (!checkout || !/^\d+$/.test(number ?? "") || !["codex", "claude"].includes(cli ?? "") ||
      !model || !/^[\w][\w./:[\]-]*$/.test(model) || (effort !== undefined && !EFFORTS.includes(effort)) || extra.length) {
    throw new Error("usage: bun review.ts <checkout> <pr> [confirm] <codex|claude> <model> [effort], started outside the checkout");
  }
  const dir = run(checkout, ["git", "rev-parse", "--show-toplevel"]);
  if (!dir) throw new Error("review needs a git checkout");
  // Bun reads bunfig.toml (preloads) from its working directory: a PR must not run code before this check.
  const cwd = realpathSync(process.cwd());
  if (cwd === dir || cwd.startsWith(`${dir}/`)) throw new Error("start review.ts outside the checkout it reviews");
  const view = () => {
    const raw = run(dir, ["gh", "pr", "view", number!, "--json", "url,headRefOid,baseRefOid,baseRefName,body"]);
    if (!raw) throw new Error("cannot read the PR");
    return JSON.parse(raw) as Pr & { body: string };
  };
  const pr = view();
  const checkHead = () => {
    if (run(dir, ["git", "rev-parse", "HEAD"]) !== pr.headRefOid || run(dir, ["git", "status", "--porcelain", "--untracked-files=all"]) !== "") {
      throw new Error("review needs a clean checkout of the pushed PR head");
    }
  };
  checkHead();
  // The reviewer sees the diff from the merge base: record that as the reviewed base, so landing checks everything after it.
  const mergeBase = run(dir, ["git", "merge-base", pr.baseRefOid, pr.headRefOid]);
  if (!mergeBase) throw new Error("cannot find the merge base; fetch the base before reviewing");
  // Each full report is kept beside the repo's objects (shared by its worktrees), for a confirm review to read.
  const reports = join(resolve(dir, run(dir, ["git", "rev-parse", "--git-common-dir"]) ?? ".git"), "work-on-code");
  const prompt = confirm ? await confirmPrompt(dir, pr, mergeBase, reports) : await fullPrompt(dir, pr, mergeBase);
  const temp = mkdtempSync(join(tmpdir(), "debt-review-"));
  try {
    const effortFile = join(temp, "effort");
    // Claude exposes applied effort (including a model downgrade) to its Stop hook.
    const stop = { type: "command", command: 'printf %s "$CLAUDE_EFFORT" > "$REVIEW_EFFORT_FILE"' };
    const cmd = cli === "claude"
      ? ["claude", "-p", "--model", model, ...(effort ? ["--effort", effort] : []), "--permission-mode", "plan",
         "--restricted", "--strict-mcp-config", "--tools", "Read,Grep,Glob", "--output-format", "json",
         "--settings", JSON.stringify({ hooks: { Stop: [{ hooks: [stop] }] } })]
      : ["codex", "exec", "--model", model, "-s", "read-only", "--ephemeral", "--color", "never",
         ...CODEX_ENV_FLAGS.flatMap(([key, values]) => ["-c", `${key}=${values[0]}`]), "-c", "mcp_servers={}",
         ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []), "-"];
    const proc = Bun.spawnSync(cmd, { cwd: dir, stdin: Buffer.from(prompt), stdout: "pipe", stderr: "pipe",
      env: { ...process.env, REVIEW_EFFORT_FILE: effortFile }, maxBuffer: 64 * 1024 * 1024 });
    if (proc.exitCode !== 0) throw new Error(`${cli} review failed (exit ${proc.exitCode}): ${proc.stderr.toString().trim().slice(-500)}`);
    let report = proc.stdout.toString();
    let usedModel: string | undefined;
    let usedEffort: string | undefined;
    if (cli === "claude") {
      const result = JSON.parse(report);
      const models = Object.keys(result.modelUsage ?? {});
      if (result.is_error || models.length !== 1) throw new Error("cannot identify a single successful Claude review model");
      [usedModel] = models;
      usedEffort = (await Bun.file(effortFile).text()).trim();
      report = result.result;
    } else {
      // Read only the startup settings, before any tool or model output.
      const header = proc.stderr.toString().split(/^user\r?$/m, 1)[0]!;
      usedModel = /^model: (\S+)$/m.exec(header)?.[1];
      usedEffort = /^reasoning effort: (\S+)$/m.exec(header)?.[1];
    }
    console.log(report);
    const verdict = reportVerdict(report);
    if (!usedModel || !/^\S+$/.test(usedModel) || !usedEffort || !EFFORTS.includes(usedEffort)) {
      throw new Error("reviewer did not report its effective model and effort");
    }
    checkHead();
    const after = view();
    if (pr.headRefOid !== after.headRefOid || pr.baseRefName !== after.baseRefName || pr.baseRefOid !== after.baseRefOid) {
      throw new Error("PR head or base moved during review; rerun review.ts");
    }
    const description = `${confirm ? "confirm " : ""}${verdict} | ${usedModel} ${usedEffort} | ${pr.baseRefName}@${mergeBase}`;
    if (description.length > 140) throw new Error("debt-verdict status is over GitHub's 140 characters (base branch name too long)");
    const state = verdict === "rework needed" ? "failure" : "success";
    if (run(dir, ["gh", "api", `repos/${repoOf(pr)}/statuses/${pr.headRefOid}`, "-f", "context=debt-verdict",
      "-f", `state=${state}`, "-f", `description=${description}`]) === null) throw new Error("could not post debt-verdict status");
    // Kept only once posted, so the report a confirm reads is the one the gate trusts.
    if (!confirm) {
      mkdirSync(reports, { recursive: true });
      await Bun.write(join(reports, `${pr.headRefOid}.md`), report);
    }
    if (state === "failure") process.exitCode = 1;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

async function fullPrompt(dir: string, pr: Pr & { body: string }, mergeBase: string) {
  const range = `${mergeBase}..${pr.headRefOid}`;
  const diff = run(dir, ["git", "diff", "--no-ext-diff", "--no-textconv", range]);
  if (diff === null) throw new Error(`cannot read ${range}; fetch the base before reviewing`);
  const plan = pr.body?.split(/^## Debt plan[ \t]*\r?$/m)[1]?.split(/^## /m)[0]?.trim() || "(no plan)";
  const instructions = await Bun.file(join(import.meta.dir, "verdict-review.md")).text();
  const architecture = await Bun.file(join(import.meta.dir, "architecture.md")).text();
  return `${instructions}\n\n${architecture}\n\nDebt plan:\n${plan}\n\nPinned diff ${range}:\n${diff}`;
}

/** The fixes since the nearest full review, from that review merged with the base the head holds (so a base merge is not shown as the PR's). */
async function confirmPrompt(dir: string, pr: Pr, mergeBase: string, reports: string) {
  const proof = proofOf(dir, pr);
  if (!proof) throw new Error("a docs-and-data PR needs no review");
  if (proof.confirm && proof.state !== "success") throw new Error("the last confirm did not pass; run a full review");
  const full = proof.full.reviewed;
  const report = Bun.file(join(reports, `${full}.md`));
  if (!(await report.exists())) throw new Error(`the full review of ${full} is not on this machine; run a full review`);
  const from = run(dir, ["git", "merge-tree", "--write-tree", full, mergeBase])?.split("\n")[0];
  if (!from) throw new Error(`cannot merge ${full} with the base; run a full review`);
  const numstat = run(dir, ["git", "diff", "--numstat", "--no-renames", from, pr.headRefOid]);
  if (numstat === null) throw new Error(`cannot read the fixes since ${full}`);
  const lines = numstat.split("\n").filter(Boolean).reduce((n, l) => {
    const [a = "-", d = "-"] = l.split("\t");
    return n + (a === "-" || d === "-" ? Number.POSITIVE_INFINITY : Number(a) + Number(d));
  }, 0);
  if (lines > CONFIRM_MAX) throw new Error(`the fixes since ${full} change ${lines} lines, over ${CONFIRM_MAX}; run a full review`);
  const diff = run(dir, ["git", "diff", "--no-ext-diff", "--no-textconv", "--no-renames", from, pr.headRefOid]);
  if (diff === null) throw new Error(`cannot read the fixes since ${full}`);
  const instructions = await Bun.file(join(import.meta.dir, "verdict-confirm.md")).text();
  return `${instructions}\n\nEarlier full review of ${full}:\n${await report.text()}\n\nFixes since then:\n${diff}`;
}

review().catch(e => { console.error(`review: ${e.message}`); process.exitCode = 1; });
