//! Files lofty refuses over one tag item: read through the salvage view, saved
//! with an edit, and read back.

mod fixture;

use std::path::{Path, PathBuf};

use apex_lib::db::Db;
use apex_lib::model::TagEdit;
use apex_lib::scan::{self, Remark};
use apex_lib::tags::{self, salvage::Salvaged, write};

struct Harness {
    _dir: tempfile::TempDir,
    music: PathBuf,
    db: Db,
}

fn harness() -> Harness {
    let dir = tempfile::tempdir().expect("tempdir");
    let music = dir.path().join("music");
    std::fs::create_dir_all(&music).unwrap();
    let db = Db::open(dir.path().join("library.sqlite3")).expect("open db");
    scan::add_watch_folder(&db.conn().unwrap(), &music).expect("add watch folder");
    Harness {
        _dir: dir,
        music,
        db,
    }
}

/// Scans, insisting every file lands, and returns what was salvaged.
fn scan_salvaged(h: &Harness) -> Vec<Salvaged> {
    let mut salvaged = Vec::new();
    let summary = scan::scan(
        &mut h.db.conn().unwrap(),
        |_| {},
        |remark| match remark {
            Remark::Salvaged(_, found) => salvaged.push(found.clone()),
            Remark::Unreadable(error) => panic!("unreadable: {error}"),
        },
    )
    .unwrap();
    assert_eq!(summary.unreadable, 0);
    salvaged
}

fn only_track(h: &Harness) -> i64 {
    h.db.conn()
        .unwrap()
        .query_row("SELECT id FROM tracks", [], |row| row.get(0))
        .unwrap()
}

fn save(h: &Harness, edit: TagEdit) {
    let written =
        write::apply_to_each(&mut h.db.conn().unwrap(), &[only_track(h)], &edit, |_| {}).unwrap();
    assert_eq!(written.summary.failed, 0, "{:?}", written.summary.errors);
}

fn genre(value: &str) -> TagEdit {
    TagEdit {
        genre: Some(value.to_owned()),
        ..TagEdit::default()
    }
}

fn body_of(path: &Path, id: &str) -> Option<Vec<u8>> {
    fixture::raw_frames(path)
        .into_iter()
        .find(|(frame, _)| frame == id)
        .map(|(_, body)| body)
}

/// UTF-16 with its BOM, as ID3v2.3 encoding 1 writes it.
fn utf16(value: &str) -> Vec<u8> {
    let mut bytes = vec![1u8, 0xFF, 0xFE];
    bytes.extend(value.encode_utf16().flat_map(u16::to_le_bytes));
    bytes
}

#[test]
fn a_frame_lofty_refuses_is_hidden_and_saved_back_as_it_was() {
    // A row per kind seen in the wild: odd UTF-16, a COMM with UTF-16 where
    // its language goes, a lone surrogate, and a body too short to decode.
    let refused: [(&str, Vec<u8>); 5] = [
        ("TALB", vec![1, 0xFF, 0xFE, 0xFE]),
        (
            "COMM",
            [&[1u8][..], &utf16("eng")[1..], &utf16("text")[1..]].concat(),
        ),
        ("TOPE", vec![1, 0xFF, 0xFE, 0x00, 0xD8, 0x41, 0x00]),
        ("POPM", b"x".to_vec()),
        ("RVA2", vec![0x00, 0x01]),
    ];
    for (id, body) in refused {
        let h = harness();
        let path = h.music.join("track.mp3");
        let frames = [
            fixture::v3_text_frame("TIT2", "Song"),
            fixture::v3_frame(id, &body),
        ];
        fixture::write_v3_mp3(&path, 10, &frames, b"");
        assert!(tags::read(&path).is_ok(), "{id}: not salvaged");

        let salvaged = scan_salvaged(&h);
        assert_eq!(salvaged.len(), 1, "{id}");
        assert_eq!(salvaged[0].hidden, [id], "{id}");

        save(&h, genre("Ambient"));
        let read = tags::read(&path).unwrap();
        assert_eq!(read.title.as_deref(), Some("Song"), "{id}");
        assert_eq!(read.genre.as_deref(), Some("Ambient"), "{id}");
        assert_eq!(body_of(&path, id), Some(body), "{id}: the kept bytes");
    }
}

