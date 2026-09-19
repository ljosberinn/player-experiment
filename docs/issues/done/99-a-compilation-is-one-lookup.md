# 99 — A compilation is one lookup, not twelve

`...And In The Darkness Bind Them` is twelve tiles in the Releases grid, one
per artist, one track each. It is the shape
[87](done/87-one-release-one-tile.md) measured and deferred, and 87's premise
for deferring it does not hold.

Re-measured on the same library, now 65,537 tracks and 8,078 tiles:

| | |
| --- | --- |
| Album titles split across more than one tile | 409 |
| Duplicate tiles they cost | 1,418 (17.5% of every tile) |
| Of those titles, none of whose tracks carries an album artist | 311 |

87 says: "**82b is what fixes those, not this.** 332 of the 356 have no album
artist on any track, and 82 writes one for every release above the threshold:
`Various Artists` for a compilation … The existing `(album, GROUP_ARTIST)` key
then collapses them on its own."

It cannot. `lookup::pending` groups by the same two expressions the grid does
([lookup.rs:63-64](src-tauri/src/db/lookup.rs#L63-L64)), so a twelve-artist
compilation with no album artist enters the queue as **twelve releases of one
track each**. `pass::look_up` requires `detail.tracks.len() == members.len()`
before it will write anything, so a twelve-track MusicBrainz release can never
match a one-file local release. Nothing is written, the album artist 87 is
waiting for never arrives, and each fragment is recorded `review` or `none`
forever. The pass that was supposed to fix the grid is split by the same key
the grid is split by.

The lookup dialog is no escape either: `release_members` takes the same
`(album, artist)` pair ([query.rs:647-677](src-tauri/src/db/query.rs#L647-L677)),
so drilling into one fragment and looking it up stamps that fragment alone.

## What makes a title one release

Grouping on the title alone is the thing 87 forbids, and for good reason —
`Above` and `Alice` are each two unrelated albums that share a name, and no
grouping by title may merge them. The signal that separates the two cases is
already in the database:

| Over the 409 split titles | |
| --- | --- |
| Every track shares one `cover_hash`, and none is NULL | **237** → 919 of the 1,418 duplicate tiles |
| One year across the title | 327 |
| Track numbers unique across the title — one tracklist | 277 |
| One directory per tile | 351 |

The artwork is the discriminator. Twelve artists over one release share one
embedded cover; two unrelated albums named `Above` do not. The directory is
worthless here and the reason is ours: the mover files by `GROUP_ARTIST`
([83a](done/83a-where-a-file-goes.md)), so it has already scattered the twelve
files into twelve `D:\Library\<artist>\...And In The Darkness Bind Them - 2009
- Album\` folders.

A title is one various-artists release when, over its tracks that are not
missing:

- the album is not NULL — an untagged group is not a release,
- `count(DISTINCT lower(ARTIST)) > 1`,
- `count(DISTINCT cover_hash) = 1` and `count(cover_hash) = count(*)`.

## `Various Artists` is the key, not a flag

Such a release is keyed `(album, "Various Artists")`. No column and no
migration: `release_lookup.artist` is TEXT
([schema.rs:309-323](src-tauri/src/db/schema.rs#L309-L323)) and the literal is
exactly what the pass writes into every file's album artist when it resolves
the release. After a successful write the tracks carry that album artist for
real, `GROUP_ARTIST` yields it on its own, and the recorded row still matches —
the key self-heals into an ordinary one. After a `review` or `none` the tracks
are unchanged and the derived key still produces the same literal, so the row
still matches and the release is not re-searched. A release whose files already
say `Various Artists` is the same release under the same key.

NULL was the other candidate and is wrong: it already means "no artist and no
album artist", and a compilation is not that.

## The key is a two-level grouping

The flag is an aggregate over the title, and a `GROUP BY` may not reference an
aggregate of the group it is forming. So the title's verdict is computed first
and joined back:

```sql
WITH titles AS (
    SELECT {ALBUM} AS album,
           count(DISTINCT lower({ARTIST})) > 1
           AND count(DISTINCT tracks.cover_hash) = 1
           AND count(tracks.cover_hash) = count(*) AS various
      FROM tracks
     WHERE tracks.missing_since IS NULL AND {ALBUM} IS NOT NULL
     GROUP BY {ALBUM} COLLATE NOCASE)
```

and the release key becomes
`CASE WHEN titles.various THEN 'Various Artists' ELSE {ARTIST} END`.

`lookup::pending` and `query::release_members` both take it, from one shared
fragment, because a release has to be the same thing in the queue as it is when
its files are fetched — the invariant `lookup.rs:10-12` already states and
`a_release_tagged_two_ways_is_one_pending_release` already guards. `pending`
gains a second grouped pass over `tracks`; it already groups every row and is
batched for exactly that reason, so this doubles a cost that is already paid
once per batch rather than adding a new one.

`release_members` for such a release matches on the album alone — every
non-missing track of that title — which needs no aggregate in the `WHERE`.

`release_selections` ([query.rs:556-598](src-tauri/src/db/query.rs#L556-L598))
is the third site and takes the key too. It decides how many lookups a
selection costs, and its doc already says a release has to be the same thing
here as it is in the grid; selecting twelve compilation tracks and being told
it is twelve lookups would be the old answer surviving in the one place the
user is asked to agree to it.

## The browse grid is not touched

`release_identity` stays as it is. The tiles collapse because the pass writes
the album artist, which is how 87 designed it; this issue only makes the pass
able to reach them. That also means the fix is not retroactive on its own: the
409 titles collapse as the pass works through them, not at migration.

**The files move.** Writing `Various Artists` to a release the mover has
already filed re-files all twelve tracks out of twelve artist folders into one
([83b](done/83b-moving-one-release.md)). That is correct and it is also the
largest visible consequence of this change on a library with the folder turned
on — worth a line in the release notes rather than a surprise.

## What this does not fix

The 172 split titles whose tracks do not share one cover: a compilation ripped
twice, art embedded by two tools, or genuinely two albums of a name. The first
two stay broken and are the reassessment 87 asked for, once this has run and
the remainder can be counted rather than guessed. `release_type` cannot help —
`tags::primary_type` discards secondary types ([93](done/93-picard-release-types.md)),
and the measured library holds no `compilation` value at all: `Album` 10,811,
`EP` 631, `Single` 93, `Other` 93, none 53,909.

## Testing

Rust, against a seeded library:

- twelve one-track rows sharing a title and a cover hash, with no album artist,
  asserted to be **one** pending release keyed `(title, "Various Artists")`,
  and `release_members` on it to return all twelve in `RELEASE_ORDER`;
- the same twelve with two distinct cover hashes asserted to stay twelve
  pending releases;
- two five-track albums sharing a title, by two artists, with different covers
  — the `Above` case — asserted to stay two;
- a title with one cover hash but a single artist asserted to be keyed on that
  artist, not on the literal;
- every track NULL-covered asserted not to merge;
- rows with no album at all asserted to stay out of the various branch;
- a release already tagged `Various Artists` asserted to produce the same key
  as one the rule derives it for, so a resolved row still matches after the
  write — the self-healing property, which is the one that stops a re-search;
- `a_release_tagged_two_ways_is_one_pending_release` extended to cover the
  derived key, so `lookup.rs`'s copy of the expressions and `db::query`'s stay
  in step;
- `release_selections` over the twelve track ids asserted to be one selection,
  which is the number the user is shown before agreeing to the lookups.

The pass's own tests need a twelve-file various release matched against a
twelve-track MusicBrainz release and asserted written, which is the whole point
and fails today at the member count.

## What shipped, where it differs

`lookup::pending` is not what feeds the pass. `library::survey` is, over
`query::for_each_release`, which groups on the same two expressions and had the
same defect. Both take the key, as do `lookup::queue` — whose scan is also the
prune, and which would have deleted every queued compilation as an orphan on
the first open — and `lookup::seed_from_tags`, which would otherwise seed one
unmatchable resolved row per artist.

`for_each_release` is shared by the lookup survey and the mover, so the move is
not a consequence of the write: a compilation is filed into one
`Various Artists` folder on the next sweep, whether or not MusicBrainz ever
answers. Splitting the two would mean a survey carrying two identities per
release, which is a second notion of what a release is — the thing this issue
exists to remove.
