# 82b — The Unattended Lookup Pass, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run 79b's MusicBrainz lookup as a background pass over every release in the library, writing the confident matches and queueing the rest.

**Architecture:** A migration adds `tracks.release_type` and a `release_lookup` table keyed by the browse view's own `(album, artist)` expressions. `db::lookup` owns that table's queries; `tagsource::pass` owns one release's worth of work — search, fetch, score, then write or queue — as a plain function over a `&mut Connection` and a `&dyn Transport`, so the whole rule set is tested against recorded fixtures with no network and no thread. A named `release-lookup` thread started from `lib.rs` drives it, reading the opt-in setting on every wake so the switch cancels a pass in flight, and resuming from the table rather than from the top.

**Tech Stack:** Rust 2021, rusqlite (SQLite), lofty 0.25, serde_json, Tauri 2, React + Zustand + vitest on the frontend.

**Spec:** [docs/issues/done/82b-the-unattended-lookup-pass.md](../issues/done/82b-the-unattended-lookup-pass.md)

## Global Constraints

- **`unsafe_code = "forbid"`** stands. Nothing here needs it.
- **One MusicBrainz request per second, process-wide.** Every MusicBrainz call goes through `tagsource::rate::shared()`, which `musicbrainz::search` and `musicbrainz::fetch` already do for themselves. Never add a second limiter and never call the API around them.
- **The Cover Art Archive has no rate limit** and must not go through the limiter. `tagsource::fetch_release` already fetches a cover beside a tracklist; use it rather than calling `coverart::front` separately.
- **Migrations are append-only.** This is migration 9 — the next entry on `MIGRATIONS`, appended, never an edit to an existing one. (`db/schema.rs`'s header records the one pre-v1 exception 82a took; this plan does not take another.)
- **A release is `GROUP_ALBUM` and `GROUP_ARTIST` in `db::query`**, folded with `COLLATE NOCASE`, empty strings folded to NULL. Every new query keys on those expressions and nothing else.
- **Comments explain non-obvious *why*.** No narration of control flow; one sentence where one will do. Match the density of the file being edited.
- **The threshold is `0.93`** and lives beside `tagsource::score`.
- **Tests run with `cargo test -p apex`** from `src-tauri/`, and `npm test` from the repo root. Do not run the e2e suite locally.
- Commit after every task, on `feature/82b-unattended-lookup-pass`.

---

### Task 1: Migration 9 — `tracks.release_type` and `release_lookup`

**Files:**
- Modify: `src-tauri/src/db/schema.rs` (append to `MIGRATIONS`)
- Test: `src-tauri/src/db/schema.rs` (new `#[cfg(test)] mod tests`, or the existing one if the file has gained one)

**Interfaces:**
- Consumes: nothing.
- Produces: `PRAGMA user_version` = 9; table `release_lookup(id, album, artist, status, release_mbid, score, candidates_json, attempted_at)`; unique index `idx_release_lookup_key`; column `tracks.release_type`.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/db/schema.rs`:

```rust
#[cfg(test)]
mod tests {
    use crate::db::Db;

    fn open() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    #[test]
    fn a_fresh_database_carries_the_lookup_table_and_the_release_type() {
        let (_dir, conn) = open();

        assert_eq!(
            conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            9
        );
        conn.execute_batch("SELECT release_type FROM tracks WHERE 0")
            .expect("tracks gained a release type");
        conn.execute_batch("SELECT album, artist, status, release_mbid, score, candidates_json, attempted_at FROM release_lookup WHERE 0")
            .expect("the lookup table has the columns the pass writes");
    }

    /// The defect the index exists for. A rowid table's PRIMARY KEY permits
    /// NULLs, so an untagged release would insert twice and pay the whole
    /// lookup twice.
    #[test]
    fn an_untagged_release_can_only_be_recorded_once() {
        let (_dir, conn) = open();
        let insert = "INSERT INTO release_lookup (album, artist, status, attempted_at)
                      VALUES (?1, ?2, 'none', 0)";

        conn.execute(insert, rusqlite::params![None::<String>, None::<String>])
            .unwrap();
        conn.execute(insert, rusqlite::params![None::<String>, None::<String>])
            .expect_err("two untagged releases are one release");
    }

    /// The grid has folded case when grouping since 81, and `release_members`
    /// matches `NOCASE`: unfolded, a release tagged two ways is one tile and
    /// one member list but two rows here, and the second row pays the four and
    /// a half hours again.
    #[test]
    fn a_release_tagged_two_ways_is_one_row() {
        let (_dir, conn) = open();
        let insert = "INSERT INTO release_lookup (album, artist, status, attempted_at)
                      VALUES (?1, ?2, 'resolved', 0)";

        conn.execute(insert, rusqlite::params!["Loveless", "My Bloody Valentine"])
            .unwrap();
        conn.execute(insert, rusqlite::params!["loveless", "my bloody valentine"])
            .expect_err("case is folded, so this is the same release");
    }

    #[test]
    fn a_status_the_pass_does_not_write_is_refused() {
        let (_dir, conn) = open();

        conn.execute(
            "INSERT INTO release_lookup (album, artist, status, attempted_at)
             VALUES ('Loveless', 'MBV', 'maybe', 0)",
            [],
        )
        .expect_err("the three statuses are the whole vocabulary");
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test -p apex db::schema::tests -- --nocapture`
Expected: FAIL — `user_version` is 8 and `no such table: release_lookup`.

- [ ] **Step 3: Append migration 9**

At the end of `MIGRATIONS` in `src-tauri/src/db/schema.rs`, after migration 8's entry:

```rust
    // 9 - what the unattended lookup pass has already been through
    //
    // One row per release key, and three jobs in one table: the review queue
    // 82c reads, the resume point a pass killed mid-run starts from, and the
    // guard that stops a second pass re-searching 8,044 releases. No row means
    // never attempted; a row is never revisited automatically, because a pass
    // that re-searches every miss on every launch is four and a half hours
    // that finds nothing, forever.
    //
    // The key is `db::query`'s two grouping expressions, so a release is the
    // same thing here as it is in the grid. A `PRIMARY KEY (album, artist)`
    // will not hold it: SQLite permits NULLs in a rowid table's primary key,
    // so an untagged release would insert twice. The unique index over the
    // coalesced pair is what actually holds, and both sides collate NOCASE
    // because the grid has folded case when grouping since 81 - unfolded, a
    // release tagged two ways is one tile and two rows here.
    //
    // `candidates_json` is a cache, not a record: the pass has the search
    // results in hand at the moment it queues a release, and 82c's dialog
    // opening on them is the difference between a click and a rate-limited
    // second per entry.
    //
    // `release_type` is MusicBrainz's release-group primary type, cached off
    // the tags the way migration 8's two ids are: `tags::read` fills it, so a
    // rescan keeps it in step with the file rather than the writer being its
    // only source. No backfill - nothing has ever written it. 83a's layout
    // reads it.
    r#"
ALTER TABLE tracks ADD COLUMN release_type TEXT;

CREATE TABLE release_lookup (
    id              INTEGER PRIMARY KEY,
    album           TEXT,
    artist          TEXT,
    status          TEXT NOT NULL CHECK (status IN ('resolved', 'review', 'none')),
    release_mbid    TEXT,
    score           REAL,
    candidates_json TEXT,
    attempted_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_release_lookup_key ON release_lookup(
    coalesce(album,  '') COLLATE NOCASE,
    coalesce(artist, '') COLLATE NOCASE
);
"#,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test -p apex db::schema::tests`
Expected: PASS, four tests.

Then run the whole backend suite once, because every existing test opens a database through this migration list: `cd src-tauri && cargo test -p apex`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/schema.rs
git commit -m "feat: add the release lookup table and the release type column"
```

---

### Task 2: `release_type` through the tags layer

The column is useless until something fills it. This task takes it end to end — read off a file, written to a file, kept in step by a scan and by a tag write — with no lookup involved. 83a reads the result.

**Files:**
- Modify: `src-tauri/src/tags/mod.rs` (`TrackTags`, `read`)
- Modify: `src-tauri/src/model.rs:314-329` (`TagEdit`)
- Modify: `src-tauri/src/tags/write.rs` (`Resolved`, `resolve`, `mutate`, `sync_row`)
- Modify: `src-tauri/src/scan/mod.rs:540-620` (`insert_track`, `update_track`)
- Test: `src-tauri/tests/tagwrite.rs`

**Interfaces:**
- Consumes: `tracks.release_type` from Task 1.
- Produces: `TrackTags.release_type: Option<String>`, `TagEdit.release_type: Option<String>` (absent means leave alone, empty string means clear — the same rule as every other text field).

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/tests/tagwrite.rs`, following the shape of the MBID tests already in that file (read one of them first for the fixture helpers it uses — `fixture`/`seeded` or whatever the file names them — and reuse them rather than inventing new ones):

```rust
/// The type is what 83a puts in a release folder's name, and it arrives the
/// way the two MBIDs do: off the file, so a library Picard already tagged is
/// right before any lookup runs.
#[test]
fn a_release_type_written_to_a_file_comes_back_off_it() {
    let (_dir, mut conn, track_id, path) = one_track();

    let edit = TagEdit {
        release_type: Some("Album".to_owned()),
        ..TagEdit::default()
    };
    let summary = tags::write::apply(&mut conn, &[(track_id, edit)], |_| {}).unwrap();
    assert_eq!(summary.written, 1);

    assert_eq!(
        tags::read(&path).unwrap().release_type.as_deref(),
        Some("Album")
    );
    assert_eq!(
        conn.query_row(
            "SELECT release_type FROM tracks WHERE id = ?1",
            [track_id],
            |row| row.get::<_, Option<String>>(0)
        )
        .unwrap()
        .as_deref(),
        Some("Album"),
        "the row is synced from the file, not from the edit"
    );
}

#[test]
fn an_edit_that_does_not_mention_the_release_type_leaves_it_alone() {
    let (_dir, mut conn, track_id, path) = one_track();

    tags::write::apply(
        &mut conn,
        &[(
            track_id,
            TagEdit {
                release_type: Some("EP".to_owned()),
                ..TagEdit::default()
            },
        )],
        |_| {},
    )
    .unwrap();
    tags::write::apply(
        &mut conn,
        &[(
            track_id,
            TagEdit {
                title: Some("Renamed".to_owned()),
                ..TagEdit::default()
            },
        )],
        |_| {},
    )
    .unwrap();

    let tags = tags::read(&path).unwrap();
    assert_eq!(tags.title.as_deref(), Some("Renamed"));
    assert_eq!(tags.release_type.as_deref(), Some("EP"));
}
```

`one_track()` stands for whatever the file's existing per-test fixture helper is called — reuse it, do not add a second one. If the existing tests inline their setup, inline yours the same way.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --test tagwrite release_type`
Expected: FAIL to compile — `TagEdit` has no field `release_type`.

- [ ] **Step 3: Implement**

`src-tauri/src/model.rs`, in `TagEdit`, beside the two MBIDs:

```rust
    /// MusicBrainz's release-group primary type. Like the two ids above it,
    /// no editor field sets this - the lookup is what knows it, and 83a's
    /// layout is what reads it.
    pub release_type: Option<String>,
```

`src-tauri/src/tags/mod.rs`, in `TrackTags`, after `release_group_mbid`:

```rust
    /// Album, EP, Single and the rest, read for the same reason the two ids
    /// above are: the file is the source of truth, and a column only the
    /// writer fills is blank again the next time a rescan re-adds the row.
    pub release_type: Option<String>,
```

and in `read`, beside the two MBID lines:

```rust
    tags.release_type = non_empty(tag.get_string(ItemKey::MusicBrainzReleaseType));
```

`src-tauri/src/tags/write.rs`:

- `Resolved` gains `release_type: Option<Option<String>>` after `release_group_mbid`.
- `resolve` gains `release_type: text(&edit.release_type),`.
- `mutate` gains, after the `release_group_mbid` arm:

```rust
    if let Some(value) = &resolved.release_type {
        // Not in `MUSICBRAINZ_TXXX`, unlike the two ids: lofty 0.25's ID3v2
        // conversion has an arm for this key (`id3/v2/tag/conversion.rs`) and
        // emits the TXXX frame without being asked.
        set_or_remove(tag, ItemKey::MusicBrainzReleaseType, value);
    }
```

- `sync_row`'s `UPDATE` gains `release_type = ?16` (shifting `cover_hash`, `mtime` and `size` to `?17`, `?18`, `?19`) and `tags.release_type` in the params, in that position.

`src-tauri/src/scan/mod.rs`: add `release_type` to `insert_track`'s column list, its `VALUES` placeholders, its `ON CONFLICT DO UPDATE SET` list (`release_type = excluded.release_type`) and its params; and to `update_track`'s `SET` list and params. Renumber the placeholders after the insertion point in both.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test -p apex && cargo test --test tagwrite && cargo test --test scan`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat: read and write the MusicBrainz release type"
```

---

### Task 3: The genre and the release type on `ReleaseDetail`

**Files:**
- Modify: `src-tauri/src/tagsource/musicbrainz.rs` (`RELEASE_INC`, `ReleaseGroup`, `ReleaseResponse`, `into_detail`)
- Modify: `src-tauri/src/model.rs:443-458` (`ReleaseDetail`)
- Modify: `src-tauri/src/tagsource/fixtures/release-loveless.json` (and the multi-disc and various-artists fixtures) — add the `genres` array and the release group's `primary-type` as the live API returns them
- Test: `src-tauri/src/tagsource/musicbrainz.rs` (its `mod tests`)

**Interfaces:**
- Consumes: nothing.
- Produces: `ReleaseDetail.genre: Option<String>`, `ReleaseDetail.release_type: Option<String>`.

- [ ] **Step 1: Record the fixture change**

`inc=genres` makes MusicBrainz return, on the release and on the release group:

```json
"genres": [
  { "id": "…", "name": "shoegaze", "count": 12 },
  { "id": "…", "name": "noise pop", "count": 4 }
]
```

Add that array to the release object in `release-loveless.json` (two entries, counts 12 and 4 as above), and add `"primary-type": "Album"` to its `"release-group"` object. In `release-multi-disc.json` add `"primary-type": "Album"` and **no** `genres` array at all — that is the release the "no genre is not an error" test needs. In `release-various-artists.json` add `"primary-type": "Compilation"` and a single-entry `genres` array (`"electronic"`, count 3).

- [ ] **Step 2: Write the failing tests**

In `src-tauri/src/tagsource/musicbrainz.rs`'s `mod tests`:

```rust
#[test]
fn a_fetch_asks_for_the_genres_the_pass_fills_with() {
    let transport = FakeTransport::new().answering("/ws/2/release/", RELEASE_JSON);
    fetch(&transport, "bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9", &local(11)).unwrap();

    assert_eq!(
        transport.call_to("/ws/2/release/").unwrap().param("inc"),
        Some("recordings artist-credits release-groups genres")
    );
}

/// The most-voted genre, not the first: MusicBrainz orders the array by id,
/// so the first entry is whichever one happens to sort first.
#[test]
fn the_genre_is_the_one_most_people_agreed_on() {
    let transport = FakeTransport::new().answering("/ws/2/release/", RELEASE_JSON);
    let detail = fetch(&transport, "bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9", &local(11)).unwrap();

    assert_eq!(detail.genre.as_deref(), Some("shoegaze"));
}

#[test]
fn a_release_nobody_has_tagged_a_genre_has_none() {
    let transport = FakeTransport::new().answering("/ws/2/release/", MULTI_DISC_JSON);
    let detail = fetch(&transport, "aa5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9", &local(4)).unwrap();

    assert_eq!(detail.genre, None);
}

#[test]
fn the_release_type_comes_off_the_release_group() {
    let transport = FakeTransport::new().answering("/ws/2/release/", VARIOUS_JSON);
    let detail = fetch(&transport, "cc5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9", &local(3)).unwrap();

    assert_eq!(detail.release_type.as_deref(), Some("Compilation"));
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test -p apex tagsource::musicbrainz`
Expected: FAIL — `ReleaseDetail` has no field `genre`.

- [ ] **Step 4: Implement**

`src-tauri/src/model.rs`, in `ReleaseDetail`, after `year`:

```rust
    /// The genre the most people agreed on, or none. Filled into files that
    /// have none and never written over one that has: MusicBrainz's genre data
    /// is thin next to a library tagged by hand.
    pub genre: Option<String>,
    /// MusicBrainz's release-group primary type, which 83a puts in the release
    /// folder's name.
    pub release_type: Option<String>,
```

`src-tauri/src/tagsource/musicbrainz.rs`:

```rust
/// What a release fetch asks to have included.
///
/// Spaces rather than the `+` the documentation shows: form encoding turns a
/// space into `+`, so the request that goes out is the canonical one and the
/// separator is not something this file has to encode by hand.
///
/// `genres` is here for the unattended pass, which fills an empty genre and
/// has nothing to fill it from otherwise. `release-groups` was already here
/// and carries the primary type with it, so the type costs no `inc` at all.
const RELEASE_INC: &str = "recordings artist-credits release-groups genres";

/// A genre and how many people voted for it.
#[derive(Debug, Deserialize)]
struct Genre {
    #[serde(default)]
    name: String,
    #[serde(default)]
    count: u32,
}

/// The most-voted genre of a list, or none for an empty one.
///
/// By count rather than by position: MusicBrainz orders the array by id, so
/// the first entry is an accident of which genre sorts first.
fn top_genre(genres: &[Genre]) -> Option<String> {
    genres
        .iter()
        .filter(|genre| !genre.name.trim().is_empty())
        .max_by_key(|genre| genre.count)
        .map(|genre| genre.name.clone())
}
```

`ReleaseGroup` gains:

```rust
#[derive(Debug, Deserialize)]
struct ReleaseGroup {
    id: String,
    #[serde(rename = "primary-type")]
    primary_type: Option<String>,
    #[serde(default)]
    genres: Vec<Genre>,
}
```

`ReleaseResponse` gains `#[serde(default)] genres: Vec<Genre>,`.

`SearchRelease`'s `release_group` is the same `ReleaseGroup` type and gains the two fields for free — search results carry neither, and `Option`/`default` covers that.

In `into_detail`, before the struct literal:

```rust
        // The release's own genres first and the group's as the fallback: the
        // pressing is the more specific answer, and a group tagged where a
        // pressing is not is still better than nothing.
        let genre = top_genre(&self.genres).or_else(|| {
            self.release_group
                .as_ref()
                .and_then(|group| top_genre(&group.genres))
        });
        let release_type = self
            .release_group
            .as_ref()
            .and_then(|group| group.primary_type.clone());
```

and the literal gains `genre,` and `release_type,`. Note `self.release_group` is moved into `candidate.release_group_mbid` further down — take the two values above that line, or restructure to read the id from a clone; keep the borrow order valid.

Every existing construction of `ReleaseDetail` (`into_detail` is the only one outside tests) needs the new fields; the frontend's generated TS types are exported by `ts-rs`, so run the export step the repo already uses if `npm test` complains about a missing field.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test -p apex tagsource` then `cd .. && npm test`
Expected: PASS. If the frontend fails on the generated `ReleaseDetail` type, regenerate the bindings the way the repo already does (check `package.json` scripts) and re-run.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src src-tauri/src/tagsource/fixtures src/
git commit -m "feat: read a release's genre and type from MusicBrainz"
```

---

### Task 4: `db::lookup`

**Files:**
- Create: `src-tauri/src/db/lookup.rs`
- Modify: `src-tauri/src/db/mod.rs` (add `pub mod lookup;`)
- Test: `src-tauri/src/db/lookup.rs` (its own `mod tests`)

**Interfaces:**
- Consumes: the `release_lookup` table from Task 1.
- Produces:
  - `pub enum Status { Resolved, Review, NotFound }` with `pub fn as_str(self) -> &'static str`
  - `pub struct Release { pub album: Option<String>, pub artist: Option<String> }`
  - `pub fn pending(conn: &Connection, limit: usize) -> AppResult<Vec<Release>>`
  - `pub fn record(conn: &Connection, release: &Release, status: Status, release_mbid: Option<&str>, score: Option<f32>, candidates_json: Option<&str>, now: i64) -> AppResult<()>`
  - `pub fn seed_from_tags(conn: &Connection, now: i64) -> AppResult<usize>`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/db/lookup.rs` containing only the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn open() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    /// `album`, `album_artist`, `artist`, `release_mbid`.
    fn track(conn: &Connection, path: &str, album: &str, artist: &str, mbid: Option<&str>) {
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, album, album_artist, artist, release_mbid, added_at)
             VALUES (?1, 0, 0, ?2, ?3, ?3, ?4, 0)",
            rusqlite::params![path, album, artist, mbid],
        )
        .unwrap();
    }

    fn keys(releases: &[Release]) -> Vec<(Option<&str>, Option<&str>)> {
        releases
            .iter()
            .map(|release| (release.album.as_deref(), release.artist.as_deref()))
            .collect()
    }

    #[test]
    fn a_library_with_no_rows_is_all_pending() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        track(&conn, "b.mp3", "Loveless", "My Bloody Valentine", None);
        track(&conn, "c.mp3", "Isn't Anything", "My Bloody Valentine", None);

        assert_eq!(
            keys(&pending(&conn, 10).unwrap()),
            [
                (Some("Isn't Anything"), Some("My Bloody Valentine")),
                (Some("Loveless"), Some("My Bloody Valentine")),
            ]
        );
    }

    /// The idempotence guard: a second pass over a library it has been through
    /// has nothing to do, whatever the outcome was the first time.
    #[test]
    fn a_release_with_a_row_is_not_pending_again() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        let release = pending(&conn, 10).unwrap().remove(0);

        record(&conn, &release, Status::NotFound, None, None, None, 100).unwrap();

        assert!(pending(&conn, 10).unwrap().is_empty());
    }

    #[test]
    fn a_release_tagged_two_ways_is_one_pending_release() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        track(&conn, "b.mp3", "loveless", "my bloody valentine", None);

        assert_eq!(pending(&conn, 10).unwrap().len(), 1);
    }

    #[test]
    fn an_untagged_release_is_pending_and_recordable() {
        let (_dir, conn) = open();
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, added_at) VALUES ('a.mp3', 0, 0, 0)",
            [],
        )
        .unwrap();

        let releases = pending(&conn, 10).unwrap();
        assert_eq!(keys(&releases), [(None, None)]);

        record(&conn, &releases[0], Status::NotFound, None, None, None, 100).unwrap();
        assert!(pending(&conn, 10).unwrap().is_empty());
    }

    /// Retagging invalidates by itself: the key changes, so the release reads
    /// as unattempted and gets looked up again.
    #[test]
    fn retagging_a_release_makes_it_pending_again() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Lovless", "My Bloody Valentine", None);
        let release = pending(&conn, 10).unwrap().remove(0);
        record(&conn, &release, Status::Review, None, Some(0.4), None, 100).unwrap();

        conn.execute("UPDATE tracks SET album = 'Loveless'", []).unwrap();

        assert_eq!(
            keys(&pending(&conn, 10).unwrap()),
            [(Some("Loveless"), Some("My Bloody Valentine"))]
        );
    }

    #[test]
    fn recording_the_same_release_twice_updates_rather_than_fails() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        let release = pending(&conn, 10).unwrap().remove(0);

        record(&conn, &release, Status::Review, None, Some(0.4), Some("[]"), 100).unwrap();
        record(&conn, &release, Status::Resolved, Some("bb5a"), Some(0.99), None, 200).unwrap();

        let (status, mbid, attempted): (String, Option<String>, i64) = conn
            .query_row(
                "SELECT status, release_mbid, attempted_at FROM release_lookup",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!((status.as_str(), mbid.as_deref(), attempted), ("resolved", Some("bb5a"), 200));
    }

    /// A re-install or a rescan of a library Picard already tagged must not
    /// pay four and a half hours again.
    #[test]
    fn a_release_whose_files_all_carry_an_mbid_is_resolved_without_a_call() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", Some("bb5a"));
        track(&conn, "b.mp3", "Loveless", "My Bloody Valentine", Some("bb5a"));

        assert_eq!(seed_from_tags(&conn, 100).unwrap(), 1);
        assert!(pending(&conn, 10).unwrap().is_empty());
        assert_eq!(
            conn.query_row("SELECT status, release_mbid FROM release_lookup", [], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap(),
            ("resolved".to_owned(), "bb5a".to_owned())
        );
    }

    #[test]
    fn a_release_only_half_of_which_carries_an_mbid_is_still_pending() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", Some("bb5a"));
        track(&conn, "b.mp3", "Loveless", "My Bloody Valentine", None);

        assert_eq!(seed_from_tags(&conn, 100).unwrap(), 0);
        assert_eq!(pending(&conn, 10).unwrap().len(), 1);
    }

    /// Files disagreeing about which pressing they are is exactly what the
    /// lookup is for, so the seed leaves it alone rather than picking one.
    #[test]
    fn a_release_whose_files_name_two_different_pressings_is_still_pending() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", Some("bb5a"));
        track(&conn, "b.mp3", "Loveless", "My Bloody Valentine", Some("cc5a"));

        assert_eq!(seed_from_tags(&conn, 100).unwrap(), 0);
        assert_eq!(pending(&conn, 10).unwrap().len(), 1);
    }

    #[test]
    fn seeding_twice_is_a_no_op() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", Some("bb5a"));

        assert_eq!(seed_from_tags(&conn, 100).unwrap(), 1);
        assert_eq!(seed_from_tags(&conn, 200).unwrap(), 0);
    }

    /// A file that cannot be read cannot be written either, so counting it
    /// would hold a release pending over a drive that is not plugged in.
    #[test]
    fn a_missing_file_does_not_hold_its_release_back() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", Some("bb5a"));
        track(&conn, "b.mp3", "Loveless", "My Bloody Valentine", None);
        conn.execute("UPDATE tracks SET missing_since = 1 WHERE path = 'b.mp3'", [])
            .unwrap();

        assert_eq!(seed_from_tags(&conn, 100).unwrap(), 1);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test -p apex db::lookup`
Expected: FAIL to compile — the module is not declared and nothing in it exists.

- [ ] **Step 3: Implement**

Add `pub mod lookup;` to `src-tauri/src/db/mod.rs` beside the other module declarations, then put this above the test module in `src-tauri/src/db/lookup.rs`:

```rust
//! The `release_lookup` table: what the unattended pass has already been
//! through.
//!
//! Three jobs in one table - 82c's review queue, the pass's resume point, and
//! the guard that stops a second pass re-searching 8,044 releases. No row
//! means never attempted, and nothing here ever clears a row: a pass that
//! re-searched every miss on every launch would be four and a half hours that
//! finds nothing, forever.
//!
//! Every query keys on `db::query`'s two grouping expressions, folded with
//! `COLLATE NOCASE` the way the browse grid folds them, because a release has
//! to be the same thing here as it is in the grid.

use rusqlite::Connection;

use crate::error::AppResult;

/// The album and artist of a release, as the grid's expressions produce them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Release {
    pub album: Option<String>,
    pub artist: Option<String>,
}

/// What became of a release the pass attempted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// Written, or already carrying the identity before the pass ran.
    Resolved,
    /// Below the threshold: nothing was written and 82c asks the user.
    Review,
    /// MusicBrainz has nothing. Not queued - there is nothing to decide.
    NotFound,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Resolved => "resolved",
            Self::Review => "review",
            Self::NotFound => "none",
        }
    }
}

/// The grid's two grouping expressions, spelled for this table's queries.
///
/// Repeated from `db::query` rather than shared: those are private consts of a
/// module that builds whole statements around them, and a `pub` pair would
/// invite a third notion of what a release is. They must stay in step, which
/// is what `a_release_tagged_two_ways_is_one_pending_release` is for.
const ALBUM: &str = "nullif(tracks.album, '')";
const ARTIST: &str = "coalesce(nullif(tracks.album_artist, ''), nullif(tracks.artist, ''))";

/// Releases with no row, oldest-reading first, at most `limit` of them.
///
/// Batched rather than one at a time: this groups every row of `tracks`, and
/// re-running it between two releases that each take two seconds would spend
/// the pass's four and a half hours scanning the table.
///
/// `min()` picks each group's label off a `NOCASE` grouping the same way
/// `browse_groups` does - a binary comparison, so the same casing every time.
pub fn pending(conn: &Connection, limit: usize) -> AppResult<Vec<Release>> {
    let sql = format!(
        "SELECT min({ALBUM}), min({ARTIST})
           FROM tracks
          WHERE tracks.missing_since IS NULL
          GROUP BY {ALBUM} COLLATE NOCASE, {ARTIST} COLLATE NOCASE
         HAVING NOT EXISTS (
                    SELECT 1 FROM release_lookup
                     WHERE coalesce(release_lookup.album,  '') = coalesce({ALBUM},  '') COLLATE NOCASE
                       AND coalesce(release_lookup.artist, '') = coalesce({ARTIST}, '') COLLATE NOCASE)
          ORDER BY 2 IS NULL, 2 COLLATE NOCASE, 1 IS NULL, 1 COLLATE NOCASE
          LIMIT ?1"
    );

    let mut stmt = conn.prepare(&sql)?;
    let releases = stmt
        .query_map([limit as i64], |row| {
            Ok(Release {
                album: row.get(0)?,
                artist: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(releases)
}

/// Writes what became of one release, replacing any earlier attempt.
///
/// The conflict target is the expression the unique index is over, which is
/// what makes an untagged release one row rather than one per attempt.
pub fn record(
    conn: &Connection,
    release: &Release,
    status: Status,
    release_mbid: Option<&str>,
    score: Option<f32>,
    candidates_json: Option<&str>,
    now: i64,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO release_lookup (album, artist, status, release_mbid, score, candidates_json, attempted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (coalesce(album, '') COLLATE NOCASE, coalesce(artist, '') COLLATE NOCASE)
         DO UPDATE SET status          = excluded.status,
                       release_mbid    = excluded.release_mbid,
                       score           = excluded.score,
                       candidates_json = excluded.candidates_json,
                       attempted_at    = excluded.attempted_at",
        rusqlite::params![
            release.album,
            release.artist,
            status.as_str(),
            release_mbid,
            score,
            candidates_json,
            now,
        ],
    )?;
    Ok(())
}

/// Resolves every release whose files already agree on a release MBID.
///
/// Seeded from the tags 79a taught `tags::read` to keep, so a re-install or a
/// rescan of a library Picard already tagged does not pay four and a half
/// hours again. Returns how many releases it resolved.
///
/// `count(*) = count(release_mbid)` is "every file carries one" - `count` of a
/// column skips NULLs - and the `count(DISTINCT …) = 1` beside it refuses a
/// release whose files name two different pressings, which is a disagreement
/// the lookup exists to settle rather than one to pick a side of.
///
/// `OR IGNORE` rather than an upsert: a release the pass has already attempted
/// keeps that attempt.
pub fn seed_from_tags(conn: &Connection, now: i64) -> AppResult<usize> {
    let sql = format!(
        "INSERT OR IGNORE INTO release_lookup (album, artist, status, release_mbid, attempted_at)
         SELECT min({ALBUM}), min({ARTIST}), 'resolved', min(tracks.release_mbid), ?1
           FROM tracks
          WHERE tracks.missing_since IS NULL
          GROUP BY {ALBUM} COLLATE NOCASE, {ARTIST} COLLATE NOCASE
         HAVING count(*) = count(tracks.release_mbid)
            AND count(DISTINCT tracks.release_mbid) = 1"
    );
    Ok(conn.execute(&sql, [now])?)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test -p apex db::lookup`
Expected: PASS, eleven tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db
git commit -m "feat: track which releases the lookup has been through"
```

---

### Task 5: One release's worth of the pass

The heart of it, and the part with no thread in it: search, fetch, score, then write or queue. Everything here is a plain function over a `&mut Connection` and a `&dyn Transport`, so it is tested against recorded fixtures with no network.

**Files:**
- Create: `src-tauri/src/tagsource/pass.rs`
- Modify: `src-tauri/src/tagsource/mod.rs` (`pub mod pass;`)
- Modify: `src-tauri/src/db/query.rs:522-536` (`ReleaseMember` gains `genre` and `cover_hash`)
- Test: `src-tauri/src/tagsource/pass.rs` (its own `mod tests`)

**Interfaces:**
- Consumes: `db::lookup::{Release, Status, record}`, `db::query::{release_members, ReleaseMember}`, `tagsource::{fetch_release, musicbrainz::search, score::LocalRelease}`, `tags::write::apply`, `scan::ScanLock`.
- Produces:
  - `tagsource::score::UNATTENDED_THRESHOLD: f32 = 0.93` — in `score.rs`, beside the weights it is derived from, because a bar and the arithmetic that puts it there belong in one file
  - `pub enum Verdict { Written { mbid: String, score: f32, tracks: u32 }, Queued { score: f32, candidates: usize }, NotFound }`
  - `pub fn look_up(conn: &mut Connection, transport: &(dyn Transport + '_), lock: &ScanLock, release: &Release, staging: &Path, dry_run: bool, now: i64) -> AppResult<Verdict>`

- [ ] **Step 1: Widen `ReleaseMember`**

In `src-tauri/src/db/query.rs`:

```rust
/// One file of a release, as the lookup needs it.
pub struct ReleaseMember {
    pub id: i64,
    pub duration_ms: i64,
    /// What the file already says, so the unattended pass can fill an empty
    /// genre without writing over one somebody chose by hand.
    pub genre: Option<String>,
    /// Whether the file already has artwork, so a pass does not stage a JPEG
    /// per release to replace a cover that is already there.
    pub cover_hash: Option<String>,
}
```

and in `release_members`, widen the `SELECT` to `tracks.id, tracks.duration_ms, tracks.genre, tracks.cover_hash` and the row mapping to match. Nothing else changes: `commands::local_release` and `commands::tagsource_apply` both use the struct by field and ignore the new ones.

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/tagsource/pass.rs` with only its test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{lookup, Db};
    use crate::tagsource::transport::FakeTransport;

    const SEARCH_JSON: &str = include_str!("fixtures/search-loveless.json");
    const RELEASE_JSON: &str = include_str!("fixtures/release-loveless.json");

    /// The fetch needle is registered first because it is the more specific
    /// one: the search URL does not contain the trailing slash, so it falls
    /// through to the second answer.
    fn musicbrainz() -> FakeTransport {
        FakeTransport::new()
            .answering("/ws/2/release/", RELEASE_JSON)
            .answering("/ws/2/release", SEARCH_JSON)
            .missing("coverartarchive.org")
    }

    /// The eleven lengths `release-loveless.json` carries, so a library built
    /// from these scores a perfect duration agreement. The eleventh is the
    /// one MusicBrainz has no length for; any value does.
    const LOVELESS_DURATIONS: [i64; 11] = [
        268_000, 195_000, 204_000, 217_000, 133_000, 262_000, 219_000, 209_000, 258_000, 194_000,
        0,
    ];

    fn all_ids(conn: &Connection) -> Vec<i64> {
        conn.prepare("SELECT id FROM tracks ORDER BY track_no")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    /// A library of `count` real files, all tagged as one release, plus the
    /// database rows for them. Real files because the pass writes tags.
    pub(crate) fn library(count: usize, durations_ms: &[i64]) -> (tempfile::TempDir, Db, lookup::Release) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixture/sample.mp3");

        for index in 0..count {
            let path = dir.path().join(format!("{:02}.mp3", index + 1));
            std::fs::copy(&source, &path).unwrap();
            conn.execute(
                "INSERT INTO tracks (path, mtime, size, duration_ms, album, album_artist, artist, track_no, added_at)
                 VALUES (?1, 0, 0, ?2, 'Loveless', 'My Bloody Valentine', 'My Bloody Valentine', ?3, 0)",
                rusqlite::params![
                    path.to_string_lossy(),
                    durations_ms.get(index).copied().unwrap_or(0),
                    index as i64 + 1,
                ],
            )
            .unwrap();
        }

        let release = lookup::Release {
            album: Some("Loveless".to_owned()),
            artist: Some("My Bloody Valentine".to_owned()),
        };
        (dir, db, release)
    }
```

Check the fixture's actual filename under `src-tauri/tests/fixture/` and use it; if the existing tests generate an mp3 rather than shipping one, call that generator instead. Check `LOVELESS_DURATIONS` against the fixture's real `length` values and correct the constant to match — the whole point of it is that these are the lengths the fixture carries.

A doubtful match is the same library with durations deliberately far off: `&[600_000; 11]` puts the duration term at zero, which takes the score to `0.45 + 0.25 = 0.70`, well under the bar.

Then the seven tests:

```rust
    #[test]
    fn a_confident_match_is_written_to_every_file_of_the_release() {
        let (dir, db, release) = library(11, &LOVELESS_DURATIONS);
        let mut conn = db.conn().unwrap();
        let lock = crate::scan::ScanLock::default();

        let verdict = look_up(
            &mut conn,
            &musicbrainz(),
            &lock,
            &release,
            dir.path(),
            false,
            100,
        )
        .unwrap();

        assert!(matches!(verdict, Verdict::Written { .. }));
        let titles: Vec<String> = conn
            .prepare("SELECT title FROM tracks ORDER BY track_no")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(titles[0], "Only Shallow");

        let (status, mbid): (String, String) = conn
            .query_row("SELECT status, release_mbid FROM release_lookup", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(status, "resolved");
        assert_eq!(mbid, "bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9");
    }

    #[test]
    fn a_doubtful_match_is_queued_with_its_candidates_and_writes_nothing() {
        let (dir, db, release) = library(11, &[600_000; 11]);
        let mut conn = db.conn().unwrap();

        let verdict = look_up(
            &mut conn,
            &musicbrainz(),
            &crate::scan::ScanLock::default(),
            &release,
            dir.path(),
            false,
            100,
        )
        .unwrap();

        assert!(matches!(verdict, Verdict::Queued { .. }));
        assert_eq!(
            conn.query_row("SELECT count(*) FROM tracks WHERE title IS NOT NULL", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0,
            "below the bar nothing is written"
        );
        let (status, candidates): (String, String) = conn
            .query_row("SELECT status, candidates_json FROM release_lookup", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(status, "review");
        assert!(
            candidates.contains("bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9"),
            "82c opens on these rather than paying for the search again"
        );
    }

    #[test]
    fn a_release_with_no_candidates_is_left_alone_and_not_queued() {
        let (dir, db, release) = library(11, &LOVELESS_DURATIONS);
        let mut conn = db.conn().unwrap();
        let transport = FakeTransport::new().answering("/ws/2/release", r#"{"releases":[]}"#);

        let verdict = look_up(
            &mut conn,
            &transport,
            &crate::scan::ScanLock::default(),
            &release,
            dir.path(),
            false,
            100,
        )
        .unwrap();

        assert!(matches!(verdict, Verdict::NotFound));
        assert_eq!(
            conn.query_row("SELECT status FROM release_lookup", [], |row| row
                .get::<_, String>(0))
                .unwrap(),
            "none",
            "recorded so it is never searched again, but not put to the user"
        );
        assert_eq!(transport.call_count(), 1, "no candidate, no fetch");
    }

    #[test]
    fn an_empty_genre_is_filled_and_one_that_is_there_is_left_alone() {
        let (dir, db, release) = library(11, &LOVELESS_DURATIONS);
        let mut conn = db.conn().unwrap();
        conn.execute("UPDATE tracks SET genre = 'Dreampop' WHERE track_no = 1", [])
            .unwrap();

        look_up(
            &mut conn,
            &musicbrainz(),
            &crate::scan::ScanLock::default(),
            &release,
            dir.path(),
            false,
            100,
        )
        .unwrap();

        let genres: Vec<Option<String>> = conn
            .prepare("SELECT genre FROM tracks ORDER BY track_no")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(genres[0].as_deref(), Some("Dreampop"), "a hand-tagged genre stands");
        assert_eq!(genres[1].as_deref(), Some("shoegaze"), "an empty one is filled");
    }

    #[test]
    fn a_comment_is_never_touched() {
        let (dir, db, release) = library(11, &LOVELESS_DURATIONS);
        let mut conn = db.conn().unwrap();
        conn.execute("UPDATE tracks SET comment = 'ripped by me'", []).unwrap();
        // The row is what the write syncs from the file, so put it on the file
        // first: a comment only in the row would prove nothing.
        crate::tags::write::apply_to_each(
            &mut conn,
            &all_ids(&conn),
            &crate::model::TagEdit {
                comment: Some("ripped by me".to_owned()),
                ..Default::default()
            },
            |_| {},
        )
        .unwrap();

        look_up(
            &mut conn,
            &musicbrainz(),
            &crate::scan::ScanLock::default(),
            &release,
            dir.path(),
            false,
            100,
        )
        .unwrap();

        assert_eq!(
            conn.query_row("SELECT count(*) FROM tracks WHERE comment = 'ripped by me'", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            11
        );
    }

    /// Above the bar the premise is that the track count agrees. It can clear
    /// 0.93 without agreeing - a perfect text match with eleven of twelve
    /// tracks scores 0.954 - and mapping by position would then put every
    /// title on the wrong file.
    #[test]
    fn a_tracklist_of_a_different_length_is_queued_rather_than_mapped() {
        let (dir, db, release) = library(10, &LOVELESS_DURATIONS[..10]);
        let mut conn = db.conn().unwrap();

        let verdict = look_up(
            &mut conn,
            &musicbrainz(),
            &crate::scan::ScanLock::default(),
            &release,
            dir.path(),
            false,
            100,
        )
        .unwrap();

        assert!(matches!(verdict, Verdict::Queued { .. }));
        assert_eq!(
            conn.query_row("SELECT count(*) FROM tracks WHERE title IS NOT NULL", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    /// What the threshold is picked with: the verdict without the consequence.
    #[test]
    fn a_dry_run_writes_neither_the_files_nor_a_row() {
        let (dir, db, release) = library(11, &LOVELESS_DURATIONS);
        let mut conn = db.conn().unwrap();

        let verdict = look_up(
            &mut conn,
            &musicbrainz(),
            &crate::scan::ScanLock::default(),
            &release,
            dir.path(),
            true,
            100,
        )
        .unwrap();

        assert!(matches!(verdict, Verdict::Written { .. }), "it reports what it would do");
        assert_eq!(
            conn.query_row("SELECT count(*) FROM tracks WHERE title IS NOT NULL", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM release_lookup", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0,
            "a dry run leaves no row, or a second dry run would find nothing to do"
        );
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test -p apex tagsource::pass`
Expected: FAIL to compile — no `look_up`, no `Verdict`.

- [ ] **Step 4: Implement**

First the threshold, in `src-tauri/src/tagsource/score.rs`, directly under `WITHOUT_DURATIONS` — beside the weights it is derived from rather than in the module that reads it, because the bar and its arithmetic are one thought:

```rust
/// How well a candidate has to fit before the unattended pass writes it
/// without asking.
///
/// [`WITH_DURATIONS`] is `(0.45, 0.25, 0.30)`, so a perfect track count and
/// perfect durations are 0.55 before any text agreement, and a MusicBrainz
/// search score of 90 carries the total to 0.955 - which puts the bar between
/// 0.93 and 0.95. That is arithmetic rather than evidence, so this is the
/// permissive end of it and `APEX_LOOKUP_DRY_RUN` is how the evidence is
/// gathered: it reports what a pass would write, over a real library, without
/// writing it.
///
/// Not a setting. The score is an opaque 0-to-1 and a slider is a control
/// nobody can aim.
pub const UNATTENDED_THRESHOLD: f32 = 0.93;
```

Then add `pub mod pass;` to `src-tauri/src/tagsource/mod.rs`, and write `src-tauri/src/tagsource/pass.rs` above its test module:

```rust
//! One release, looked up with nobody watching.
//!
//! The rules 79b's dialog leaves to a person, written down: which candidate,
//! whether it is certain enough to write, and what to write. Everything here
//! is a function over a connection and a transport - the thread that drives it
//! is in [`crate::tagsource::worker`], and none of it is needed to test a
//! rule.
//!
//! **A reversal, deliberately.** 79b confirms every match by hand and
//! conventions calls the file the source of truth. Both still hold for
//! uncertain matches; a release whose track count, track order and per-track
//! durations all agree with MusicBrainz is not a guess.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db::{lookup, query};
use crate::error::AppResult;
use crate::model::{CoverEdit, TagEdit};
use crate::scan::ScanLock;
use crate::tagsource::score::{LocalRelease, UNATTENDED_THRESHOLD};
use crate::tagsource::transport::Transport;
use crate::{tags, tagsource};

/// The environment variable that turns the pass into a report.
///
/// A testing affordance rather than a feature - no command, no setting, no UI.
pub const DRY_RUN_VAR: &str = "APEX_LOOKUP_DRY_RUN";

/// Whether this process was started to report rather than to write.
pub fn dry_run() -> bool {
    std::env::var_os(DRY_RUN_VAR).is_some_and(|value| !value.is_empty())
}

/// What one release came to.
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    Written {
        mbid: String,
        score: f32,
        tracks: u32,
    },
    Queued {
        score: f32,
        candidates: usize,
    },
    /// MusicBrainz has nothing for it. Recorded so it is not searched again,
    /// and not queued: there is nothing for the user to decide.
    NotFound,
}

/// Looks one release up and acts on the answer.
///
/// Two MusicBrainz calls and no way to make it fewer: `search` for candidates,
/// then `fetch` on the best, because the per-track durations that separate two
/// pressings do not exist until a tracklist does. The cover rides along with
/// the fetch, free, because the Cover Art Archive has no rate limit.
pub fn look_up(
    conn: &mut Connection,
    transport: &(dyn Transport + '_),
    lock: &ScanLock,
    release: &lookup::Release,
    staging: &Path,
    dry_run: bool,
    now: i64,
) -> AppResult<Verdict> {
    let members = query::release_members(conn, release.album.as_deref(), release.artist.as_deref())?;
    let local = LocalRelease {
        track_count: u32::try_from(members.len()).unwrap_or(u32::MAX),
        durations_ms: members.iter().map(|member| member.duration_ms).collect(),
    };

    let candidates = tagsource::musicbrainz::search(
        transport,
        release.album.as_deref(),
        release.artist.as_deref(),
        &local,
    )?;
    let Some(best) = candidates.first() else {
        if !dry_run {
            lookup::record(conn, release, lookup::Status::NotFound, None, None, None, now)?;
        }
        return Ok(Verdict::NotFound);
    };

    let (detail, cover) = tagsource::fetch_release(transport, &best.mbid, &local)?;
    let score = detail.candidate.score;

    // The track count has to agree, not merely score well. A perfect text
    // match with eleven of twelve tracks reaches 0.954, and the write maps
    // remote tracks onto files by position - so a length that disagrees would
    // put every title on the wrong file at a score above the bar.
    let confident = score >= UNATTENDED_THRESHOLD && detail.tracks.len() == members.len();
    if !confident {
        let candidates_json = serde_json::to_string(&candidates).ok();
        if !dry_run {
            lookup::record(
                conn,
                release,
                lookup::Status::Review,
                Some(&best.mbid),
                Some(score),
                candidates_json.as_deref(),
                now,
            )?;
        }
        return Ok(Verdict::Queued {
            score,
            candidates: candidates.len(),
        });
    }

    let tracks = u32::try_from(detail.tracks.len()).unwrap_or(u32::MAX);
    if dry_run {
        return Ok(Verdict::Written {
            mbid: detail.candidate.mbid,
            score,
            tracks,
        });
    }

    // Only where the release has none: over 8,044 releases, staging a JPEG to
    // replace artwork that is already there is 8,044 needless rewrites of
    // whole audio files.
    let staged = match cover.filter(|_| members.iter().all(|member| member.cover_hash.is_none())) {
        Some(bytes) => stage(staging, &best.mbid, &bytes),
        None => None,
    };

    let edits = edits_for(&members, &detail, staged.as_deref());
    {
        // Behind the same lock as a scan, because this rewrites the files a
        // scan reads its (mtime, size) from - and per write rather than for the
        // pass, because holding it for four and a half hours would block every
        // scan in that window.
        let _guard = lock.acquire();
        tags::write::apply(conn, &edits, |_| {})?;
    }
    if let Some(path) = staged {
        // One file at a time rather than 8,044 of them left in the cache.
        let _ = std::fs::remove_file(path);
    }

    lookup::record(
        conn,
        release,
        lookup::Status::Resolved,
        Some(&detail.candidate.mbid),
        Some(score),
        None,
        now,
    )?;

    Ok(Verdict::Written {
        mbid: detail.candidate.mbid,
        score,
        tracks,
    })
}

/// Writes the fetched cover to its own file, named for the release.
///
/// Not `commands::stage_cover`'s fixed name: that one file is what an open tag
/// editor is previewing over `cover://`, and a pass writing through it would
/// swap the picture under the user.
fn stage(staging: &Path, mbid: &str, bytes: &[u8]) -> Option<PathBuf> {
    let mime = tags::write::check_cover(bytes).ok()?;
    let extension = if mime == "image/png" { "png" } else { "jpg" };
    let path = staging.join(format!("lookup-{mbid}.{extension}"));
    std::fs::write(&path, bytes).ok()?;
    Some(path)
}

/// One edit per file, mapped onto the tracklist by position.
///
/// Position is the mapping the score was computed over, so it is the mapping
/// the write applies - a score measured over one pairing and a write that
/// makes another would be scoring an apply that never happens. The caller has
/// already refused a tracklist of a different length.
///
/// The genre is set only where the file has none, which is all
/// "filled, never overwritten" costs: absent means leave alone. The comment is
/// never mentioned, so it is never touched.
fn edits_for(
    members: &[query::ReleaseMember],
    detail: &crate::model::ReleaseDetail,
    cover_path: Option<&Path>,
) -> Vec<(i64, TagEdit)> {
    members
        .iter()
        .zip(&detail.tracks)
        .map(|(member, track)| {
            (
                member.id,
                TagEdit {
                    title: Some(track.title.clone()),
                    artist: Some(track.artist.clone()),
                    album: Some(detail.candidate.title.clone()),
                    album_artist: Some(detail.album_artist.clone()),
                    genre: member
                        .genre
                        .is_none()
                        .then(|| detail.genre.clone())
                        .flatten(),
                    comment: None,
                    year: detail.year.map(|year| year.to_string()),
                    track_no: Some(track.track_no.to_string()),
                    disc_no: Some(track.disc_no.to_string()),
                    release_mbid: Some(detail.candidate.mbid.clone()),
                    release_group_mbid: detail.candidate.release_group_mbid.clone(),
                    release_type: detail.release_type.clone(),
                    cover: cover_path.map(|path| CoverEdit::Replace {
                        path: path.to_string_lossy().into_owned(),
                    }),
                },
            )
        })
        .collect()
}
```

`ReleaseCandidate` must be `Serialize` for `serde_json::to_string(&candidates)`; it already is (it crosses IPC). Check and add the derive if not.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test -p apex tagsource::pass -- --test-threads=1`
Expected: PASS, seven tests. They are slow — each release costs two rate-limited seconds — so expect roughly twenty seconds.

Then the full suite: `cd src-tauri && cargo test -p apex`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src
git commit -m "feat: look one release up unattended and write or queue it"
```

---

### Task 6: The opt-in switch

**Files:**
- Modify: `src-tauri/src/db/settings.rs` (`UNATTENDED_LOOKUP`, `unattended_lookup`)
- Modify: `src-tauri/src/commands/mod.rs` (two commands, beside `load_dynamic_background`)
- Modify: `src-tauri/src/lib.rs` (register them in `invoke_handler`)
- Create: `src/features/shell/lookupStore.ts`
- Modify: `src/ipc/index.ts`
- Modify: `src/features/shell/SettingsDialog.tsx`
- Test: `src-tauri/src/db/settings.rs`, `src/features/shell/lookupStore.test.ts`, `src/features/shell/SettingsDialog.test.tsx`, `src/ipc/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `settings::UNATTENDED_LOOKUP: &str`, `settings::unattended_lookup(&Connection) -> AppResult<bool>`, commands `load_unattended_lookup` / `save_unattended_lookup`, `useLookupStore` with `{ enabled, load(), set(enabled) }`.

- [ ] **Step 1: Write the failing backend test**

In `src-tauri/src/db/settings.rs`'s `mod tests`:

```rust
    /// The inverse of the dynamic background's default. That one is a drawing
    /// the design makes unless it is turned off; this one makes the app talk
    /// to a server, which nothing may do until somebody says so.
    #[test]
    fn the_unattended_lookup_is_off_until_it_is_turned_on() {
        let (_dir, conn) = conn();
        assert!(!unattended_lookup(&conn).unwrap());

        set(&conn, UNATTENDED_LOOKUP, "true").unwrap();
        assert!(unattended_lookup(&conn).unwrap());

        set(&conn, UNATTENDED_LOOKUP, "false").unwrap();
        assert!(!unattended_lookup(&conn).unwrap());

        set(&conn, UNATTENDED_LOOKUP, "yes please").unwrap();
        assert!(
            !unattended_lookup(&conn).unwrap(),
            "a value this app did not write must not start four hours of traffic"
        );
    }
```

and extend `an_export_carries_known_preferences_and_nothing_else` with:

```rust
        // Opting a machine into outbound network is a decision about that
        // machine, not a preference an exported library carries to the next.
        assert!(!is_exportable(UNATTENDED_LOOKUP));
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test -p apex db::settings`
Expected: FAIL to compile — no `UNATTENDED_LOOKUP`.

- [ ] **Step 3: Implement the backend**

In `src-tauri/src/db/settings.rs`, beside `DYNAMIC_BACKGROUND`:

```rust
/// Whether the unattended lookup pass may run.
///
/// Off unless it has been turned on, which is the opposite of every other
/// preference here: this is the one that makes the app talk to a server, and
/// 79b calls that module inert unless somebody asks. The ask is this switch,
/// once, rather than a confirmation per release.
pub const UNATTENDED_LOOKUP: &str = "lookup.unattended";
```

and beside `dynamic_background`:

```rust
/// Whether the unattended lookup pass may run. Off unless explicitly on.
pub fn unattended_lookup(conn: &Connection) -> AppResult<bool> {
    Ok(get(conn, UNATTENDED_LOOKUP)?.as_deref() == Some("true"))
}
```

`EXPORTABLE` is untouched — it is an allowlist, so the key is excluded by default and the new assertion documents that.

In `src-tauri/src/commands/mod.rs`, beside the dynamic-background pair:

```rust
/// Whether the unattended lookup pass may run.
#[tauri::command]
pub fn load_unattended_lookup(db: State<'_, Db>) -> AppResult<bool> {
    let conn = db.conn()?;
    settings::unattended_lookup(&conn)
}

/// Turning it off cancels a pass in flight: the worker reads this on every
/// release rather than once at start.
#[tauri::command]
pub fn save_unattended_lookup(db: State<'_, Db>, enabled: bool) -> AppResult<()> {
    let conn = db.conn()?;
    settings::set(
        &conn,
        settings::UNATTENDED_LOOKUP,
        if enabled { "true" } else { "false" },
    )
}
```

and register both in `lib.rs`'s `invoke_handler!`, after `commands::save_dynamic_background`.

- [ ] **Step 4: Run the backend test to verify it passes**

Run: `cd src-tauri && cargo test -p apex db::settings && cargo build -p apex`
Expected: PASS and a clean build.

- [ ] **Step 5: Write the failing frontend tests**

`src/ipc/index.test.ts` — extend the settings round-trip block in the same shape as the `saveDynamicBackground` case:

```ts
    it("round-trips the unattended lookup switch", async () => {
      await saveUnattendedLookup(true);
      await expect(loadUnattendedLookup()).resolves.toBe(true);
    });
```

Create `src/features/shell/lookupStore.test.ts` mirroring `dynamicBackgroundStore.test.ts` exactly — the same four cases (defaults, `load` reads the backend, `set` writes and updates, a failed save leaves the state alone), with `false` as the default instead of `true`.

`src/features/shell/SettingsDialog.test.tsx` — add:

```tsx
  it("turns the unattended lookup on", async () => {
    useLookupStore.setState({ enabled: false });
    render(<SettingsDialog open onOpenChange={() => {}} />);

    await userEvent.click(screen.getByLabelText("Look Releases Up Automatically"));

    expect(useLookupStore.getState().enabled).toBe(true);
  });
```

matching whatever render/mock preamble that file already uses, and adding `loadUnattendedLookup`/`saveUnattendedLookup` to its `vi.mock("../../ipc", …)` block.

- [ ] **Step 6: Run them to verify they fail**

Run: `npm test -- lookupStore SettingsDialog ipc`
Expected: FAIL — `loadUnattendedLookup` is not exported.

- [ ] **Step 7: Implement the frontend**

`src/ipc/index.ts`, after the dynamic-background pair:

```ts
/**
 * Whether the unattended lookup pass may run.
 *
 * Off until it is turned on, unlike every other preference here: it is what
 * lets the app talk to MusicBrainz on its own. Turning it off cancels a pass
 * in flight — the worker reads the setting between releases.
 */
export function loadUnattendedLookup(): Promise<boolean> {
  return invoke<boolean>("load_unattended_lookup");
}

export function saveUnattendedLookup(enabled: boolean): Promise<void> {
  return invoke<void>("save_unattended_lookup", { enabled });
}
```

`src/features/shell/lookupStore.ts` — a copy of `dynamicBackgroundStore.ts` with `enabled: false` as the initial state, `loadUnattendedLookup`/`saveUnattendedLookup` as its two calls, and no `toggle` (nothing outside the dialog flips it). Read `dynamicBackgroundStore.ts` and follow it line for line, including its comment about why the store is separate from `App`.

`src/features/shell/SettingsDialog.tsx` — a row directly above `<WatchFolderSettings />`, since that comment already orders the dialog by how far each setting reaches:

```tsx
          {/* Below the appearance rows and beside the watch interval: both are
              things the app does to the library on its own. The one thing this
              row does that the interval does not is leave the machine, which
              is why it says so. */}
          <div className="settings-row">
            <label htmlFor="unattended-lookup">Look Releases Up Automatically</label>
            <input
              id="unattended-lookup"
              type="checkbox"
              checked={unattendedLookup}
              onChange={(event) => void setUnattendedLookup(event.target.checked)}
            />
          </div>
```

with `const unattendedLookup = useLookupStore((s) => s.enabled);` and `const setUnattendedLookup = useLookupStore((s) => s.set);` beside the dynamic-background pair at the top of the component.

The store loads where the other one does. Check `App.tsx:63` — if `loadDynamicBg` is called there on mount, add the lookup store's `load` the same way, and re-read `CLAUDE.md`'s rule about `App.tsx`: this adds a subscription to a store `App` does not read, so `App` must not subscribe to `enabled`, only call `load()` once in the same effect.

- [ ] **Step 8: Run the frontend tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src src/
git commit -m "feat: add the switch that opts a library into automatic lookups"
```

---

### Task 7: The worker

**Files:**
- Create: `src-tauri/src/tagsource/worker.rs`
- Modify: `src-tauri/src/tagsource/mod.rs` (`pub mod worker;`)
- Modify: `src-tauri/src/lib.rs` (start it in `setup`, beside `watch_library`)
- Test: `src-tauri/src/tagsource/worker.rs` (its own `mod tests`, against `sweep` rather than the thread)

**Interfaces:**
- Consumes: `db::lookup::{pending, seed_from_tags}`, `pass::{look_up, Verdict, dry_run, THRESHOLD}`.
- Produces:
  - `pub struct Summary { pub resolved: usize, pub queued: usize, pub missed: usize }`
  - `pub fn sweep(db: &Db, lock: &ScanLock, transport: &(dyn Transport + '_), log: &Log, staging: &Path, enabled: &dyn Fn() -> bool) -> AppResult<Summary>`
  - `pub fn spawn(db: Db, lock: ScanLock, log: Log, staging: PathBuf, on_change: impl Fn() + Send + 'static)`

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/tagsource/worker.rs`'s test module. Task 5 already made `library` `pub(crate)`; call it from here rather than copying it, and add the second release on top of what it built.

```rust
    use crate::log::Log;
    use crate::scan::ScanLock;
    use crate::tagsource::pass::tests::{library, LOVELESS_DURATIONS};
    use crate::tagsource::transport::FakeTransport;

    const SEARCH_JSON: &str = include_str!("fixtures/search-loveless.json");
    const RELEASE_JSON: &str = include_str!("fixtures/release-loveless.json");

    fn musicbrainz() -> FakeTransport {
        FakeTransport::new()
            .answering("/ws/2/release/", RELEASE_JSON)
            .answering("/ws/2/release", SEARCH_JSON)
            .missing("coverartarchive.org")
    }

    /// Two releases, both answerable by the same fixtures. The second is a
    /// different `(album, artist)` and nothing more: these tests count how
    /// many releases a sweep got through, not what it decided about each.
    fn two_releases() -> (tempfile::TempDir, Db, ()) {
        let (dir, db, _) = library(11, &LOVELESS_DURATIONS);
        let conn = db.conn().unwrap();
        let source = dir.path().join("01.mp3");

        for index in 0..11 {
            let path = dir.path().join(format!("b{:02}.mp3", index + 1));
            std::fs::copy(&source, &path).unwrap();
            conn.execute(
                "INSERT INTO tracks (path, mtime, size, duration_ms, album, album_artist, artist, track_no, added_at)
                 VALUES (?1, 0, 0, ?2, 'Isn''t Anything', 'My Bloody Valentine', 'My Bloody Valentine', ?3, 0)",
                rusqlite::params![
                    path.to_string_lossy(),
                    LOVELESS_DURATIONS[index],
                    index as i64 + 1,
                ],
            )
            .unwrap();
        }

        drop(conn);
        (dir, db, ())
    }

    /// The resume point, which is the whole reason the table exists: a pass
    /// cut short by a quit starts from where it stopped.
    #[test]
    fn a_cancelled_sweep_resumes_where_it_stopped() {
        let (dir, db, _) = two_releases();
        let lock = ScanLock::default();
        let log = Log::to(dir.path().join("log"));
        let transport = musicbrainz();

        // Off after the first release: the closure is what the switch flips.
        let done = std::cell::Cell::new(0);
        let first = sweep(&db, &lock, &transport, &log, dir.path(), &|| {
            let seen = done.get();
            done.set(seen + 1);
            seen < 1
        })
        .unwrap();
        assert_eq!(first.resolved + first.queued + first.missed, 1);

        let second = sweep(&db, &lock, &transport, &log, dir.path(), &|| true).unwrap();
        assert_eq!(
            second.resolved + second.queued + second.missed,
            1,
            "the second sweep does the release the first did not, and not the one it did"
        );
    }

    #[test]
    fn a_second_sweep_over_a_finished_library_does_nothing() {
        let (dir, db, _) = two_releases();
        let lock = ScanLock::default();
        let log = Log::to(dir.path().join("log"));
        let transport = musicbrainz();

        sweep(&db, &lock, &transport, &log, dir.path(), &|| true).unwrap();
        let before = transport.call_count();

        let again = sweep(&db, &lock, &transport, &log, dir.path(), &|| true).unwrap();

        assert_eq!(again.resolved + again.queued + again.missed, 0);
        assert_eq!(transport.call_count(), before, "and it costs no requests");
    }

    /// The seed, asserted through the sweep: a library already carrying its
    /// identities must not pay four and a half hours.
    #[test]
    fn a_library_that_already_carries_its_mbids_costs_no_requests() {
        let (dir, db, _) = two_releases();
        db.conn()
            .unwrap()
            .execute("UPDATE tracks SET release_mbid = 'bb5a'", [])
            .unwrap();
        let transport = musicbrainz();

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &transport,
            &Log::to(dir.path().join("log")),
            dir.path(),
            &|| true,
        )
        .unwrap();

        assert_eq!(summary.resolved + summary.queued + summary.missed, 0);
        assert_eq!(transport.call_count(), 0);
    }
```

Both releases are answered by the same fixtures on purpose. `FakeTransport` matches on URL substrings and the album is a `query` *parameter* rather than part of the URL, so there is no way to route two searches to two different bodies — and no need to: all three tests count releases a sweep got through, not what it decided about each. Task 5 is where the deciding is asserted.

Task 5's test module must therefore be reachable from here: mark it `#[cfg(test)] pub(crate) mod tests` in `pass.rs`, with `library` and `LOVELESS_DURATIONS` `pub(crate)`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd src-tauri && cargo test -p apex tagsource::worker`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

`src-tauri/src/tagsource/worker.rs`:

```rust
//! The thread that drives the unattended pass.
//!
//! `scan::watch::spawn`'s shape, not `commands::blocking`'s: that helper wraps
//! a command that returns when its work finishes, and four and a half hours is
//! not that. A named thread owning a `Db` handle, started from `lib.rs`, joined
//! by nobody.
//!
//! The switch is read between releases rather than captured at start, which is
//! what makes turning it off cancel a pass in flight and turning it back on
//! resume without a restart.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::db::{lookup, settings, Db};
use crate::error::AppResult;
use crate::log::{Fields, Log};
use crate::scan::ScanLock;
use crate::tagsource::pass::{self, Verdict};
use crate::tagsource::transport::Transport;

/// How often the thread wakes to ask whether the switch is on.
///
/// The same fifteen seconds `scan::watch` waits, and for the same reason: it
/// decides only how soon a changed setting takes effect.
const TICK: Duration = Duration::from_secs(15);

/// How many pending releases are read at a time.
///
/// `lookup::pending` groups every row of `tracks`, so asking per release would
/// spend a pass that already takes four and a half hours scanning the table
/// eight thousand times. Large enough to amortise that, small enough that a
/// retagged release is picked up within a batch.
const BATCH: usize = 200;

/// What a sweep came to.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Summary {
    pub resolved: usize,
    pub queued: usize,
    pub missed: usize,
}

impl Summary {
    fn attempted(self) -> usize {
        self.resolved + self.queued + self.missed
    }
}

/// Works through every release with no row, until there are none or the switch
/// goes off.
///
/// `enabled` is read before every release rather than once, so the switch
/// cancels rather than merely stopping the next pass.
pub fn sweep(
    db: &Db,
    lock: &ScanLock,
    transport: &(dyn Transport + '_),
    log: &Log,
    staging: &Path,
    enabled: &dyn Fn() -> bool,
) -> AppResult<Summary> {
    let dry_run = pass::dry_run();
    let mut summary = Summary::default();

    let mut conn = db.conn()?;
    // Free, and it is what keeps a re-install off the four and a half hours.
    lookup::seed_from_tags(&conn, crate::now_seconds())?;

    loop {
        let batch = lookup::pending(&conn, BATCH)?;
        if batch.is_empty() {
            return Ok(summary);
        }

        for release in &batch {
            if !enabled() {
                return Ok(summary);
            }

            let op = log
                .op("lookup.release")
                .add("album", release.album.as_deref().unwrap_or("-"))
                .add("artist", release.artist.as_deref().unwrap_or("-"));
            let verdict = pass::look_up(
                &mut conn,
                transport,
                lock,
                release,
                staging,
                dry_run,
                crate::now_seconds(),
            );

            // By hand rather than through `Op::run_with`, because which of the
            // two this is - a line, or silence - is not known until the work
            // has run, and `Op::quiet` is decided before it does. 8,044 lines
            // about what was written is nothing next to a bad threshold that
            // cannot be diagnosed after the fact; 8,044 more about releases
            // MusicBrainz has never heard of is noise.
            match &verdict {
                Ok(Verdict::NotFound) => {}
                Ok(verdict) => op.succeeded(verdict_fields(verdict)),
                Err(error) => op.failed(error),
            }

            match verdict {
                Ok(Verdict::Written { .. }) => summary.resolved += 1,
                Ok(Verdict::Queued { .. }) => summary.queued += 1,
                Ok(Verdict::NotFound) => summary.missed += 1,
                // A release that failed keeps no row, so the next sweep tries
                // it again - which is right for a network that was down and
                // harmless for one that was not.
                Err(_) => return Ok(summary),
            }
        }
    }
}

/// Enough of the number to diagnose a bad threshold after the fact.
///
/// `NotFound` has no arm because it is never logged: a release MusicBrainz has
/// nothing for is not something that happened.
fn verdict_fields(verdict: &Verdict) -> Fields {
    match verdict {
        Verdict::Written { mbid, score, tracks } => Fields::new()
            .add("status", "written")
            .add("mbid", mbid)
            .add("score", format!("{score:.3}"))
            .add("tracks", tracks),
        Verdict::Queued { score, candidates } => Fields::new()
            .add("status", "queued")
            .add("score", format!("{score:.3}"))
            .add("candidates", candidates),
        Verdict::NotFound => Fields::new(),
    }
}

/// Starts the `release-lookup` thread.
///
/// `on_change` runs after a sweep that wrote something, on the one channel
/// that says the library is no longer what a view thinks. A sweep that only
/// queued or missed says nothing: nothing a view draws has changed.
pub fn spawn(
    db: Db,
    lock: ScanLock,
    log: Log,
    staging: PathBuf,
    on_change: impl Fn() + Send + 'static,
) {
    let _ = std::thread::Builder::new()
        .name("release-lookup".to_owned())
        .spawn(move || loop {
            std::thread::sleep(TICK);

            let enabled = || {
                db.conn()
                    .and_then(|conn| settings::unattended_lookup(&conn))
                    .unwrap_or(false)
            };
            if !enabled() {
                continue;
            }
            let Some(transport) = crate::tagsource::transport::shared() else {
                continue;
            };

            let op = log.op("lookup.sweep");
            let summary = sweep(&db, &lock, transport, &log, &staging, &enabled);

            match &summary {
                Ok(summary) => op.succeeded(
                    Fields::new()
                        .add("resolved", summary.resolved)
                        .add("queued", summary.queued)
                        .add("missed", summary.missed),
                ),
                Err(error) => op.failed(error),
            }

            if matches!(&summary, Ok(summary) if summary.resolved > 0) {
                on_change();
            }
        });
}
```

Add `pub mod worker;` to `src-tauri/src/tagsource/mod.rs`.

In `src-tauri/src/lib.rs`'s `setup`, after `watch_library(...)` and before `app.manage(lock)`:

```rust
            // The staging directory the pass writes fetched covers through, so
            // the thread does not need an `AppHandle` to find it.
            let staging = app.path().app_cache_dir().ok();
            if let Some(staging) = staging {
                let announce = app.handle().clone();
                tagsource::worker::spawn(
                    db.clone(),
                    lock.clone(),
                    log.clone(),
                    staging,
                    move || commands::announce_library_changed(&announce),
                );
            }
```

`std::fs::create_dir_all` on that directory happens in `commands::staging_dir`; the pass's `stage` writes into it, so create it here too — one `let _ = std::fs::create_dir_all(&staging);` before the spawn.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test -p apex tagsource::worker -- --test-threads=1`
Expected: PASS, three tests.

Then everything: `cd src-tauri && cargo test -p apex && cargo clippy -p apex --all-targets -- -D warnings && cargo fmt --check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat: run the release lookup as a background pass"
```

---

### Task 8: The documentation

**Files:**
- Modify: `docs/knowledge/data-model.md`
- Modify: `docs/knowledge/architecture.md`
- Modify: `docs/knowledge/conventions.md`
- Modify: `docs/knowledge/testing.md`
- Modify: `docs/knowledge/limitations.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code depends on.

- [ ] **Step 1: Read each file before editing it**

These are curated prose, not a changelog. Match each file's voice and add the least that is true.

- [ ] **Step 2: `data-model.md`**

Add migration 9 to the migration table with the same one-line summary style the other eight have. Add `release_lookup` to the table list with its columns, and note the unique index over the coalesced, `NOCASE`-folded pair and *why* a primary key will not do. Add `tracks.release_type` to the `tracks` column list.

- [ ] **Step 3: `architecture.md`**

Three places, all of which already name the neighbours this joins:

- the module map gains `tagsource::pass` and `tagsource::worker`;
- the `ScanLock` holders list gains the pass, with "per write, never for the pass";
- the thread list gains `release-lookup` beside `library-watch`, and line 110's "writes that run for hours" now has its first real instance.

- [ ] **Step 4: `conventions.md`**

The file is the source of truth still holds; what changes is that it now has a stated exception. One entry: an automatic write happens only above `pass::THRESHOLD`, and everything below it goes to a person. Name the threshold constant so the number is findable.

- [ ] **Step 5: `testing.md`**

The Rust integration row gains the pass. Note that `tagsource::pass` and `tagsource::worker` tests go through the shared rate limiter and so cost real seconds — which is why they keep their fixtures to two or three releases.

- [ ] **Step 6: `limitations.md`**

Two honest entries:

- **A pass over a large library takes hours.** 8,044 releases × 2 calls at one a second. The limit is MusicBrainz's and no concurrency moves it.
- **A release MusicBrainz has nothing for is never retried.** Deliberate — a pass that re-searched every miss on every launch would be four and a half hours that finds nothing — and a manual re-lookup is 82c's or later.

- [ ] **Step 7: Verify and commit**

Run: `npx markdownlint-cli2 docs/knowledge/*.md` if the repo has it configured (check `package.json`); otherwise just re-read the diff.

```bash
git add docs/knowledge
git commit -m "docs: record the unattended lookup pass"
```

---

## Verification before the PR

Run all of it from a clean tree:

```bash
cd src-tauri && cargo fmt --check && cargo clippy -p apex --all-targets -- -D warnings && cargo test -p apex
cd .. && npm run lint && npm test && npm run build
```

Then open the PR against `feature/82a-undo-goes`, not `main` — this is stacked on 82a (#145), which is stacked on the lookup PRs below it.

**Pre-merge checklist for the PR body** — only what CI cannot judge:

- [ ] Turn the switch on with a library present and confirm the log fills with `lookup.release` lines about one every two seconds.
- [ ] Turn it off mid-pass and confirm the lines stop within a release, and that turning it back on resumes rather than restarting.
- [ ] Confirm a release the pass wrote shows its new tags, artwork and MusicBrainz ids in the tag editor.
- [ ] Confirm an open tag editor's staged artwork is not swapped out by a pass running behind it.
- [ ] Run one pass with `APEX_LOOKUP_DRY_RUN=1`, read the scores it reports, and say whether 0.93 is the right bar for this library.
