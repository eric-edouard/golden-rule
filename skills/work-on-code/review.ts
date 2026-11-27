#!/usr/bin/env bun
// Run a full review from the pushed checkout. Only the wrapper writes the verdict status.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEX_ENV_FLAGS, EFFORTS, type Pr, repoOf, reportVerdict, run } from "./gate";

async function review() {
  const [number, cli, model, effort, ...extra] = process.argv.slice(2);
  if (!/^\d+$/.test(number ?? "") || !["codex", "claude"].includes(cli ?? "") ||
      !model || !/^[\w][\w./:[\]-]*$/.test(model) || (effort !== undefined && !EFFORTS.includes(effort)) || extra.length) {
    throw new Error("usage: bun review.ts <pr> <codex|claude> <model> [effort]");
  }
  const dir = run(process.cwd(), ["git", "rev-parse", "--show-toplevel"]);
  if (!dir) throw new Error("review needs a git checkout");
  const view = () => {
    const raw = run(dir, ["gh", "pr", "view", number!, "--json", "url,headRefOid,baseRefOid,baseRefName,body"]);
    if (!raw) throw new Error("cannot read the PR");
    return JSON.parse(raw) as Pick<Pr, "url" | "headRefOid" | "baseRefName" | "baseRefOid"> & { body: string };
  };
  const pr = view();
  const checkHead = () => {
    if (run(dir, ["git", "rev-parse", "HEAD"]) !== pr.headRefOid || run(dir, ["git", "status", "--porcelain", "--untracked-files=all"]) !== "") {
      throw new Error("review needs a clean checkout of the pushed PR head");
    }
  };
  checkHead();
  const range = `${pr.baseRefOid}...${pr.headRefOid}`;
  const diff = run(dir, ["git", "diff", "--no-ext-diff", "--no-textconv", range]);
  if (diff === null) throw new Error(`cannot read ${range}; fetch the base before reviewing`);
  const plan = pr.body?.split(/^## Debt plan[ \t]*\r?$/m)[1]?.split(/^## /m)[0]?.trim() || "(no plan)";
  const instructions = await Bun.file(join(import.meta.dir, "verdict-review.md")).text();
  const architecture = await Bun.file(join(import.meta.dir, "architecture.md")).text();
  const prompt = `${instructions}\n\n${architecture}\n\nDebt plan:\n${plan}\n\nPinned diff ${range}:\n${diff}`;
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
         ...CODEX_ENV_FLAGS.flatMap(([key, values]) => ["-c", `${key}=${values[0]}`]),
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
    const description = `${verdict} | ${usedModel} ${usedEffort} | ${pr.baseRefName}@${pr.baseRefOid}`;
    const state = verdict === "rework needed" ? "failure" : "success";
    if (run(dir, ["gh", "api", `repos/${repoOf(pr)}/statuses/${pr.headRefOid}`, "-f", "context=debt-verdict",
      "-f", `state=${state}`, "-f", `description=${description}`]) === null) throw new Error("could not post debt-verdict status");
    if (state === "failure") process.exitCode = 1;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

review().catch(e => { console.error(`review: ${e.message}`); process.exitCode = 1; });
