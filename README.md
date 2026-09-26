# @chrismessina/raycast-faker

Real-looking, obscured data for Store screenshots of Raycast extensions that show personal data.

**Record** captures your extension's real API responses and scrubs them in memory. People and
businesses become Twin Peaks characters and places. IDs, account numbers, and free text are
replaced consistently. Amounts are scaled by one hidden factor, and dates are shifted. **Replay**
then answers from those fixtures. Everything looks real; nothing is. Only development builds can
record or replay: in a Store build, `withFaker` returns the `fetch` you gave it.

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
npx raycast-faker record   # walk every screen once
npx raycast-faker replay   # take the screenshots
npx raycast-faker off
```

Fixtures and secrets live in `~/.config/raycast-faker/<extension>/`, outside the extension folder,
because `ray publish` ships everything inside it. No real value is ever written: fixtures are
scrubbed before they're saved, and a fixture where any original value survived is refused.

The full design is in [docs/SPEC.md](docs/SPEC.md). The procedure, including what the faker can't
cover (curl downloads, AppleScript), is the `screenshots` skill in `raycast-extensions-skills`.
