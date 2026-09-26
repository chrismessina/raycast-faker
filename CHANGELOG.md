# Changelog

## 0.1.0

- `withFaker(fetch, rules)`: record scrubbed fixtures, or replay them, in development builds only.
- `fakerKey(key)`: a separate LocalStorage namespace while replaying.
- `raycast-faker` CLI: `record`, `replay`, `off`, `status`, `clear`.
- Twin Peaks names for people and places. Dates shift together, with hours of jitter on timestamps.
- A leak check refuses to save any fixture where an original value survived.
