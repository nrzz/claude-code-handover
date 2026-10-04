# Security policy

## Supported versions

Security fixes go into the latest release on `main`.

## Reporting a vulnerability

Please do not report a vulnerability in a public issue. Use GitHub's private reporting: [https://github.com/nrzz/claude-code-handover/security/advisories/new](https://github.com/nrzz/claude-code-handover/security/advisories/new), or the contact in the [nrzz security policy](https://github.com/nrzz/.github/blob/master/SECURITY.md). You can expect a first answer within 72 hours, and credit in the release notes if you want it.

## What this tool can and cannot protect

The context guard and recall read your own transcripts on your machine, and the scripts open no network connection. What they find still reaches Claude: the lines automatic recall picks from earlier sessions are added to your next prompt, and the newest lines of `DECISIONS.md` are shown at the start of a session, so both are sent with the conversation like anything else in it. `HANDOVER_AUTORECALL=0` turns both off. The one-command setup (`init`) and the setup prompt write files in your project, and settings in `~/.claude` (or `$CLAUDE_CONFIG_DIR`) after a backup. The command uses no model and makes no network request of its own, with one exception: if an older setup left a git clone in `~/.claude/claude-code-handover`, `init` runs `git pull --ff-only` there. `init --dry-run` shows what it would write.

`uninstall` takes out our three hook entries, the two skills (when they are still the copies `init` wrote) and the copy of the scripts, after a backup of `settings.json`. It keeps the rest: the recall index (`claude-code-handover-data` in the config folder, a local copy of remarks from your transcripts), the effort settings `init` merged into `settings.json` (including `cleanupPeriodDays`), the `settings.json.bak-*` backups and your project files. Delete those by hand if you want them gone.
