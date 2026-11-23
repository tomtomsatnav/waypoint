# waypoint's prompts

Everything waypoint says to a model is in these files; `lib/prompts.mjs` fills them in. `config/routing.json` holds which
model builds which kind of task. `waypoint improve` may change these files, the routing settings and `skills/`, and nothing
else.

| File | Sent to | When |
|---|---|---|
| `research.md` | strong model | before planning (and in `waypoint build`): writes EXPECTATIONS.md |
| `approach.md` | strong model | before planning: writes APPROACH.md |
| `plan.md`, `plan-continue.md` | strong model | the first plan, and a second chance if it stopped early |
| `plan-format.md`, `types-help.md`, `existing.md` | (included) | the milestone format, task types, a project already under way |
| `worker.md` | builders | every task |
| `stuck-research.md` | strong model | after a task failed, before a stronger builder tries |
| `tester.md` | tester | after each milestone |
| `review.md`, `review-retry.md`, `owner-notes-review.md`, `interrupted.md` | strong model | after each milestone |
| `build.md`, `build-resume.md` | one session | `waypoint build` |

Syntax: `{{name}}` a value, `{{#name}}...{{/name}}` only when it is set, `{{^name}}...{{/name}}` only when it is not,
`{{>file}}` another prompt. A missing value is an error. One trailing newline is dropped from each file.
