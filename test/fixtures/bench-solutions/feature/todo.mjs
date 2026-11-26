#!/usr/bin/env node
// A tiny to-do list for the terminal. Stores to-dos in todos.json (or the file in $TODO_FILE).
//
// The file is either the original format, a plain array of { id, text }, or the current one,
// { nextId, todos: [{ id, text, done }] }. Old files are read as they are and upgraded on the next change;
// nextId is kept so that an id is never reused after a remove.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FILE = process.env.TODO_FILE || 'todos.json';

const HELP = `usage: node todo.mjs <command>

commands:
  add <text>        add a to-do
  list [--pending]  list to-dos ([x] = done); --pending shows only those not done
  done <id>         mark a to-do done
  undo <id>         mark a to-do not done
  remove <id>       delete a to-do (other ids stay the same)
  help              show this help

To-dos are kept in todos.json, or the file named in TODO_FILE.`;

function load() {
  const data = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];
  const todos = (Array.isArray(data) ? data : data.todos || []).map((t) => ({ ...t, done: Boolean(t.done) }));
  const maxId = todos.reduce((m, t) => Math.max(m, t.id), 0);
  const nextId = Math.max(Array.isArray(data) ? 0 : Number(data.nextId) || 0, maxId + 1);
  return { nextId, todos };
}
const save = (state) => writeFileSync(FILE, JSON.stringify(state, null, 2) + '\n');

function die(msg) { console.error(msg); process.exit(1); }

function findTodo(state, cmd, arg) {
  if (arg === undefined) die(`usage: todo ${cmd} <id>`);
  const id = Number(arg);
  const t = Number.isInteger(id) ? state.todos.find((x) => x.id === id) : undefined;
  if (!t) die(`no to-do with id ${arg} (see "node todo.mjs list")`);
  return t;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'add') {
  const text = rest.join(' ').trim();
  if (!text) die('usage: todo add <text>');
  const state = load();
  const id = state.nextId++;
  state.todos.push({ id, text, done: false });
  save(state);
  console.log(`added ${id}: ${text}`);
} else if (cmd === 'list' || cmd === undefined) {
  const pending = rest.includes('--pending');
  for (const t of load().todos) if (!pending || !t.done) console.log(`${t.id}. [${t.done ? 'x' : ' '}] ${t.text}`);
} else if (cmd === 'done' || cmd === 'undo') {
  const state = load();
  const t = findTodo(state, cmd, rest[0]);
  t.done = cmd === 'done';
  save(state);
  console.log(`${cmd === 'done' ? 'done' : 'not done'} ${t.id}: ${t.text}`);
} else if (cmd === 'remove') {
  const state = load();
  const t = findTodo(state, cmd, rest[0]);
  state.todos = state.todos.filter((x) => x !== t);
  save(state);
  console.log(`removed ${t.id}: ${t.text}`);
} else if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(HELP);
} else {
  die(`unknown command: ${cmd} (try "node todo.mjs help")`);
}
