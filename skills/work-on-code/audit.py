#!/usr/bin/env python3
# Where the past days' coding time and tokens went, from Claude Code transcripts and review.ts's run log.
# Partial: background commands and Codex transcripts are not timed.
#   python3 -I audit.py [days=8] [project-substring]
import glob, json, os, re, sys, time, statistics as st
from collections import defaultdict
from datetime import datetime
from multiprocessing import Pool

DAYS = float(sys.argv[1]) if len(sys.argv) > 1 else 8
ONLY = sys.argv[2] if len(sys.argv) > 2 else ""
CUT = time.time() - DAYS * 86400
CATS = [("review.ts", r"review\.ts\b"), ("land.ts / lock", r"land(\.ts|-lock\.sh)"), ("codex exec", r"\bcodex\s+exec\b"),
        ("git push (pre-push check)", r"\bgit\s+push\b"), ("check", r"check\.sh|bun run check"),
        ("tests", r"bun test|vitest|jest|pytest"), ("wait loop", r"\bsleep\s+\d|until\b.*;\s*do"),
        ("git merge base", r"git\s+(merge|pull)\b.*\b(origin/)?(main|master)\b"),
        ("build/simulator", r"xcodebuild|eas build|expo run|agent-device|simctl")]

def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

def mine(path):
    if os.path.getmtime(path) < CUT:
        return None
    pending, tools, seen, tok = {}, [], set(), {}
    for line in open(path, errors="ignore"):
        try:
            r = json.loads(line); T = ts(r["timestamp"])
        except Exception:
            continue
        if T < CUT:
            continue
        m = r.get("message") or {}
        if r.get("type") == "assistant":
            u = m.get("usage") or {}
            if m.get("id") not in seen and u:
                seen.add(m.get("id")); k = m.get("model")
                tok[k] = tok.get(k, 0) + sum(u.get(k) or 0 for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
            for c in m.get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_use":
                    i = c.get("input") or {}
                    k = next((n for n, rx in CATS if re.search(rx, i.get("command", ""))), None) if c["name"] == "Bash" else c["name"]
                    if k and not i.get("run_in_background"):
                        pending[c["id"]] = (T, k)
        elif r.get("type") == "user" and isinstance(m.get("content"), list):
            for c in m["content"]:
                p = isinstance(c, dict) and pending.pop(c.get("tool_use_id"), None)
                if p:
                    tools.append((p[1], T - p[0]))
    return dict(sub="/subagents/" in path, tok=tok, tools=tools)

if __name__ == "__main__":
    files = [p for p in glob.glob(os.path.expanduser("~/.claude/projects/*/**/*.jsonl"), recursive=True) if ONLY in p]
    with Pool(4) as pool:
        S = [s for s in pool.imap_unordered(mine, files, chunksize=8) if s]
    tok = defaultdict(int); n = defaultdict(int); C = defaultdict(list)
    for s in S:
        for model, t in s["tok"].items():
            k = ("subagent " if s["sub"] else "main ") + str(model); tok[k] += t; n[k] += 1
        for c, d in s["tools"]:
            C[c].append(d)
    print(f"{len(S)} transcripts, last {DAYS:g} days{' in ' + ONLY if ONLY else ''}\n\ntokens read (input + cache):")
    for k, v in sorted(tok.items(), key=lambda a: -a[1])[:8]:
        print(f"  {v / 1e9:6.2f}B  {n[k]:5d} transcripts  {k}")
    print("\nforeground tool time:")
    for c, ds in sorted(C.items(), key=lambda a: -sum(a[1]))[:15]:
        print(f"  {sum(ds) / 3600:6.1f}h  n={len(ds):5d}  median {st.median(ds):4.0f}s  {c}")
    log = os.path.expanduser("~/.agents/work-on-code-runs.jsonl")
    runs = []
    for l in open(log) if os.path.exists(log) else []:
        try:
            runs.append(json.loads(l))
        except ValueError:
            pass  # a line still being appended
    runs = [r for r in runs if ts(r["at"]) >= CUT and ONLY in r["pr"]]
    for kind in ("full", "confirm"):
        ds = [r["seconds"] for r in runs if r["kind"] == kind]
        if ds:
            print(f"\nreview.ts {kind}: {len(ds)} runs, median {st.median(ds) / 60:.1f} min, total {sum(ds) / 3600:.1f}h")
