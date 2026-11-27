import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { carries, commands, isData } from "./gate";
import { touched } from "./pr-status";

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
  expect(gate(MAIN, "gh api repos/o/r/statuses/abc -f context=debt-verdict -f state=success")).toBe(2);
  expect(gate(MAIN, "gh api repos/o/r/statuses/abc -f context=ci/check -f state=success")).toBe(0);
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
  expect(isData(".work-on-code.json", true)).toBe(false);
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
    `codex -m gpt --strict-config -c allow_login_shell=false exec ${inherit} review </dev/null`,
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
    `codex --strict-config exec review </dev/null`,
    `bash -lc "codex exec review </dev/null"`,
    // Not the protected key, an enclosing table set after it, the subcommand glued to its redirection.
    `codex exec -c '"allow_login_shell"=false' ${inherit} review </dev/null`,
    `codex exec ${SAFE} -c 'shell_environment_policy={inherit="all"}' review </dev/null`,
    "codex exec</dev/null",
    "codex exec&>out.txt </dev/null",
    // A boolean is not a string, and a quoted `<` is a value's, not a redirection.
    `codex exec -c 'allow_login_shell="false"' ${inherit} review </dev/null`,
    `codex exec -c 'allow_login_shell=false<x' ${inherit} review </dev/null`,
  ]) {
    expect([cmd, gate(FEATURE, cmd)]).toEqual([cmd, 2]);
  }
  expect(gate(FEATURE, ["bash", "-lc", `codex exec resume --last ${SAFE} review </dev/null`])).toBe(0);
  expect(gate(FEATURE, ["bash", "-lc", "codex exec resume --last review </dev/null"])).toBe(2);
  // Codex's own argv with a global option first is one command's words, never a shell script.
  expect(gate(FEATURE, ["codex", "-c", "allow_login_shell=false", "exec", "review"])).toBe(2);
  expect(gate(FEATURE, ["/bin/dash", "-c", "codex exec review </dev/null"])).toBe(2);
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

test("a verdict carries across a clean merge of the base whose hunks stay more than 3 lines from the PR's, and nothing else", () => {
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
  // main changes the PR's file 4 lines from its change (line 5 vs 1): carries
  c("git reset -q --hard HEAD~1 && git checkout -q main && sed -i.bak 5s/5/five/ a.ts && rm a.ts.bak && COMMIT -am far");
  c("git checkout -q pr && git merge -q --no-edit main");
  expect(carries(repo, reviewed, head(), "main")).toBe(true);
  // 3 lines from it (line 4), still a clean merge: stale
  c("git checkout -q main && sed -i.bak 4s/4/four/ a.ts && rm a.ts.bak && COMMIT -am near");
  c("git checkout -q pr && git merge -q --no-edit main");
  expect(carries(repo, reviewed, head(), "main")).toBe(false);
  // a mode change on the PR's file counts as the whole file, even beside a far edit: stale
  c(`git checkout -q -b base2 ${reviewed}~1 && chmod +x a.ts && sed -i.bak 5s/5/five/ a.ts && rm a.ts.bak && COMMIT -am mode && git checkout -q -b pr2 ${reviewed} && git merge -q --no-edit base2`);
  expect(carries(repo, reviewed, head(), "base2")).toBe(false);
  // unknown commits are a no
  expect(carries(repo, "0".repeat(40), head(), "main")).toBe(false);
});

