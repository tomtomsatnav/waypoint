# todo

A tiny to-do list for the terminal.

    node todo.mjs add buy lamp oil     # add a to-do
    node todo.mjs list                 # 1. [ ] buy lamp oil
    node todo.mjs list --pending       # only the ones not done
    node todo.mjs done 1               # tick it off: 1. [x] buy lamp oil
    node todo.mjs undo 1               # mark it not done again
    node todo.mjs remove 1             # delete it
    node todo.mjs help                 # list the commands

To-dos are kept in `todos.json` in the current directory, or in the file named by the `TODO_FILE` environment variable.
Removing a to-do leaves the other ids as they are, and a new to-do never reuses an old id. An id that does not exist
prints an error and exits with code 1 without changing anything.

Files written by earlier versions (a plain list of to-dos) keep working; they are upgraded the next time they change.

Run the tests with `node --test`. No dependencies.
