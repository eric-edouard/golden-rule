import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commands, isData } from "./gate";

// The gate on throwaway repos: an origin whose default branch is main, a clone on main and one on a feature branch.
// Run: bun test ~/.agents/skills/golden-rule/gate.test.ts

const GATE = join(import.meta.dir, "gate.ts");
const root = mkdtempSync(join(tmpdir(), "golden-gate-"));
const sh = (cwd: string, cmd: string) => {
  const p = Bun.spawnSync(["sh", "-c", cmd], { cwd, env: { HOME: process.env.HOME, PATH: process.env.PATH } });
  if (p.exitCode !== 0) {
    throw new Error(`${cmd}: ${p.stderr}`);
  }
};
sh(root, "git init -q --bare -b main origin.git && git clone -q origin.git main 2>/dev/null");
sh(join(root, "main"), "git -c user.name=t -c user.email=t@t commit -q --allow-empty -m one && git push -q origin main && git remote set-head origin main");
sh(root, "git clone -q origin.git feature && cd feature && git checkout -q -b feature");
const MAIN = join(root, "main");
// An unpushed code commit on main, so pushes from it carry code.
sh(MAIN, "echo 1 > app.ts && git add app.ts && git -c user.name=t -c user.email=t@t commit -q -m code");
const FEATURE = join(root, "feature");

/** Exit code of the gate for a Claude-shaped call (or Codex argv when `command` is an array). */
function gate(cwd: string, command: string | string[]) {
  return run({ cwd, tool_input: { command } });
}
function run(input: object) {
  const p = Bun.spawnSync(["bun", GATE], { stdin: new TextEncoder().encode(JSON.stringify(input)) });
  return p.exitCode;
}

test("pushes to the default branch are refused, however they are written", () => {
  for (const cmd of [
    "git push origin main",
    "git push",
    "git push -q origin HEAD",
    "git push origin feature:main",
    "git push origin HEAD:refs/heads/main",
    "git push origin +main",
    "git push --all",
    "git -c core.x=y push origin main",
    "env X=1 git push origin main",
    'sh -c "git push origin main"',
    "echo ok\ngit push origin main",
  ]) {
    expect([cmd, gate(MAIN, cmd)]).toEqual([cmd, 2]);
  }
  expect(gate(FEATURE, `git -C ${MAIN} push`)).toBe(2);
  expect(gate(root, "cd main && git push")).toBe(2);
  expect(gate(MAIN, ["bash", "-lc", "git push origin main"])).toBe(2);
});

test("a feature branch pushes freely, and words in arguments are not commands", () => {
  for (const cmd of [
    "git push -u origin feature",
    "git push",
    "git push --dry-run origin feature",
    "git push --dry-run origin main",
    "git push origin --tags",
    "cat > body.md <<'EOF'\ngit push origin main\nEOF",
    "git log --grep 'git push origin main'",
    'git commit -m "never git push origin main"',
    "grep -E 'git push|gh pr merge' notes.md",
    'echo "gh pr merge 1"',
  ]) {
    expect([cmd, gate(FEATURE, cmd)]).toEqual([cmd, 0]);
  }
  expect(gate(MAIN, "grep -rE 'git push|push origin' .")).toBe(0);
});

test("merges through the API are refused (gh pr merge is checked against the PR's golden-rule verdict)", () => {
  expect(gate(MAIN, "gh api -X PUT repos/o/r/pulls/3/merge")).toBe(2);
});

test("data-only commits (a job's report or log) go straight to main; code or agent instructions do not", () => {
  const data = join(root, "data");
  sh(root, "git clone -q origin.git data");
  const commit = (file: string) =>
    sh(data, `mkdir -p "$(dirname ${file})" && echo x >> ${file} && git add ${file} && git -c user.name=t -c user.email=t@t commit -q -m ${file}`);
  commit("docs/recap/2026-10-19.json");
  commit("docs/seo/indexing-log.md");
  expect(gate(data, "git push")).toBe(0);
  expect(gate(data, "git push origin main")).toBe(0);
  commit("AGENTS.md");
  expect(gate(data, "git push")).toBe(2);
  sh(data, "git reset -q --hard HEAD~1");
  commit("package.json");
  expect(gate(data, "git push origin HEAD:main")).toBe(2);
});

