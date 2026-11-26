#!/usr/bin/env node
// wf: print the most common words in a text.
import { readFileSync } from 'node:fs';

const USAGE = `Usage: node wf.mjs <file> [--top N] [--ignore-case] [--min-length N] [--json]

Counts the words in <file> (use - to read standard input) and prints the most common, one "word count" per line,
most frequent first, ties in alphabetical order. A word is a run of letters, digits and apostrophes.

Options:
  --top N          how many words to show (default 10)
  --ignore-case    count "The" and "the" together, shown in lower case
  --min-length N   ignore words shorter than N characters
  --json           print [{"word": "...", "count": N}, ...] instead
  --help           show this help`;

function fail(msg) {
  process.stderr.write(`wf: ${msg}\nTry "node wf.mjs --help".\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { top: 10, ignoreCase: false, minLength: 0, json: false, file: null };
  const intArg = (name, v, min) => {
    if (v === undefined) fail(`${name} needs a number`);
    if (!/^\d+$/.test(v) || Number(v) < min) fail(`${name} must be a whole number${min ? ` of at least ${min}` : ''}, not "${v}"`);
    return Number(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { process.stdout.write(USAGE + '\n'); process.exit(0); }
    else if (a === '--top') opts.top = intArg('--top', argv[++i], 1);
    else if (a === '--min-length') opts.minLength = intArg('--min-length', argv[++i], 0);
    else if (a === '--ignore-case') opts.ignoreCase = true;
    else if (a === '--json') opts.json = true;
    else if (a.startsWith('-') && a !== '-') fail(`unknown option "${a}"`);
    else if (opts.file !== null) fail(`only one file can be given (got "${opts.file}" and "${a}")`);
    else opts.file = a;
  }
  if (opts.file === null) fail('no file given');
  return opts;
}

function read(file) {
  try { return readFileSync(file === '-' ? 0 : file, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') fail(`cannot find the file "${file}"`);
    if (e.code === 'EISDIR') fail(`"${file}" is a directory, not a file`);
    fail(`cannot read "${file}": ${e.message}`);
  }
}

export function countWords(text, { ignoreCase = false, minLength = 0 } = {}) {
  const counts = new Map();
  for (let w of text.match(/[\p{L}\p{N}']+/gu) || []) {
    if (ignoreCase) w = w.toLowerCase();
    if ([...w].length < minLength) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

const opts = parseArgs(process.argv.slice(2));
const top = countWords(read(opts.file), opts).slice(0, opts.top);
if (opts.json) process.stdout.write(JSON.stringify(top.map(([word, count]) => ({ word, count }))) + '\n');
else process.stdout.write(top.map(([w, c]) => `${w} ${c}\n`).join(''));
