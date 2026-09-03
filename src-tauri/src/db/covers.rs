//! The `covers` table: artwork bytes, deduplicated by hash, and the palette
//! extracted from them.
//!
//! One place rather than two. The scanner and the tag writer both store
//! artwork, both did it with the same two-line `INSERT OR IGNORE`, and phase
//! 39 gave that insert a second job - so the duplicate became worth naming.
//! Phase 72 gave it a third: everything stored here is re-encoded first, so
//! this is also the one place that decides what a cover costs.

use image::ImageEncoder;
use rusqlite::{Connection, OptionalExtension};

use crate::db::settings;
use crate::error::AppResult;
use crate::model::Colour;
use crate::tags::Cover;

/// The longest edge stored artwork is reduced to.
///
/// The largest place a cover is drawn is the browse grid's tile at 158 CSS px;
/// `MAX_ZOOM` is 2 and Windows display scaling stacks on top of that, so
/// roughly 474 device pixels at the very top end. It is also exactly Cover Art
/// Archive's `-500` size, so a cover fetched from there needs no resample.
const MAX_EDGE: u32 = 500;

/// Quality of the re-encode. Measured over a real library's 5,799 covers:
/// 1,093 MB of artwork becomes 208 MB, at a difference nothing at cover size
/// can see.
const QUALITY: u8 = 85;

/// Stores a cover if it is new, and gives it a palette if it has none.
///
/// Returns **the hash of the bytes that arrived**, which is what a track row
/// points at - not the hash of what is stored, which normalizing changes. That
/// is the trade that keeps this cheap: a hash already in the table returns
/// without decoding anything, so a first scan decodes 5,799 covers rather than
/// the 55,781 tracks that share them, and `tracks.cover_hash` and the backfill
/// both keep pointing at what they already point at. The column
/// stops describing its own bytes, which is the whole cost.
///
/// The two paths are separate on purpose. A new cover is normalized and gets
/// its palette out of the decode that normalizing already did. An existing one
/// is left alone except for a null palette: a cover stored before the column
/// existed, or one whose extraction failed on an earlier build, gets another
/// look the next time something sees it.
pub fn store(conn: &Connection, cover: &Cover) -> AppResult<String> {
    let stored: Option<Option<String>> = conn
        .query_row(
            "SELECT palette FROM covers WHERE hash = ?1",
            [&cover.hash],
            |row| row.get(0),
        )
        .optional()?;

    match stored {
        Some(Some(_)) => {}
        Some(None) => {
            // An undecodable cover writes nothing, so it is retried the next
            // time rather than remembered as having no colours. Retrying a
            // broken JPEG once per scan is cheaper than a sentinel value
            // everything reading this column would have to know about.
            if let Some(colours) = crate::palette::extract(&cover.bytes) {
                conn.execute(
                    "UPDATE covers SET palette = ?2 WHERE hash = ?1",
                    rusqlite::params![cover.hash, encode(&colours)],
                )?;
            }
        }
        None => {
            let normalized = normalize(&cover.mime, &cover.bytes);
            // OR IGNORE because two connections can reach here with the same
            // artwork; the row that wins is the same picture either way.
            conn.execute(
                "INSERT OR IGNORE INTO covers (hash, mime, bytes, palette)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    cover.hash,
                    normalized.mime,
                    normalized.bytes,
                    normalized.palette.as_deref().map(encode)
                ],
            )?;
        }
    }

    Ok(cover.hash.clone())
}

/// What one cover is worth storing, once it has been decoded.
struct Normalized {
    mime: String,
    bytes: Vec<u8>,
    palette: Option<Vec<Colour>>,
}