test("the landing lock: one holder per repo across worktrees, only the holder drops it, a stale lock is taken over", () => {
  const LOCK = join(import.meta.dir, "land-lock.sh");
  const repo = join(root, "locked");
  sh(root, "git clone -q origin.git locked");
  sh(repo, "git worktree add -q ../locked-b -b b");
  // A contended take reaches sleep. End it there so contention is independent of machine speed.
  const lockBin = mkdtempSync(join(root, "lock-bin-"));
  writeFileSync(join(lockBin, "sleep"), "#!/bin/sh\nexit 42\n", { mode: 0o755 });
  const env = { HOME: process.env.HOME, PATH: `${lockBin}:${process.env.PATH}`, TMPDIR: root };
  const lock = (cwd: string, op: string, ...areas: string[]) =>
    Bun.spawnSync(["sh", LOCK, op, ...areas], { cwd, env }).exitCode;
  const b = join(root, "locked-b");
  expect(lock(repo, "take")).toBe(0);
  expect(lock(repo, "take")).toBe(0); // the holder again
  expect(lock(join(root, "locked-b"), "drop")).toBe(1);
  expect(lock(b, "take")).toBe(42);
  sh(root, "touch -t 202001010000 work-on-code-land-*");
  expect(lock(join(root, "locked-b"), "take")).toBe(0); // stale: taken over
  expect(lock(join(root, "locked-b"), "drop")).toBe(0);
  expect(lock(repo, "take")).toBe(0);
  // A lock whose landing process died is taken over at once, whatever its age.
  const dead = Bun.spawnSync(["true"]).pid;
  expect(Bun.spawnSync(["sh", LOCK, "take", "gone"], { cwd: repo, env: { ...env, LAND_LOCK_PID: String(dead) } }).exitCode).toBe(0);
  expect(lock(b, "take", "gone")).toBe(0);
  expect(lock(b, "drop", "gone")).toBe(0);
  // Areas: different areas land in parallel; a PR spanning a held area waits; a bad name is refused.
  expect(lock(repo, "take", "server")).toBe(0);
  expect(lock(b, "take", "phone")).toBe(0);
  expect(lock(b, "take", "server", "phone")).toBe(42); // waits on server
  expect(lock(repo, "drop", "server")).toBe(0);
  expect(lock(b, "take", "server", "phone")).toBe(0); // resumes past phone, already held
  expect(lock(b, "drop", "phone", "server")).toBe(0);
  expect(lock(b, "take", "a/b")).toBe(2);
  // Case-folded; a drop releases what it holds even past a lock it doesn't.
  expect(lock(repo, "take", "Server")).toBe(0);
  expect(lock(b, "take", "phone")).toBe(0);
  expect(lock(b, "drop", "server", "phone")).toBe(1);
  expect(lock(repo, "take", "phone", "SERVER")).toBe(0);
  expect(lock(repo, "drop", "phone", "server")).toBe(0);
}, 30_000);

test("the PR status hook names each PR a command pushed or edited, and nothing else", () => {
  expect(touched("cd sub && git push -u origin x", "/r")).toEqual([{ dir: "/r/sub" }]);
  expect(touched("git -C /a push", "/r")).toEqual([{ dir: "/a" }]);
  expect(touched("gh pr edit 12 --body-file b.md && gh pr ready 13", "/r")).toEqual([
    { dir: "/r", number: "12" },
    { dir: "/r", number: "13" },
  ]);
  expect(touched("gh pr edit https://github.com/o/x/pull/4 -t y", "/r")).toEqual([{ dir: "/r", repo: "o/x", number: "4" }]);
  expect(touched("gh pr edit 3 -R o/other", "/r")).toEqual([{ dir: "/r", repo: "o/other", number: "3" }]);
  expect(touched('bash -c "gh pr create -t x -b y"', "/r")).toEqual([{ dir: "/r" }]);
  expect(touched("gh api -X PATCH repos/o/x/pulls/7 -F body=@b.md", "/r")).toEqual([{ dir: "/r", repo: "o/x", number: "7" }]);
  expect(touched("gh api -X PATCH repos/{owner}/{repo}/pulls/7 -F body=@b.md", "/r")).toEqual([{ dir: "/r", number: "7" }]);
  for (const cmd of ["git push --dry-run", "git push origin --tags", "gh pr edit -R o/other", "gh pr view", "echo git push", "gh api repos/o/r/pulls/7"]) {
    expect([cmd, touched(cmd, "/r")]).toEqual([cmd, []]);
  }
});

