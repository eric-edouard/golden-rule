# Verdict proof: the gate trusts a reviewer-posted status, not the PR body

Goal: a merge passes only with proof that a fresh reviewer run produced the verdict for the reviewed commit, with model and effort recorded and a per-repo minimum reviewer (hub plugins: at least Claude Opus 5.5 at medium).

Options weighed: (A) a local wrapper posts a commit status — picked; (B) reviewer in GitHub Actions with a GitHub App check run — unforgeable even by the local session, ~+200 lines, CI key per repo; upgrade path; (C) signed block in the PR body — key readable by the main session, proves no more than A.

What A proves: a client or PR author who edits the body or posts a status from their own account fails. It does not stop the main session on the same Mac (same token) from scripting a status; the gate refuses the plain `gh api …/statuses/…` call, a determined bypass stays possible (as gate.md already says of merges). Only B closes that.

## Milestone 1: proof in the gate

- [ ] `gate.ts`: export `CODEX_ENV_FLAGS`; `proofOf` (trusted statuses, nearest reviewed commit, one parser); policy read (absent ≠ unreadable, functional in data repos); `verdictOf` from the proof; every `gh pr merge` needs `--match-head-commit <full head sha>`; deny hand-posted `debt-verdict` statuses; header documents the trust limit
- [ ] `review.ts`: pins base and head shas, runs one full review read-only, parses the report, posts the status (effective model and effort, base ref and sha)
- [ ] `land.ts`: reviewed sha from `proofOf`, not the body; base round measured on base movement only
- [ ] `pr-status.ts`: keep only `<prefix>/check`
- [ ] rename `verdict-confirm.md` → `base-review.md` (its only job left)
- [ ] `gate.test.ts`: fake `gh` serves statuses, user and policy; cases: no status, wrong publisher, failure status, failed rerun after success, model or effort below policy, unreadable policy, passing body with no status, unpinned merge, hand-post denial, retargeted base, mechanical commit after review (allowed without policy, refused with), land message
- [ ] `SKILL.md` (tier table "confirming round", fast/ultrafast verdict lines, steps 2, 4, 5, the verdict launch line), `gate.md`, `README.md`
- [ ] Hub: `.work-on-code.json` through its own PR (after this merges)

## Debt plan
Tier: hard: trust boundary (merge gate)
Inventory:
- Verdict rule: `gate.ts:277-322` (`verdictOf`), called by `gate.ts:345` (`checkMerge`), `land.ts:63`, `pr-status.ts:83`
- Reviewed sha: `gate.ts:273` (`reviewedOf`), used at `land.ts:53`
- Carry: `gate.ts:209-255` (`carries`); base round: `land.ts:60` (`LAND_BASE_CHECKED`, self-declared)
- Status posting: `pr-status.ts:74-97`, derived from the body
- Reviewer launch commands: prose only, `SKILL.md:41-45`; codex safety flags at `gate.ts:351-355`
- Head pin: `land.ts:67`, `gate.ts:348-351`; API merges denied at `gate.ts:450-455`
- rg: `rg -n -i "Debt verdict|Reviewed:|Verdict:|match-head-commit|gh pr merge|statuses|codex exec|claude -p" skills/work-on-code`
Shape:
- Proof: one commit status, context `debt-verdict`, on the reviewed sha, posted only by `review.ts`; description `<verdict> | <model> <effort> | <base ref>@<base sha>` with the effective effort (the CLI default written out when omitted); failure on "rework needed", else success; one shared parser reads the report's `Verdict:` field wherever it sits among the final fields (missing or malformed: no status, the run fails)
- `review.ts <pr> <codex|claude> <model> [effort]`: refuses unless the checkout is clean and equals the PR's pushed head; runs a full review (verdict-review.md) read-only (codex flags from `CODEX_ENV_FLAGS`), prints the report, posts the status. No confirm mode: a rerun is another full run
- Policy, once per repo: optional `.work-on-code.json` at the repo root, read from the base branch on GitHub: `{"reviewer": {"models": ["claude-opus-5-5"], "effort": "medium", "publishers": ["<login>"]}}`; models match exactly; the effort order is one array in `gate.ts`; publishers default to the login running the gate (`gh api user`), so nothing is hard-coded; a failed read refuses (absent ≠ unreadable); a PR changing the policy is judged by the base branch's
- One reviewed-commit rule, shared by gate and land.ts: `proofOf(pr)` walks from the head back through the PR's commits and takes the nearest commit with a trusted `debt-verdict` status; on that commit the newest status decides (ties: highest status id), so a failed rerun voids an earlier success; the body's `Reviewed:` is no longer read
- Gate (`verdictOf`): a trusted status must exist and pass the policy's model and effort; then:
  - with a policy: the status sha is the head, or the head carries it (`carries`: clean base merge, base hunks >3 lines away); any other commit after the review needs a new run
  - without a policy: the status sha is an ancestor of the head; commits after it are the self-declared mechanical fixes (as today), still listed under `Mechanical fixes:` for humans
  - the status's base ref must equal the PR's base ref (a retargeted PR needs a new run)
  - unchanged: behind-base refusal
  - every `gh pr merge` must carry `--match-head-commit <the full head sha the gate checked>`
- Hand-posting: the gate denies `gh api …/statuses/…` naming `debt-verdict` (a determined bypass stays possible with the same token; documented in gate.ts's header and gate.md)
- Names: "plan review" stays plan review; a fix after the review means a rerun (with policy) or a mechanical fix (without); `verdict-confirm.md` becomes `base-review.md`
- Trust limit (gate.ts header, gate.md): proves a trusted publisher's wrapped run reviewed that commit; a PR author who is also a trusted publisher, or anyone with that token, can still script a status
State: the status is the only verdict state (per reviewed sha, on GitHub); the body's `## Debt verdict` is a human report the gate no longer parses; the policy lives only on the base branch
Deletes:
- `Verdict:`, `Reviewed:` and `Net lines:` body parsing in `verdictOf` and `land.ts`
- the body-derived `<prefix>/debt-verdict` status in `pr-status.ts:82-85` and its `verdictOf` import and `gate.md` paragraph
- the verdict-reviewer launch prose in `SKILL.md` (builder, watcher and intern launch lines stay), replaced by one `review.ts` line
- the confirming round (step 4) and its findings flow; `verdict-confirm.md` keeps only the base round, renamed
- Agent-tool subagents and `pi` as verdict reviewers
Net lines: about +130 / −45 (`review.ts` +60, `gate.ts` +45/−15, `land.ts` −5, `pr-status.ts` −8, tests +45, docs about −15)
Plan review: round 1 reshape (Codex astra): per-repo publishers, no confirm mode, one reviewed-commit rule shared with land.ts, base sha in the status, one report parser, policy read failure refuses, docs in gate.ts header. Round 2 (Codex astra): folded in without a third round: pin every merge, exact models, effective effort, nearest-commit proof with failed-rerun rule, base ref check, rename, trust-limit wording. Owner decisions: wrapped runs only (codex exec / claude -p); models as an explicit list; publishers permissive (default the merging login, a repo may name its own); keep the mechanical-fix skip in repos without a policy
