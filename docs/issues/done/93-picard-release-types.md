# 93 — Picard's release types

`tracks.release_type` names the mover's folder (`Album - Year - Type`). The
lookup writes MusicBrainz's primary type: `Album`, `EP`, `Single`, `Broadcast`,
`Other`. Picard writes something else into the same frame. From a sample of
342 Picard-tagged files in the measured library:

| Value in the file | Files |
| --- | --- |
| `album` | 261 |
| `﻿album` / `﻿ep` / `﻿Album` | 23 |
| `ep` | 17 |
| `album`, `compilation` | 10 |
| `live` | 7 |
| `compilation` | 5 |
| `album`, `live` / `album`, `mixtape/street` | 6 |
| `single` | 5 |
| none | 7 |

So Picard writes the type lowercase, carries secondary types, and sometimes
names only a secondary type. A few values start with a byte-order mark.

The scan stores these raw for any file it parses, so the mover already files
releases as `- album`, `- album; compilation` and BOM-prefixed.
[78](../done/78-import-the-lastfm-history.md)'s backfill left `release_type`
alone, so rows scanned before migration 9 have none.

## Wanted

- Values normalized to the primary type when read: the first value naming one,
  case-insensitively, after splitting multiple values and stripping the BOM. A
  secondary type alone (`live`, `compilation`) is not a primary type.
- The backfill reads the type too. A row whose type is already a primary type
  keeps it; any other takes the file's. Picard's EPs and singles move into
  their own folders.
- The backfill runs again on libraries that finished it: its flag is set there.

`- album` → `- Album` is a case-only change, which the mover treats as placed
([81](../done/81-two-casings-two-tiles.md)). Those folders stay lowercase.
