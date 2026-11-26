# waypoint

Give Claude Code a brief and let it build the whole thing, for hours or days, without you saying "continue". waypoint
keeps it going until the project is done: it plans, builds in small checked steps, tests what it built in a real browser,
reviews and re-plans, waits out your plan's usage limits and carries on after them. It works on a new project or on one
already under way.

Two ways to use it:

| | What it does | Best for |
|---|---|---|
| `waypoint build` | A short research pass writes down what users of this kind of thing expect but the brief doesn't say, then one Claude Code session builds it | Projects that fit in one long session; quick and cheap |
| `waypoint autopilot` | A strong model researches, plans milestones and reviews; cheaper models build one checked task at a time; a tester plays each milestone; it runs until it ships | Big projects (days of work), or anything you want to steer while it runs |

## The easy way: the launcher

Double-click **`Waypoint.command`** in the waypoint folder (on a Mac; elsewhere run `node bin/app.mjs --open`). A page opens
in your browser where you:

1. say in a few lines what you want built, and drop in any reference images (with a word on what each is for);
2. press **Write the brief for me**: Claude turns it into a full brief, which you can edit or revise with a sentence of
   feedback (or write your own);
3. pick a name and folder (a new one, or a folder that already has code in it to carry on from), optionally a Discord
   webhook, and press **Start building**. If the [GitHub CLI](https://cli.github.com) is installed and signed in
   (`brew install gh`, then `gh auth login`, once), it also makes a private GitHub repository for the project and
   pushes the work there every few minutes.

The same page lists your projects: open each one's dashboard, send it a note, stop it or carry on after a restart. Closing
the page or the launcher does not stop a build. Everything below is the same thing from the command line.

## Install as a Claude Code plugin

In Claude Code:

```
/plugin install waypoint --marketplace tomtomsatnav/waypoint-framework
```

(use the owner and name of the repository you got this from). That gives Claude two skills:

- **waypoint**: say "build this with waypoint", "keep working on my game overnight", "how's the run going?" or "tell it the
  menus are too bright", and Claude writes a brief with you, starts the autopilot, shows you the dashboard, relays notes and
  reports progress. No commands to remember.
- **expectations**: whenever you ask Claude to build something from a description, it first writes down what users of that
  kind of product expect that you didn't say (each with a check), then builds to it. The single change that helped most
  in testing; it needs nothing else from waypoint.

Or use the launcher above, or the commands below.

## Needs

- Node 18 or newer, and git.
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and logged in (`claude`, then `/login`). It uses
  your plan and pauses when you reach its limits.
- On first run the autopilot installs Playwright and Chromium into `~/.waypoint/tools` (the tester plays your project in a
  real browser).

```sh
git clone <this repo> ~/waypoint
```

## waypoint build

In a git repository that holds a `BRIEF.md` describing what you want:

```sh
node ~/waypoint/bin/waypoint.mjs build --brief-file BRIEF.md --yes
```

Options: `--model` (default sonnet), `--budget-usd` (default 30), `--no-research`. Run it again after a restart and it
carries on.

## waypoint autopilot

In your project's folder (a git repository with at least one commit):

```sh
~/waypoint/bin/autopilot.sh start --brief-file BRIEF.md        # a new project, from a brief
~/waypoint/bin/autopilot.sh start --brief "finish the checkout flow and add tests"   # or a project already under way
~/waypoint/bin/autopilot.sh dashboard --lan                    # a live dashboard; prints its private link
```

It keeps running in the background (and keeps a Mac awake) until the project ships. `autopilot.sh start` again after a
reboot carries on where it was. Other commands: `status`, `log`, `stop`.

Options for `start`: `--references a.png,b.jpg` (images to match: art, mock-ups, screenshots), `--budget-usd N` (default:
none), `--hours N` (default: none, it runs until done), `--weekly 0.95` (how much of your weekly plan usage it may use,
default 0.85), `--max-workers N` (parallel builders, default 1).

**A project already under way**: point it at the repo with a brief saying what it should become. It notices the existing
work, and before planning it reads the code and history, runs the project and its tests, keeps what works and continues
from there rather than starting over.

### How it works

- **Research**: a strong model writes `EXPECTATIONS.md` (what users of this kind of product take for granted, each with a
  check) and `APPROACH.md` (how the hardest parts are best built: libraries, reference projects, practices).
- **Plan**: `SPEC.md`, `FEATURES.json` and milestones of small tasks, each with checks that must pass.
- **Build**: Haiku writes code and Sonnet does UI, each with one step up to a stronger model if needed; a task that still
  fails goes back to the planner to be rethought. Each task runs under a finish line: the session cannot stop until its
  checks pass.
- **Test and review**: after each milestone a cheap tester plays the project in a browser and reports with screenshots;
  the strong model reviews from that report and plans the next milestone, or ships.
- **Pace**: it pauses near your 5-hour and weekly limits and resumes after the reset; effort drops when usage runs low.

### Steering it while it runs

- **Notes**: `autopilot.sh note "btw, make the menus darker"` (or the dashboard's note box). Builders see it from their
  next task and the planner folds it into the plan at the next review, replying to you; `--urgent` reviews straight after
  the task in progress. Ask to see options ("show me 10 mockups") and it makes them first and waits for your pick.
- **Dashboard**: progress, the current task, the tester's latest screenshots, your notes and their replies, in a browser
  (on your phone too with `--lan`, on the same Wi-Fi). Sending notes needs the private link it prints.
- **Discord**: `autopilot.sh discord <webhook url>` (or the dashboard) posts each milestone, the tester's screenshots,
  reviews and replies to your notes, images made for you, pauses and the end to a channel. The URL stays on your machine.
- **GitHub**: if the project has an `origin` remote, the work is pushed every few minutes.
- **A revised brief**: edit `BRIEF.md` and run `start` again; the planner re-plans around the changes.

## Improving waypoint

waypoint can improve its own instructions to the models. `bin/autopilot.sh improve --rounds 1 --yes` (or the launcher's
"Improving waypoint" card) measures the current version on a benchmark of eight small briefs, each scored by hidden
acceptance checks; asks a strong model for one focused change to `prompts/`, `config/routing.json` or `skills/`, informed
by the failures and by what your own projects ran into; measures again with the change; and, if it is better beyond the
noise without the two held-out briefs getting worse, opens it as a draft pull request for you to review. Nothing else may
change and nothing merges by itself. The first round makes 48 small builds and later ones 24, each capped at $5 and 25
minutes; it pauses for your plan's limits. Without `--yes` it only prints the plan.

## Lower level

`waypoint run --queue queue.json` runs a fixed queue of tasks with checks under the same finish line (no planner), and
`waypoint doctor` checks what is installed. `node --test test/*.test.mjs` runs the tests (no API calls: a scripted
stand-in for Claude Code).
