# Architecture: the questions and the naming rules

Read by the planner and by every reviewer. A new question goes here, once.

## The questions

Answer each with file:line evidence from your own `rg`.

1. Will any rule or computation be decided in two places (a second place that *composes* shared pieces differently
   counts), or is there a second way of doing what the codebase already does?
2. Is a rename or migration left half-done (an old name, path, caller or doc still alive)?
3. Is any state copied instead of derived, or a magic value (a sentinel date, an empty string, a -1) instead of its own
   field or type?
4. Does any new type, object or module do more than one job (name each job)?
5. For queues, retries and schedules: can old or failing work starve new work? What runs first?
6. Is any state global that belongs to each item (a reason, a status, a timestamp)?
7. A workaround: a special case for one input, a flag switching behavior, a retry or try-catch hiding an ordering bug?
8. Does each new name say what it is, one word per concept (below)?
9. Is a decision this relies on written in the repo's AGENTS.md?
10. Is there a shape that lands it at fewer net lines? What does it delete?

## Names are architecture

A name is the cheapest place to see a concept that is wrong or doubled: two names for one thing, one name for two
things, a name that no longer says what the thing does. A naming problem is a design problem, never style.

- **Every concept has one word**, written in the repo's glossary when it has one, the same in docs, UI, API and code.
  A new concept gets its word, and its glossary line, in the same change.
- **Clarity beats brevity.** A longer name that says what the thing is and does (`read_open_invoices` over
  `invoices`, `waiting_on_supplier` over `waiting`) beats a short one the reader has to look up.
- **A clearer name is worth its rename, data included.** In data only the repo's own code reads, rename everywhere
  and backfill: one migration rewrites the stored values (a field, an enum value, an id prefix, a file name), then
  the old name leaves the code, with no alias that reads both spellings forever. Existing data alone is never a
  reason to keep a worse name. Data someone else reads or owns (a production database, a public API, a client
  already shipped, a repo shared with someone) is ask-first: propose the rename and its migration, and the repo's
  AGENTS.md can rule it out. Batch renames that cost the user something (a reconnect, a re-login) into one change.
- **No person's name** in code, stored values or ids: name the role.
