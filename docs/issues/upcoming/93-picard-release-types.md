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

The scan stores these raw for any file it parses, so the rows do not agree on
one vocabulary. [78](../done/78-import-the-lastfm-history.md)'s backfill leaves
`release_type` alone for that reason. Reading these values in would rename
folders the mover has already filed.

## Wanted

- Values normalized to the primary type when read. A secondary type alone
  (`live`, `compilation`) is not a primary type.
- The backfill extended to `release_type` once they are, accepting that Picard's
  EPs and singles move into their own folders.
