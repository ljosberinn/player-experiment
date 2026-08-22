//! The `covers` table: artwork bytes, deduplicated by hash, and the palette
//! extracted from them.
//!
//! One place rather than two. The scanner and the tag writer both store
//! artwork, both did it with the same two-line `INSERT OR IGNORE`, and phase
//! 39 gave that insert a second job - so the duplicate became worth naming.

use rusqlite::{Connection, OptionalExtension};

use crate::error::AppResult;
use crate::model::Colour;
use crate::tags::Cover;

/// Stores a cover if it is new, and gives it a palette if it has none.
///
/// Returns the hash, which is what a track row points at.
///
/// The two halves are separate on purpose. `INSERT OR IGNORE` leaves an
/// existing row alone - that is what makes the table a deduplicating store -
/// so a cover already present would never gain a palette that way. The
/// conditional update is what closes that: a cover stored before the column
/// existed, or one whose extraction failed on an earlier build, gets another
/// look the next time something sees it. A cover that already has one is not
/// decoded again, which is the whole point of caching it here.
pub fn store(conn: &Connection, cover: &Cover) -> AppResult<String> {
    conn.execute(
        "INSERT OR IGNORE INTO covers (hash, mime, bytes) VALUES (?1, ?2, ?3)",
        rusqlite::params![cover.hash, cover.mime, cover.bytes],
    )?;

    let known: Option<String> = conn
        .query_row(
            "SELECT palette FROM covers WHERE hash = ?1",
            [&cover.hash],
            |row| row.get(0),
        )
        .optional()?
        .flatten();

    if known.is_none() {
        // An undecodable cover writes nothing, so it is retried the next time
        // rather than remembered as having no colours. Retrying a broken JPEG
        // once per scan is cheaper than a sentinel value everything reading
        // this column would have to know about.
        if let Some(colours) = crate::palette::extract(&cover.bytes) {
            conn.execute(
                "UPDATE covers SET palette = ?2 WHERE hash = ?1",
                rusqlite::params![cover.hash, encode(&colours)],
            )?;
        }
    }

    Ok(cover.hash.clone())
}

/// The stored palette for a cover, if it has one.
///
/// A missing row, a null column and a value this build cannot parse all come
/// back as `None`: downstream they mean the same thing, which is a background
/// with no blobs in it.
pub fn palette(conn: &Connection, hash: &str) -> AppResult<Option<Vec<Colour>>> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT palette FROM covers WHERE hash = ?1",
            [hash],
            |row| row.get(0),
        )
        .optional()?
        .flatten();

    Ok(stored.as_deref().and_then(decode))
}

fn encode(colours: &[Colour]) -> String {
    // Infallible in practice - a Vec of three-field structs of integers - but
    // an unwrap in a scan is a panic in a scan.
    serde_json::to_string(colours).unwrap_or_else(|_| "null".to_owned())
}

fn decode(stored: &str) -> Option<Vec<Colour>> {
    serde_json::from_str(stored).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn conn() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    /// A one-row PNG of `colours`, which is what a real cover reduces to.
    fn png(colours: &[[u8; 3]]) -> Vec<u8> {
        let mut buffer = image::RgbImage::new(colours.len() as u32, 1);
        for (x, colour) in colours.iter().enumerate() {
            buffer.put_pixel(x as u32, 0, image::Rgb(*colour));
        }
        let mut encoded = Vec::new();
        image::DynamicImage::ImageRgb8(buffer)
            .write_to(
                &mut std::io::Cursor::new(&mut encoded),
                image::ImageFormat::Png,
            )
            .unwrap();
        encoded
    }

    fn cover(hash: &str, bytes: Vec<u8>) -> Cover {
        Cover {
            hash: hash.to_owned(),
            mime: "image/png".to_owned(),
            bytes,
        }
    }

    #[test]
    fn storing_a_cover_extracts_its_palette() {
        let (_dir, conn) = conn();
        let art = cover("a", png(&[[255, 0, 0], [0, 255, 0], [0, 0, 255]]));

        assert_eq!(store(&conn, &art).unwrap(), "a");

        let found = palette(&conn, "a").unwrap().unwrap();
        assert_eq!(found.len(), 3);
    }

    #[test]
    fn a_cover_already_carrying_a_palette_is_not_decoded_again() {
        let (_dir, conn) = conn();
        let art = cover("a", png(&[[255, 0, 0], [0, 255, 0], [0, 0, 255]]));
        store(&conn, &art).unwrap();

        // Stand in for a previous extraction with a value the extractor could
        // not have produced from these pixels. If the second store re-decoded,
        // this would be gone.
        conn.execute(
            "UPDATE covers SET palette = ?1 WHERE hash = 'a'",
            [r#"[{"r":1,"g":2,"b":3}]"#],
        )
        .unwrap();

        store(&conn, &art).unwrap();

        assert_eq!(
            palette(&conn, "a").unwrap().unwrap(),
            vec![Colour { r: 1, g: 2, b: 3 }]
        );
    }

    #[test]
    fn a_cover_stored_without_a_palette_gains_one_the_next_time_it_is_seen() {
        let (_dir, conn) = conn();
        // Exactly the shape a database from before migration 6 is in: bytes
        // present, palette null.
        let art = cover("a", png(&[[10, 20, 30], [200, 210, 220]]));
        conn.execute(
            "INSERT INTO covers (hash, mime, bytes) VALUES ('a', 'image/png', ?1)",
            [&art.bytes],
        )
        .unwrap();
        assert!(palette(&conn, "a").unwrap().is_none());

        store(&conn, &art).unwrap();

        assert!(palette(&conn, "a").unwrap().is_some());
    }

    #[test]
    fn a_cover_that_will_not_decode_is_stored_anyway() {
        let (_dir, conn) = conn();
        let art = cover("a", b"not an image".to_vec());

        assert_eq!(store(&conn, &art).unwrap(), "a");

        // The bytes are kept - `cover://` serves them, and a reader that
        // handles a format we do not may yet make sense of them - but there
        // are no colours, and nothing was written that would stop a later
        // build from trying again.
        let bytes: Vec<u8> = conn
            .query_row("SELECT bytes FROM covers WHERE hash = 'a'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(bytes, b"not an image");
        assert!(palette(&conn, "a").unwrap().is_none());
    }

    #[test]
    fn an_unknown_hash_and_an_unparseable_palette_both_read_as_absent() {
        let (_dir, conn) = conn();
        assert!(palette(&conn, "nothing here").unwrap().is_none());

        conn.execute(
            "INSERT INTO covers (hash, mime, bytes, palette)
             VALUES ('a', 'image/png', x'00', 'not json')",
            [],
        )
        .unwrap();
        assert!(palette(&conn, "a").unwrap().is_none());
    }

    #[test]
    fn the_palette_round_trips_through_the_column() {
        let (_dir, conn) = conn();
        let colours = vec![
            Colour {
                r: 64,
                g: 64,
                b: 64,
            },
            Colour {
                r: 112,
                g: 96,
                b: 96,
            },
            Colour {
                r: 224,
                g: 224,
                b: 224,
            },
        ];

        conn.execute(
            "INSERT INTO covers (hash, mime, bytes, palette)
             VALUES ('a', 'image/png', x'00', ?1)",
            [encode(&colours)],
        )
        .unwrap();

        assert_eq!(palette(&conn, "a").unwrap().unwrap(), colours);
    }
}
