# Finish the terminal to-do list

`todo.mjs` can add and list to-dos, and people already use it, so their existing `todos.json` files must keep working.
Add what it is missing:

- `node todo.mjs done <id>` marks a to-do done; `node todo.mjs undo <id>` marks it not done again.
- `node todo.mjs remove <id>` deletes one. The other to-dos keep their ids, and a new to-do never reuses an id that was
  used before.
- `node todo.mjs list` shows `[ ]` or `[x]` for each: `1. [ ] buy lamp oil` and `2. [x] trim wicks`.
  `node todo.mjs list --pending` shows only those not done.
- A to-do id that does not exist prints a clear message to standard error and exits with code 1, changing nothing.
- `node todo.mjs help` lists the commands.
- Add tests for the new commands, and update the README.

Keep it Node.js only, with no dependencies. The file is still `todos.json`, or the one named in `TODO_FILE`.

## Done means

Existing users upgrade without losing anything, and can now tick things off.