#[test]
fn an_edit_of_a_hidden_field_replaces_the_kept_frame() {
    let h = harness();
    let path = h.music.join("track.mp3");
    let frames = [
        fixture::v3_text_frame("TIT2", "Song"),
        fixture::v3_frame("TALB", &[1, 0xFF, 0xFE, 0xFE]),
    ];
    fixture::write_v3_mp3(&path, 10, &frames, b"");
    scan_salvaged(&h);

    save(
        &h,
        TagEdit {
            album: Some("Tokyo".to_owned()),
            ..TagEdit::default()
        },
    );

    let read = tags::read(&path).unwrap();
    assert_eq!(read.album.as_deref(), Some("Tokyo"));
    assert_eq!(read.salvaged, None, "nothing left to hide");
}

#[test]
fn a_stray_byte_after_a_utf16_value_is_dropped_and_the_value_read() {
    let h = harness();
    let path = h.music.join("track.mp3");
    let mut album = utf16("Tokyo");
    album.push(0);
    let frames = [
        fixture::v3_text_frame("TIT2", "Song"),
        fixture::v3_frame("TALB", &album),
    ];
    fixture::write_v3_mp3(&path, 10, &frames, b"");

    let salvaged = scan_salvaged(&h);
    assert_eq!(salvaged[0].fixed, ["TALB"]);
    assert!(salvaged[0].hidden.is_empty());
    assert_eq!(tags::read(&path).unwrap().album.as_deref(), Some("Tokyo"));

    save(&h, genre("Ambient"));
    let read = tags::read(&path).unwrap();
    assert_eq!(read.album.as_deref(), Some("Tokyo"));
    assert_eq!(read.salvaged, None, "the save wrote it clean");
}

#[test]
fn a_year_with_a_second_one_after_a_nul_reads_as_the_first() {
    let h = harness();
    let path = h.music.join("track.mp3");
    let frames = [
        fixture::v3_text_frame("TIT2", "Song"),
        fixture::v3_frame("TYER", b"\x002014\x002014"),
    ];
    fixture::write_v3_mp3(&path, 10, &frames, b"");

    let salvaged = scan_salvaged(&h);
    assert_eq!(salvaged[0].fixed, ["TYER"]);
    assert_eq!(tags::read(&path).unwrap().year, Some(2014));

    save(&h, genre("Ambient"));
    let read = tags::read(&path).unwrap();
    assert_eq!(read.year, Some(2014));
    assert_eq!(read.salvaged, None);
}

#[test]
fn an_ape_item_that_is_not_utf8_hides_the_ape_tag_and_nothing_else() {
    let h = harness();
    let path = h.music.join("track.mp3");
    let plain = h.music.join("plain.mp3");
    let frames = [fixture::v3_text_frame("TIT2", "Song")];
    let ape = fixture::ape_tag("Publisher", b"Les Cr\xE9ations Clandestines");
    fixture::write_v3_mp3(&path, 40, &frames, &ape);
    fixture::write_v3_mp3(&plain, 40, &frames, b"");

    let salvaged = scan_salvaged(&h);
    assert!(salvaged.iter().any(|found| found.ape), "{salvaged:?}");
    let read = tags::read(&path).unwrap();
    assert_eq!(read.title.as_deref(), Some("Song"));
    assert_eq!(
        read.duration_ms,
        tags::read(&plain).unwrap().duration_ms,
        "the APE tag is not audio"
    );

    let id: i64 =
        h.db.conn()
            .unwrap()
            .query_row(
                "SELECT id FROM tracks WHERE path = ?1",
                [path.to_string_lossy()],
                |row| row.get(0),
            )
            .unwrap();
    let written =
        write::apply_to_each(&mut h.db.conn().unwrap(), &[id], &genre("Ambient"), |_| {}).unwrap();
    assert_eq!(written.summary.failed, 0, "{:?}", written.summary.errors);

    assert_eq!(tags::read(&path).unwrap().genre.as_deref(), Some("Ambient"));
    assert!(
        std::fs::read(&path).unwrap().ends_with(&ape),
        "the APE tag is kept byte for byte"
    );
}

#[test]
fn a_bare_url_frame_no_longer_hides_the_file() {
    let h = harness();
    let path = h.music.join("track.mp3");
    fixture::write_mp3_with_bare_url(&path, 10, "https://www.discogs.com/release/1");

    assert_eq!(scan_salvaged(&h)[0].hidden, ["WXXX"]);
}
