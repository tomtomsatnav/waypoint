Write the milestone as JSON to {{milestoneFile}}:
{ "title": "...", "tasks": [ { "id": "m{{n}}-short-id", "type": "<task type>", "after": ["m{{n}}-other-id"], "builder": "(optional) haiku|sonnet|opus", "goal": "self-contained instruction for the worker",
  "checks": [ { "name": "...", "run": "shell command, exit 0 = pass, run in the repo root" } ] } ] }
Rules for tasks and checks:
- 3 to 8 tasks per milestone, each a coherent unit a worker can finish in one sitting, in dependency order.
- "builder" is optional: leave it out for the default (Haiku for code, Sonnet for UI, each with a step up). Set "opus" for
  intricate work (engines, rendering, physics, AI, tricky algorithms) and for any task that failed before; "sonnet" for work
  a little beyond Haiku.
- Give every task "after": the ids of the tasks it truly needs ([] for none). Tasks that need nothing from each other and do
  not edit the same files run at the same time, each in its own copy of the repo, so split work to make that possible
  (e.g. server module and client screen) but never at the cost of two tasks editing one file.
- Every task needs at least one check that fails now and passes only when the task is genuinely done. Prefer tests you write now in
  tests/ (node:test, *.test.mjs, testing behaviour through public interfaces; assert every subprocess result you start). Keep pure
  logic in modules that tests can import without a browser or a bundler.
- Every test must finish on its own: give it a timeout (node --test --test-timeout=120000), close any browser in a finally
  block, and stop any server it starts in an after hook. A check whose command can hang stops the whole project.
- For anything visible in a browser, add a check that runs: node {{smoke}} --root <the directory that serves the built app> --keys "..."
  (it loads the page in a real browser, fails on console/page errors or a blank screen, and saves screenshots). If the app needs a
  build step, put the build in the same check: e.g. "npm run build && node {{smoke}} --root dist".
- Do not write the implementation. You may write tests, fixtures and SPEC.md; nothing else.
{{>types-help}}
