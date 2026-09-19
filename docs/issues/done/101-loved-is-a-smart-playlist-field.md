# 101 — Loved is a smart-playlist field

The loved set is already fetched and already stored. `Import::loved` pages
`user.getLovedTracks`, reduces each entry to `plays::match_key` and replaces
`lastfm_loved` in one transaction
([import.rs:239-281](src-tauri/src/lastfm/import.rs#L239-L281)). Statistics
already filters on it ([stats.rs:90-96](src-tauri/src/db/stats.rs#L90-L96)).
A smart playlist cannot, and that is the whole gap.

## It resolves through `plays`, and a link table would gain nothing

`lastfm_loved` holds `match_key` and nothing maps a key to a track except
`plays.track_id`. The alternative was a resolved link table filled the way
`plays::resolve` fills `temp.play_keys`. Measured on the library:

| | |
| --- | --- |
| `lastfm_loved` rows | 285 |
| Resolve to a track through `plays` | 215 |
| Match a library track directly, by key | 215 |
| Gained by a table and a migration | **0** |
| Loved, and not in the library at all | 70 |

The two routes return the same set, so the migration buys nothing. Same
measurement, same conclusion as [78](done/78-import-the-lastfm-history.md)
rejecting MBIDs.

```sql
tracks.id IN (SELECT track_id FROM plays
               WHERE track_id IS NOT NULL
                 AND match_key IN (SELECT match_key FROM lastfm_loved))
```

**53 ms**, over 237,675 plays, three runs. The plan scans `plays` — no index
leads on `match_key`; the only one is `UNIQUE(started_at, match_key)`, wrong
order — and a covering `plays(match_key, track_id)` would turn it into a
lookup over 285 keys. Not added: 53 ms is under the budget and an index on the
largest table is not worth buying before something needs it. The number is
here so a later regression has a baseline, and `tests/perf.rs` is where it
belongs.

**The set is only as fresh as the last import.** `Import::loved` runs solely
as the tail of `Import::run` ([import.rs:159-163](src-tauri/src/lastfm/import.rs#L159-L163)),
after the whole history has paged. Loving a track on last.fm elsewhere does not
reach a Loved playlist until the next full import. Accepted for now;
[102](102-love-a-track-from-the-app.md) closes the half of it that matters
most, which is loving from in here.

## A fourth field kind

Every `FilterField` arm is a bare column and `compile_rule` hard-codes
`tracks.{}` ([smart/mod.rs:99](src-tauri/src/smart/mod.rs#L99)). `Loved` is
not a column, so it is a `FilterFieldKind::Boolean` with an early return above
that line, beside the `IsEmpty`/`IsNotEmpty` returns — which assume a column
and have to exclude this field.

- `FilterField::Loved` ([model.rs:595-612](src-tauri/src/model.rs#L595-L612)),
  `kind()` → `Boolean`. `as_sql()` is never reached for it; it returns a
  literal column name and has nothing true to say here, so the early return
  has to come first and the arm should say so rather than return a lie.
- `FilterOp::Is` and `IsNot` over `FilterValue::None` — the field is valueless,
  reading "Loved is" / "Loved is not". No `FilterValue::Bool`: a second way to
  spell the same rule is a second thing to validate.
- `IsNot` emits `tracks.id NOT IN (…)`. The NULL argument that shapes every
  text `IsNot` does not apply — `track_id IS NOT NULL` is inside the subquery,
  so the list holds no NULL and `NOT IN` cannot swallow the row.
- `export_bindings_filter_ops` asserts every field of a kind accepts the same
  operators ([smart/mod.rs:338-345](src-tauri/src/smart/mod.rs#L338-L345)). Its
  own kind satisfies that; giving `Loved` `Text` would fire it.

Then regenerate: `cargo test export_bindings_filter_ops` for
`filterOps.generated.ts`, `npm run bindings` for `FilterField` and
`FilterFieldKind`.

Frontend, all in [filterTree.ts](src/features/smart/filterTree.ts): `FIELDS`
gains `loved` — `filterTree.test.ts` asserts `FIELDS` matches
`FILTER_FIELD_KINDS`, so it is not optional — `OPS_BY_KIND` gains a `boolean`
row and is a `Record<FilterFieldKind, …>`, so it is a type error until it does,
and `valueFor` returns `{ kind: "none" }`. `ValueInput` in
`SmartPlaylistEditor.tsx` needs no branch, because the field renders no input.
`vocabularyFor` returns `null` by default.

## It is empty for most people, and should say so

`lastfm_loved` is empty on a build with no API key
([lastfm/mod.rs:52-65](src-tauri/src/lastfm/mod.rs#L52-L65)) and on anyone who
has never imported. A Loved rule there is not wrong, it is unanswerable, and a
smart playlist that is silently empty is the failure mode this field is most
likely to produce. The editor disables the field and says why, the way
`LastfmSettings.tsx` already disables Connect on a key-less build.

## Export

`PlaylistExport.filter` serialises the tree verbatim
([export/mod.rs:147](src-tauri/src/export/mod.rs#L147)), so an older build
reading a newer export meets an unknown `FilterField` and fails to
deserialise. `kindOf` degrades on the TS side; Rust does not.
[export-schema.md](../knowledge/export-schema.md) should say that a filter
field is a forward-incompatible addition — this is the first one.

## Testing

Rust, in `smart::mod`'s seeded fixture, which has no `lastfm_loved` rows and
needs some: a loved track matched by `Is`; an unloved one matched by `IsNot`;
a track with no play row at all excluded by `Is` and included by `IsNot`; a
loved key whose only play has `track_id IS NULL` — an imported play that
resolved to nothing — asserted to widen neither direction, which is what keeps
the `IS NOT NULL` inside the subquery honest; the rule under `Any` and under a
negated group, since it compiles to a subquery and not to a comparison; and a
`Loved` rule with a text value rejected as a mismatch.

`filterTree.test.ts` for the field/op table, and one editor test that the field
renders no value input.
