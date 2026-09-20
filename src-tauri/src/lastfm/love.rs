//! Loving a track from in here.
//!
//! `track.love` and `track.unlove` are signed session-key calls with no batch
//! form, so a selection is one request per song. They are the only calls in
//! this module the user pressed a control to make, which is what shapes the
//! two decisions below.
//!
//! **The local set is written first and put back on a failure.** A love is
//! answered in [`crate::db::loved`] before last.fm has confirmed it, so a
//! smart playlist recomputed while the request is in flight already agrees
//! with the menu the user just used.
//!
//! **No queue.** `lastfm::queue` exists because a scrobble has a timestamp
//! that expires and a play that already happened; a love is a present-tense
//! preference, and sending one from three days ago is not obviously right.
//! A failure is reported instead - the user asked for this, which is the line
//! `docs/knowledge/conventions.md` draws.

use rusqlite::Connection;

use crate::db::{loved, playback, plays};
use crate::error::{AppError, AppResult};

use super::transport::Transport;
use super::{auth, signed, Credentials, Error};

/// One song, as both last.fm and the local set need it.
struct Song {
    artist: String,
    title: String,
    /// [`plays::match_key`] over this song's own artist and title - the same
    /// function the import reduces last.fm's loved list with, so the two
    /// agree by construction.
    key: String,
}

/// Loves or unloves every track in `track_ids`.
///
/// **Refused before any request** when a track carries no artist or no title:
/// [`plays::match_key`] has no key for it, so the love could be sent but never
/// remembered, and the set would disagree with last.fm from the moment it
/// landed. The control is disabled for such a track; this is the guard behind
/// it.
///
/// Stops at the first failure rather than working through the rest: what
/// refused one call - no network, a dead key, a rate limit - will refuse the
/// next, and the songs already done stay done.
pub fn set(
    transport: &dyn Transport,
    credentials: &Credentials,
    conn: &Connection,
    track_ids: &[i64],
    loved: bool,
) -> AppResult<()> {
    let Some(session) = auth::stored_session(conn)? else {
        return Err(AppError::Internal(
            "No last.fm account is connected.".to_owned(),
        ));
    };
    let songs = songs(conn, track_ids)?;

    for song in &songs {
        let held = !loved::held(conn, std::slice::from_ref(&song.key))?.is_empty();
        write(conn, &song.key, loved)?;

        if let Err(error) = call(transport, credentials, conn, &session.key, song, loved) {
            write(conn, &song.key, held)?;
            return Err(error.into());
        }
    }

    Ok(())
}

/// The songs behind the ids, or the reason none of them can be loved.
///
/// Every id resolved before the first request, so a selection with one
/// unloveable track in it is refused whole rather than part-way through.
fn songs(conn: &Connection, track_ids: &[i64]) -> AppResult<Vec<Song>> {
    let mut songs = Vec::with_capacity(track_ids.len());
    for &id in track_ids {
        // Gone since the menu opened. Nothing to love and nothing to report:
        // the row the user pointed at no longer exists.
        let Some(track) = playback::track_by_id(conn, id)? else {
            continue;
        };
        let artist = track.artist.unwrap_or_default();
        let title = track.title.unwrap_or_default();
        let key = plays::match_key(&artist, &title);
        if key.is_empty() {
            return Err(AppError::Internal(
                "A song needs both an artist and a title before last.fm can love it.".to_owned(),
            ));
        }
        songs.push(Song { artist, title, key });
    }
    Ok(songs)
}

/// The local set, moved to where the user has just asked it to be.
fn write(conn: &Connection, key: &str, loved: bool) -> AppResult<()> {
    let keys = [key.to_owned()];
    if loved {
        loved::remember(conn, &keys)
    } else {
        loved::forget(conn, &keys)
    }
}

