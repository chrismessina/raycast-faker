# @chrismessina/raycast-faker — spec

Fake-but-real-shaped data for Store screenshots of extensions that show personal data.
First adopter: `raycast-mercury`. Status: **approved 2026-09-26** with the decisions below.

## Decisions

- **Name:** `@chrismessina/raycast-faker`. API: `withFaker(fetch, rules)` and `fakerKey(key)`; config in `~/.config/raycast-faker/<extensionName>/`.
- **Skill:** `raycast-screenshots` in the `raycast-extensions` plugin, next to `ship`.
- **Goal:** everything looks real; only personal details are obscured.
- **Names** come from Twin Peaks: characters for people, places for businesses.
- **Dates** are jittered: one hidden shift for the whole extension, plus a few hours of jitter on timestamps. Date-only fields take only the shift, so running balances and charts stay consistent.
- **Nothing real is stored.** Each fake value is derived from a hash of the real value and a random secret in `config.json`, so no real-to-fake table is ever written.
- **Pagination parameters** (`start_after`, `end_before`, `cursor`, `offset`) are part of a fixture's key, so page 2 is not a replay of page 1. Other query parameters are ignored.
- **Record mode uses the real storage**, since it needs your real logins. Only **replay** switches `fakerKey` to the fake namespace.

## The problem, grounded in Mercury

Store screenshots have to come from somewhere. For Mercury, "somewhere" is Chris's bank.
Faking the API alone does not make a screenshot safe. Three things in Mercury leak real data
even when every response is fake:

1. **Cached balances.** Manage Accounts paints the LocalStorage snapshot before any request.
2. **Stored identity.** A login's name ("Christopher Messina") is saved at Add Account, not fetched.
3. **Non-fetch transfers.** Statement PDFs download through curl (`raycast-downloader`), which no
   `fetch` wrapper can see.

So the kit covers requests, storage, and a written procedure (the skill) for the rest.

## Pieces

| Piece | Ships in the Store bundle? | Job |
| --- | --- | --- |
| `withFaker(fetch, rules)` | Yes, inert | Replays scrubbed fixtures, or records them |
| `fakerKey(key)` | Yes, inert | Moves LocalStorage keys to a separate namespace while fixtures are on |
| `raycast-screenshots` skill | No | Record, replay, capture, and audit, step by step |

"Inert" means: when `environment.isDevelopment` is false, `withFaker` returns the `fetch` it
was given, unchanged, and `fakerKey` returns its argument. A Store build cannot enter fixture
mode, whatever is on disk.

## Modes

Set in `~/.config/raycast-faker/<extensionName>/config.json`, outside the extension folder
(`ray publish` ships everything inside it). A missing file means `off`.

```json
{ "mode": "replay" }
```

