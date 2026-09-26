# @chrismessina/raycast-faker

Realistic Store screenshots for Raycast extensions that show confidential data, without blurring
or pixelating your own account.

An extension for a bank, a CRM, a calendar, or an inbox has only one source of realistic
screens: the contributor's real data. The faker records your extension's real API responses and
scrubs them in memory. People and businesses become Twin Peaks characters and places. Text IDs,
account numbers, and free text are replaced consistently. Amounts are scaled by one hidden
factor, and dates are shifted. Then it **replays** those fixtures while you take the
screenshots. Everything looks real; nothing is.

```ts
import { fakerKey, withFaker } from "@chrismessina/raycast-faker";

const apiFetch = withFaker(fetch, {
  hosts: ["api.example.com"],
  keep: ["status", "kind"], // enums and public data your UI reads
  names: { counterpartyName: "company", nameOnCard: "person", name: "account" },
  scale: ["amount", "balance"],
});

await LocalStorage.getItem(fakerKey("logins")); // a separate, empty store while replaying
```

```bash
npx raycast-faker record   # from the extension root; walk every screen you plan to shoot
npx raycast-faker replay   # take the screenshots
npx raycast-faker off      # back to your real data
```

- **Safe to ship.** Only development builds can record or replay. In a Store build, `withFaker`
  returns the `fetch` you gave it and `fakerKey` returns its key.
- **No raw response is written.** Fixtures and secrets live in `~/.config/raycast-faker/<extension>/`,
  outside the extension folder, because `ray publish` ships everything inside it. Responses are
  scrubbed before they're saved, and a fixture in which a replaced value survives in a kept field
  is refused.
- **Fail-closed.** Every string value is replaced unless a rule keeps it (or it's a one- or
  two-letter code), and in replay a request with no fixture fails instead of reaching the real
  API.
- **Know the limits.** Object keys, numbers other than money, and some path segments are left as
  they are. Other caches, downloads, and SDKs with their own transport need handling in the
  extension. See the list at the end of the spec.

Rules, modes, and the full list of replacements: [docs/SPEC.md](docs/SPEC.md). The step-by-step
screenshot procedure is the `screenshots` skill in `raycast-extensions-skills`.
