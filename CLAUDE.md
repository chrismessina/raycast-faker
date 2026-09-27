# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

`AGENTS.md` is the source of truth for layout, invariants, and releasing; it is shared with Codex.
Put anything both agents need there, not here. What follows is Claude-specific or fills gaps.

## Running tests

Tests import from `dist/`, not `src/`, so a test run without a build exercises stale code.

```bash
npm test                                                   # build + every test
npm run build && node --test test/scrub.test.mjs           # one file
npm run build && node --test --test-name-pattern="leak" test/*.test.mjs  # by name
```

The tests run with no Raycast host, so `raycastEnvironment()` in `src/index.ts` returns undefined
and `withFaker` is inert. That is why `test/inert.test.mjs` needs no mocking, and why record and
replay are tested through `createScrubber` and the fixture helpers directly rather than end to end.

## Request flow (`src/index.ts`)

`withFaker` checks `isDevelopment` once at wrap time, then re-reads `config.json` on every
request, so `raycast-faker record|replay|off` takes effect without reloading the extension.
Only hosts in `rules.hosts` are touched; anything else goes straight to the real `fetch`.

- **Replay:** look up the fixture by `fixtureName(method, path + search)`; missing means a 404.
  Incoming URLs already carry fake IDs, because the lists they came from were faked.
- **Record:** fetch for real, skip non-JSON, scrub the body, then rewrite the path and every query
  value through `mapPath`/`mapId` so the fixture is keyed by the same fake IDs replay will request.
  If the leak check finds an original value in the output, write `refused.json` (field names only)
  instead of the fixture. The caller still gets the real response.
