//! Importing a last.fm listening history into `plays`.
//!
//! **`api_key` only.** `user.getRecentTracks` and `user.getLovedTracks` take no
//! session key, so an import works before an account is connected, and nothing
//! here is signed.
//!
//! **Paged backwards by timestamp, never by page number.** Page numbers shift
//! the moment a scrobble lands mid-import; a `to=` cursor does not, and
//! committed with each page it is what a killed import resumes from. See
//! `docs/issues/done/78-import-the-lastfm-history.md` for the API facts the
//! rest of this is shaped by.

use std::collections::BTreeSet;
use std::time::Duration;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::transport::Transport;
use super::{parse, Error};
use crate::db::{plays, settings};
use crate::error::{AppError, AppResult};
use crate::model::{LastfmImport, WriteProgress};

/// The most scrobbles one history page may carry.
const PAGE: u32 = 200;
/// The most loved tracks one page may carry.
const LOVED_PAGE: u32 = 1000;
/// The wait between requests: four a second, inside last.fm's five-per-second
/// average.
const THROTTLE: Duration = Duration::from_millis(250);
/// How often one page is asked for before the run stops.
const ATTEMPTS: u32 = 3;
/// The first wait after a failed request, doubled for each one after it.
const BACKOFF: Duration = Duration::from_secs(2);

/// "Operation failed". Routine on the deep pages of a long history, and gone
/// on a retry, so it is retried here although it is a malformed request
/// everywhere else.
const OPERATION_FAILED: u32 = 8;
const NO_SUCH_USER: u32 = 6;
/// A user who hides their recent listening, which `api_key` alone cannot read.
const PRIVATE: u32 = 17;

/// Where the import stands, stored as JSON under [`settings::LASTFM_IMPORT`].
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    /// The account this history is of. A different one starts over.
    pub username: String,
    /// The `to` of the next page, while a run is under way.
    pub cursor: Option<i64>,
    /// The newest scrobble the running run has seen, which becomes `floor`
    /// when it finishes. Kept because a resumed run never sees that page again.
    pub ceiling: Option<i64>,
    /// The newest scrobble a finished run imported, so the next one asks only
    /// for what came after (`from=`).
    pub floor: Option<i64>,
}

/// The stored state, if an import has ever run.
///
/// A value this build cannot read is no state at all: the worst that costs is
/// one import from the top, which the identity index makes free of duplicates.
pub fn state(conn: &Connection) -> AppResult<Option<State>> {
    Ok(settings::get(conn, settings::LASTFM_IMPORT)?
        .and_then(|value| serde_json::from_str(&value).ok()))
}

/// The stored state, as the Settings pane draws it.
pub fn status(conn: &Connection) -> AppResult<Option<LastfmImport>> {
    Ok(state(conn)?.map(|state| LastfmImport {
        resumable: state.cursor.is_some(),
        through: state.floor,
        username: state.username,
    }))
}

fn save(conn: &Connection, state: &State) -> AppResult<()> {
    let value = serde_json::to_string(state)
        .map_err(|e| AppError::Internal(format!("encoding the import state: {e}")))?;
    settings::set(conn, settings::LASTFM_IMPORT, &value)
}

/// One scrobble as a history page gives it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Scrobble {
    started_at: i64,
    artist: String,
    title: String,
    album: Option<String>,
    artist_mbid: Option<String>,
    track_mbid: Option<String>,
}

/// One page of `user.getRecentTracks`.
#[derive(Debug, Default)]
struct Page {
    /// Scrobbles left in the window this page was asked for, this one included.
    total: u32,
    total_pages: u32,
    scrobbles: Vec<Scrobble>,
}

/// What an import needs from outside: somewhere to send requests and a way to
/// wait between them. The wait is injected so a test runs a thousand pages
/// without sleeping through them.
pub struct Import<'a> {
    pub transport: &'a dyn Transport,
    pub api_key: &'a str,
    pub pause: &'a dyn Fn(Duration),
}

