// waypoint's prompts live in prompts/<name>.md so they can be read, compared and improved on their own (bin/waypoint.mjs
// improve edits only them, config/routing.json and skills/). A tiny template language, nothing more:
//   {{name}}               the value of name (a string; missing names are an error, so a typo cannot pass silently)
//   {{#name}}...{{/name}}  the text inside only when name is truthy
//   {{^name}}...{{/name}}  the text inside only when name is falsy
//   {{>other}}             the prompt prompts/other.md, filled with the same values
// A file's single trailing newline is dropped, so a prompt that ends without one can be stored as a normal text file.
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROMPTS_DIR = join(ROOT, 'prompts');
export const CONFIG_DIR = join(ROOT, 'config');

const cache = new Map();
export function template(name, dir = PROMPTS_DIR) {
  const f = join(dir, `${name}.md`);
  if (!cache.has(f)) cache.set(f, readFileSync(f, 'utf8').replace(/\n$/, ''));
  return cache.get(f);
}

// One pass, left to right: inserted values are never scanned again, so a brief that contains "{{" stays as it is.
export function fill(text, vars, dir = PROMPTS_DIR, depth = 0) {
  if (depth > 8) throw new Error('prompts nest too deeply');
  const re = /\{\{([#^>]?)(\w[\w-]*)\}\}/g;
  let out = '', i = 0, m;
  while ((m = re.exec(text))) {
    out += text.slice(i, m.index);
    const [, kind, name] = m;
    if (kind === '#' || kind === '^') {
      const close = `{{/${name}}}`, end = text.indexOf(close, re.lastIndex);
      if (end < 0) throw new Error(`prompt section {{${kind}${name}}} is not closed`);
      if ((kind === '#') === !!vars[name]) out += fill(text.slice(re.lastIndex, end), vars, dir, depth + 1);
      re.lastIndex = end + close.length;
    } else if (kind === '>') out += fill(template(name, dir), vars, dir, depth + 1);
    else {
      if (!(name in vars)) throw new Error(`prompt value {{${name}}} was not given`);
      out += String(vars[name]);
    }
    i = re.lastIndex;
  }
  return out + text.slice(i);
}

export const render = (name, vars = {}, dir = PROMPTS_DIR) => fill(template(name, dir), vars, dir);

export function config(name) { return JSON.parse(readFileSync(join(CONFIG_DIR, `${name}.json`), 'utf8')); }
