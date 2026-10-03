# Changelog

All notable changes to Claude Code handover are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

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

[1.3.1]: https://github.com/nrzz/claude-code-handover/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/nrzz/claude-code-handover/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/nrzz/claude-code-handover/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/nrzz/claude-code-handover/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/nrzz/claude-code-handover/releases/tag/v1.0.0
