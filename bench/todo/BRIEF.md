# Tally: a to-do list

A small, pleasant to-do list in the browser for one person keeping track of their day.

- Type a to-do and press Enter to add it; blank entries are ignored and the box clears after adding.
- Tick a to-do to mark it done (and untick it); delete one with its delete button.
- A count of what is left ("3 items left", "1 item left").
- Show all, only active, or only completed to-dos; clear all completed ones at once.
- Everything is kept when the page is reloaded.
- Clean, readable, works with keyboard and mouse, looks good on a phone and a laptop.

## Interface (for automated testing; keep these exactly)

Plain static files: `index.html` at the repository root (or in `dist/` after `npm run build`), opened from any static web
server, no backend. Elements carry these `data-testid` attributes: `new-todo` (the text input), `todo-item` (each to-do),
`todo-toggle` (the checkbox inside a to-do), `todo-delete` (the delete button inside a to-do), `todo-count` (the count
text), `filter-all`, `filter-active`, `filter-completed` (the three filters), `clear-completed`.

## Done means

Someone can open the page, manage a day's to-dos with it, reload, and find them as they left them.
