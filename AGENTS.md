# AGENTS.md

`@chrismessina/raycast-faker` lets a Raycast extension that shows confidential data (a bank, a
CRM, an inbox) take realistic Store screenshots without blurring the contributor's real account.
It records real API responses, scrubs them in memory, and replays the scrubbed copies. The user
docs are `README.md` (ships to npm) and `docs/SPEC.md` (rules, modes, limits).

Paths here are repo-relative. This file does not ship to npm (`package.json` `files` is `dist`
and `CHANGELOG.md`).

## Layout

| File | Job |
| --- | --- |
| `src/index.ts` | Public API: `withFaker(fetch, rules)`, `fakerKey(key)`, `isReplaying()` |
| `src/scrub.ts` | `createScrubber`: every replacement rule and the leak check |
| `src/config.ts` | `~/.config/raycast-faker/<extension>/config.json`: mode and secrets |
| `src/fixtures.ts` | Fixture file names, reads and writes, `refused.json` |
| `src/cli.ts` | The `raycast-faker` CLI: `record`, `replay`, `off`, `status`, `clear` |
| `src/names.ts` | Twin Peaks people, places, and lines |
| `test/*.test.mjs` | `node --test` against `dist/` |

## Commands

```bash
npm test          # builds, then runs every test in test/
npm run typecheck # tsc --noEmit
```

There is no lint step. CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm test`, `npm audit` and
`npm pack --dry-run` on Node 22 and 24.

## Invariants: break one and real data reaches disk or a screenshot

- **Inert outside development.** When `environment.isDevelopment` is false, `withFaker` returns
  the `fetch` it was given, `fakerKey` returns its argument, and `isReplaying` returns false.
  `test/inert.test.mjs` pins the first two; `isReplaying` has no test yet. A Store build must
  never be able to record or replay.
- **Nothing raw is written.** Record scrubs in memory and writes only the scrubbed body. Never
  add a debug dump, cache, or log line that writes an original value. `refused.json` and the
  console name fields, never values.
- **Fail-closed.** Every string is replaced unless a rule keeps it. New behavior that passes
  something through by default is a leak, not a convenience.
- **Replay never reaches the network** for a configured host: a missing fixture is a 404.
- **No real-to-fake table.** Fakes are derived from an HMAC of the real value with the secret in
  `config.json`, so there is nothing to reverse.
- **Config lives outside the extension folder,** because `ray publish` ships everything inside it.

Known limits, documented in `docs/SPEC.md` under "What the faker doesn't cover": object keys, numbers
other than money, and some path segments pass through unscrubbed; the leak check skips `keepIf`
values and originals under four characters; fixtures aren't keyed by token. Closing any of these
is a 0.x feature; say so in `CHANGELOG.md`.

## Changing the scrubber

- Add a test first in `test/hardening.test.mjs` (a leak) or `test/scrub.test.mjs` (a
  replacement), watch it fail, then fix `src/scrub.ts`.
- Test data must be invented. Never put a real person's name, account number, or address in a
  test, even the maintainer's own.
- A change to how a value is faked changes every adopter's screenshots on their next recording.
  Note it in `CHANGELOG.md`.

## Releasing

1. Bump `version` in `package.json` and add the `CHANGELOG.md` entry.
2. Commit and push to `main`.
3. Publish a GitHub release tagged `v<version>`. `.github/workflows/publish.yml` checks that the
   tag matches `package.json`, runs the tests, and publishes to npm with provenance, using the
   repo's `NPM_TOKEN` secret. A release marked as a prerelease publishes under the `next` tag.

## Adopters and the procedure

- Reference adopter: `raycast-mercury` (`src/mercury.ts` holds its rules).
- The step-by-step screenshot procedure is the `screenshots` skill in `raycast-extensions-skills`
  (`plugins/raycast-extensions/skills/screenshots/SKILL.md`). Keep it in step with any change to
  modes or the CLI.

## House rules

- US English in code, comments, docs, and commit messages.
- This repo is public. No private session links in commits; a `commit-msg` hook refuses them.
