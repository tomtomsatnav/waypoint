// E5-het: shared definitions for the generator and the scorer. Each module has one target function of one of seven kinds;
// the generator knows the correct code, so the ground truth is free. All kinds map a number x to a number and add the
// module's region constant K, which is the correct output of the previous module's function at CHAIN_INPUT.

export const CHAIN_INPUT = 10;

export const isLeap = (y) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

const UNITS = [
  { from: 'kilograms', to: 'grams', f: 1000, wrong: 100 },
  { from: 'kilometres', to: 'metres', f: 1000, wrong: 100 },
  { from: 'hours', to: 'minutes', f: 60, wrong: 3600 },
  { from: 'minutes', to: 'seconds', f: 60, wrong: 100 },
  { from: 'litres', to: 'millilitres', f: 1000, wrong: 10 },
];

const ROUND = { nearest: 'round', down: 'floor', up: 'ceil' };

// Random parameters for a kind, from a seeded rng.
export function paramsFor(kind, rnd) {
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  switch (kind) {
    case 'round': { const modes = Object.keys(ROUND); const mode = modes[int(0, 2)]; let wrong; do wrong = modes[int(0, 2)]; while (wrong === mode); return { r: int(13, 37), mode, wrong }; }
    case 'tier': return { t: int(5, 15), d: int(2, 9) };
    case 'clamp': { const lo = int(2, 8); return { lo, hi: lo + int(5, 20) }; }
    case 'month': return { y: [2024, 2000, 2028, 2016][int(0, 3)] };
    case 'units': return { u: int(0, UNITS.length - 1) };
    case 'vat': return { p: [5, 10, 12, 15, 20][int(0, 4)] };
    case 'affine': return { a: int(2, 9), b: int(2, 5) };
    default: throw new Error(kind);
  }
}

// Body of the function (without the K line), correct or with the kind's mutation.
export function bodySrc(kind, p, buggy) {
  switch (kind) {
    case 'round': return `return Math.${ROUND[buggy ? p.wrong : p.mode]}(x * ${p.r} / 10) + regionConstant;`;
    case 'tier': return `return (x ${buggy ? '>' : '>='} ${p.t} ? x - ${p.d} : x) + regionConstant;`;
    case 'clamp': return buggy ? `return Math.max(Math.min(x, ${p.lo}), ${p.hi}) + regionConstant;` : `return Math.min(Math.max(x, ${p.lo}), ${p.hi}) + regionConstant;`;
    case 'month': return `const feb = ${buggy ? '28' : `${p.y} % 4 === 0 && (${p.y} % 100 !== 0 || ${p.y} % 400 === 0) ? 29 : 28`};\n  const days = [31, feb, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][(((x - 1) % 12) + 12) % 12];\n  return days + regionConstant;`;
    case 'units': return `return x * ${buggy ? UNITS[p.u].wrong : UNITS[p.u].f} + regionConstant;`;
    case 'vat': return buggy ? `return Math.round(x * (1 + ${p.p})) + regionConstant;` : `return Math.round(x * (100 + ${p.p}) / 100) + regionConstant;`;
    case 'affine': return `return (x ${buggy ? '+' : '-'} ${p.a}) * ${p.b} + regionConstant;`;
    default: throw new Error(kind);
  }
}

// The correct function as a JS function of x, for a given K.
export function correctFn(kind, p, K) {
  // eslint-disable-next-line no-new-func
  return new Function('x', `const regionConstant = ${K};\n  ${bodySrc(kind, p, false)}`);
}

// Prose rule, phrased in one of several ways so a regex over headers does not recover it.
export function ruleProse(kind, p, v) {
  const pick = (xs) => xs[v % xs.length];
  switch (kind) {
    case 'round': return pick([
      `Scale the input by ${p.r} tenths and round the result ${p.mode === 'nearest' ? 'to the nearest whole number' : p.mode === 'down' ? 'down (towards minus infinity)' : 'up (towards plus infinity)'}.`,
      `Multiply x by ${p.r / 10} and then ${p.mode === 'nearest' ? 'round half up to an integer' : p.mode === 'down' ? 'take the floor' : 'take the ceiling'}.`,
      `The figure is x times ${p.r}, divided by ten, ${p.mode === 'nearest' ? 'rounded normally' : p.mode === 'down' ? 'with any fraction dropped downwards' : 'with any fraction pushed upwards'}.`]);
    case 'tier': return pick([
      `Orders of ${p.t} units or more get ${p.d} units off; smaller orders pay x unchanged.`,
      `If x is at least ${p.t}, subtract ${p.d}. Otherwise leave x as it is.`,
      `A discount of ${p.d} applies from ${p.t} upwards (${p.t} itself included).`]);
    case 'clamp': return pick([
      `Keep x within ${p.lo}..${p.hi} inclusive: below ${p.lo} becomes ${p.lo}, above ${p.hi} becomes ${p.hi}.`,
      `The value is x, but never less than ${p.lo} and never more than ${p.hi}.`,
      `Clamp the input to the band from ${p.lo} to ${p.hi}.`]);
    case 'month': return pick([
      `x is a month number (1 = January); return how many days that month has in the year ${p.y}.`,
      `Days in month x of ${p.y}, counting February correctly for that year (Gregorian rules).`,
      `For month x (1-12) of ${p.y}, the number of days in it; ${p.y} follows the usual leap-year rules.`]);
    case 'units': { const u = UNITS[p.u]; return pick([
      `x is in ${u.from}; convert it to ${u.to}.`,
      `Express the input, given in ${u.from}, in ${u.to}.`,
      `The input arrives in ${u.from} and must be returned in ${u.to}.`]); }
    case 'vat': return pick([
      `Add ${p.p}% tax to x and round to the nearest whole unit.`,
      `The gross amount: x plus ${p.p} per cent of x, rounded normally.`,
      `Apply a ${p.p} percent uplift to x, rounding the result to an integer.`]);
    case 'affine': return pick([
      `Take ${p.a} away from x, then multiply by ${p.b}.`,
      `The result is ${p.b} times (x minus ${p.a}).`,
      `Reduce x by ${p.a} and scale what is left by a factor of ${p.b}.`]);
    default: throw new Error(kind);
  }
}

// Inputs the acceptance tests use per kind (edges included).
export function testInputs(kind, p) {
  switch (kind) {
    case 'round': return [0, 7, 13, 25, CHAIN_INPUT];
    case 'tier': return [0, p.t - 1, p.t, p.t + 1, CHAIN_INPUT];
    case 'clamp': return [p.lo - 5, p.lo, p.hi, p.hi + 5, CHAIN_INPUT];
    case 'month': return [1, 2, 4, 12, CHAIN_INPUT];
    case 'units': return [0, 3, CHAIN_INPUT];
    case 'vat': return [0, 9, 100, CHAIN_INPUT];
    case 'affine': return [0, p.a, CHAIN_INPUT];
    default: throw new Error(kind);
  }
}

export const KINDS = ['round', 'tier', 'clamp', 'month', 'units', 'vat', 'affine'];
export const NAMES = ['priceFor', 'feeFor', 'chargeOf', 'rateFor', 'tariffOf', 'levyFor', 'dutyOn', 'costOf', 'tollFor', 'premiumOf'];

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
