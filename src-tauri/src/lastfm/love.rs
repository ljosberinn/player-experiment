//! Loving a track, and keeping the loved set in step with last.fm.
//!
//! **The love is kept here first.** [`crate::db::loved`] is the set, on every
//! build and with no account; a love never waits on the network and is never
//! taken back because a call failed.
//!
//! **A connected account mirrors it through `love_queue`.** `track.love` and
//! `track.unlove` are signed session-key calls with no batch form, so each
//! song is one row holding the user's latest word on it, drained by
//! [`super::Service::flush`] beside the scrobbles and with their backoff.
//! Unlike a scrobble a love has no timestamp to expire, so nothing here ages
//! out; a row that keeps failing is dropped after the same dozen attempts.
//!
//! **last.fm's own set comes back through [`absorb`]**, which is three-way:
//! see [`crate::db::loved::mirror`].

use std::collections::BTreeSet;

use rusqlite::{params, Connection};

use crate::db::{loved, playback, plays, settings};
use crate::error::{AppError, AppResult};

use super::{auth, queue, signed, Credentials};

/// One song, as both last.fm and the local set need it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Song {
    pub artist: String,
    pub title: String,
    /// [`plays::match_key`] over this song's own artist and title - the same
    /// function the import reduces last.fm's loved list with, so the two
    /// agree by construction.
    pub key: String,
}

/// One queued love or unlove.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Queued {
    pub song: Song,
    pub loved: bool,
}

/// Loves or unloves every track in `track_ids`, answering whether anything
/// was queued for last.fm.
///
/// Queued only with `connected`: with no account there is nobody to tell,
/// and connecting one later pushes what it lacks once - see [`absorb`].
///
/// **Refused whole** when a track carries no artist or no title:
/// [`plays::match_key`] has no key for it, so the love could never be
/// remembered. The control is disabled for such a track; this is the guard
/// behind it.
pub fn set(
    conn: &mut Connection,
    track_ids: &[i64],
    loved: bool,
    connected: bool,
) -> AppResult<bool> {
    let songs = songs(conn, track_ids)?;
    let keys: Vec<String> = songs.iter().map(|song| song.key.clone()).collect();

    let tx = conn.transaction()?;
    if loved {
        loved::remember(&tx, &keys)?;
    } else {
        loved::forget(&tx, &keys)?;
    }
    if connected {
        for song in &songs {
            enqueue(&tx, song, loved)?;
        }
    }
    tx.commit()?;
    Ok(connected && !songs.is_empty())
}

/// The songs behind the ids, or the reason none of them can be loved.
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
                "A song needs both an artist and a title before it can be loved.".to_owned(),
            ));
        }
        songs.push(Song { artist, title, key });
    }
    Ok(songs)
}

/// Queues `song`, replacing whatever was queued for it.
///
/// The attempts start over: a love after a failed unlove is a new request,
/// not a retry of the old one.
fn enqueue(conn: &Connection, song: &Song, loved: bool) -> AppResult<()> {
    conn.execute(
        "INSERT INTO love_queue (match_key, artist, title, loved) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(match_key) DO UPDATE SET
             artist = excluded.artist, title = excluded.title, loved = excluded.loved,
             attempts = 0, next_try_at = 0",
        params![song.key, song.artist, song.title, loved],
    )?;
    Ok(())
}

