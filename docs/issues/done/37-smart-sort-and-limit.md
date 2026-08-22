# 37 — Smart playlists get sort and limit

Merged in #58.

"Most played" is not a filter — it is an ordering and a cutoff — so the model grew
two optional pieces, stored in `playlists.sort_json`, which had existed unused
since migration 1. No schema change.

```ts
type SmartQuery = { filter: Group; sort?: { field; direction }; limit?: number }
```

- **A limit decides membership, not display order.** It is part of what `scope()`
  builds — `tracks.id IN (SELECT id … ORDER BY … LIMIT ?)` — not a `LIMIT` on the
  page query. Appended there, sorting the open playlist would silently change
  which hundred songs it holds and searching inside it would search the whole
  library. In `scope()`, `count_tracks`, `library_stats` and `all_track_ids` are
  all correct with no call-site arithmetic. (This superseded a planned
  `min(count, limit)`, which cannot compute "how many of the limited hundred
  match" once a search is running.)
- The sort field goes through the same whitelist enum the filter fields do — it is
  concatenated into SQL. The limit is a bound integer.
- **`relevance` and `position` are refused** as a smart sort rather than falling
  back the way `db::query` does. A silent fallback is right for a display order the
  user can see and change; here the sort decides membership, and handing back a
  different hundred is not a detail.
- **The built-ins**, seeded on first run and special-cased nowhere: **Recently
  Added** (`added_at` desc, limit 100) and **Most Played** (`plays > 0`,
  `play_count` desc, limit 100). `plays > 0` is not redundant beside the cutoff —
  without it a library with nothing played shows a hundred arbitrary songs. The
  guard is a `playlists.seeded` settings flag, not a check for the playlists
  themselves, so deleting Most Played deletes it. Seeding runs from `lib.rs`'s
  `setup`, not `Db::open`: which playlists a new library starts with is a product
  decision. **Top Rated is not among them** — there is no rating field, and
  inventing one to satisfy a mockup label is the tail wagging the dog.
- The editor footer was planned as one sentence and built as **two rows with
  checkboxes**: "sorted by nothing" and "limited to no songs" both have to be
  expressible, and a select whose first option is blank says that far less clearly.
  Ticking the cutoff supplies a sort if there is none; unticking it leaves the sort
  alone.
- **Exports carry the order** alongside the filter, or a Most Played would read
  back as every song ever played. The key is omitted when there is no order, so
  earlier exports stay valid at the same `schemaVersion`.
