# waypoint

**Early research, nothing built yet.** Keeps a long-running Claude Code agent on course and moving, using what Claude Code already has
(hooks, compaction, resume) rather than a framework beside it:

- **Drift:** after every session start and compaction, re-anchor the agent with the goal verbatim plus facts from git and the checks.
- **Stopping:** a Stop hook runs the external finish line (the task's checks and `aos-orch verify`) and hands over the next task until
  the work is verifiably done or a hard limit fires.

Start with [HANDOFF.md](HANDOFF.md): the problem, the plan, what has been verified and the first experiments.

Sibling repos: [aos-orchestrator](https://github.com/tomtomsatnav/aos-orchestrator) (`aos-orch verify`),
[fenceline](https://github.com/tomtomsatnav/fenceline), [lessons](https://github.com/tomtomsatnav/lessons).
