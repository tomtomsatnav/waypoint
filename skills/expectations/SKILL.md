---
name: expectations
description: Before building something substantial from a brief or a feature request (an app, a game, a tool, a site), write EXPECTATIONS.md first - what users of this kind of product take for granted that the request does not say, each with a check - and then build to it. Use when asked to build, make or create a product, app, game, site or tool from a description, or when the user says "write the expectations" or "what am I forgetting".
---

# Expectations first

Briefs leave out what everyone in the field takes for granted: a game's camera and controls, a shop's basket and order
emails, a dashboard's date ranges and empty states. Built literally, the result does what was asked and still feels wrong.
In side-by-side tests, writing these down before building was the single change that made the biggest difference: one
plain session that started from such a file beat both a session without it and a full multi-agent pipeline.

## When the user asks you to build something from a description

1. **Read the request** (and any brief file, references and existing code). If the project is already under way, look at
   what is there and run it first.
2. **Research briefly.** If web search is available, look at two to four comparable products and how they behave;
   otherwise use what you know. Keep this short: a few minutes, not an essay.
3. **Write `EXPECTATIONS.md`** in the project root, with three sections:
   - **Conventions**: controls, navigation, layout, feedback and feel that users of this kind of product expect.
   - **What comparable products all have** that the request does not mention.
   - **Pitfalls**: technical problems typical of this kind of build and how others avoid them.

   Every item is one line: the expectation, then `Check:` and a concrete way to verify it in the running product. Drop
   anything without a check, anything the request already says, and anything that contradicts it. At most 40 items, most
   important first.
4. **Show the user the list briefly** (the top ten or so, in a sentence each) and ask if anything should be dropped or added,
   unless they asked you to just get on with it. Their request always wins over the file.
5. **Build to the request plus the file**, treating each item as part of the request. When you think you are done, go
   through the checks yourself in the running product (a browser for anything visual), fix what fails, and say which, if
   any, you deliberately left out and why.

## Writing good items

- Specific and observable: "Esc closes any open menu. Check: open the inventory, press Esc, it closes", not "intuitive UI".
- About the user's experience, not the implementation: do not choose libraries here.
- Fit the product's kind and scale: a weekend prototype needs the core conventions, not every feature of a market leader.

For long or very large projects that will not fit in one session, the `waypoint` skill hands the work to the waypoint
autopilot, which does this research (and more) itself.
