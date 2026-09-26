# @chrismessina/raycast-faker — spec

Realistic Store screenshots for Raycast extensions that show confidential data: a bank, a CRM, a
calendar, health records, an inbox. The only realistic data such an extension has is its
contributor's own account. The usual workaround is to blur or pixelate it, which makes the
screenshots look broken and still risks a missed value. The faker records your real API
responses, replaces the values that identify anyone, and replays the result. The screens look
lived-in, and nothing on them is real.

## How it fits into publishing

1. **Wire it once:** wrap the extension's `fetch` in `withFaker`, and each LocalStorage key in `fakerKey`.
2. **Record:** `npx raycast-faker record` from the extension root (or pass its `name` from
   `package.json`), then walk every screen you plan to shoot.
3. **Replay:** `npx raycast-faker replay`, then take the screenshots with Raycast's Window Capture.
4. **Off:** `npx raycast-faker off`. Your real data is back, untouched.

Retake them whenever the UI changes. Fixtures stay on disk, so later rounds need only replay,
unless a screen calls an endpoint you haven't recorded. The full procedure, including capture
and audit, is the `screenshots` skill in `raycast-extensions-skills`.

## Pieces

| Piece | In the Store build? | Job |
| --- | --- | --- |
| `withFaker(fetch, rules)` | Yes, inert | Records scrubbed fixtures, or replays them |
| `fakerKey(key)` | Yes, inert | Gives LocalStorage a separate, empty namespace while replaying |
| `isReplaying()` | Yes, inert | Lets the extension refuse work the faker can't see (downloads) |
| `raycast-faker` CLI | No | Switches modes and clears fixtures |

**Inert** means that when `environment.isDevelopment` is false, `withFaker` returns the `fetch` it
was given, `fakerKey` returns its argument, and `isReplaying` returns false. A Store build can't
enter record or replay, whatever is on disk.

## Modes

The mode is stored in `~/.config/raycast-faker/<extension>/config.json`, outside the extension
folder, because `ray publish` ships everything inside it. A missing file means `off`.

| Mode | Requests | Written to disk |
| --- | --- | --- |
| `off` | Real, unchanged | Nothing |
| `record` | Real. Each response with a JSON `content-type` is scrubbed **in memory** | The scrubbed copy only; raw data is never written |
| `replay` | Answered from fixtures. **Unmatched requests fail** | Nothing |

In replay, a request with no fixture gets a 404 instead of reaching the real API. A missing
fixture shows up as an error on screen, never as a screen quietly showing real data.

Record uses the real LocalStorage, since it needs your real logins. Only replay switches `fakerKey`
to the separate namespace, so you add an account again inside replay. Replay never checks tokens, so any token the
extension itself accepts works.

## Rules

Rules live in code, so they're versioned with the extension. They name fields, never values.

```ts
const apiFetch = withFaker(fetch, {
  hosts: ["api.example.com"], // requests to record and replay; everything else passes through
  keep: ["status", "kind", "type"], // enums and public data the UI or its logic reads
  keepIf: { description: /^Dividend posted: .+$/ }, // kept only when the value matches
  keepHosts: ["app.example.com"], // URL hosts kept as they are, besides `hosts`
  names: { counterpartyName: "company", nameOnCard: "person", name: "account", "merchantLock.name": "company" },
  scale: ["amount", "balance"], // money; fields whose names look like money are scaled anyway
  safeWords: ["brokerage"], // words that may stay in an account-style name
});
```

**String values are fail-closed:** every one is replaced unless a rule keeps it, except ASCII codes
of one or two characters. List every field the
UI branches on (status, kind, type) in `keep`, or it arrives as fake text. Write a `keepIf` pattern
as tightly as the public forms allow; a loose one keeps personal text.

| Value | Becomes |
| --- | --- |
| A `person` name | A Twin Peaks character |
| A `company` name | A Twin Peaks place or business |
| An `account` name | Kept if every word is banking vocabulary ("Savings ••6333", with the digits changed); otherwise a Twin Peaks place |
| Other text (notes, memos) | A Twin Peaks line |
| UUIDs | A fake UUID, the same everywhere, in bodies and in request paths |
| Account numbers, digit strings | Other digits, same length |
| Emails | A Twin Peaks character at `example.com` |
| URLs | The host becomes `example.com` unless it's listed; IDs in the path are mapped |
| Money | Multiplied by one hidden factor (0.4–1.6), so totals and running balances agree to within a few cents |
| Dates | Shifted back by the same few days; timestamps also get a few hours of jitter |
| Short ASCII codes ("US", "CA") | Kept, unless the field has a name rule |

A rule for `parent.key` wins over one for `key`, so a merchant's `name` can differ from an
account's. Fakes are derived from an HMAC of the real value with a secret in `config.json`: the
same real value in the same kind of field always gets the same fake, and no real-to-fake table
is ever stored.

**Leak check.** Before saving, the scrubber searches every value it kept verbatim for any original
it replaced, and for each word of a replaced name, except banking vocabulary. A hit means a
field holding personal data is in `keep`, so the fixture is **not saved**. The console and
`refused.json` name the fields, never the values. Fix the rule and walk that screen again. A
refusal is the faker doing its job.

The check has two blind spots: `keepIf` values (the pattern is their only check, so keep it
tight) and originals shorter than four characters, which would match by coincidence.

## Fixtures

`~/.config/raycast-faker/<extension>/fixtures/<host>/<METHOD> <path>.json` holds
`{ "status": 200, "body": … }`.

- **Keyed by method, path, and page parameters** (`start_after`, `end_before`, `cursor`, `offset`),
  so page 2 isn't a replay of page 1. Other query parameters are ignored: a search replays the
  recorded list, so screenshot an unfiltered view or accept an illustrative result.
- **`raycast-faker clear`** deletes the fixtures but keeps the secrets, so re-recording produces the
  same fakes. Delete `config.json` for all-new fakes.
- **One login per recording.** Fixtures aren't keyed by token, so two accounts calling the same
  endpoint overwrite each other. Record with only the account you want to show.

## Where real data leaks besides `fetch`

The faker scrubs the string values in JSON responses from the wrapped `fetch`, and moves keys
wrapped in `fakerKey`. Check each of these before shooting:

- **What the scrubber leaves as is.** Object keys (a map keyed by email address), numbers other
  than money (a numeric ID or account number), and path segments other than UUIDs and runs of
  four or more digits (a username in `/users/jane`), which end up in fixture file names. If your
  API puts personal data in any of these, don't record that endpoint.

- **Other caches.** `useCachedPromise`, `useCachedState`, `useFetch` and `Cache` hold real data
  from normal use and show it before a replayed request answers. Key them with `fakerKey`, or
  clear the extension's cache.
- **Requests outside the wrapped `fetch`:** `useFetch`, which calls the global `fetch`; SDKs that
  don't accept a custom `fetch`; curl and other downloaders; AppleScript; local files. Refuse them
  with `isReplaying()`, or plan screens that don't show their results.
- **Identity saved at setup,** such as an account name stored when a token is added. Replay starts
  empty, so record the endpoint the setup flow calls.
- **The shape of your history.** Scaling hides magnitudes, not trends: a chart keeps its real
  shape. Decide whether that's acceptable for your data.

A human still has to look at every screenshot before it ships.