impl Import<'_> {
    /// Imports `username`'s history, returning how many plays it added.
    ///
    /// Resumes a run that stopped, or asks only for what is newer than the
    /// last finished one. `fresh` deletes every imported play first and starts
    /// from the top, which is how scrobbles deleted on last.fm leave; local
    /// plays stay.
    ///
    /// `plays::resolve` and `plays::regroup` run when the run ends, finished
    /// or not: the pages already committed are plays like any other, and
    /// until both have run they are unlinked and ungrouped. The loved set is
    /// fetched only once the history is complete.
    pub fn run(
        &self,
        conn: &mut Connection,
        username: &str,
        fresh: bool,
        on_progress: &mut dyn FnMut(WriteProgress),
    ) -> AppResult<u32> {
        let username = username.trim();
        if username.is_empty() {
            return Err(AppError::Internal("Enter a last.fm username.".to_owned()));
        }

        let mut state = match state(conn)? {
            Some(state) if !fresh && state.username.eq_ignore_ascii_case(username) => state,
            _ => State {
                username: username.to_owned(),
                ..State::default()
            },
        };
        if fresh {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM plays WHERE source = 'lastfm'", [])?;
            save(&tx, &state)?;
            tx.commit()?;
        }

        let history = self.history(conn, &mut state, on_progress);

        let tx = conn.transaction()?;
        plays::resolve(&tx)?;
        plays::regroup(&tx)?;
        tx.commit()?;

        let imported = history?;
        self.loved(conn, username).map_err(|error| {
            AppError::Internal(format!(
                "Imported the history, but not the loved tracks: {error}"
            ))
        })?;
        Ok(imported)
    }

    fn history(
        &self,
        conn: &mut Connection,
        state: &mut State,
        on_progress: &mut dyn FnMut(WriteProgress),
    ) -> AppResult<u32> {
        let mut imported = 0;
        let mut seen = 0;
        on_progress(WriteProgress { done: 0, total: 0 });

        loop {
            let page = self.page(state)?;

            let tx = conn.transaction()?;
            imported += insert(&tx, &page.scrobbles)?;
            let newest = page.scrobbles.iter().map(|s| s.started_at).max();
            let oldest = page.scrobbles.iter().map(|s| s.started_at).min();
            if state.cursor.is_none() {
                state.ceiling = newest;
            }
            // Empty with pages supposedly left is a window the cursor cannot
            // move through, so it is treated as the end rather than a loop.
            let last = page.total_pages <= 1 || oldest.is_none();
            match oldest {
                Some(oldest) if !last => state.cursor = Some(next_cursor(oldest, state.cursor)),
                _ => {
                    state.floor = state.ceiling.max(state.floor);
                    state.cursor = None;
                    state.ceiling = None;
                }
            }
            save(&tx, state)?;
            tx.commit()?;

            seen += page.scrobbles.len() as u32;
            let left = page.total.saturating_sub(page.scrobbles.len() as u32);
            on_progress(WriteProgress {
                done: seen,
                total: seen + if last { 0 } else { left },
            });

            if last {
                return Ok(imported);
            }
            (self.pause)(THROTTLE);
        }
    }

    /// One history page, below the cursor and above the floor.
    fn page(&self, state: &State) -> AppResult<Page> {
        let mut params = vec![
            ("method", "user.getRecentTracks".to_owned()),
            ("user", state.username.clone()),
            ("api_key", self.api_key.to_owned()),
            ("limit", PAGE.to_string()),
        ];
        if let Some(to) = state.cursor {
            params.push(("to", to.to_string()));
        }
        if let Some(from) = state.floor {
            params.push(("from", from.to_string()));
        }
        params.push(("format", "json".to_owned()));

        let value = self.fetch(&params, &state.username)?;
        read_page(&value).map_err(|error| AppError::Internal(error.to_string()))
    }

    /// Replaces the loved set with what last.fm holds now.
    ///
    /// Every page before any write, so a fetch that fails part-way keeps the
    /// set the last import left rather than a partial one.
    fn loved(&self, conn: &mut Connection, username: &str) -> AppResult<()> {
        let mut keys = BTreeSet::new();
        let mut page = 1;
        loop {
            let params = [
                ("method", "user.getLovedTracks".to_owned()),
                ("user", username.to_owned()),
                ("api_key", self.api_key.to_owned()),
                ("limit", LOVED_PAGE.to_string()),
                ("page", page.to_string()),
                ("format", "json".to_owned()),
            ];
            let value = self.fetch(&params, username)?;
            let loved = &value["lovedtracks"];
            if !loved.is_object() {
                return Err(AppError::Internal(
                    "last.fm sent a loved page without its tracks".to_owned(),
                ));
            }
            for track in entries(&loved["track"]) {
                let key = plays::match_key(text(&track["artist"]["name"]), text(&track["name"]));
                if !key.is_empty() {
                    keys.insert(key);
                }
            }
            if page >= number(&loved["@attr"]["totalPages"]) {
                break;
            }
            page += 1;
            (self.pause)(THROTTLE);
        }

        let tx = conn.transaction()?;
        tx.execute("DELETE FROM lastfm_loved", [])?;
        {
            let mut insert = tx.prepare("INSERT INTO lastfm_loved (match_key) VALUES (?1)")?;
            for key in &keys {
                insert.execute([key])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// One request, asked again on a failure a later attempt can get past.
    fn fetch(&self, params: &[(&str, String)], username: &str) -> AppResult<Value> {
        let mut wait = BACKOFF;
        for attempt in 1..=ATTEMPTS {
            let outcome = self
                .transport
                .post(params)
                .map_err(Error::from)
                .and_then(|body| parse(&body));
            match outcome {
                Ok(value) => return Ok(value),
                Err(error) if retryable(&error) && attempt < ATTEMPTS => {
                    (self.pause)(wait);
                    wait *= 2;
                }
                Err(error) => return Err(describe(&error, username)),
            }
        }
        unreachable!("the last attempt returns either way")
    }
}

fn retryable(error: &Error) -> bool {
    error.transient() || error.api_code() == Some(OPERATION_FAILED)
}

/// The failure, as the user can act on it.
fn describe(error: &Error, username: &str) -> AppError {
    AppError::Internal(match error.api_code() {
        Some(NO_SUCH_USER) => format!("last.fm has no user called {username}."),
        Some(PRIVATE) => format!("{username} keeps their listening history private on last.fm."),
        _ if retryable(error) => {
            format!("last.fm stopped answering ({error}). Import again to resume.")
        }
        _ => error.to_string(),
    })
}

/// The `to` of the page after one whose oldest scrobble is `oldest`.
///
/// **`oldest + 1`, because last.fm does not document whether `to` is
/// inclusive.** Either way the page re-fetches the boundary second, the
/// identity index drops what it already has, and scrobbles sharing that second
/// across two pages are not lost. It must still move: a page that is one second
/// throughout would ask for itself again, so the cursor never climbs back to or
/// past where it was.
fn next_cursor(oldest: i64, cursor: Option<i64>) -> i64 {
    match cursor {
        Some(cursor) => (oldest + 1).min(cursor - 1),
        None => oldest + 1,
    }
}

/// Writes a page, returning how many plays it added.
///
/// **A second that already holds a local play is skipped**, whatever it is
/// called. last.fm autocorrects artist and title, so a play this app wrote and
/// scrobbled comes back under a spelling with a different `match_key`, which
/// the identity index would let in a second time. Within a second this app
/// played exactly one thing, so the second alone is enough - and narrow enough
/// to leave two last.fm rows that share one alone.
fn insert(conn: &Connection, scrobbles: &[Scrobble]) -> AppResult<u32> {
    let mut insert = conn.prepare(
        "INSERT OR IGNORE INTO plays
            (started_at, source, artist, title, album, artist_mbid, track_mbid, match_key)
         SELECT ?1, 'lastfm', ?2, ?3, ?4, ?5, ?6, ?7
          WHERE NOT EXISTS (SELECT 1 FROM plays WHERE started_at = ?1 AND source = 'local')",
    )?;
    let mut added = 0;
    for scrobble in scrobbles {
        added += insert.execute(rusqlite::params![
            scrobble.started_at,
            scrobble.artist,
            scrobble.title,
            scrobble.album,
            scrobble.artist_mbid,
            scrobble.track_mbid,
            plays::match_key(&scrobble.artist, &scrobble.title),
        ])? as u32;
    }
    Ok(added)
}

fn read_page(value: &Value) -> Result<Page, Error> {
    let recent = &value["recenttracks"];
    if !recent.is_object() {
        return Err(Error::Malformed(
            "a history page came back without its tracks".to_owned(),
        ));
    }
    let attr = &recent["@attr"];
    Ok(Page {
        total: number(&attr["total"]),
        total_pages: number(&attr["totalPages"]),
        scrobbles: entries(&recent["track"])
            .into_iter()
            .filter_map(scrobble)
            .collect(),
    })
}

/// One entry, or nothing for the `nowplaying` one: it has no `date`, and it is
/// not a play yet.
fn scrobble(entry: &Value) -> Option<Scrobble> {
    let started_at = entry["date"]["uts"].as_str()?.parse().ok()?;
    let album = text(&entry["album"]["#text"]).trim();
    Some(Scrobble {
        started_at,
        artist: text(&entry["artist"]["#text"]).trim().to_owned(),
        title: text(&entry["name"]).trim().to_owned(),
        album: (!album.is_empty()).then(|| album.to_owned()),
        artist_mbid: plays::mbid(text(&entry["artist"]["mbid"])),
        track_mbid: plays::mbid(text(&entry["mbid"])),
    })
}

/// A list field's entries: one comes back as an object rather than an array of
/// one, and none as an empty array or nothing at all.
fn entries(value: &Value) -> Vec<&Value> {
    match value {
        Value::Array(items) => items.iter().collect(),
        Value::Object(_) => vec![value],
        _ => Vec::new(),
    }
}

fn text(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}

/// A count, which last.fm sends as a string.
fn number(value: &Value) -> u32 {
    value
        .as_str()
        .and_then(|text| text.parse().ok())
        .or_else(|| value.as_u64().map(|n| n as u32))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::lastfm::transport::{FakeTransport, TransportError};
    use std::cell::RefCell;

    fn open() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    /// One history entry.
    fn entry(started_at: i64, artist: &str, title: &str) -> String {
        format!(
            r##"{{"artist":{{"mbid":"","#text":"{artist}"}},"name":"{title}","mbid":"",
                "album":{{"mbid":"","#text":"Tide"}},"date":{{"uts":"{started_at}","#text":""}}}}"##
        )
    }

    /// A history page. `entries` is spliced in raw, so a test can hand over an
    /// object where an array would be.
    fn page(total: u32, total_pages: u32, entries: &str) -> String {
        format!(
            r#"{{"recenttracks":{{"track":{entries},
                "@attr":{{"user":"listener","page":"1","perPage":"200",
                          "total":"{total}","totalPages":"{total_pages}"}}}}}}"#
        )
    }

    fn array(entries: &[String]) -> String {
        format!("[{}]", entries.join(","))
    }

    fn loved(entries: &[(&str, &str)]) -> String {
        let tracks: Vec<String> = entries
            .iter()
            .map(|(artist, title)| {
                format!(r#"{{"name":"{title}","mbid":"","artist":{{"name":"{artist}"}}}}"#)
            })
            .collect();
        format!(
            r#"{{"lovedtracks":{{"track":[{}],"@attr":{{"page":"1","totalPages":"1"}}}}}}"#,
            tracks.join(",")
        )
    }

    const NO_LOVED: &str = r#"{"lovedtracks":{"track":[],"@attr":{"page":"1","totalPages":"0"}}}"#;

    /// Runs an import over `transport`, recording the waits rather than
    /// sleeping them.
    fn import(
        conn: &mut Connection,
        transport: &FakeTransport,
        fresh: bool,
    ) -> (AppResult<u32>, Vec<Duration>) {
        let waits = RefCell::new(Vec::new());
        let pause = |wait: Duration| waits.borrow_mut().push(wait);
        let import = Import {
            transport,
            api_key: "KEY",
            pause: &pause,
        };
        let outcome = import.run(conn, "listener", fresh, &mut |_| {});
        (outcome, waits.into_inner())
    }

    fn started(conn: &Connection) -> Vec<i64> {
        conn.prepare("SELECT started_at FROM plays ORDER BY started_at")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    #[test]
    fn a_history_is_paged_backwards_by_timestamp() {
        let (_dir, mut conn) = open();
        let transport = FakeTransport::scripted(vec![
            Ok(page(
                4,
                2,
                &array(&[entry(400, "A", "a"), entry(300, "B", "b")]),
            )),
            Ok(page(
                2,
                1,
                &array(&[entry(200, "C", "c"), entry(100, "D", "d")]),
            )),
            Ok(NO_LOVED.to_owned()),
        ]);

        let (outcome, waits) = import(&mut conn, &transport, false);

        assert_eq!(outcome.unwrap(), 4);
        assert_eq!(started(&conn), [100, 200, 300, 400]);
        assert_eq!(transport.param(0, "to"), None);
        assert_eq!(transport.param(0, "limit").as_deref(), Some("200"));
        assert_eq!(
            transport.param(0, "extended"),
            None,
            "the plain response carries the ids"
        );
        assert_eq!(transport.param(1, "to").as_deref(), Some("301"));
        assert_eq!(transport.param(1, "page"), None, "never paged by number");
        assert!(waits.contains(&THROTTLE));

        let state = state(&conn).unwrap().unwrap();
        assert_eq!(
            state,
            State {
                username: "listener".to_owned(),
                cursor: None,
                ceiling: None,
                floor: Some(400),
            }
        );
    }

    #[test]
    fn the_now_playing_entry_is_not_a_play() {
        let (_dir, mut conn) = open();
        let now_playing = r##"{"artist":{"mbid":"","#text":"A"},"name":"a","mbid":"",
            "album":{"mbid":"","#text":""},"@attr":{"nowplaying":"true"}}"##;
        let transport = FakeTransport::scripted(vec![
            Ok(page(
                1,
                1,
                &format!("[{now_playing},{}]", entry(100, "B", "b")),
            )),
            Ok(NO_LOVED.to_owned()),
        ]);

        let (outcome, _) = import(&mut conn, &transport, false);

        assert_eq!(outcome.unwrap(), 1);
        assert_eq!(started(&conn), [100]);
    }

    #[test]
    fn one_scrobble_comes_back_as_an_object() {
        let (_dir, mut conn) = open();
        let transport = FakeTransport::scripted(vec![
            Ok(page(1, 1, &entry(100, "A", "a"))),
            Ok(NO_LOVED.to_owned()),
        ]);

        let (outcome, _) = import(&mut conn, &transport, false);

        assert_eq!(outcome.unwrap(), 1);
    }

    #[test]
    fn scrobbles_sharing_the_boundary_second_are_all_kept() {
        // Two at 300, split across the page boundary. The overlap re-fetches
        // the first and the index drops it; an exclusive cursor would have
        // lost the second.
        let (_dir, mut conn) = open();
        let transport = FakeTransport::scripted(vec![
            Ok(page(
                3,
                2,
                &array(&[entry(400, "A", "a"), entry(300, "B", "b")]),
            )),
            Ok(page(
                2,
                1,
                &array(&[entry(300, "B", "b"), entry(300, "C", "c")]),
            )),
            Ok(NO_LOVED.to_owned()),
        ]);

        let (outcome, _) = import(&mut conn, &transport, false);

        assert_eq!(outcome.unwrap(), 3, "the re-fetched row adds nothing");
        assert_eq!(started(&conn), [300, 300, 400]);
    }

    #[test]
    fn a_page_that_is_one_second_throughout_still_moves_the_cursor() {
        assert_eq!(next_cursor(300, None), 301);
        assert_eq!(next_cursor(300, Some(500)), 301);
        // `to=301` answered with a page wholly at 300: asking for `to=301`
        // again would be the same page forever.
        assert_eq!(next_cursor(300, Some(301)), 300);
        // And if `to` turns out inclusive, the same page again at `to=300`.
        assert_eq!(next_cursor(300, Some(300)), 299);
    }

    #[test]
    fn a_failure_part_way_leaves_the_cursor_for_a_resume() {
        let (_dir, mut conn) = open();
        let offline = || Err(TransportError::Unreachable("offline".to_owned()));
        let failing = FakeTransport::scripted(vec![
            Ok(page(
                4,
                2,
                &array(&[entry(400, "A", "a"), entry(300, "B", "b")]),
            )),
            offline(),
            offline(),
            offline(),
        ]);

        let (outcome, waits) = import(&mut conn, &failing, false);

        let error = outcome.unwrap_err().to_string();
        assert!(error.contains("Import again to resume"), "{error}");
        assert_eq!(
            waits
                .iter()
                .filter(|wait| **wait >= BACKOFF)
                .collect::<Vec<_>>(),
            [&BACKOFF, &(BACKOFF * 2)],
            "backed off between the three attempts"
        );
        let stopped = state(&conn).unwrap().unwrap();
        assert_eq!(stopped.cursor, Some(301));
        assert_eq!(stopped.ceiling, Some(400));

        let resumed = FakeTransport::scripted(vec![
            Ok(page(
                2,
                1,
                &array(&[entry(200, "C", "c"), entry(100, "D", "d")]),
            )),
            Ok(NO_LOVED.to_owned()),
        ]);
        let (outcome, _) = import(&mut conn, &resumed, false);

        assert_eq!(outcome.unwrap(), 2);
        assert_eq!(resumed.param(0, "to").as_deref(), Some("301"));
        assert_eq!(started(&conn), [100, 200, 300, 400]);
        // The ceiling the first run saw, not anything the resumed one did.
        assert_eq!(state(&conn).unwrap().unwrap().floor, Some(400));
    }

    #[test]
    fn a_second_run_asks_only_for_what_is_new() {
        let (_dir, mut conn) = open();
        let first = FakeTransport::scripted(vec![
            Ok(page(1, 1, &array(&[entry(100, "A", "a")]))),
            Ok(NO_LOVED.to_owned()),
        ]);
        import(&mut conn, &first, false).0.unwrap();

        let second = FakeTransport::scripted(vec![
            Ok(page(
                2,
                1,
                &array(&[entry(200, "B", "b"), entry(100, "A", "a")]),
            )),
            Ok(NO_LOVED.to_owned()),
        ]);
        let (outcome, _) = import(&mut conn, &second, false);

        assert_eq!(second.param(0, "from").as_deref(), Some("100"));
        assert_eq!(outcome.unwrap(), 1, "a duplicated page inserts nothing new");
        assert_eq!(state(&conn).unwrap().unwrap().floor, Some(200));

        // Nothing new at all leaves the floor where it was.
        let third = FakeTransport::scripted(vec![Ok(page(0, 0, "[]")), Ok(NO_LOVED.to_owned())]);
        assert_eq!(import(&mut conn, &third, false).0.unwrap(), 0);
        assert_eq!(state(&conn).unwrap().unwrap().floor, Some(200));
    }

    #[test]
    fn from_scratch_drops_imported_plays_and_keeps_local_ones() {
        let (_dir, mut conn) = open();
        conn.execute(
            "INSERT INTO plays (started_at, source, artist, title, match_key)
             VALUES (50, 'local', 'L', 'l', ?1), (60, 'lastfm', 'Gone', 'g', ?2)",
            [plays::match_key("L", "l"), plays::match_key("Gone", "g")],
        )
        .unwrap();
        crate::db::settings::set(
            &conn,
            settings::LASTFM_IMPORT,
            r#"{"username":"listener","floor":60}"#,
        )
        .unwrap();
        let transport = FakeTransport::scripted(vec![
            Ok(page(1, 1, &array(&[entry(100, "A", "a")]))),
            Ok(NO_LOVED.to_owned()),
        ]);

        let (outcome, _) = import(&mut conn, &transport, true);

        assert_eq!(outcome.unwrap(), 1);
        assert_eq!(transport.param(0, "from"), None, "from the top");
        assert_eq!(started(&conn), [50, 100]);
    }

    #[test]
    fn a_play_this_app_wrote_is_not_imported_again_under_a_corrected_name() {
        let (_dir, mut conn) = open();
        conn.execute(
            "INSERT INTO tracks (id, path, mtime, size, duration_ms, artist, title, added_at)
             VALUES (1, 'C:\\music\\1.mp3', 0, 0, 240000, 'Motorhead', 'Ace of Spades', 0)",
            [],
        )
        .unwrap();
        plays::record(&conn, 1, 100).unwrap();
        let transport = FakeTransport::scripted(vec![
            Ok(page(
                2,
                1,
                &array(&[
                    entry(100, "Motörhead", "Ace of Spades"),
                    entry(100, "Other", "Same second, not ours"),
                ]),
            )),
            Ok(NO_LOVED.to_owned()),
        ]);

        let (outcome, _) = import(&mut conn, &transport, false);

        assert_eq!(outcome.unwrap(), 0);
        let sources: Vec<String> = conn
            .prepare("SELECT source FROM plays")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(sources, ["local"]);
    }

    #[test]
    fn imported_plays_are_linked_when_the_run_ends() {
        let (_dir, mut conn) = open();
        conn.execute(
            "INSERT INTO tracks (id, path, mtime, size, duration_ms, artist, title, added_at)
             VALUES (1, 'C:\\music\\1.mp3', 0, 0, 240000, 'Blue Room', 'Harbour', 0)",
            [],
        )
        .unwrap();
        // The ids ride along on the row and nothing matches on them; the key
        // is what links a play.
        let with_id = r##"{"artist":{"mbid":"A-1","#text":"Blue Room"},"name":"Harbour",
            "mbid":"R-1","album":{"mbid":"","#text":""},"date":{"uts":"100","#text":""}}"##;
        let transport = FakeTransport::scripted(vec![
            Ok(page(1, 1, &format!("[{with_id}]"))),
            Ok(NO_LOVED.to_owned()),
        ]);

        import(&mut conn, &transport, false).0.unwrap();

        let (link, artist_mbid, track_mbid): (Option<i64>, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT track_id, artist_mbid, track_mbid FROM plays",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(link, Some(1));
        assert_eq!(
            (artist_mbid.as_deref(), track_mbid.as_deref()),
            (Some("a-1"), Some("r-1"))
        );
    }

    /// Beside the link rebuild, and for its reason: the run changed the log
    /// wholesale, and until the fold has seen the new spellings the
    /// Statistics view draws one record as several.
    #[test]
    fn imported_plays_are_grouped_when_the_run_ends() {
        let (_dir, mut conn) = open();
        let transport = FakeTransport::scripted(vec![
            Ok(page(1, 1, &array(&[entry(100, "Blue Room", "Harbour")]))),
            Ok(NO_LOVED.to_owned()),
        ]);

        import(&mut conn, &transport, false).0.unwrap();

        let heading: String = conn
            .query_row("SELECT heading FROM album_groups", [], |row| row.get(0))
            .unwrap();
        assert_eq!(heading, "Tide");
    }

    #[test]
    fn a_private_history_and_an_unknown_user_say_so() {
        let (_dir, mut conn) = open();
        for (body, expected) in [
            (
                r#"{"error":17,"message":"Login: User required to be logged in"}"#,
                "private",
            ),
            (
                r#"{"error":6,"message":"User not found"}"#,
                "no user called listener",
            ),
        ] {
            let transport = FakeTransport::scripted(vec![Ok(body.to_owned())]);
            let (outcome, waits) = import(&mut conn, &transport, false);

            let error = outcome.unwrap_err().to_string();
            assert!(error.contains(expected), "{error}");
            assert!(waits.is_empty(), "not worth asking again");
        }
    }

    #[test]
    fn an_operation_failed_is_asked_again() {
        let (_dir, mut conn) = open();
        let transport = FakeTransport::scripted(vec![
            Ok(r#"{"error":8,"message":"Operation failed"}"#.to_owned()),
            Ok(page(1, 1, &array(&[entry(100, "A", "a")]))),
            Ok(NO_LOVED.to_owned()),
        ]);

        let (outcome, _) = import(&mut conn, &transport, false);

        assert_eq!(outcome.unwrap(), 1);
    }

    #[test]
    fn the_loved_set_is_replaced_rather_than_merged() {
        let (_dir, mut conn) = open();
        let loved_keys = |conn: &Connection| -> Vec<String> {
            conn.prepare("SELECT match_key FROM lastfm_loved ORDER BY match_key")
                .unwrap()
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        let empty = || Ok(page(0, 0, "[]"));

        let first = FakeTransport::scripted(vec![empty(), Ok(loved(&[("A", "a"), ("B", "b")]))]);
        import(&mut conn, &first, false).0.unwrap();
        assert_eq!(
            first.param(1, "method").as_deref(),
            Some("user.getLovedTracks")
        );
        assert_eq!(
            loved_keys(&conn),
            [plays::match_key("A", "a"), plays::match_key("B", "b")]
        );

        let second = FakeTransport::scripted(vec![empty(), Ok(loved(&[("B", "b")]))]);
        import(&mut conn, &second, false).0.unwrap();
        assert_eq!(loved_keys(&conn), [plays::match_key("B", "b")]);

        // A fetch that fails keeps what the last one left.
        let failing = FakeTransport::scripted(vec![
            empty(),
            Ok(r#"{"error":6,"message":"User not found"}"#.to_owned()),
        ]);
        let error = import(&mut conn, &failing, false).0.unwrap_err();
        assert!(
            error.to_string().contains("not the loved tracks"),
            "{error}"
        );
        assert_eq!(loved_keys(&conn), [plays::match_key("B", "b")]);
    }

    #[test]
    fn a_different_username_starts_over() {
        let (_dir, mut conn) = open();
        crate::db::settings::set(
            &conn,
            settings::LASTFM_IMPORT,
            r#"{"username":"someone","cursor":500,"floor":60}"#,
        )
        .unwrap();
        let transport =
            FakeTransport::scripted(vec![Ok(page(0, 0, "[]")), Ok(NO_LOVED.to_owned())]);

        import(&mut conn, &transport, false).0.unwrap();

        assert_eq!(transport.param(0, "to"), None);
        assert_eq!(transport.param(0, "from"), None);
        assert_eq!(transport.param(0, "user").as_deref(), Some("listener"));
    }

    #[test]
    fn nothing_is_signed_and_no_session_key_is_sent() {
        let (_dir, mut conn) = open();
        let transport =
            FakeTransport::scripted(vec![Ok(page(0, 0, "[]")), Ok(NO_LOVED.to_owned())]);

        import(&mut conn, &transport, false).0.unwrap();

        for call in transport.calls() {
            assert!(!call
                .iter()
                .any(|(name, _)| name == "sk" || name == "api_sig"));
        }
    }
}