/// Artwork at the size the app actually draws it, as a JPEG.
///
/// **The re-encode is the lever, not the resize.** Four rows in five of a real
/// library are already inside [`MAX_EDGE`] and still account for half the
/// bytes, because they are PNGs of a photograph; a downscale-only pass would
/// leave most of the problem in place.
///
/// Two things come back exactly as they arrived: art that will not decode -
/// [`crate::db::query::cover_bytes`] still serves it, and a reader that
/// handles a format this build does not may yet make sense of it - and art the
/// re-encode would *grow*, which is 681 of those 5,799 rows and 4.6 MB against
/// 885 MB saved. That second case is what makes "stored art is never larger
/// than what the file carries" true.
fn normalize(mime: &str, bytes: &[u8]) -> Normalized {
    let verbatim = |palette| Normalized {
        mime: mime.to_owned(),
        bytes: bytes.to_vec(),
        palette,
    };

    let Ok(decoded) = image::load_from_memory(bytes) else {
        return verbatim(None);
    };
    // Off the image already in hand, and before the resize: the colours are
    // the picture's, not the thumbnail's.
    let palette = crate::palette::of_image(&decoded);

    // Downscale only - `resize` fits inside the box and preserves the aspect
    // ratio, but would enlarge a cover smaller than it.
    let fitted = if decoded.width() > MAX_EDGE || decoded.height() > MAX_EDGE {
        decoded.resize(
            MAX_EDGE,
            MAX_EDGE,
            // Lanczos3 over Triangle: 6 MB larger across the library and a
            // millisecond a cover slower, on the one image the user looks at.
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        decoded
    };

    match encode_jpeg(&fitted) {
        Some(encoded) if encoded.len() < bytes.len() => Normalized {
            mime: "image/jpeg".to_owned(),
            bytes: encoded,
            palette,
        },
        _ => verbatim(palette),
    }
}

fn encode_jpeg(image: &image::DynamicImage) -> Option<Vec<u8>> {
    // JPEG has no alpha channel, so one is dropped rather than composited.
    // Artwork with transparency is vanishingly rare and a cover is drawn on an
    // opaque square either way.
    let rgb = image.to_rgb8();
    let mut encoded = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, QUALITY)
        .write_image(
            &rgb,
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .ok()?;
    Some(encoded)
}

/// How many covers one transaction of the backfill writes.
///
/// The decoding happens outside it, one cover at a time; this is only how long
/// a scan or a tag write can be behind the writer.
const CHUNK: usize = 50;

/// Puts every cover stored by an earlier build through [`normalize`], then
/// prunes what nothing points at and reclaims the pages.
///
/// **A background thread, not a migration** - see [`settings::COVERS_NORMALIZED`].
/// Silent throughout: the picture the user sees does not change, so there is
/// nothing to report and no `library://changed`.
///
/// Palettes are left alone. q85 does not move three dominant colours, and a
/// row that has none is a row that would not decode.
///
/// The prune is only safe because nothing reads artwork back out of here at
/// all - the bytes go to the window and nowhere else. It is worth little today
/// and is about what comes next: a removal orphans a row, and a release lookup
/// fetches thousands of covers. VACUUM is what actually shrinks the file; the
/// 885 MB the re-encode frees is merely free pages until it runs.
///
/// Answers whether there was anything to do, which is false on every launch
/// after the one that finished the pass: a caller that logged it either way
/// would write a line per launch saying nothing happened.
pub fn normalize_stored(conn: &mut Connection) -> AppResult<bool> {
    if settings::get(conn, settings::COVERS_NORMALIZED)?.is_some() {
        return Ok(false);
    }

    let mut cursor = settings::get(conn, settings::COVERS_NORMALIZED_THROUGH)?.unwrap_or_default();

    loop {
        let hashes: Vec<String> = conn
            .prepare("SELECT hash FROM covers WHERE hash > ?1 ORDER BY hash LIMIT ?2")?
            .query_map(rusqlite::params![cursor, CHUNK as i64], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let Some(last) = hashes.last().cloned() else {
            break;
        };

        // A hash at a time rather than the whole chunk at once: a cover can be
        // 10 MB, and fifty of those in hand to save fifty statements is a bad
        // trade in a thread that runs beside a player.
        let mut smaller = Vec::new();
        for hash in &hashes {
            let (mime, bytes): (String, Vec<u8>) = conn.query_row(
                "SELECT mime, bytes FROM covers WHERE hash = ?1",
                [hash],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let normalized = normalize(&mime, &bytes);
            if normalized.bytes != bytes {
                smaller.push((hash.clone(), normalized));
            }
        }

        let tx = conn.transaction()?;
        for (hash, normalized) in &smaller {
            tx.execute(
                "UPDATE covers SET mime = ?2, bytes = ?3 WHERE hash = ?1",
                rusqlite::params![hash, normalized.mime, normalized.bytes],
            )?;
        }
        // In the same transaction as the rows it describes, or a crash between
        // the two would skip them.
        settings::set(&tx, settings::COVERS_NORMALIZED_THROUGH, &last)?;
        tx.commit()?;

        cursor = last;
    }

    conn.execute(
        "DELETE FROM covers
         WHERE hash NOT IN (SELECT cover_hash FROM tracks WHERE cover_hash IS NOT NULL)",
        [],
    )?;
    // Cannot run inside a transaction, and rewrites the whole file - which is
    // the point.
    conn.execute_batch("VACUUM")?;
    settings::set(conn, settings::COVERS_NORMALIZED, "true")?;

    Ok(true)
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

    /// A row as a build before this one left it: the file's own bytes, stored
    /// whole.
    fn stored_as_it_was(conn: &Connection, hash: &str, bytes: &[u8]) {
        conn.execute(
            "INSERT INTO covers (hash, mime, bytes) VALUES (?1, 'image/png', ?2)",
            rusqlite::params![hash, bytes],
        )
        .unwrap();
    }

    /// A track pointing at a cover, so the prune has a reason to keep it.
    fn referenced_by_a_track(conn: &Connection, hash: &str) {
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, added_at, cover_hash)
             VALUES (?1, 1, 2, 3, ?2)",
            rusqlite::params![format!("/m/{hash}.mp3"), hash],
        )
        .unwrap();
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

    /// A PNG the shape of a real cover: enough colour variation that it does
    /// not compress to nothing, which is what makes a re-encode a saving.
    fn photo_png(width: u32, height: u32) -> Vec<u8> {
        let mut buffer = image::RgbImage::new(width, height);
        for (x, y, pixel) in buffer.enumerate_pixels_mut() {
            *pixel = image::Rgb([
                (x * 7 % 256) as u8,
                (y * 13 % 256) as u8,
                ((x + y) * 3 % 256) as u8,
            ]);
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

    fn row(conn: &Connection, hash: &str) -> (String, Vec<u8>) {
        conn.query_row(
            "SELECT mime, bytes FROM covers WHERE hash = ?1",
            [hash],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    #[test]
    fn a_cover_wider_than_the_box_is_stored_as_a_jpeg_that_fits_it() {
        let (_dir, conn) = conn();
        let source = photo_png(1200, 600);
        let art = cover("a", source.clone());

        // Under the hash of the bytes that arrived, not of the bytes stored.
        assert_eq!(store(&conn, &art).unwrap(), "a");

        let (mime, bytes) = row(&conn, "a");
        assert_eq!(mime, "image/jpeg");
        assert!(
            bytes.len() < source.len(),
            "re-encode did not save anything"
        );
        let stored = image::load_from_memory(&bytes).unwrap();
        assert_eq!((stored.width(), stored.height()), (500, 250));
    }

    #[test]
    fn a_cover_already_within_the_box_is_re_encoded_at_its_own_size() {
        let (_dir, conn) = conn();
        let source = photo_png(300, 300);

        store(&conn, &cover("a", source.clone())).unwrap();

        let (mime, bytes) = row(&conn, "a");
        assert_eq!(mime, "image/jpeg");
        assert!(bytes.len() < source.len());
        let stored = image::load_from_memory(&bytes).unwrap();
        assert_eq!((stored.width(), stored.height()), (300, 300));
    }

    #[test]
    fn a_cover_the_re_encode_would_grow_is_stored_as_it_arrived() {
        let (_dir, conn) = conn();
        // Three flat pixels: PNG's best case and JPEG's worst.
        let source = png(&[[10, 20, 30], [10, 20, 30], [10, 20, 30]]);

        store(&conn, &cover("a", source.clone())).unwrap();

        let (mime, bytes) = row(&conn, "a");
        assert_eq!(bytes, source, "stored art is larger than the file's own");
        assert_eq!(mime, "image/png");
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
        // Exactly the shape a database from before migration 5 is in: bytes
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

    #[test]
    fn the_backfill_re_encodes_what_is_already_stored_and_records_that_it_is_done() {
        let (_dir, mut conn) = conn();
        let source = photo_png(1200, 600);
        stored_as_it_was(&conn, "a", &source);
        referenced_by_a_track(&conn, "a");

        normalize_stored(&mut conn).unwrap();

        let (mime, bytes) = row(&conn, "a");
        assert_eq!(mime, "image/jpeg");
        assert!(bytes.len() < source.len());
        assert_eq!(
            crate::db::settings::get(&conn, crate::db::settings::COVERS_NORMALIZED).unwrap(),
            Some("true".to_owned())
        );
    }

    #[test]
    fn the_backfill_resumes_from_its_cursor_rather_than_from_the_start() {
        let (_dir, mut conn) = conn();
        let source = photo_png(1200, 600);
        for hash in ["a", "b"] {
            stored_as_it_was(&conn, hash, &source);
            referenced_by_a_track(&conn, hash);
        }
        // Where a run cut short by a quit left off.
        crate::db::settings::set(&conn, crate::db::settings::COVERS_NORMALIZED_THROUGH, "a")
            .unwrap();

        normalize_stored(&mut conn).unwrap();

        assert_eq!(
            row(&conn, "a").1,
            source,
            "re-encoded a row it had finished"
        );
        assert_eq!(row(&conn, "b").0, "image/jpeg");
    }

    #[test]
    fn the_backfill_leaves_palettes_and_undecodable_rows_alone() {
        let (_dir, mut conn) = conn();
        stored_as_it_was(&conn, "a", &photo_png(1200, 600));
        referenced_by_a_track(&conn, "a");
        conn.execute(
            "UPDATE covers SET palette = ?1 WHERE hash = 'a'",
            [r#"[{"r":1,"g":2,"b":3}]"#],
        )
        .unwrap();
        stored_as_it_was(&conn, "b", b"not an image");
        referenced_by_a_track(&conn, "b");

        normalize_stored(&mut conn).unwrap();

        assert_eq!(
            palette(&conn, "a").unwrap().unwrap(),
            vec![Colour { r: 1, g: 2, b: 3 }]
        );
        assert_eq!(row(&conn, "b").1, b"not an image");
        assert!(palette(&conn, "b").unwrap().is_none());
    }

    #[test]
    fn the_backfill_is_a_no_op_once_the_flag_is_set() {
        let (_dir, mut conn) = conn();
        crate::db::settings::set(&conn, crate::db::settings::COVERS_NORMALIZED, "true").unwrap();
        let source = photo_png(1200, 600);
        stored_as_it_was(&conn, "a", &source);
        referenced_by_a_track(&conn, "a");

        normalize_stored(&mut conn).unwrap();

        assert_eq!(row(&conn, "a").1, source);
    }

    #[test]
    fn the_backfill_drops_a_cover_no_track_references() {
        let (_dir, mut conn) = conn();
        stored_as_it_was(&conn, "kept", &photo_png(60, 60));
        referenced_by_a_track(&conn, "kept");
        stored_as_it_was(&conn, "orphan", &photo_png(60, 60));

        normalize_stored(&mut conn).unwrap();

        let remaining: Vec<String> = conn
            .prepare("SELECT hash FROM covers ORDER BY hash")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(remaining, ["kept"]);
    }
}
