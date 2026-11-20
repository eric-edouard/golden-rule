import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { carries, commands, isData } from "./gate";

// The gate on throwaway repos: an origin whose default branch is main, a clone on main and one on a feature branch.
// Run: bun test ~/.agents/skills/work-on-code/gate.test.ts

const GATE = join(import.meta.dir, "gate.ts");
const root = mkdtempSync(join(tmpdir(), "work-on-code-gate-"));
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
  return refusal(input).exitCode;
}
function refusal(input: object) {
  return Bun.spawnSync(["bun", GATE], { stdin: new TextEncoder().encode(JSON.stringify(input)) });
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

test("merges through the API are refused (gh pr merge is checked against the PR's debt verdict)", () => {
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

test("a data-only repo opts in with a reviewed .data-repo on its default branch; a stray local one changes nothing", () => {
  const t = (c: string) => `git -c user.name=t -c user.email=t@t commit -q -m ${c}`;
  sh(root, "git init -q --bare -b main store.git && git clone -q store.git store 2>/dev/null");
  const store = join(root, "store");
  sh(store, `git commit -q --allow-empty -m one && git push -q origin main && git remote set-head origin main`);
  sh(store, `touch .data-repo && mkdir -p lynx/posts && echo x > lynx/posts/1.png && git add -A && ${t("first")}`);
  expect(gate(store, "git push")).toBe(2); // the marker itself is a change to review
  sh(store, "git push -q --no-verify origin main"); // as if merged through a PR
  sh(store, `echo y > lynx/posts/2.png && echo '[]' > lynx/rounds.json && git add -A && ${t("round")}`);
  expect(gate(store, "git push")).toBe(0);
  sh(store, `echo 1 > lynx/brand.test.ts && git add -A && ${t("script")}`);
  expect(gate(store, "git push")).toBe(2);
  sh(FEATURE, `git checkout -q main && echo '{}' > package.json && git add package.json && ${t("pkg")} && git add -N . && touch .data-repo`);
  expect(gate(FEATURE, "git push")).toBe(2); // a local marker in a code repo changes nothing
  sh(FEATURE, `git add .data-repo`);
  expect(gate(FEATURE, ["git", "push", join(root, "origin.git"), "main"])).toBe(2); // nor a staged one, even to a URL remote
  sh(FEATURE, "git rm -q --cached .data-repo && rm .data-repo && git reset -q --hard origin/main && git checkout -q feature");
});

test("docs, memory and data pass anywhere; code and agent instructions do not", () => {
  for (const f of ["docs/recap/2026-10-19.json", "memory/units/2026-10-18.jsonl", "notes/log.md", "README.md", "reports/weekly.csv"]) {
    expect([f, isData(f)]).toEqual([f, true]);
  }
  for (const f of ["docs/build.ts", "memory/who.ts", "AGENTS.md", "docs/AGENTS.md", "prompts/task.v2.md", ".claude/rules/truth.md", "docs/agents/ui-design.md", "package.json", "src/app.ts"]) {
    expect([f, isData(f)]).toEqual([f, false]);
  }
  // A data-only repository (`.data-repo` at its root): media and JSON anywhere are data; scripts and instructions are not.
  expect(["lynx/posts/rd1-a/1.png", "lynx/reviewer/rounds.json", "lynx/brand.test.ts", "lynx/AGENTS.md"].map((f) => isData(f, true))).toEqual([true, true, false, false]);
});

test("a heredoc body is text, and the command after it is still checked", () => {
  expect(commands("cat > f <<'EOF'\ngit push origin main\nEOF\ngit status").map((w) => w[0])).toEqual(["cat", "git"]);
});

test("redirections are not arguments", () => {
  expect(commands("gh pr merge 4 --merge 2>&1 | tail -2")[0]).toEqual(["gh", "pr", "merge", "4", "--merge", "2>&1"]);
  expect(gate(FEATURE, "git push -u origin feature 2>&1 > /tmp/out.txt")).toBe(0);
  expect(gate(MAIN, "git push origin main 2>&1 | tail -3")).toBe(2);
});

// The env-safety flags every `codex exec` needs, as SKILL.md writes them, and unquoted.
const SAFE = `-c allow_login_shell=false -c 'shell_environment_policy.inherit="core"'`;
const SAFE_UNQUOTED = "-c allow_login_shell=false -c shell_environment_policy.inherit=core";
const SAFE_ARGV = ["-c", "allow_login_shell=false", "-c", 'shell_environment_policy.inherit="core"'];

test("codex exec runs only with both env-safety flags, in the quoting forms agents write", () => {
  const login = "-c allow_login_shell=false";
  const inherit = `-c 'shell_environment_policy.inherit="core"'`;
  // Refused without the flags, or with one, naming exactly the flags to add.
  for (const [cmd, missing] of [
    ["codex exec review </dev/null", [login, inherit]],
    [`codex exec ${login} review </dev/null`, [inherit]],
    [`codex exec ${inherit} review </dev/null`, [login]],
    [`codex exec resume --last ${login} review </dev/null`, [inherit]],
  ] as const) {
    const p = refusal({ cwd: FEATURE, tool_input: { command: cmd } });
    expect(p.exitCode).toBe(2);
    expect(String(p.stderr)).toEndWith(`Add: ${missing.join(" ")}\n`);
  }
  // Allowed with both, on exec and on resume, however quoted or placed.
  for (const cmd of [
    `codex exec ${SAFE} review </dev/null`,
    `codex exec resume --last ${SAFE} review </dev/null`,
    `codex exec ${SAFE_UNQUOTED} review </dev/null`,
    `codex exec -c "allow_login_shell = false" -c "shell_environment_policy.inherit='core'" review </dev/null`,
    "codex exec --config allow_login_shell=false --config=shell_environment_policy.inherit=core review </dev/null",
    "codex exec -callow_login_shell=false -c=shell_environment_policy.inherit=core review </dev/null",
    `codex -m gpt --full-auto -c allow_login_shell=false exec ${inherit} review </dev/null`,
    `codex exec -c allow_login_shell=false -c shell_environment_policy.inherit=core</dev/null`,
    `timeout 900 codex e ${SAFE} review </dev/null`,
  ]) {
    expect([cmd, gate(FEATURE, cmd)]).toEqual([cmd, 0]);
  }
  // Refused: a later value overrides, a flag after \`--\` is a prompt word, the flags are on an outer command.
  for (const cmd of [
    `codex exec ${SAFE} -c allow_login_shell=true review </dev/null`,
    `codex exec ${login} -- ${inherit} review </dev/null`,
    `codex e review </dev/null`,
    `codex --full-auto exec review </dev/null`,
    `bash -lc "codex exec review </dev/null"`,
  ]) {
    expect([cmd, gate(FEATURE, cmd)]).toEqual([cmd, 2]);
  }
  expect(gate(FEATURE, ["bash", "-lc", `codex exec resume --last ${SAFE} review </dev/null`])).toBe(0);
  expect(gate(FEATURE, ["bash", "-lc", "codex exec resume --last review </dev/null"])).toBe(2);
  expect(gate(FEATURE, 'codex "explain exec" </dev/null')).toBe(0);
});

test("codex exec runs only with its stdin redirected, piped or supplied, in the forms agents write", () => {
  expect(gate(FEATURE, `codex exec ${SAFE} -s read-only "review" </dev/null > out.txt 2>&1`)).toBe(0);
  expect(gate(FEATURE, `cd /tmp && codex exec ${SAFE} "review" 0< /dev/null &`)).toBe(0);
  expect(gate(FEATURE, `codex exec ${SAFE} -s read-only "review" > out.txt 2>&1`)).toBe(2);
  expect(gate(FEATURE, `timeout 900 codex exec ${SAFE} "review" </dev/null`)).toBe(0);
  expect(gate(FEATURE, `timeout 900 codex exec ${SAFE} "review"`)).toBe(2);
  expect(gate(FEATURE, `sh -c "codex exec ${SAFE_UNQUOTED} review"`)).toBe(2);
  expect(gate(FEATURE, 'echo "codex exec is how a review runs"')).toBe(0);
  // A prompt that only looks like a redirection is no redirection; a pipe, heredoc or here-string feeds stdin.
  expect(gate(FEATURE, `codex exec ${SAFE} "<task>review</task>"`)).toBe(2);
  expect(gate(FEATURE, `codex exec ${SAFE} review</dev/null`)).toBe(0);
  expect(gate(FEATURE, `cat prompt.md | codex exec ${SAFE} -`)).toBe(0);
  expect(gate(FEATURE, `codex exec ${SAFE} - <<'EOF'\nreview\nEOF`)).toBe(0);
  expect(gate(MAIN, `codex exec ${SAFE} - <<< review; git push origin main`)).toBe(2);
  expect(gate(FEATURE, `false || codex exec ${SAFE} review`)).toBe(2);
  expect(gate(FEATURE, "timeout 5 printf '%s' codex exec")).toBe(0);
  expect(gate(FEATURE, `codex exec ${SAFE} review 3</dev/null`)).toBe(2);
  // Codex's plain argv: a prompt word is never shell syntax.
  expect(gate(FEATURE, ["codex", "exec", ...SAFE_ARGV, "<task>review</task>"])).toBe(2);
  expect(gate(FEATURE, ["codex", "exec", ...SAFE_ARGV, `it's "<b>" review`])).toBe(2);
  expect(gate(MAIN, ["git", "push", "origin", "main"])).toBe(2);
  expect(gate(FEATURE, ["bash", "-lc", `codex exec ${SAFE} review </dev/null`])).toBe(0);
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

test("a plan passes only with a debt plan section", () => {
  const plan = (text: string) => run({ tool_name: "ExitPlanMode", tool_input: { plan: text } });
  expect(plan("# Add X\n\nSteps.\n\n## Debt plan\nInventory: none")).toBe(0);
  expect(plan("# Fix copy\n### Debt plan\nn/a: copy only")).toBe(0);
  expect(plan("# Add X\n\nSteps, with the debt plan in mind.")).toBe(2);
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
}, 30_000); // real git pushes through the hook: slower than the 5 s default on a busy Mac

test("a verdict carries across a clean merge of the base that leaves the PR's files alone, and nothing else", () => {
  const repo = join(root, "carry");
  sh(root, "git init -q -b main carry");
  const c = (cmd: string) => sh(repo, cmd.replaceAll("COMMIT", "git -c user.name=t -c user.email=t@t commit -q"));
  const head = () => Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: repo }).stdout.toString().trim();
  c("printf '1\\n2\\n3\\n4\\n5\\n' > a.ts && echo b > b.ts && git add -A && COMMIT -m one");
  c("git checkout -q -b pr && sed -i.bak 1s/1/one/ a.ts && rm a.ts.bak && COMMIT -am pr");
  const reviewed = head();
  // main changes another file: merged cleanly, the verdict carries
  c("git checkout -q main && echo b2 > b.ts && COMMIT -am other && git checkout -q pr && git merge -q --no-edit main");
  expect(carries(repo, reviewed, head(), "main")).toBe(true);
  // a commit after the merge changes the PR: stale
  c("echo c > c.ts && git add c.ts && COMMIT -m extra");
  expect(carries(repo, reviewed, head(), "main")).toBe(false);
  // main changes a file the PR changed, far from its lines (a clean merge): stale
  c("git reset -q --hard HEAD~1 && git checkout -q main && sed -i.bak 5s/5/five/ a.ts && rm a.ts.bak && COMMIT -am same-file");
  c("git checkout -q pr && git merge -q --no-edit main");
  expect(carries(repo, reviewed, head(), "main")).toBe(false);
  // unknown commits are a no
  expect(carries(repo, "0".repeat(40), head(), "main")).toBe(false);
});

test("the landing lock: one holder per repo across worktrees, only the holder drops it, a stale lock is taken over", () => {
  const LOCK = join(import.meta.dir, "land-lock.sh");
  const repo = join(root, "locked");
  sh(root, "git clone -q origin.git locked");
  sh(repo, "git worktree add -q ../locked-b -b b");
  const env = { HOME: process.env.HOME, PATH: process.env.PATH, TMPDIR: root, LAND_LOCK_POLL: "0.1" };
  const lock = (cwd: string, op: string, extra = {}) =>
    Bun.spawnSync(["sh", LOCK, op], { cwd, env: { ...env, ...extra }, timeout: 1000 }).exitCode;
  expect(lock(repo, "take")).toBe(0);
  expect(lock(repo, "take")).toBe(0); // the holder again
  expect(lock(join(root, "locked-b"), "drop")).toBe(1);
  expect(lock(join(root, "locked-b"), "take")).not.toBe(0); // waits, killed by the timeout
  sh(root, "touch -t 202001010000 work-on-code-land-*");
  expect(lock(join(root, "locked-b"), "take")).toBe(0); // stale: taken over
  expect(lock(join(root, "locked-b"), "drop")).toBe(0);
  expect(lock(repo, "take")).toBe(0);
});