/// What is due to be sent, oldest intent first.
pub fn due(conn: &Connection, now: i64) -> AppResult<Vec<Queued>> {
    let mut statement = conn.prepare(
        "SELECT match_key, artist, title, loved FROM love_queue
          WHERE next_try_at <= ?1 ORDER BY next_try_at, match_key",
    )?;
    let rows = statement
        .query_map([now], |row| {
            Ok(Queued {
                song: Song {
                    key: row.get(0)?,
                    artist: row.get(1)?,
                    title: row.get(2)?,
                },
                loved: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Forgets a row once it is delivered or refused for good.
///
/// Only if it still says what was sent: a toggle landing while the call was in
/// flight is a newer intent, and it has not been delivered.
pub fn delivered(conn: &Connection, sent: &Queued) -> AppResult<()> {
    conn.execute(
        "DELETE FROM love_queue WHERE match_key = ?1 AND loved = ?2",
        params![sent.song.key, sent.loved],
    )?;
    Ok(())
}

/// Puts a row back for later, further out each time, or drops it after
/// [`queue::MAX_ATTEMPTS`].
pub fn defer(conn: &Connection, sent: &Queued, now: i64) -> AppResult<()> {
    let attempts: i64 = conn.query_row(
        "SELECT attempts FROM love_queue WHERE match_key = ?1",
        [&sent.song.key],
        |row| row.get(0),
    )?;
    conn.execute(
        "UPDATE love_queue SET attempts = ?2, next_try_at = ?3 WHERE match_key = ?1",
        params![sent.song.key, attempts + 1, now + queue::backoff(attempts)],
    )?;
    conn.execute(
        "DELETE FROM love_queue WHERE attempts >= ?1",
        [queue::MAX_ATTEMPTS],
    )?;
    Ok(())
}

/// How many loves and unloves are waiting for last.fm.
pub fn depth(conn: &Connection) -> AppResult<u32> {
    let count: i64 = conn.query_row("SELECT count(*) FROM love_queue", [], |row| row.get(0))?;
    Ok(count as u32)
}

/// The signed parameters for one queued row.
pub fn params<'a>(
    credentials: &'a Credentials,
    session_key: &str,
    queued: &Queued,
) -> Vec<(&'a str, String)> {
    let method = if queued.loved {
        "track.love"
    } else {
        "track.unlove"
    };
    signed(
        method,
        credentials,
        vec![
            ("artist", queued.song.artist.clone()),
            ("track", queued.song.title.clone()),
            ("sk", session_key.to_owned()),
        ],
    )
}

/// Takes in `username`'s loved tracks, as last.fm reported them.
///
/// **The connected account mirrors** ([`loved::mirror`]). The first time the
/// set meets an account, every key is treated as local and what that account
/// lacks is queued for it - loves made before connecting, or under another
/// account - and [`settings::LOVED_SYNCED_WITH`] remembers the meeting.
///
/// **Any other username only adds.** An import of someone else's history, or
/// one made with no account, has no say over what the user unloved here.
pub fn absorb(conn: &mut Connection, username: &str, reported: &BTreeSet<String>) -> AppResult<()> {
    let tx = conn.transaction()?;
    let connected = auth::stored_session(&tx)?
        .is_some_and(|session| session.username.eq_ignore_ascii_case(username));

    if !connected {
        loved::remember(&tx, &reported.iter().cloned().collect::<Vec<_>>())?;
        tx.commit()?;
        return Ok(());
    }

    let synced = settings::get(&tx, settings::LOVED_SYNCED_WITH)?
        .is_some_and(|synced| synced.eq_ignore_ascii_case(username));
    if !synced {
        loved::disown(&tx)?;
        for key in loved::local(&tx)? {
            if reported.contains(&key) {
                continue;
            }
            // A key no library track carries has no artist and title to send;
            // it stays loved here and goes out if the song arrives and is
            // loved again.
            if let Some((artist, title)) = loved::song(&tx, &key)? {
                enqueue(&tx, &Song { artist, title, key }, true)?;
            }
        }
        settings::set(&tx, settings::LOVED_SYNCED_WITH, username)?;
    }

    loved::mirror(&tx, reported, &pending(&tx)?)?;
    tx.commit()?;
    Ok(())
}

fn pending(conn: &Connection) -> AppResult<BTreeSet<String>> {
    let mut statement = conn.prepare("SELECT match_key FROM love_queue")?;
    let keys = statement
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<BTreeSet<String>>>()?;
    Ok(keys)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    /// A library of one song.
    fn library(artist: &str, title: &str) -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        track(&conn, 1, artist, title);
        (dir, conn)
    }

    fn track(conn: &Connection, id: i64, artist: &str, title: &str) {
        conn.execute(
            "INSERT INTO tracks (id, path, mtime, size, duration_ms, added_at, artist, title, match_key)
             VALUES (?1, ?2, 0, 0, 200000, 0, ?3, ?4, ?5)",
            rusqlite::params![
                id,
                format!("/{id}.mp3"),
                artist,
                title,
                plays::track_key(Some(artist), Some(title))
            ],
        )
        .unwrap();
    }

    fn connect(conn: &Connection, username: &str) {
        auth::store_session(
            conn,
            &auth::Session {
                username: username.to_owned(),
                key: "sk-1".to_owned(),
            },
        )
        .unwrap();
    }

    fn keys(conn: &Connection) -> Vec<String> {
        conn.prepare("SELECT match_key FROM loved ORDER BY match_key")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap()
    }

    fn queued(conn: &Connection) -> Vec<(String, bool)> {
        due(conn, i64::MAX)
            .unwrap()
            .into_iter()
            .map(|row| (row.song.title, row.loved))
            .collect()
    }

    const NOW: i64 = 1_700_000_000;

    #[test]
    fn a_love_is_kept_with_no_account() {
        let (_dir, mut conn) = library("Nachtmystium", "Every Last Drop");

        assert!(!set(&mut conn, &[1], true, false).unwrap());

        assert_eq!(
            keys(&conn),
            vec![plays::match_key("Nachtmystium", "Every Last Drop")]
        );
        assert_eq!(loved::tracks(&conn).unwrap(), vec![1]);
        assert!(queued(&conn).is_empty(), "nobody to tell");
    }

    #[test]
    fn an_unlove_forgets_the_key() {
        let (_dir, mut conn) = library("Nachtmystium", "Every Last Drop");
        set(&mut conn, &[1], true, false).unwrap();

        set(&mut conn, &[1], false, false).unwrap();

        assert!(keys(&conn).is_empty());
    }

    #[test]
    fn a_connected_love_is_queued_as_the_latest_word_on_the_song() {
        let (_dir, mut conn) = library("Nachtmystium", "Every Last Drop");

        assert!(set(&mut conn, &[1], true, true).unwrap());
        set(&mut conn, &[1], false, true).unwrap();

        assert_eq!(queued(&conn), vec![("Every Last Drop".to_owned(), false)]);
        assert_eq!(depth(&conn).unwrap(), 1);
    }

    #[test]
    fn a_song_with_no_artist_is_refused_whole() {
        let (_dir, mut conn) = library("Nachtmystium", "Every Last Drop");
        track(&conn, 2, "", "Holzwege");

        set(&mut conn, &[1, 2], true, true).unwrap_err();

        assert!(keys(&conn).is_empty());
        assert!(queued(&conn).is_empty());
    }

    #[test]
    fn a_track_the_library_no_longer_has_is_skipped_rather_than_refused() {
        let (_dir, mut conn) = library("Nachtmystium", "Every Last Drop");

        set(&mut conn, &[1, 404], true, true).unwrap();

        assert_eq!(queued(&conn).len(), 1);
    }

    #[test]
    fn a_love_goes_out_signed() {
        let queued = Queued {
            song: Song {
                artist: "Nachtmystium".to_owned(),
                title: "Every Last Drop".to_owned(),
                key: String::new(),
            },
            loved: true,
        };
        let credentials = Credentials {
            api_key: "KEY",
            api_secret: "SECRET",
        };

        let sent = params(&credentials, "sk-1", &queued);

        let value = |name: &str| {
            sent.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.clone())
        };
        assert_eq!(value("method").as_deref(), Some("track.love"));
        assert_eq!(value("artist").as_deref(), Some("Nachtmystium"));
        assert_eq!(value("track").as_deref(), Some("Every Last Drop"));
        assert_eq!(value("sk").as_deref(), Some("sk-1"));
        assert_eq!(
            params(
                &credentials,
                "sk-1",
                &Queued {
                    loved: false,
                    ..queued
                }
            )[0]
            .1,
            "track.unlove"
        );
    }

    #[test]
    fn a_delivered_row_goes_unless_a_newer_intent_replaced_it() {
        let (_dir, mut conn) = library("Nachtmystium", "Every Last Drop");
        set(&mut conn, &[1], true, true).unwrap();
        let sent = due(&conn, NOW).unwrap().remove(0);
        // Unloved while the love was in flight.
        set(&mut conn, &[1], false, true).unwrap();

        delivered(&conn, &sent).unwrap();

        assert_eq!(queued(&conn), vec![("Every Last Drop".to_owned(), false)]);
    }

    #[test]
    fn a_deferred_row_waits_the_scrobble_backoff_and_is_dropped_in_the_end() {
        let (_dir, mut conn) = library("Nachtmystium", "Every Last Drop");
        set(&mut conn, &[1], true, true).unwrap();
        let sent = due(&conn, NOW).unwrap().remove(0);

        defer(&conn, &sent, NOW).unwrap();

        assert!(due(&conn, NOW + 59).unwrap().is_empty());
        assert_eq!(due(&conn, NOW + 60).unwrap().len(), 1);

        for _ in 1..queue::MAX_ATTEMPTS {
            defer(&conn, &sent, NOW).unwrap();
        }
        assert_eq!(depth(&conn).unwrap(), 0);
    }

    #[test]
    fn an_import_of_another_account_only_adds() {
        let (_dir, mut conn) = library("Nachtmystium", "Every Last Drop");
        set(&mut conn, &[1], true, false).unwrap();

        absorb(&mut conn, "someone", &BTreeSet::from(["other".to_owned()])).unwrap();

        assert_eq!(
            keys(&conn),
            vec![
                plays::match_key("Nachtmystium", "Every Last Drop"),
                "other".to_owned()
            ]
        );
        assert!(queued(&conn).is_empty());
    }

    #[test]
    fn the_first_sync_pushes_what_the_account_lacks_once() {
        let (_dir, mut conn) = library("Nachtmystium", "Every Last Drop");
        track(&conn, 2, "Marathonmann", "Holzwege");
        set(&mut conn, &[1, 2], true, false).unwrap();
        connect(&conn, "Listener");
        let holzwege = plays::match_key("Marathonmann", "Holzwege");

        absorb(&mut conn, "listener", &BTreeSet::from([holzwege.clone()])).unwrap();

        assert_eq!(queued(&conn), vec![("Every Last Drop".to_owned(), true)]);
        assert_eq!(
            settings::get(&conn, settings::LOVED_SYNCED_WITH)
                .unwrap()
                .as_deref(),
            Some("listener")
        );

        // Delivered, and last.fm keeps it under an autocorrected spelling.
        conn.execute("DELETE FROM love_queue", []).unwrap();
        absorb(
            &mut conn,
            "listener",
            &BTreeSet::from([holzwege, "corrected".to_owned()]),
        )
        .unwrap();

        assert!(queued(&conn).is_empty(), "not pushed a second time");
        assert_eq!(keys(&conn).len(), 3, "and the love made here stays");
    }

    #[test]
    fn a_sync_brings_in_an_unlove_made_elsewhere() {
        let (_dir, mut conn) = library("Nachtmystium", "Every Last Drop");
        connect(&conn, "listener");
        let key = plays::match_key("Nachtmystium", "Every Last Drop");
        absorb(&mut conn, "listener", &BTreeSet::from([key])).unwrap();
        assert_eq!(loved::tracks(&conn).unwrap(), vec![1]);

        absorb(&mut conn, "listener", &BTreeSet::new()).unwrap();

        assert!(loved::tracks(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_change_last_fm_has_not_heard_about_outlasts_a_sync() {
        let (_dir, mut conn) = library("Nachtmystium", "Every Last Drop");
        connect(&conn, "listener");
        let key = plays::match_key("Nachtmystium", "Every Last Drop");
        absorb(&mut conn, "listener", &BTreeSet::from([key.clone()])).unwrap();

        set(&mut conn, &[1], false, true).unwrap();
        absorb(&mut conn, "listener", &BTreeSet::from([key])).unwrap();

        assert!(loved::tracks(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_new_account_is_given_the_loves_the_last_one_reported() {
        let (_dir, mut conn) = library("Nachtmystium", "Every Last Drop");
        connect(&conn, "first");
        let key = plays::match_key("Nachtmystium", "Every Last Drop");
        absorb(&mut conn, "first", &BTreeSet::from([key])).unwrap();

        connect(&conn, "second");
        absorb(&mut conn, "second", &BTreeSet::new()).unwrap();

        assert_eq!(loved::tracks(&conn).unwrap(), vec![1], "not an unlove");
        assert_eq!(queued(&conn), vec![("Every Last Drop".to_owned(), true)]);
    }
}
