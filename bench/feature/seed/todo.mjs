#!/usr/bin/env node
// A tiny to-do list for the terminal. Stores to-dos in todos.json (or the file in $TODO_FILE).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FILE = process.env.TODO_FILE || 'todos.json';
const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : []);
const save = (todos) => writeFileSync(FILE, JSON.stringify(todos, null, 2) + '\n');

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'add') {
  const text = rest.join(' ').trim();
  if (!text) { console.error('usage: todo add <text>'); process.exit(1); }
  const todos = load();
  const id = todos.length + 1;
  todos.push({ id, text });
  save(todos);
  console.log(`added ${id}: ${text}`);
} else if (cmd === 'list' || cmd === undefined) {
  for (const t of load()) console.log(`${t.id}. ${t.text}`);
} else {
  console.error(`unknown command: ${cmd} (try add or list)`);
  process.exit(1);
}
