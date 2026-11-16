---
name: waypoint
description: Build a large project autonomously over hours or days with the waypoint autopilot, and steer it while it runs. Use when the user wants something built "on its own", "overnight", "until it's done", for days, or too big for one session; to continue a project already under way autonomously; or to check on, steer, send a note to, show the dashboard of, connect Discord to, or stop a waypoint run.
---

# The waypoint autopilot

waypoint runs outside this session so it can keep going for days: a strong model researches, plans milestones and reviews;
cheaper models build one checked task at a time (Haiku for code, Sonnet for UI, each with one step up); a tester plays every
milestone in a real browser and reports with screenshots; it pauses for the user's plan usage limits, carries on after
them and after reboots, and runs until the project ships. You drive it with `bin/autopilot.sh` and do not do the building
yourself.

## Where waypoint is

This skill sits in `<waypoint>/skills/waypoint/`, so the waypoint folder is two levels up from this skill's base directory
(it holds `bin/autopilot.sh`). Call it `$WP` below. If that folder has no `bin/autopilot.sh` (the skill was copied on its
own), ask the user where waypoint is cloned, or clone it for them with their permission.

Check the essentials once: `node --version` (18 or newer), `git`, and `claude` logged in to the user's plan. The first
start installs Playwright and Chromium into `~/.waypoint/tools`; tell the user it will take a minute.

## Starting a run

All commands run in the project's folder, which must be a git repository with at least one commit (offer to `git init`
and commit what is there if not).

1. **Write the brief with the user** (skip if they already have a good one). It is the most important input; spend real
   effort here, asking a few focused questions rather than many. Save it as `BRIEF.md` and commit it. A good brief:
   - says **what** to build and **why**, not how (no libraries unless the user insists);
   - names what is easy to forget for this kind of product: for a game the camera, controls, feel, difficulty, saving,
     settings and sound; for an app the accounts, empty states, errors and mobile layout;
   - describes **the look** in words and points at reference images in `references/` (artwork, mock-ups, screenshots of
     things the user likes, used with permission where they are someone else's work), saying what each one is for;
   - ends with **"Done means"**: what a person can do with it when it is finished;
   - for an original product, says so: its own names, characters and art, nothing copied from an existing one.
2. **Start it**:
   ```sh
   $WP/bin/autopilot.sh start --brief-file BRIEF.md --references references/a.png,references/b.jpg
   ```
   Useful options: `--budget-usd N` (default none), `--hours N` (default none: it runs until done), `--weekly 0.95` (how
   much of the user's weekly plan usage it may use; default 0.85 leaves room for their own use), `--max-workers N`
   (parallel builders, default 1). For a **project already under way**, a one-line brief is enough:
   `start --brief "finish the checkout flow and add tests"`; the planner surveys the code first and continues from it.
3. **Offer the dashboard and updates**: `$WP/bin/autopilot.sh dashboard --lan` prints a private link (with `?key=`) for
   the user's browser and phone on the same Wi-Fi; give them that link. Discord: ask the user to make a webhook (channel
   settings, Integrations, Webhooks, New Webhook, Copy Webhook URL) and to paste it into the dashboard's Discord box, or
   run `$WP/bin/autopilot.sh discord <url>` themselves; do not ask them to paste the URL into the chat. If the repo has
   an `origin` remote, the work is pushed every few minutes.
4. Tell the user it keeps a Mac awake while it runs, needs the machine on, and that `autopilot.sh start` again after a
   reboot carries on.

## While it runs

- **Status**: `$WP/bin/autopilot.sh status`, and `tail -n 20 .git/autopilot/autopilot.log`. Explain plainly where it is
  (milestone, task, which model), and what any pause means ("paused for plan usage until 14:00, it resumes by itself").
- **Steering**: relay the user's wishes as notes, `$WP/bin/autopilot.sh note "..."` (add `--urgent` to have the planner
  review straight after the current task). Write notes as clear requests with the reason; for choices, ask it to "show me
  N options in owner/ and wait for my pick". Replies and images appear on the dashboard and in Discord;
  `autopilot.sh note` with no text lists notes and replies.
- **Screenshots**: the tester's are in `.git/autopilot/shots/m<N>-tester/`; images made for the user in `owner/<note>/`.
- **A changed brief**: edit `BRIEF.md`, then `$WP/bin/autopilot.sh stop` and `start` again; the planner re-plans
  around the differences.
- **Problems**: if `status` says the supervisor is not running, `start` again (it resumes). If the same task keeps
  failing, look at the log, then send a note explaining what you think is wrong. Do not edit the project's code or the
  autopilot's files under `.git/autopilot` by hand while it runs.
- **Stop**: `$WP/bin/autopilot.sh stop`. Nothing is lost; `start` carries on.

## Smaller jobs

If the job fits in one long session, waypoint's simpler recipe is cheaper and quick: `node $WP/bin/waypoint.mjs build
--brief-file BRIEF.md --yes` (research, then one plain session), or just use the `expectations` skill here.
