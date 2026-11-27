#!/usr/bin/env bun
// Lands one PR with no model (work-on-code, verdict step 6). Run it in the background from the PR's checkout:
//   bun land.ts <pr number> [area...]
// Takes the landing lock, merges origin/<base> once, pushes (the repo's pre-push check runs), applies the gate's
// verdict rule to the pushed head, merges, drops the lock. Exit 0 merged; 1 refused or failed (why on stderr); 3 the
// base changed the PR's own files since its review: run the base-review.md on the diff it names, then
// run again with LAND_BASE_CHECKED=<the sha it printed> (a later base change asks again). LAND_METHOD: merge (default),
// squash or rebase.
import { join } from "node:path";
import { PR_FIELDS, type Pr, proofOf, run, verdictOf } from "./gate";

const [pr, ...areas] = process.argv.slice(2);
const dir = process.cwd();
function fail(why: string, code = 1): never {
  console.error(`land: ${why}`);
  process.exit(code);
}
/** Runs a command with its output shown; true when it succeeded. */
const shown = (cmd: string[], env?: Record<string, string>) =>
  Bun.spawnSync(cmd, { cwd: dir, env: { ...process.env, ...env }, stdio: ["inherit", "inherit", "inherit"] }).exitCode === 0;
const view = () => {
  const json = run(dir, ["gh", "pr", "view", pr as string, "--json", `${PR_FIELDS},headRefName`]);
  return json ? (JSON.parse(json) as Pr & { headRefName: string }) : fail(`cannot read PR ${pr}`);
};

if (!/^\d+$/.test(pr ?? "")) {
  fail("usage: bun land.ts <pr number> [area...]", 2);
}
const before = view();
if (run(dir, ["git", "branch", "--show-current"]) !== before.headRefName) {
  fail(`this checkout is not on PR ${pr}'s branch (${before.headRefName})`);
}
if (run(dir, ["git", "status", "--porcelain"]) !== "") {
  fail("this checkout has uncommitted changes");
}
// The lock records this process, so a landing killed past these handlers (SIGKILL) frees it at the next take.
const lock = (op: string) => shown(["sh", join(import.meta.dir, "land-lock.sh"), op, ...areas], { LAND_LOCK_PID: String(process.pid) });
if (!lock("take")) {
  fail("could not take the landing lock");
}
process.on("exit", () => lock("drop"));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => fail(`stopped by ${signal}`));
}
process.on("uncaughtException", (e) => fail(String(e)));

const base = before.baseRefName;
if (!(shown(["git", "fetch", "-q", "origin", base]) && shown(["git", "merge", "-q", "--no-edit", `origin/${base}`]))) {
  run(dir, ["git", "merge", "--abort"]);
  fail(`conflict with ${base}: resolve it, then a full verdict round`);
}
const head = run(dir, ["git", "rev-parse", "HEAD"]) as string;
if (!shown(["git", "push", "-q", "origin", "HEAD"])) {
  fail("push failed (the check)");
}
const pushed = view();
if (pushed.headRefOid !== head || pushed.baseRefName !== base || pushed.baseRefOid !== run(dir, ["git", "rev-parse", `origin/${base}`])) {
  fail("GitHub's PR head or base differs from the checkout; run land.ts again");
}
const proof = proofOf(dir, pushed);
const { state, why } = verdictOf(dir, pushed, true, proof);
if (state !== "success") {
  fail(why);
}
if (proof && proof.baseSha !== pushed.baseRefOid && process.env.LAND_BASE_CHECKED !== pushed.baseRefOid) {
  const range = `${proof.baseSha}..${pushed.baseRefOid}`;
  const files = pushed.files.map(f => f.path);
  if (pushed.changedFiles !== files.length) fail("cannot list all PR files for the base round");
  const moved = run(dir, ["git", "diff", "--name-only", range, "--", ...files]);
  if (moved === null) fail(`cannot read the base diff ${range}`);
  if (moved) fail(`${base} changed PR ${pr}'s files: base round on git diff ${range} -- <the PR's files>; then LAND_BASE_CHECKED=${pushed.baseRefOid}\n${moved}`, 3);
}
if (!shown(["gh", "pr", "merge", pr as string, `--${process.env.LAND_METHOD ?? "merge"}`, "--match-head-commit", head])) {
  fail("gh pr merge failed");
}
