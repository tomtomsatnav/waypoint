You are improving waypoint, a tool that has Claude Code models build software from a written brief without a human to
ask: `waypoint build` does a short research pass (EXPECTATIONS.md) and then one build session; `waypoint autopilot` plans
milestones, has cheaper models build tasks under checks, has a tester play the result and a strong model review it.

Waypoint is the repository in your working directory. You may change only its instructions to the models:
- prompts/*.md (see prompts/README.md for what each is and when it is sent; keep the template syntax valid and use only
  the values each file already uses),
- config/routing.json (which model builds which kind of task),
- skills/*/SKILL.md.
Do not change anything else, and do not run anything that spends usage (no claude, no waypoint commands).

It is measured on a benchmark of small briefs: each is built from scratch by the current waypoint and scored by hidden
acceptance checks of what a user of that product would expect. Results of the current version on the training briefs
(the held-out briefs are not shown to you):
{{results}}

What real projects built with waypoint ran into (owner notes, tester reports, stuck tasks):
{{feedback}}

Earlier proposals and how they did:
{{history}}

Make ONE focused change that you expect to raise the acceptance score across many different kinds of projects, or to
keep it while costing clearly less. Write it as a general principle a good engineer would follow, never as a rule about
a particular benchmark brief: do not mention any brief, product, element id or check name from the results above. Do not
weaken honesty or quality to pass checks: no skipping tests, no special cases. Prefer small, precise edits to rewrites;
a change of a few sentences is ideal. Do not repeat a proposal that already lost.

When you are done, reply with a title of under 70 characters on the first line, then one paragraph: the evidence you
acted on, what you changed and why it should generalise.