| Mode | Requests | Written to disk |
| --- | --- | --- |
| `off` | Real, unchanged | Nothing |
| `record` | Real; each JSON response is scrubbed **in memory** | The scrubbed copy only. Raw data is never written |
| `replay` | Answered from fixtures. **Unmatched requests fail** (they don't fall through to the real API) | Nothing |

Unmatched requests failing is deliberate. A screen that silently fetched real data is the exact
failure this kit exists to prevent. A missing fixture shows up as an error you can see.

## Fixtures

`~/.config/raycast-faker/<extensionName>/fixtures/<host>/<METHOD> <path>.json` holds
`{ "status": 200, "body": … }`.

- **Matched by method and path.** The query string is ignored by default, so
  `/transactions?limit=500&order=desc` and `/transactions?search=chase` get the same answer.
  Search results in screenshots are therefore illustrative; the skill says so.
- **IDs stay consistent.** A real UUID maps to the same fake UUID everywhere, in bodies and in
  paths. The extension navigates with fake IDs from fake lists, and the paths it requests match
  the recorded ones.

## Scrubbing (record mode)

Rules are passed in code, so they're versioned with the extension. They're field names, nothing
sensitive:

```ts
const request = withFaker(fetch, {
  hosts: ["api.mercury.com"],
  keep: ["kind", "status", "type", "mercuryCategory", "documentType", "interval", "network"],
  names: { counterpartyName: "company", nameOnCard: "person", legalBusinessName: "person", nickname: "account" },
  scale: ["amount", "balance", "currentBalance", "availableBalance", "endingBalance", "netAmount"],
});
```

Defaults are **fail-closed**. Every string is replaced unless it is:

- in `keep`;
- an ISO date or timestamp (dates are kept, so charts keep their shape);
- a UUID (mapped consistently);
- a URL (its host becomes `example.com`, and the path is mapped).

Replacements:

- **Names:** realistic fakes from a small built-in word list (people, companies, merchants,
  accounts). The same real value gets the same fake value everywhere. No faker dependency.
- **Other strings** (notes, memos, descriptions): fake text of similar length.
- **Numbers in `scale`:** multiplied by one factor, chosen at random once per extension (0.4–1.6)
  and stored in `config.json`. One factor keeps totals, running balances, and return percentages
  consistent with each other. It hides the real magnitudes, but not the shape of the history.
- **Account numbers and other digit strings:** replaced digit for digit, keeping their length.

**Leak check before any write.** The scrubber knows every original value it replaced. If any
original string of 4+ characters still appears anywhere in the output, that fixture is **not
written**, and the log names the field. The extension keeps working in record mode; only that
fixture is missing, which replay then reports as unmatched.

## Storage (`fakerKey`)

```ts
LocalStorage.getItem(fakerKey("mercury-logins"));
```

While fixtures are on, this returns `raycast-faker:mercury-logins`. The extension sees an empty store
(no logins, no cached balances), so you add an account inside fixture mode. Its name comes from
the scrubbed `/organization`. Turning fixtures off returns you to the real store, untouched.

## Hardening after review (2026-09-26)

Codex found ten ways real data could reach disk. All are fixed and tested:

- **No enum heuristic.** Every string not in `keep` or `keepIf` is replaced; enums must be listed.
- **`keepIf: { field: /pattern/ }`** keeps a field only when its value matches.
- **Account-style names** keep their words only if every word is banking vocabulary (`safeWords`
  extends it). Otherwise they're replaced whole.
- **Money is scaled even when unlisted,** whenever the field name looks like money.
- **The leak check is case-insensitive** and also checks each word of a replaced name, except
  banking vocabulary.
- **Only `hosts` and `keepHosts` keep a URL's origin.** Anything else becomes `example.com`.
- **The CLI generates secrets once, when it creates the config.** Before, it wrote `scale: 1`,
  which would have left every amount unscaled.
- **Extension names are validated** as a single path component, so `clear ..` can't escape.
- **Adopters refuse non-`fetch` transfers while replaying** (Mercury: statement downloads).
- **Storage keys are resolved at each use,** never cached at module load, so switching modes
  can't leave one store pointing at the real data.

A second review reopened three of these, now fixed:

- **Names in any script:** words are Unicode letters, and short values are kept as codes only when
  they're ASCII and have no name rule ("张伟" is a name, "CA" is a code).
- **Rules can name a parent** (`merchantLock.name`), which wins over the plain key (`name`).
- **`total` and a bare `limit` aren't money.** In responses they're counts.
- **A `keepIf` pattern must spell out the public forms exactly.** Mercury's keeps three Treasury
  description shapes, not "anything after `posted:`".

## What the kit does not cover

- **Transfers outside `fetch`** (curl downloads, AppleScript, SDKs with their own transport).
  The skill lists these per extension. For Mercury, don't screenshot a downloaded PDF.
- **Server-side behavior** (search, filtering, pagination). Replay returns the recorded page.
- **Deciding a screenshot is clean.** The skill ends with a human look at every image, plus an
  automated pass that searches the recorded originals for any string visible in the screenshot.

## `raycast-screenshots` skill (outline)

1. **Inventory:** list the extension's hosts, caches, stored identity, and non-`fetch` transfers.
2. **Wire it:** `withFaker` at the one `fetch` call site, `fakerKey` on every
   LocalStorage key.
3. **Record:** mode `record`, walk every screen, check the log for leak-check refusals.
4. **Replay:** mode `replay`, add an account, walk every screen again, fix unmatched requests.
5. **Capture** at 2000 × 1250 with Raycast's Window Capture.
6. **Audit:** a human look at each image, plus the automated pass above.
7. **Off:** mode `off`. Confirm real data is back and nothing from fixture mode leaked into it.

## Mercury changes (the grounding)

- `mercuryGet` calls `withFaker(fetch, rules)` instead of `fetch`.
- Every LocalStorage key goes through `fakerKey`: logins, the legacy-import fingerprint,
  balance snapshots, menu bar settings, and download history.
- About 15 lines, all inert in the Store build.

## Open questions

1. **Name.** `raycast-faker`, or something that says "screenshots" (`raycast-screenshot-mode`)?
2. **Where the skill lives.** In the `raycast-extensions` plugin next to `ship` (my
   recommendation, since `ship` already checks screenshot staleness), or as a user skill?
3. **Scale factor.** 0.4–1.6 changes magnitudes but keeps the shape. Is the shape of your real
   history acceptable in a public screenshot, or should replay also jitter dates?