test("docs, memory and data pass anywhere; code and agent instructions do not", () => {
  for (const f of ["docs/recap/2026-10-19.json", "memory/units/2026-10-18.jsonl", "notes/log.md", "README.md", "reports/weekly.csv"]) {
    expect([f, isData(f)]).toEqual([f, true]);
  }
  for (const f of ["docs/build.ts", "memory/who.ts", "AGENTS.md", "docs/AGENTS.md", "prompts/task.v2.md", ".claude/rules/truth.md", "docs/agents/ui-design.md", "package.json", "src/app.ts"]) {
    expect([f, isData(f)]).toEqual([f, false]);
  }
});

test("a heredoc body is text, and the command after it is still checked", () => {
  expect(commands("cat > f <<'EOF'\ngit push origin main\nEOF\ngit status").map((w) => w[0])).toEqual(["cat", "git"]);
});

test("redirections are not arguments", () => {
  expect(commands("gh pr merge 4 --merge 2>&1 | tail -2")[0]).toEqual(["gh", "pr", "merge", "4", "--merge", "2>&1"]);
  expect(gate(FEATURE, "git push -u origin feature 2>&1 > /tmp/out.txt")).toBe(0);
  expect(gate(MAIN, "git push origin main 2>&1 | tail -3")).toBe(2);
});

test("merging two PRs at once, or the wrong one through a flag value, is refused", () => {
  expect(gate(MAIN, "gh pr merge 4 5")).toBe(2);
  expect(gate(MAIN, "gh -R o/r pr merge 4")).toBe(2); // checked (and refused: no such PR here), not skipped
});

test("a push from a folder the same command creates: decided from the named branch, refused when unknowable", () => {
  expect(gate(root, "git worktree add new -b topic && cd new && git push -u origin topic")).toBe(0);
  expect(gate(root, "git worktree add new2 -b topic2 && cd new2 && git push")).toBe(2);
  expect(gate(root, "mkdir x && cd x && git push origin main")).toBe(2);
});

test("a plan passes only with a golden-rule plan section", () => {
  const plan = (text: string) => run({ tool_name: "ExitPlanMode", tool_input: { plan: text } });
  expect(plan("# Add X\n\nSteps.\n\n## Golden rule plan\nInventory: none")).toBe(0);
  expect(plan("# Fix copy\n### Golden-rule plan\nn/a: copy only")).toBe(0);
  expect(plan("# Add X\n\nSteps, with the golden rule plan in mind.")).toBe(2);
});

test("as git's pre-push hook (any harness): code to main is refused, data, tags and branches pass", () => {
  const repo = join(root, "hooked");
  sh(root, "git clone -q origin.git hooked");
  const hook = `-c hook.gate.event=pre-push -c hook.gate.command='bun ${GATE} pre-push'`;
  const push = (args: string) => Bun.spawnSync(["sh", "-c", `git ${hook} push -q ${args}`], { cwd: repo, env: { HOME: process.env.HOME, PATH: process.env.PATH } }).exitCode;
  const commit = (file: string) => sh(repo, `mkdir -p "$(dirname ${file})" && echo x >> ${file} && git add ${file} && git -c user.name=t -c user.email=t@t commit -q -m ${file}`);
  commit("docs/recap/2026-10-29.json");
  expect(push("origin main")).toBe(0);
  commit("app.ts");
  expect(push("origin main")).not.toBe(0);
  expect(push("origin HEAD:refs/heads/side")).toBe(0);
  sh(repo, "git tag main-tag");
  expect(push("origin main-tag")).toBe(0);
  // An unnamed push (a URL) still knows main; a new main on an empty remote is checked from what no remote has.
  expect(push(`${join(root, "origin.git")} main`)).not.toBe(0);
  sh(root, "git init -q --bare -b main empty.git");
  sh(repo, `git remote add empty ${join(root, "empty.git")}`);
  expect(push("empty main")).not.toBe(0);
});