// Only the base policy and statuses returned by gh can authorize a code merge.
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const ancestor = "c".repeat(40);
const prView = {
  baseRefName: "main", baseRefOid: baseSha, headRefName: "pr", headRefOid: headSha,
  url: "https://github.com/o/r/pull/7", files: [{ path: "shared.ts" }], changedFiles: 1,
  body: `## Debt verdict\nReviewed: ${headSha}\nVerdict: no debt added`,
};
const status = {
  state: "success", creator: { login: "reviewer" }, context: "debt-verdict",
  description: `no debt added | claude-opus-5-5 medium | main@${baseSha}`, id: 1, created_at: "2026-11-27T01:00:00Z",
};
const bin = mkdtempSync(join(root, "bin-"));
writeFileSync(join(bin, "gh"), `#!/bin/sh
remote() {
  if [ -n "$REMOTE" ]; then
    printf '%s' "$1" | sed "s/REMOTE_HEAD/$(git --git-dir="$REMOTE" rev-parse pr)/g;s/REMOTE_BASE/$(git --git-dir="$REMOTE" rev-parse main)/g"
  else
    printf '%s' "$1"
  fi
}
case "$1 $2" in
  'pr view') remote "$PR_VIEW";;
  'pr merge') exit 0;;
  'api user') echo reviewer;;
  'api rate_limit') [ -n "$RATE" ] && echo "$RATE" || exit 1;;
  *git/trees/${headSha}) if [ -n "$HEAD_TREE" ]; then echo "$HEAD_TREE"; else echo "$TREE"; fi;;
  *git/trees/*) echo "$TREE";;
  *contents/.work-on-code.json*) [ -n "$POLICY" ] && echo "$POLICY";;
  *commits/"$REVIEWED"/statuses*) echo "$STATUSES";;
  *commits/"$FULL"/statuses*) echo "$FULL_STATUSES";;
  *commits/*/statuses*) echo "$OTHER_STATUSES";;
  *compare/*per_page*) remote "$COMPARE";;
  *compare/*) echo "$BEHIND";;
  *statuses/*) echo "$@" > "$POSTED";;
  *) exit 1;;
esac
`, { mode: 0o755 });
// The PR's commits as GitHub's compare gives them: head, then its first parents.
const chain = (...shas: string[]) => shas.map((sha, i) => ({ sha, parents: shas[i + 1] ? [{ sha: shas[i + 1] }] : [] }));
function fakeGh(extra: Record<string, string> = {}, files: object[] = [{ filename: "shared.ts" }]) {
  return {
    HOME: process.env.HOME, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root, PR_VIEW: JSON.stringify(prView),
    REVIEWED: headSha, STATUSES: JSON.stringify([[status]]), OTHER_STATUSES: "[[]]", BEHIND: "0",
    TREE: '{"truncated":false,"tree":[]}', COMPARE: JSON.stringify({ commits: chain(headSha, ancestor), files }), ...extra,
  };
}

