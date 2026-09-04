# 75 — The genre tree

Black Metal → Atmospheric Black Metal, Raw Black Metal. The hierarchy the genre
donut in [84b](84b-what-you-own.md) drills through, and the whole of the data
work behind it. Depends on nothing.

## Where it comes from

**Wikidata, taken; the alternatives are argued out in
[plans/statistics.md](../../plans/statistics.md).** 6,628 items are music genres
(`P31/P279* → Q188451`) and 8,384 `subclass of` edges run between them. CC0, so
no attribution burden. Metal Archives is not redistributable, MusicBrainz
exposes no genre-genre relationships over its API, Discogs and AcousticBrainz
stop at two levels.

`scripts/genres.mjs` runs one SPARQL query and writes a committed data file, the
way `scripts/notices.mjs` writes its own. **The runtime never touches the
network** — the offline-first rule and the CSP both require it. Labels and
`skos:altLabel` aliases both come down, so "DSBM" resolves to depressive black
metal.

## The migration

Next free number when it lands; migrations are append-only and numbered by the
order they land.

```sql
CREATE TABLE genres          (label TEXT PRIMARY KEY, parent TEXT);
CREATE TABLE genre_edges     (child TEXT NOT NULL, parent TEXT NOT NULL,
                              PRIMARY KEY (child, parent));
CREATE TABLE genre_aliases   (alias TEXT PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE genre_overrides (label TEXT PRIMARY KEY, parent TEXT);
```

All lowercased. The first three are seeded from the data file by the migration
itself; `genre_overrides` is the only one the app writes at runtime.

## Resolution, in three layers

**Wikidata label or alias → suffix derivation → override.**

Suffix derivation covers what Wikidata lacks by treating a genre as a child of
any shorter genre its name ends with, longest match winning. It is guesswork and
carries a flag saying so, which [84b](84b-what-you-own.md) shows in the panel: a
wrong guess is then something to see and fix rather than something to trust.

**Multi-parent genres are the wrinkle.** Blackened death metal is a child of
both black metal and death metal, and a donut that puts it under both
double-counts. `genre_edges` keeps the whole DAG so nothing is lost;
`genres.parent` holds one primary parent, picked at generation time as the
lexicographically smallest parent label. **That rule is arbitrary, and is
written down at the column as arbitrary** — nothing makes black metal more the
parent than death metal is. `genre_overrides` is what corrects it, and is why
the arbitrary rule is affordable.

Nothing here reads `tracks.genre` in bulk yet; the panel that does is 84b.

Testing: resolution is a pure function with a table of cases — an exact label, a
`skos:altLabel` hit (DSBM), a suffix derivation asserted flagged as derived, an
override winning over both, and a genre matching no layer. The generator script
is not tested against the live endpoint; its committed output is the fixture.
