# Sprint 1 offline fixtures

See `docs/SPRINT1_CONTRACTS_AND_FIXTURES.md` for the Chinese beginner guide and policies.

- `manifest.json`: stable IDs, owning roles and development/reserved split.
- `<split>/<id>/scenario.json`: input, configuration, raw provider attempts, review history and expected results.
- `<split>/<id>/base/**.txt`, `head/**.txt`: source snapshots at synthetic 40-character SHAs, never executable application files.

These are acceptance oracles and local adapter inputs, not real model observations or production risk/gate implementations. Reserved examples are public regression cases, not a blind evaluation set.