test("only the nearest trusted verdict authorizes its pinned head", () => {
  const pinned = `gh pr merge 7 --match-head-commit ${headSha}`;
  const merge = (extra: Record<string, string>, command = pinned, files?: object[]) => Bun.spawnSync(["bun", GATE], {
    env: fakeGh(extra, files), stdin: new TextEncoder().encode(JSON.stringify({ cwd: FEATURE, tool_input: { command } })),
  }).exitCode;
  const failed = { ...status, state: "failure", description: status.description.replace("no debt added", "rework needed"), id: 2 };
  const strict = {
    TREE: '{"truncated":false,"tree":[{"path":".work-on-code.json","type":"blob","mode":"100644","sha":"policy"}]}',
    POLICY: '{"reviewer":{"models":["claude-opus-5-5"],"effort":"medium","publishers":["reviewer"]}}',
  };
  expect(merge({})).toBe(0);
  expect(merge(strict)).toBe(0);
  for (const statuses of [[], [{ ...status, creator: { login: "author" } }], [failed], [status, failed]]) {
    expect(merge({ STATUSES: JSON.stringify([statuses]) })).toBe(2);
  }
  expect(merge({ STATUSES: JSON.stringify([[{ ...status, description: "ok" }]]) })).toBe(2);
  expect(merge({ ...strict, POLICY: "" })).toBe(2);
  expect(merge({ ...strict, POLICY: "{}" })).toBe(2);
  expect(merge({ ...strict, POLICY: strict.POLICY.replace("medium", "high") })).toBe(2);
  expect(merge({ ...strict, POLICY: strict.POLICY.replace("claude-opus-5-5", "claude-opus") })).toBe(2);
  expect(merge({ ...strict, POLICY: strict.POLICY.replace('["reviewer"]', '["maintainer"]') })).toBe(2);
  expect(merge({ PR_VIEW: JSON.stringify({ ...prView, baseRefName: "other" }) })).toBe(2);
  expect(merge({ BEHIND: "1" })).toBe(2);
  expect(merge({}, "gh pr merge 7")).toBe(2);
  expect(merge({}, pinned.slice(0, -1))).toBe(2);
  const docs = { STATUSES: "[[]]" };
  const readme = [{ filename: "README.md" }];
  expect(merge(docs, pinned, readme)).toBe(0);
  expect(merge({ ...docs, ...strict }, pinned, readme)).toBe(0);
  expect(merge(docs, pinned, [{ filename: "notes.md", previous_filename: ".work-on-code.json" }])).toBe(2); // policy renamed into docs
  expect(merge(docs, pinned, [{ filename: "docs/old.md", previous_filename: "tool.ts" }])).toBe(2); // script renamed into docs
  expect(merge(docs, pinned, [{ filename: "skills/x/verdict-review.md" }])).toBe(2); // reviewer prompts are instructions
  expect(merge(docs, "gh pr merge 7", readme)).toBe(2);
  // A verdict of an older commit holds for no head, policy or not: the fixes after it need a confirm review.
  expect(merge({ REVIEWED: ancestor })).toBe(2);
  expect(merge({ ...strict, REVIEWED: ancestor })).toBe(2);
  // A confirm on the head stands on the nearest full review behind it; a policy binds both.
  const confirmed = { ...status, description: `confirm no debt added | claude-opus-5-5 medium | main@${baseSha}`, id: 3 };
  const full = (s: object) => ({ STATUSES: JSON.stringify([[confirmed]]), OTHER_STATUSES: JSON.stringify([[s]]) });
  expect(merge({ ...strict, ...full(status) })).toBe(0);
  const cheap = { ...confirmed, description: confirmed.description.replace("claude-opus-5-5 medium", "claude-haiku low") };
  expect(merge({ ...full(status), STATUSES: JSON.stringify([[cheap]]) })).toBe(0); // no policy: any confirm model
  expect(merge({ ...strict, ...full(status), STATUSES: JSON.stringify([[cheap]]) })).toBe(2); // policy: the confirm meets it too
  const landed = { ...confirmed, description: confirmed.description.replace("confirm ", "land "), id: 4 };
  expect(merge({ ...strict, ...full(status), STATUSES: JSON.stringify([[landed]]) })).toBe(0); // a land review stands like a confirm
  expect(merge({ ...strict, ...full(failed) })).toBe(0); // the confirm says its Blocking items are fixed
  expect(merge({ ...strict, ...full(confirmed) })).toBe(2); // confirms only, no full review
  expect(merge({ ...strict, ...full({ ...status, description: status.description.replace("medium", "low") }) })).toBe(2);
  expect(merge({ ...strict, ...full({ ...status, description: status.description.replace("main@", "other@") }) })).toBe(2);
  expect(merge({ ...strict, ...full(status), STATUSES: JSON.stringify([[{ ...confirmed, state: "failure", description: confirmed.description.replace("no debt added", "rework needed") }]]) })).toBe(2);
  expect(merge({ ...strict, ...full(status), STATUSES: JSON.stringify([[{ ...confirmed, description: `confirm ${confirmed.description}` }]]) })).toBe(2);
  // Only first parents count, and only MAX_WALK of them: the hook must stay inside its timeout.
  const side = "d".repeat(40);
  const merged = [{ sha: headSha, parents: [{ sha: ancestor }, { sha: side }] }, { sha: ancestor, parents: [] }, { sha: side, parents: [] }];
  expect(merge({ REVIEWED: side, COMPARE: JSON.stringify({ commits: merged, files: [{ filename: "shared.ts" }] }) })).toBe(2);
  const long = Array.from({ length: 25 }, (_, i) => i.toString(16).padStart(40, "e"));
  expect(merge({ REVIEWED: long[22]!, COMPARE: JSON.stringify({ commits: chain(headSha, ...long), files: [{ filename: "shared.ts" }] }) })).toBe(2);
}, 30_000);

