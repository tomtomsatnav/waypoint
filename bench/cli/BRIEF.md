# wf: word frequencies

A small command-line tool that counts the words in a text and prints the most common ones. Writers use it to spot words
they overuse.

    node wf.mjs <file> [--top N] [--ignore-case] [--min-length N] [--json]

- A word is a run of letters, digits and apostrophes (so "don't" is one word); everything else separates words.
- Prints one line per word, `word count` (one space between), most frequent first; ties in alphabetical order.
- `--top N`: how many to show (default 10). `--ignore-case`: "The" and "the" count together, shown in lower case.
  `--min-length N`: ignore words shorter than N characters. `--json`: print `[{"word": "...", "count": N}, ...]` instead.
- `-` as the file reads standard input.
- A missing file or a bad option prints a short, helpful message to standard error and exits with code 2. `--help`
  explains the usage.

Node.js only, no dependencies needed.

## Done means

Someone can point it at a chapter of their book and see which words they lean on.
