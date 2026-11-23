# mend-patch-tool

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/acaiyaya/mend-patch-tool/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/acaiyaya/mend-patch-tool/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

`mend` is a command-line tool that applies AI-written edits to a tree of text files. It reads one patch as a unified diff, SEARCH/REPLACE blocks, a V4A patch, or JSON edit objects. For line-based edits, it tries exact matching, then ignores trailing spaces and tabs, then ignores leading and trailing spaces and tabs. JSON string replacements use exact matching. The patch applies every change or none.

## Run it

```sh
node main.ts [--format=NAME] [--check] [--strict] [PATCH]
```

Use Node.js 22. `mend` uses only the standard library and requires no install step. The working directory is the root of the file tree, and patch paths are relative to it.

- `--format=NAME` selects `unified` for unified diffs, `search-replace` for SEARCH/REPLACE blocks, `v4a` for V4A patches, or `json` for a JSON array of edit objects or one edit object per line. The default, `auto`, detects the format from the patch contents.
- `--check` is a dry run. It reports the same output and exit code as a normal run without writing any files.
- `--strict` uses exact line matching only.
- `PATCH` is a patch file path relative to the working directory. Use `-` or omit `PATCH` to read from standard input.

`mend` reports results on standard output.

- **Exit 0** means the patch applied successfully, or would apply with `--check`. It lists changes as `A <path>` for an addition, `D <path>` for a deletion, `M <path>` for a modification, and `R <old> -> <new>` for a move from a removed original path to a newly created path. The final line is `ok: <n> files` (`ok: 1 file` for a single file).
- **Exit 1** means one or more edits failed and no files were written. It prints `error: <code> <path>` for each failed edit in patch order, then `failed: <k> of <n> edits`.
- **Exit 2** means a usage, patch-reading, format-detection, or parse error. It prints one line, `error: usage`, `error: no-patch`, `error: format`, or `error: parse <N>` with the 1-based patch line number.

`runner.ts` is the kit's trial runner, kept as shipped. `check.ts` runs the 100 public practice checks using the kit's `program/generator/practice.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=5ttpknjz&utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
