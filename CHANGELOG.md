# Changelog

## 0.1.1

- The leak check searches only values written out verbatim (kept fields and short codes), not
  the fakes. That stops false refusals when a merchant word also appears in a Twin Peaks name, a
  custom category matches a kept enum, or a value reappears in a `keepIf`-validated field. A name
  surviving in a kept field is still refused.
- A refusal names the fields a leaked value came from, never the value, in
  `~/.config/raycast-faker/<extension>/refused.json` and in the console warning.
- `raycast-faker clear` also removes `refused.json`.

## 0.1.0

- `withFaker(fetch, rules)`: record scrubbed fixtures, or replay them, in development builds only.
- `fakerKey(key)`: a separate LocalStorage namespace while replaying.
- `raycast-faker` CLI: `record`, `replay`, `off`, `status`, `clear`.
- Twin Peaks names for people and places. Dates shift together, with hours of jitter on timestamps.
- A leak check refuses to save any fixture where an original value survived.
