{{goal}}

The product is described in SPEC.md (read it first). Commit your work with git as you go.{{#parallel}}

Other workers are building other tasks at the same time in their own copies of the repo; stay within this task. If you start a server, listen on the port in $PORT ({{port}}), not a fixed one.{{/parallel}}{{#ownerNotes}}

The owner sent these notes while the project is running. Keep to them where they touch this task (they override the brief and the plan where they conflict); the planner will fold them into the plan at the next review:
{{ownerNotes}}{{/ownerNotes}}{{#failNotes}}

A previous attempt at this task failed. Notes from looking into why:
{{failNotes}}{{/failNotes}}

Start by reading SPEC.md, PROGRESS.md (if present), APPROACH.md (if present: technical advice on libraries, techniques and reference projects) and git log, and run ./init.sh to check the app still works before changing anything. Test what you build in a real browser as a user would (a short Playwright script via Bash works). Run tests in the foreground with a time limit (node --test --test-timeout=120000 ...), never in the background with a loop that waits for their output: a test that does not finish within its limit is a bug to fix (a missing timeout, a server or browser left open, an event that never comes), not something to wait for. When the task is done, append two or three lines to PROGRESS.md (what you did, what is next) and set "passes": true in FEATURES.json only for features you verified end to end. Never edit or delete anything else in FEATURES.json.