/// One `track.love` or `track.unlove`.
///
/// A dead session key is forgotten here rather than at the call site, the way
/// [`super::Service::call`] does it: it is not a failed request to retry, it
/// is an account that is no longer connected.
fn call(
    transport: &dyn Transport,
    credentials: &Credentials,
    conn: &Connection,
    session_key: &str,
    song: &Song,
    loved: bool,
) -> Result<(), Error> {
    let method = if loved { "track.love" } else { "track.unlove" };
    let params = signed(
        method,
        credentials,
        vec![
            ("artist", song.artist.clone()),
            ("track", song.title.clone()),
            ("sk", session_key.to_owned()),
        ],
    );

    let outcome = transport
        .post(&params)
        .map_err(Error::from)
        .and_then(|body| super::parse(&body))
        .map(|_| ());

    if outcome.as_ref().err().is_some_and(Error::needs_reconnect) {
        // A failed write here would leave the app sending with a key it
        // already knows is dead, so it is not worth failing over either.
        let _ = auth::forget_session(conn);
    }

    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::lastfm::transport::{FakeTransport, TransportError};
    use crate::lastfm::{code, sign};

    const CREDENTIALS: Credentials = Credentials {
        api_key: "KEY",
        api_secret: "SECRET",
    };

    /// A library of one song, with an account connected.
    fn library(artist: &str, title: &str) -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        conn.execute(
            "INSERT INTO tracks (id, path, mtime, size, duration_ms, added_at, artist, title)
             VALUES (1, '/a.mp3', 0, 0, 200000, 0, ?1, ?2)",
            rusqlite::params![artist, title],
        )
        .unwrap();
        auth::store_session(
            &conn,
            &auth::Session {
                username: "listener".to_owned(),
                key: "sk-1".to_owned(),
            },
        )
        .unwrap();
        (dir, conn)
    }

    fn keys(conn: &Connection) -> Vec<String> {
        conn.prepare("SELECT match_key FROM lastfm_loved ORDER BY match_key")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap()
    }

    #[test]
    fn a_love_is_remembered_locally_and_sent_signed() {
        let (_dir, conn) = library("Nachtmystium", "Every Last Drop");
        let transport = FakeTransport::always(r#"{"status":"ok"}"#);

        set(&transport, &CREDENTIALS, &conn, &[1], true).unwrap();

        assert_eq!(
            keys(&conn),
            vec![plays::match_key("Nachtmystium", "Every Last Drop")]
        );
        assert_eq!(transport.param(0, "method").as_deref(), Some("track.love"));
        assert_eq!(
            transport.param(0, "artist").as_deref(),
            Some("Nachtmystium")
        );
        assert_eq!(
            transport.param(0, "track").as_deref(),
            Some("Every Last Drop")
        );
        assert_eq!(transport.param(0, "sk").as_deref(), Some("sk-1"));
        assert_eq!(
            transport.param(0, "api_sig"),
            Some(sign::api_sig(
                &[
                    ("method", "track.love".to_owned()),
                    ("api_key", "KEY".to_owned()),
                    ("artist", "Nachtmystium".to_owned()),
                    ("track", "Every Last Drop".to_owned()),
                    ("sk", "sk-1".to_owned()),
                ],
                "SECRET"
            ))
        );
    }

    #[test]
    fn an_unlove_forgets_the_key_and_calls_the_other_method() {
        let (_dir, conn) = library("Nachtmystium", "Every Last Drop");
        let transport = FakeTransport::always(r#"{"status":"ok"}"#);
        set(&transport, &CREDENTIALS, &conn, &[1], true).unwrap();

        set(&transport, &CREDENTIALS, &conn, &[1], false).unwrap();

        assert!(keys(&conn).is_empty());
        assert_eq!(
            transport.param(1, "method").as_deref(),
            Some("track.unlove")
        );
    }

    #[test]
    fn loving_a_song_twice_leaves_one_row() {
        // `PRIMARY KEY` is the only thing stopping a duplicate, and an
        // optimistic write over a set an import already filled is exactly
        // where one would come from.
        let (_dir, conn) = library("Nachtmystium", "Every Last Drop");
        let transport = FakeTransport::always(r#"{"status":"ok"}"#);

        set(&transport, &CREDENTIALS, &conn, &[1], true).unwrap();
        set(&transport, &CREDENTIALS, &conn, &[1], true).unwrap();

        assert_eq!(keys(&conn).len(), 1);
    }

    #[test]
    fn a_call_that_never_lands_puts_the_row_back() {
        let (_dir, conn) = library("Nachtmystium", "Every Last Drop");
        let transport =
            FakeTransport::always_failing(TransportError::Unreachable("refused".to_owned()));

        let error = set(&transport, &CREDENTIALS, &conn, &[1], true).unwrap_err();

        assert!(error.to_string().contains("refused"));
        assert!(keys(&conn).is_empty(), "the optimistic write stayed");
    }

    #[test]
    fn a_failed_unlove_puts_the_row_back_too() {
        let (_dir, conn) = library("Nachtmystium", "Every Last Drop");
        let key = plays::match_key("Nachtmystium", "Every Last Drop");
        loved::remember(&conn, std::slice::from_ref(&key)).unwrap();
        let transport = FakeTransport::always_failing(TransportError::Server { status: 503 });

        set(&transport, &CREDENTIALS, &conn, &[1], false).unwrap_err();

        assert_eq!(keys(&conn), vec![key]);
    }

    #[test]
    fn a_dead_session_key_is_forgotten() {
        let (_dir, conn) = library("Nachtmystium", "Every Last Drop");
        let transport = FakeTransport::always(
            r#"{"error":9,"message":"Invalid session key - Please re-authenticate"}"#,
        );

        let error = set(&transport, &CREDENTIALS, &conn, &[1], true).unwrap_err();

        assert!(error.to_string().contains("re-authenticate"));
        assert_eq!(auth::stored_session(&conn).unwrap(), None);
        assert!(keys(&conn).is_empty());
    }

    #[test]
    fn error_nine_is_what_reconnect_is_keyed_on() {
        // Guards the branch above against the code being renumbered here and
        // not in `Error::needs_reconnect`.
        assert_eq!(code::INVALID_SESSION_KEY, 9);
    }

    #[test]
    fn a_song_with_no_artist_is_refused_before_any_call() {
        let (_dir, conn) = library("", "Every Last Drop");
        // Answers nothing, so reaching the transport at all fails the test.
        let transport = FakeTransport::scripted(Vec::new());

        set(&transport, &CREDENTIALS, &conn, &[1], true).unwrap_err();

        assert_eq!(transport.call_count(), 0);
        assert!(keys(&conn).is_empty());
    }

    #[test]
    fn one_unloveable_song_refuses_the_whole_selection() {
        // Before any request, so a selection is never half sent: the menu
        // disables the entry for exactly this case, and reaching here means
        // the row changed underneath it.
        let (_dir, conn) = library("Nachtmystium", "Every Last Drop");
        conn.execute(
            "INSERT INTO tracks (id, path, mtime, size, duration_ms, added_at, artist, title)
             VALUES (2, '/b.mp3', 0, 0, 200000, 0, 'Nachtmystium', '')",
            [],
        )
        .unwrap();
        let transport = FakeTransport::scripted(Vec::new());

        set(&transport, &CREDENTIALS, &conn, &[1, 2], true).unwrap_err();

        assert_eq!(transport.call_count(), 0);
    }

    #[test]
    fn a_selection_is_one_call_per_song() {
        let (_dir, conn) = library("Nachtmystium", "Every Last Drop");
        conn.execute(
            "INSERT INTO tracks (id, path, mtime, size, duration_ms, added_at, artist, title)
             VALUES (2, '/b.mp3', 0, 0, 200000, 0, 'Marathonmann', 'Holzwege')",
            [],
        )
        .unwrap();
        let transport = FakeTransport::always(r#"{"status":"ok"}"#);

        set(&transport, &CREDENTIALS, &conn, &[1, 2], true).unwrap();

        assert_eq!(transport.call_count(), 2);
        assert_eq!(keys(&conn).len(), 2);
    }

    #[test]
    fn a_failure_part_way_keeps_the_songs_already_loved() {
        // One bad file does not cost the good ones: the first song is loved
        // on last.fm and locally, and only the one that failed goes back.
        let (_dir, conn) = library("Nachtmystium", "Every Last Drop");
        conn.execute(
            "INSERT INTO tracks (id, path, mtime, size, duration_ms, added_at, artist, title)
             VALUES (2, '/b.mp3', 0, 0, 200000, 0, 'Marathonmann', 'Holzwege')",
            [],
        )
        .unwrap();
        let transport = FakeTransport::scripted(vec![
            Ok(r#"{"status":"ok"}"#.to_owned()),
            Err(TransportError::Unreachable("refused".to_owned())),
        ]);

        set(&transport, &CREDENTIALS, &conn, &[1, 2], true).unwrap_err();

        assert_eq!(
            keys(&conn),
            vec![plays::match_key("Nachtmystium", "Every Last Drop")]
        );
    }

    #[test]
    fn nothing_is_sent_without_an_account() {
        let (_dir, conn) = library("Nachtmystium", "Every Last Drop");
        auth::forget_session(&conn).unwrap();
        let transport = FakeTransport::scripted(Vec::new());

        set(&transport, &CREDENTIALS, &conn, &[1], true).unwrap_err();

        assert_eq!(transport.call_count(), 0);
    }

    #[test]
    fn a_track_the_library_no_longer_has_is_skipped_rather_than_refused() {
        let (_dir, conn) = library("Nachtmystium", "Every Last Drop");
        let transport = FakeTransport::always(r#"{"status":"ok"}"#);

        set(&transport, &CREDENTIALS, &conn, &[1, 404], true).unwrap();

        assert_eq!(transport.call_count(), 1);
    }
}