test("review.ts posts a full report's verdict on the pushed commit only", () => {
  sh(root, "git clone -q origin.git reviewing && cd reviewing && git checkout -qb pr");
  const dir = join(root, "reviewing");
  const sha = (ref: string) => Bun.spawnSync(["git", "rev-parse", ref], { cwd: dir }).stdout.toString().trim();
  const base = sha("HEAD");
  sh(dir, "echo review > shared.ts && git add shared.ts && git -c user.name=t -c user.email=t@t commit -qm pr");
  const head = sha("HEAD");
  const posted = join(root, "posted");
  const report = join(root, "report");
  const args = join(root, "review-args");
  const prompt = join(root, "review-prompt");
  writeFileSync(join(bin, "codex"), `#!/bin/sh
printf '%s\\n' "$@" > "${args}"
cat > "${prompt}"
echo 'model: gpt-review' >&2
echo 'reasoning effort: high' >&2
cat "${report}"
`, { mode: 0o755 });
  writeFileSync(join(bin, "claude"), `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args.includes("--effort") || args[args.indexOf("--model") + 1] !== "opus") process.exit(2);
const stop = JSON.parse(args[args.indexOf("--settings") + 1]).hooks.Stop[0].hooks[0];
const hook = Bun.spawnSync(["sh", "-c", stop.command], { env: { ...process.env, CLAUDE_EFFORT: "medium" } });
if (hook.exitCode !== 0) process.exit(2);
console.log(JSON.stringify({ is_error: false, result: "Verdict: no debt added", modelUsage: { "claude-opus-5-5": {} } }));
`, { mode: 0o755 });
  const review = (pushed = head, cli = "codex", model = "gpt-review") => Bun.spawnSync(["bun", join(import.meta.dir, "review.ts"), dir, "7", cli, model], {
    cwd: root, env: fakeGh({ PR_VIEW: JSON.stringify({ ...prView, baseRefOid: base, headRefOid: pushed }), POSTED: posted }),
  });
  writeFileSync(report, "Plan: matched\nVerdict: debt reduced\nNet lines: +1 / −2\n");
  expect(review().exitCode).toBe(0);
  expect(readFileSync(posted, "utf8")).toContain(`statuses/${head}`);
  expect(readFileSync(args, "utf8")).toContain("mcp_servers={}");
  expect(readFileSync(posted, "utf8")).toContain("state=success");
  expect(readFileSync(posted, "utf8")).toContain(`debt reduced | gpt-review high | main@${base}`);
  expect(readFileSync(args, "utf8")).toContain("read-only");
  expect(review(head, "claude", "opus").exitCode).toBe(0);
  expect(readFileSync(posted, "utf8")).toContain(`no debt added | claude-opus-5-5 medium | main@${base}`);
  writeFileSync(report, "Verdict: rework needed\n");
  review();
  expect(readFileSync(posted, "utf8")).toContain("state=failure");
  unlinkSync(posted);
  for (const text of ["No verdict", "Verdict: looks OK", "Verdict: debt reduced\nVerdict: rework needed"]) {
    writeFileSync(report, text);
    expect(review().exitCode).not.toBe(0);
    expect(existsSync(posted)).toBe(false);
  }
  writeFileSync(report, "Verdict: debt reduced");
  expect(review(base).exitCode).not.toBe(0);
  expect(Bun.spawnSync(["bun", join(import.meta.dir, "review.ts"), dir, "7", "codex", "gpt-review"], { cwd: dir, env: fakeGh() }).exitCode).not.toBe(0); // started inside the checkout
  writeFileSync(join(dir, "dirty"), "unreviewed");
  expect(review().exitCode).not.toBe(0);
  expect(existsSync(posted)).toBe(false);
  unlinkSync(join(dir, "dirty"));
  // Confirm: the small fixes since the nearest full review, judged with that review's saved report.
  expect(review().exitCode).toBe(0);
  const commit = (cmd: string) => { sh(dir, `${cmd} && git add shared.ts && git -c user.name=t -c user.email=t@t commit -qm fix`); return sha("HEAD"); };
  const confirm = (pushed: string, ...parents: string[]) => Bun.spawnSync(["bun", join(import.meta.dir, "review.ts"), dir, "7", "confirm", "codex", "gpt-mini"], {
    cwd: root, env: fakeGh({ PR_VIEW: JSON.stringify({ ...prView, baseRefOid: base, headRefOid: pushed }), POSTED: posted,
      REVIEWED: head, COMPARE: JSON.stringify({ commits: chain(pushed, ...parents, head), files: [{ filename: "shared.ts" }] }) }),
  });
  const saved = join(dir, ".git", "work-on-code", `${head}.md`);
  writeFileSync(report, "Verdict: no debt added\nunposted");
  expect(Bun.spawnSync(["bun", join(import.meta.dir, "review.ts"), dir, "7", "codex", "gpt-review"], {
    cwd: root, env: fakeGh({ PR_VIEW: JSON.stringify({ ...prView, baseRefOid: base, headRefOid: head }), POSTED: join(root, "none", "x") }),
  }).exitCode).not.toBe(0); // the post fails: the saved report stays the posted one
  expect(readFileSync(saved, "utf8")).toBe("Verdict: debt reduced");
  unlinkSync(posted);
  const fix = commit("echo fix >> shared.ts");
  writeFileSync(report, "Verdict: no debt added");
  expect(confirm(fix).exitCode).toBe(0);
  expect(readFileSync(posted, "utf8")).toContain(`statuses/${fix}`);
  expect(readFileSync(posted, "utf8")).toContain(`confirm no debt added | gpt-review high | main@${base}`);
  expect(readFileSync(prompt, "utf8")).toContain("Confirming fixes");
  expect(readFileSync(prompt, "utf8")).toContain("Verdict: debt reduced"); // the full review's report
  expect(readFileSync(prompt, "utf8")).toContain("+fix");
  expect(readFileSync(prompt, "utf8")).not.toContain("+review"); // the reviewed change is not shown again
  unlinkSync(posted);
  // Three rounds at most: a failing confirm may be followed by one more confirm, never a third.
  const failedConfirm = { ...status, state: "failure", description: `confirm rework needed | gpt-review high | main@${base}` };
  const big = commit("seq 1 100 >> shared.ts"); // any fix size
  const second = (headStatuses: object[][]) => Bun.spawnSync(["bun", join(import.meta.dir, "review.ts"), dir, "7", "confirm", "codex", "gpt-mini"], {
    cwd: root, env: fakeGh({ PR_VIEW: JSON.stringify({ ...prView, baseRefOid: base, headRefOid: big }), POSTED: posted, REVIEWED: fix,
      STATUSES: JSON.stringify([[failedConfirm]]), OTHER_STATUSES: JSON.stringify(headStatuses), FULL: head, FULL_STATUSES: JSON.stringify([[status]]),
      COMPARE: JSON.stringify({ commits: chain(big, fix, head), files: [{ filename: "shared.ts" }] }) }),
  });
  expect(second([[]]).exitCode).toBe(0); // the second confirm
  expect(readFileSync(posted, "utf8")).toContain(`statuses/${big}`);
  unlinkSync(posted);
  expect(second([[failedConfirm]]).stderr.toString()).toContain("the loop stops"); // never a third
  expect(second([[failedConfirm, { ...failedConfirm, id: 3 }]]).stderr.toString()).toContain("the loop stops"); // reruns count
  // A policy: confirms below it use no round, and one below it is refused before it runs.
  const policyTree = { TREE: '{"truncated":false,"tree":[{"path":".work-on-code.json","type":"blob","mode":"100644","sha":"policy"}]}',
    POLICY: '{"reviewer":{"models":["gpt-mini"],"effort":"medium","publishers":["reviewer"]}}' };
  const withPolicy = (model: string, effort?: string) => Bun.spawnSync(["bun", join(import.meta.dir, "review.ts"), dir, "7", "confirm", "codex", model, ...(effort ? [effort] : [])], {
    cwd: root, env: fakeGh({ ...policyTree, PR_VIEW: JSON.stringify({ ...prView, baseRefOid: base, headRefOid: big }), POSTED: posted, REVIEWED: fix,
      STATUSES: JSON.stringify([[failedConfirm]]), OTHER_STATUSES: JSON.stringify([[failedConfirm]]), FULL: head,
      FULL_STATUSES: JSON.stringify([[{ ...status, description: `debt added | gpt-mini high | main@${base}` }]]),
      COMPARE: JSON.stringify({ commits: chain(big, fix, head), files: [{ filename: "shared.ts" }] }) }),
  });
  expect(withPolicy("gpt-mini", "low").stderr.toString()).toContain("reviewer policy"); // refused before running
  expect(existsSync(posted)).toBe(false);
  expect(withPolicy("gpt-mini", "medium").exitCode).toBe(0); // the two gpt-review high confirms are below it: no round used
  unlinkSync(posted);
  sh(dir, `git reset -q --hard ${fix} && rm -r .git/work-on-code`);
  expect(confirm(fix).exitCode).not.toBe(0); // no saved report of the full review
  expect(existsSync(posted)).toBe(false);
  sh(dir, `git reset -q --hard ${head} && mkdir .git/work-on-code && echo 'Verdict: debt reduced' > .git/work-on-code/${head}.md`);
  expect(confirm(head).stderr.toString()).toContain("no fixes since"); // nothing to confirm
  expect(existsSync(posted)).toBe(false);
  // Land: a base merge resolved by hand is reviewed alone, as a "land" status.
  sh(dir, `git checkout -q -b side ${base} && echo side > shared.ts && git add shared.ts && git -c user.name=t -c user.email=t@t commit -qm side && git checkout -q pr`);
  const side = sha("side");
  sh(dir, "git -c user.name=t -c user.email=t@t merge -q side || true");
  sh(dir, "echo resolved > shared.ts && git add shared.ts && git -c user.name=t -c user.email=t@t commit -qm 'merge side'");
  const merged = sha("HEAD");
  const reviewedFull = { ...status, description: `debt reduced | gpt-review high | main@${base}` };
  const land = (pushed: string, statuses = [[reviewedFull]]) => Bun.spawnSync(["bun", join(import.meta.dir, "review.ts"), dir, "7", "land", "codex", "gpt-mini"], {
    cwd: root, env: fakeGh({ PR_VIEW: JSON.stringify({ ...prView, baseRefOid: side, headRefOid: pushed }), POSTED: posted,
      REVIEWED: head, STATUSES: JSON.stringify(statuses), COMPARE: JSON.stringify({ commits: chain(pushed, head), files: [{ filename: "shared.ts" }] }) }),
  });
  writeFileSync(report, "Base: clean\nVerdict: no debt added");
  expect(land(merged).exitCode).toBe(0);
  expect(readFileSync(posted, "utf8")).toContain(`land no debt added | gpt-review high | main@${side}`);
  expect(readFileSync(prompt, "utf8")).toContain("+resolved"); // the hand resolution
  expect(readFileSync(prompt, "utf8")).toContain("<<<<<<<"); // against git's own conflicted merge
  unlinkSync(posted);
  const failedFull = { ...reviewedFull, state: "failure", description: reviewedFull.description.replace("debt reduced", "rework needed") };
  expect(land(merged, [[failedFull]]).stderr.toString()).toContain("did not pass"); // never launders a failed review
  expect(existsSync(posted)).toBe(false);
  sh(dir, `git reset -q --hard ${head}`);
  expect(land(head).stderr.toString()).toContain("merges the base"); // not a merge commit
  expect(Bun.spawnSync(["bun", join(import.meta.dir, "review.ts"), dir, "7", "codex", "gpt-review"], {
    cwd: root, env: fakeGh({ RATE: "3 1800000000", PR_VIEW: JSON.stringify({ ...prView, baseRefOid: base, headRefOid: head }), POSTED: posted }),
  }).stderr.toString()).toContain("API limit"); // no review GitHub could not record
  expect(existsSync(posted)).toBe(false);
  expect(existsSync(posted)).toBe(false);
}, 30_000);

