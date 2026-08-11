//! Playback against a real library: files on disk, scanned into SQLite, turned
//! into a queue, driven through the engine, and counted back into the database.
//!
//! The output device is faked - CI runners have no sound card - but everything
//! either side of it is the real thing, including decoding the fixture mp3s
//! with the decoder the app ships.

mod fixture;

use std::path::Path;
use std::time::Duration;

use apex_lib::audio::engine::{Command, Engine, Event};
use apex_lib::audio::sink::AudioSink;
use apex_lib::db::{playback, query, Db};
use apex_lib::model::{PlaybackStatus, SortField, TrackQuery};
use apex_lib::scan;

/// Records what it was asked to do and lets a test move the playhead.
#[derive(Default)]
struct TestSink {
    loaded: Option<std::path::PathBuf>,
    position: Duration,
    exhausted: bool,
}

impl AudioSink for TestSink {
    fn load(&mut self, path: &Path) -> Result<(), String> {
        // The real sink would fail here on an undecodable file, so the fake
        // opens it too: a fixture that stopped being valid mp3 must not pass.
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        rodio::Decoder::try_from(file).map_err(|e| format!("{}: {e}", path.display()))?;
        self.loaded = Some(path.to_path_buf());
        self.position = Duration::ZERO;
        self.exhausted = false;
        Ok(())
    }
    fn play(&mut self) {}
    fn pause(&mut self) {}
    fn stop(&mut self) {
        self.loaded = None;
        self.position = Duration::ZERO;
    }
    fn set_volume(&mut self, _volume: f32) {}
    fn seek(&mut self, position: Duration) -> Result<(), String> {
        self.position = position;
        Ok(())
    }
    fn position(&self) -> Duration {
        self.position
    }
    fn finished(&self) -> bool {
        self.loaded.is_none() || self.exhausted
    }
}

struct Harness {
    _dir: tempfile::TempDir,
    db: Db,
}

/// Three scanned tracks, ordered by path.
fn harness() -> Harness {
    let dir = tempfile::tempdir().expect("tempdir");
    let music = dir.path().join("music");
    std::fs::create_dir_all(&music).unwrap();

    for (index, title) in ["One", "Two", "Three"].into_iter().enumerate() {
        fixture::write_mp3(
            &music.join(format!("{index}.mp3")),
            // ~1.3s of audio, so the halfway mark is a real position.
            50,
            &fixture::Meta {
                title: Some(title),
                artist: Some("Fixture Artist"),
                ..Default::default()
            },
        );
    }

    let db = Db::open(dir.path().join("library.sqlite3")).expect("open db");
    let conn = db.conn().unwrap();
    scan::add_watch_folder(&conn, &music).expect("add watch folder");
    drop(conn);

    let mut conn = db.conn().unwrap();
    scan::scan(&mut conn, |_| {}).expect("scan");

    Harness { _dir: dir, db }
}

fn track_ids(db: &Db) -> Vec<i64> {
    let conn = db.conn().unwrap();
    query::all_track_ids(
        &conn,
        &TrackQuery {
            sort_by: SortField::Path,
            ..Default::default()
        },
    )
    .expect("ids")
}

#[test]
fn a_scanned_library_becomes_a_playable_queue() {
    let harness = harness();
    let ids = track_ids(&harness.db);
    assert_eq!(ids.len(), 3);

    let conn = harness.db.conn().unwrap();
    let entries = playback::queue_entries(&conn, &ids).expect("queue");
    assert_eq!(entries.len(), 3);
    // The scanner read a real duration out of each fixture.
    assert!(entries.iter().all(|entry| entry.duration_ms > 0));

    let mut engine = Engine::new(TestSink::default(), 1.0, false);
    engine.handle(Command::SetQueue { entries, index: 0 });

    let state = engine.state();
    assert_eq!(state.status, PlaybackStatus::Playing);
    assert_eq!(state.track_id, Some(ids[0]));
    assert_eq!(state.queue_len, 3);
}

#[test]
fn the_queue_advances_through_the_library_and_then_stops() {
    let harness = harness();
    let ids = track_ids(&harness.db);
    let conn = harness.db.conn().unwrap();
    let entries = playback::queue_entries(&conn, &ids).expect("queue");

    let mut engine = Engine::new(TestSink::default(), 1.0, false);
    engine.handle(Command::SetQueue { entries, index: 0 });

    for expected in &ids[1..] {
        engine.handle(Command::Next);
        assert_eq!(engine.state().track_id, Some(*expected));
    }

    engine.handle(Command::Next);
    assert_eq!(engine.state().status, PlaybackStatus::Stopped);
}

#[test]
fn playing_half_a_track_counts_it_in_the_library() {
    let harness = harness();
    let ids = track_ids(&harness.db);
    let conn = harness.db.conn().unwrap();
    let entries = playback::queue_entries(&conn, &ids).expect("queue");
    let duration_ms = entries[0].duration_ms;

    let mut engine = Engine::new(TestSink::default(), 1.0, false);
    engine.handle(Command::SetQueue { entries, index: 0 });
    engine.handle(Command::Seek {
        position_ms: duration_ms / 2,
    });

    let played: Vec<i64> = engine
        .tick()
        .into_iter()
        .filter_map(|event| match event {
            Event::Played(id) => Some(id),
            _ => None,
        })
        .collect();
    assert_eq!(played, vec![ids[0]]);

    // What the app's event callback does with that event.
    playback::mark_played(&conn, ids[0], 1_700_000_000).expect("mark played");

    let track = playback::track_by_id(&conn, ids[0]).unwrap().unwrap();
    assert_eq!(track.play_count, 1);
    assert_eq!(track.last_played_at, Some(1_700_000_000));
}

#[test]
fn a_snapshot_carries_the_row_the_engine_only_knows_by_id() {
    let harness = harness();
    let ids = track_ids(&harness.db);
    let conn = harness.db.conn().unwrap();
    let entries = playback::queue_entries(&conn, &ids).expect("queue");

    let mut engine = Engine::new(TestSink::default(), 0.4, false);
    engine.handle(Command::SetQueue { entries, index: 1 });

    let snapshot = playback::snapshot(&conn, &engine.state()).expect("snapshot");
    assert_eq!(snapshot.status, PlaybackStatus::Playing);
    assert_eq!(snapshot.volume, 0.4);
    assert_eq!(snapshot.queue_index, Some(1));
    assert_eq!(snapshot.track.map(|track| track.id), Some(ids[1]));
}

#[test]
fn a_track_deleted_since_the_queue_was_built_is_left_out_of_it() {
    let harness = harness();
    let ids = track_ids(&harness.db);
    let conn = harness.db.conn().unwrap();
    conn.execute("DELETE FROM tracks WHERE id = ?1", [ids[1]])
        .unwrap();

    let entries = playback::queue_entries(&conn, &ids).expect("queue");
    assert_eq!(
        entries
            .iter()
            .map(|entry| entry.track_id)
            .collect::<Vec<_>>(),
        vec![ids[0], ids[2]]
    );
}
