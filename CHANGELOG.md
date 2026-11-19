# Changelog

All notable changes to Claude Code handover are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

- `recall.mjs --project <folder>` searches only the transcripts and saved notes for one project path, resolved relative to the current folder. It cannot be combined with `--all`; a project without transcripts reports no match and exits 0. Without `--project`, the current-project behavior is unchanged.
- Regression coverage for absolute and relative project paths, project-specific notes, missing transcript folders, and the `--all` conflict.

## [1.7.0] - 2026-11-03

- `recall.mjs` names the filters that were on in both of its summary lines, with the values as typed: `No match for "migration" from claude since 7d in this project's transcripts (...)` and `3 match(es) for "migration" from you since 2026-10-01, newest first:`. Before, the "No match" line read as if the topic had never come up when it only meant that nothing matched within the filters, and the heading named `--who` but not `--since`. With neither flag both lines read as before; a search with no match still exits 0; `--all` and `, showing N` keep their places. Thanks to [@Vamsi-2581](https://github.com/Vamsi-2581) in [#10](https://github.com/nrzz/claude-code-handover/pull/10), for the good first issue [#9](https://github.com/nrzz/claude-code-handover/issues/9).
- Tests for a filtered search with no match, in the current project and with `--all`, and for a heading with both filters and `, showing N`.

## [1.6.0] - 2026-11-03

- `recall.mjs --who you|claude|notes` keeps only one kind of match: what you said (`you`, role `user`), what Claude answered (`claude`, role `assistant`) or the lines of DECISIONS.md and HANDOVER.md (`notes`, role `note`). The heading line says what was kept (`3 match(es) for "migration" from you, newest first:`), it works together with `--since`, `--all` and `--limit`, and any other value is an error that names the three and exits 1, like a bad `--since`. Thanks to [@madhavidayma21](https://github.com/madhavidayma21) in [#8](https://github.com/nrzz/claude-code-handover/pull/8).
- A test for each of the three values against a synthetic transcript and a DECISIONS.md line, for a value that is none of them, and for `--who` together with `--since`, `--limit` and `--all`.

## [1.5.0] - 2026-10-28

- `recall.mjs --since` narrows recall to recent work: a number of hours, days or weeks back (`12h`, `7d`, `2w`) or a date (`YYYY-MM-DD`, local midnight); a value that is neither is an error. The index keeps each remark's timestamp, and `search()` in `memory-index.mjs` takes the same filter as `{ since }`. Thanks to [@yoreva-01](https://github.com/yoreva-01) in [#5](https://github.com/nrzz/claude-code-handover/pull/5).
- Recall matches words in any script. Words are runs of letters, marks and digits as Unicode defines them, so Tamil, Hindi, Chinese and accented European words are matched whole; before, the tokenizer knew only `a-z`, `0-9` and `_`, split "Größe" at the umlaut, and never recalled anything written in another script. Text that writes no spaces between words gives one word per run, which still matches a repeated phrase.
- Automatic recall is about three times faster per prompt. `sig.bin`, next to `index.jsonl`, holds a 256-byte signature per remark (a Bloom filter of every word and every prefix of it from 3 to 12 characters). A query word is looked for in a remark's text only when its signature allows it, so most of the text searches are never made; a remark whose signature allows a word is still checked in the text, so what recall finds is unchanged (verified on 220 prompts against a 94,000-remark history: identical results on every ASCII prompt, the only differences being the accented words that now match). On the 12 MB window a prompt went from about 125 ms to about 45 ms. An existing index is signed a little on each call, inside the hook's time budget, and a signature file that does not agree with `state.json` is rebuilt from the index; `sig.bin` is safe to delete.
- `HANDOVER_CONTEXT_LIMIT`, `HANDOVER_STALE_MINUTES`, `HANDOVER_RECALL_WINDOW_MB` and `HANDOVER_RECALL_STRICTNESS` that are not numbers count as unset, as `HANDOVER_CONTEXT_WINDOW` already did. Before, a typo gave `NaN`, every comparison was false, and the guard never warned or asked, silently. `HANDOVER_STALE_MINUTES=0` still means "ask whenever a turn ends above the limit".
- `scripts/common.mjs` holds what the scripts shared by copy: the config and transcripts folders, the price list (one table, dated, with a fallback to the newest price of a model's family for an id the list does not know), the summing of a request's token counts, and the text of a message. The usage and cache reports name the date of the price list in their first heading.
- SECURITY.md says that text pasted into an earlier session can come back as a recall line, and how to remove it.
- Tests for each of these: settings that are not numbers, recall in Tamil and German, the signature file (same results with and without it, rebuilt when it does not match, kept in step with new remarks), the copy of the scripts still needing nothing outside its folder, and `--since` with the signature file (a remark that stays is checked against its own signature, not the one at its new place in the filtered list).
- The signature file, the words in any script, the settings that fall back and `scripts/common.mjs` are from [@elavarasan-sr](https://github.com/elavarasan-sr) in [#6](https://github.com/nrzz/claude-code-handover/pull/6), who also brought `--since` on top of the signature file.

## [1.4.1] - 2026-10-04

- The guard's limit is now 35% of `HANDOVER_CONTEXT_WINDOW` (still 350,000 tokens with the default 1,000,000), so the window setting moves the limit instead of only the percentage shown. `HANDOVER_CONTEXT_LIMIT` still wins when it is set. A window that is not a positive number counts as unset.
- The installed `/recall` skill finds the script and the transcripts from its own folder, `${CLAUDE_SKILL_DIR}`, which Claude Code fills in before the model reads the skill. It used to name `~/.claude`, so with `CLAUDE_CONFIG_DIR` set it missed the copy `init` installs; now it follows it, and the command keeps nothing for the shell to expand, so `Bash(node:*)` covers it as before.
- `scripts/selftest.mjs --replay` follows `CLAUDE_CONFIG_DIR`, `HANDOVER_PROJECTS_DIR` and `HANDOVER_DATA_DIR` like recall does, instead of always reading `~/.claude`.
- `init` keeps a `claude-token-rules.md` you edited as `claude-token-rules.md.bak-YYYYMMDD` before it replaces the card, and reports the backup; a card it wrote for another model list is replaced without one.
- `scripts/usage-report.mjs` and `scripts/cache-report.mjs` read the transcripts of `$CLAUDE_CONFIG_DIR` when it is set, as recall does (`--root` still wins), and the cache report names its 55-minute threshold in its headings. The threshold is unchanged.
- Documentation matched to the code. The guard asks once, at the end of a turn above the limit, when HANDOVER.md is older than 30 minutes; it does not hold the turn open until the handover is written, and 35% is a share of the window. Also corrected: SECURITY.md (what reaches Claude, what `uninstall` keeps), the setup prompt (backup name, a longer `cleanupPeriodDays`, rules card rows, `git pull` on a plain copy), the README (recall index, saved effort levels, `--no-hooks`, model ids, next-day sessions, the stress test, model combinations, CI on Node 18) and CONTRIBUTING (a throwaway config folder that stays set, the prompt route, "every job").
- Tests for each of these, and for all 15 combinations of the four models.

## [1.4.0] - 2026-10-04

- One-command setup: `npx -y github:nrzz/claude-code-handover init` does what the setup prompt tells Claude to do, with the same file contents and the same never-destroy rules, using no model and asking nothing. Options: `--models`, `--streams`, `--dir`, `--dry-run`, `--no-hooks`. Running it twice changes nothing the second time and says so.
- `uninstall` removes only what `init` added at user level (our three hooks, the `/handover` and `/recall` skills, the copy of the scripts) after a backup of `settings.json`, and leaves project files and effort settings alone; `--purge` also removes a git checkout of the scripts that an older setup made. `status` shows what is installed where.
- The guard and recall scripts are copied into `~/.claude/claude-code-handover/` instead of cloned, so the hooks depend on neither git nor npx's cache. An older clone there is updated with `git pull --ff-only`, and copied over when git cannot do it.
- `npm test` now also runs the installer's `node:test` suites, which check every code block of `setup-prompt.txt` against its template.
- Recall (`scripts/recall.mjs`, `scripts/memory-index.mjs`) follows `CLAUDE_CONFIG_DIR`: it reads transcripts from `<config folder>/projects` and keeps its index in `<config folder>/claude-code-handover-data`. With the variable unset nothing changes. The index no longer rewrites its state file when no transcript has anything new.
- `package.json` lists the files to ship, so `npx` no longer prints npm's `gitignore-fallback` warning.
- Fixed three templates that differed from the setup prompt: the first stream in `DECISIONS.md`, the model id placeholder in `settings-single-model.json` and the layout of `hooks-settings.json`. The prompt is authoritative.

## [1.3.1] - 2026-10-01

- Recall that holds up at scale, with a stress test (`scripts/selftest.mjs`).

## [1.3.0] - 2026-10-01

- Recall honours `HANDOVER_PROJECTS_DIR`; a clearer build message; live test notes.
- Recall matches sentence by sentence and unwraps relayed messages; it skips system-injected prompts.

## [1.2.0] - 2026-10-01

- Automatic recall: relevant past lines arrive with each prompt.

## [1.1.0] - 2026-10-01

- The decisions log, the context guard hook and `/recall`.
- A zero-edit setup paste, hardened for existing files and any model mix.

## [1.0.0] - 2026-10-01

- The handover workflow: setup prompt, templates, skill and audit scripts.

[1.7.0]: https://github.com/nrzz/claude-code-handover/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/nrzz/claude-code-handover/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/nrzz/claude-code-handover/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/nrzz/claude-code-handover/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/nrzz/claude-code-handover/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/nrzz/claude-code-handover/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/nrzz/claude-code-handover/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/nrzz/claude-code-handover/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/nrzz/claude-code-handover/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/nrzz/claude-code-handover/releases/tag/v1.0.0