test("land.ts lands only from the PR's branch, and asks for a base round when the base changed the PR's files", () => {
  const LAND = join(import.meta.dir, "land.ts");
  const c = (cwd: string, cmd: string) => sh(cwd, `git -c user.name=t -c user.email=t@t ${cmd}`);
  // The base pushes skip pre-push hooks (the global gate refuses code on main).
  sh(root, "git clone -q origin.git base2");
  const base2 = join(root, "base2");
  sh(base2, "seq 1 10 > shared.ts && git add shared.ts");
  c(base2, "commit -q -m shared && git push -q --no-verify origin main");
  sh(root, "git clone -q origin.git landing && cd landing && git checkout -q -b pr");
  const dir = join(root, "landing");
  sh(dir, "sed -i.bak 1s/1/one/ shared.ts && rm shared.ts.bak && git add shared.ts");
  c(dir, "commit -q -m pr && git push -q origin pr");
  const rev = () => Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: dir }).stdout.toString().trim();
  const reviewed = rev();
  const oldBase = Bun.spawnSync(["git", "rev-parse", "origin/main"], { cwd: dir }).stdout.toString().trim();
  sh(dir, "sed -i.bak 1s/one/first/ shared.ts && rm shared.ts.bak && git add shared.ts");
  c(dir, "commit -q -m mechanical && git push -q origin pr");
  const fixed = rev();
  const full = { ...status, description: status.description.replace(baseSha, oldBase) };
  const env = fakeGh({
    REMOTE: join(root, "origin.git"), REVIEWED: fixed, FULL: reviewed, FULL_STATUSES: JSON.stringify([[full]]),
    STATUSES: JSON.stringify([[{ ...full, description: `confirm ${full.description}` }]]),
    PR_VIEW: JSON.stringify({ ...prView, headRefOid: "REMOTE_HEAD", baseRefOid: "REMOTE_BASE" }),
    COMPARE: JSON.stringify({ commits: chain("REMOTE_HEAD", fixed, reviewed), files: [{ filename: "shared.ts" }] }),
  });
  const land = (cwd: string, extra: Record<string, string> = {}) =>
    Bun.spawnSync(["bun", LAND, "7"], { cwd, env: { ...env, ...extra } });
  expect(land(FEATURE).exitCode).toBe(1); // another branch's checkout
  expect(land(dir).exitCode).toBe(0); // a confirmed fix lands, with no base round when the base left the PR's files alone
  sh(base2, "sed -i.bak 10s/10/ten/ shared.ts && rm shared.ts.bak && git add shared.ts");
  c(base2, "commit -q -m far && git push -q --no-verify origin main");
  const first = land(dir);
  expect(first.exitCode).toBe(3); // the base changed the PR's file
  const base = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: base2 }).stdout.toString().trim();
  expect(first.stderr.toString()).toContain(`git diff ${oldBase}..${base}`);
  expect(first.stderr.toString()).toContain(`LAND_BASE_CHECKED=${base}`);
  expect(land(dir, { LAND_BASE_CHECKED: base }).exitCode).toBe(0);
  sh(base2, "sed -i.bak 9s/9/nine/ shared.ts && rm shared.ts.bak && git add shared.ts");
  c(base2, "commit -q -m again && git push -q --no-verify origin main");
  expect(land(dir, { LAND_BASE_CHECKED: base }).exitCode).toBe(3); // the base moved again: asked again
  // A confirm naming a newer base never skips the base round from the full review's base.
  const latest = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: base2 }).stdout.toString().trim();
  const newer = JSON.stringify([[{ ...full, description: `confirm ${full.description.replace(oldBase, latest)}` }]]);
  expect(land(dir, { STATUSES: newer, REVIEWED: rev() }).exitCode).toBe(3);
}, 30_000);
