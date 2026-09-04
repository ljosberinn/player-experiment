# 75 — The genre tree

Black Metal → Atmospheric Black Metal, Raw Black Metal. The hierarchy the genre
donut in [84b](../upcoming/84b-what-you-own.md) drills through, and the whole of
the data work behind it. Depended on nothing.

## Where it comes from

**Wikidata, taken; the alternatives are argued out in
[plans/statistics.md](../../plans/statistics.md).** CC0, so no attribution
burden. Metal Archives is not redistributable, MusicBrainz exposes no
genre-genre relationships over its API, Discogs and AcousticBrainz stop at two
levels.

`scripts/genres.mjs` (`npm run genres`) runs three SPARQL queries and writes
`src-tauri/data/genres.sql`. **The runtime never touches the network** — the
offline-first rule and the CSP both require it. Run by hand, not from CI, and
with **no drift check**: the file is a snapshot of a wiki other people edit, so
there is nothing for a check to be right about.

**6,575 genres, 8,200 edges, 8,004 aliases**, 871KB. Wikidata has 6,628 genre
items and 8,384 edges; the shortfall is the items with no English `rdfs:label`.
They are left out rather than taken from the label service's fallback chain — a
Japanese label cannot match an English tag, and it would take the suffix
derivation's shorter-genre slot from a label that could.

## Migration 11

```sql
CREATE TABLE genres          (label TEXT PRIMARY KEY, parent TEXT);
CREATE TABLE genre_edges     (child TEXT NOT NULL, parent TEXT NOT NULL,
                              PRIMARY KEY (child, parent));
CREATE TABLE genre_aliases   (alias TEXT PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE genre_overrides (label TEXT PRIMARY KEY, parent TEXT);
```

All lowercased, all `WITHOUT ROWID` for the reason `tag_values` has it. The
first three are seeded by `concat!`ing the generated file into the migration —
still SQL, still frozen at compile time, and not 6,575 rows to read past in
`schema.rs`. Indexed on `genres(parent)` and `genre_edges(parent)`, which is the
drill-down's question in both directions.

**No foreign keys between the seeded tables.** `genres.parent` points into
`genres` and the rows arrive alphabetically, so a self-referential key would
have to be deferred to survive its own seed — a constraint holding only at
commit time, over data a generator produces correct by construction.
`genre_overrides.parent` does get one: it is written at runtime, by hand, and a
parent nothing knows is a branch the donut cannot draw.

## Resolution, in three layers

**Wikidata label or alias → suffix derivation → override**, in `db::genres`.

The tree is loaded whole and `resolve` is then pure: 84b resolves every distinct
genre at once, and the suffix layer needs the entire label set to answer even
one string. 68ms to seed a database and 15ms to load the tree, both budgeted in
`tests/perf.rs` — the seed is now paid by every test that opens a database.

**Suffix derivation matches whole trailing words only**, driven from the spaces
in the tag rather than by testing every label for `ends_with`. Without the word
boundary "metalcore" comes out a child of "core". Longest match wins, and the
result is flagged `ParentSource::Derived` so 84b can label a guess as a guess.

`ParentSource` rather than a bare `Option<String>`, because a root of the tree
and a genre nothing matched both have no parent and 84b draws only the first.

**Multi-parent genres are the wrinkle.** Blackened death metal is a child of
both black metal and death metal, and a donut that puts it under both
double-counts. `genre_edges` keeps the whole DAG; `genres.parent` holds one
primary parent, the lexicographically smallest parent label. **That rule is
arbitrary, and is written down at the column as arbitrary.** `genre_overrides`
is what corrects it, and is why the arbitrary rule is affordable.

**`genres.parent` is a forest, not a graph.** P279 in the wild is not acyclic
and a parent chain that loops is a drill-down that never terminates, so the
generator settles genres shortest-chain-first and skips any candidate that would
close a cycle. Nothing needed skipping in this generation; the data is a wiki.

**An alias two genres share is dropped, not picked between** — 139 of them.
"prog" names both progressive rock and progressive metal, so storing one would
be a coin flip presented as a fact; dropped, the tag falls through to the
derivation, which at least says it is guessing.

An override of `NULL` is "this genre has no parent", a correction someone may
well want; `clear_override` is what forgets one.

Nothing here reads `tracks.genre` in bulk yet; the panel that does is
[84b](../upcoming/84b-what-you-own.md).

## Tests

Resolution is a table of cases: an exact label, an alias hit (DSBM), a suffix
derivation asserted flagged as derived, one asserted not to split a word, an
override winning over both, an override onto an unknown parent refused, and a
genre matching no layer. The generator is not tested against the live endpoint;
its committed output is the fixture, and the seeded tree is what the cases run
against.

`db::schema`'s fresh-database test lost its `PRAGMA user_version` assertion. It
pinned the number 10, which is the trap `db::mod` already names — every later
migration looks like a regression — and `migrates_to_the_latest_version` owns
that question.
