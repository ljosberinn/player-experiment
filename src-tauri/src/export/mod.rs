//! JSON export.
//!
//! The shape below is a published contract, not an implementation detail:
//! someone will write a script against it. It is versioned, every field is
//! spelled out, and it is assembled from the same query layer the UI uses so
//! an export of "this playlist" contains exactly what the playlist showed.
//!
//! What it deliberately does **not** contain: artwork, in any form - not the
//! bytes, and not the hash that identifies them. An export is the library's
//! text, and the images stay in the files where they already live. Also
//! excluded: any setting not on the allowlist in [`crate::db::settings`],
//! which is what keeps credentials out.
//!
//! The shape is documented for consumers in `docs/export-schema.md`. Changing
//! anything here means changing that too.

use serde::Serialize;
use ts_rs::TS;

use rusqlite::Connection;

use crate::db::{playlists, query, settings};
use crate::error::AppResult;
use crate::model::{
    FilterGroup, PlaylistKind, SmartOrder, SortDirection, SortField, Track, TrackQuery,
};

/// Bumped only for a breaking change to the shape below.
///
/// Adding a field is not breaking - a reader that ignores unknown keys keeps
/// working - so this changes when something is removed or reinterpreted.
pub const SCHEMA_VERSION: u32 = 1;

/// What to export.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize, TS)]
// `rename_all` renames the variants; the fields inside them need their own
// rule, or `trackIds` arrives as `track_ids` and the command silently sees an
// empty selection.
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum ExportScope {
    /// Every track, every playlist, and the exportable settings.
    Library,
    /// Just the tracks named, with no playlists.
    Selection {
        #[ts(type = "number[]")]
        track_ids: Vec<i64>,
    },
    /// One playlist and the tracks in it, in its own order.
    Playlist {
        #[ts(type = "number")]
        playlist_id: i64,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Export {
    pub schema_version: u32,
    /// Unix seconds, so a reader can tell two exports apart.
    pub exported_at: i64,
    pub generator: Generator,
    pub scope: &'static str,
    pub tracks: Vec<ExportTrack>,
    pub playlists: Vec<ExportPlaylist>,
    /// Only keys on the allowlist; credentials can never appear here.
    pub settings: Vec<ExportSetting>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Generator {
    pub name: String,
    pub version: String,
}

/// A track as exported.
///
/// Field names are camelCase and stable. There is no artwork field of any
/// kind - see the module docs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTrack {
    pub id: i64,
    pub path: String,
    pub duration_ms: i64,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i64>,
    pub track_no: Option<i64>,
    pub disc_no: Option<i64>,
    pub comment: Option<String>,
    pub bitrate: Option<i64>,
    pub sample_rate: Option<i64>,
    pub added_at: i64,
    pub play_count: i64,
    pub last_played_at: Option<i64>,
}

impl From<Track> for ExportTrack {
    fn from(track: Track) -> Self {
        Self {
            id: track.id,
            path: track.path,
            duration_ms: track.duration_ms,
            title: track.title,
            artist: track.artist,
            album: track.album,
            album_artist: track.album_artist,
            genre: track.genre,
            year: track.year,
            track_no: track.track_no,
            disc_no: track.disc_no,
            comment: track.comment,
            bitrate: track.bitrate,
            sample_rate: track.sample_rate,
            added_at: track.added_at,
            play_count: track.play_count,
            last_played_at: track.last_played_at,
        }
    }
}

/// A playlist as exported.
///
/// A static playlist carries its ordered `trackIds`; a smart one carries the
/// `filter` that decides its contents. Exactly one of the two is present,
/// which is what tells a reader which kind it is holding without trusting
/// `kind` alone.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlaylist {
    pub id: i64,
    pub name: String,
    pub kind: &'static str,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_ids: Option<Vec<i64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<FilterGroup>,
    /// A smart playlist's ordering and cutoff, alongside its filter.
    ///
    /// Present only when there is one: a playlist with neither a sort nor a
    /// limit omits the key entirely rather than exporting two nulls, which is
    /// also what keeps every export written before this phase a valid document
    /// under the same schema.
    ///
    /// Without this a "Most Played" would export as its filter alone - `plays
    /// greater than 0` - and read back as every song ever played rather than
    /// the hundred it actually holds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<SmartOrder>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportSetting {
    pub key: String,
    pub value: String,
}

/// Reads everything `scope` covers into one document.
pub fn build(conn: &Connection, scope: &ExportScope, now: i64) -> AppResult<Export> {
    let (tracks, playlists) = match scope {
        ExportScope::Library => (all_tracks(conn, None)?, all_playlists(conn)?),
        ExportScope::Selection { track_ids } => (
            // Through the same lookup the editor uses, so a selection naming
            // a track that has since gone exports what survives.
            crate::db::playback::tracks_by_ids(conn, track_ids)?
                .into_iter()
                .map(ExportTrack::from)
                .collect(),
            Vec::new(),
        ),
        ExportScope::Playlist { playlist_id } => {
            let playlist = playlists::get(conn, *playlist_id)?;
            (
                all_tracks(conn, Some(*playlist_id))?,
                playlist
                    .into_iter()
                    .map(|p| export_playlist(conn, &p))
                    .collect::<AppResult<_>>()?,
            )
        }
    };

    Ok(Export {
        schema_version: SCHEMA_VERSION,
        exported_at: now,
        generator: Generator {
            name: env!("CARGO_PKG_NAME").to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
        },
        scope: match scope {
            ExportScope::Library => "library",
            ExportScope::Selection { .. } => "selection",
            ExportScope::Playlist { .. } => "playlist",
        },
        tracks,
        playlists,
        settings: match scope {
            // A selection or a single playlist is a fragment of a library, not
            // a backup of one, so app preferences have no business in it.
            ExportScope::Library => settings::exportable(conn)?
                .into_iter()
                .map(|(key, value)| ExportSetting { key, value })
                .collect(),
            _ => Vec::new(),
        },
    })
}

/// Pages through the query layer rather than issuing its own SELECT.
///
/// An export of a playlist therefore contains exactly what the playlist view
/// showed, in the same order, including a smart playlist's live evaluation.
fn all_tracks(conn: &Connection, playlist_id: Option<i64>) -> AppResult<Vec<ExportTrack>> {
    let mut tracks = Vec::new();
    let mut offset = 0;
    loop {
        let page = query::query_tracks(
            conn,
            &TrackQuery {
                playlist_id,
                sort_by: if playlist_id.is_some() {
                    SortField::Position
                } else {
                    SortField::Path
                },
                direction: SortDirection::Asc,
                offset,
                limit: query::MAX_LIMIT,
                search: None,
                // An export covers the whole library or the whole playlist.
                // Narrowing it to whatever album happened to be open would make
                // the file silently partial.
                browse: None,
            },
        )?;
        let count = page.len() as u32;
        tracks.extend(page.into_iter().map(ExportTrack::from));
        if count < query::MAX_LIMIT {
            return Ok(tracks);
        }
        offset += count;
    }
}

fn all_playlists(conn: &Connection) -> AppResult<Vec<ExportPlaylist>> {
    playlists::list(conn)?
        .iter()
        .map(|playlist| export_playlist(conn, playlist))
        .collect()
}

fn export_playlist(
    conn: &Connection,
    playlist: &crate::model::Playlist,
) -> AppResult<ExportPlaylist> {
    let is_static = playlist.kind == PlaylistKind::Static;
    Ok(ExportPlaylist {
        id: playlist.id,
        name: playlist.name.clone(),
        kind: playlist.kind.as_sql(),
        created_at: playlist.created_at,
        track_ids: is_static
            .then(|| playlists::track_ids(conn, playlist.id))
            .transpose()?,
        filter: if is_static {
            None
        } else {
            playlists::filter(conn, playlist.id)?.or_else(|| Some(FilterGroup::default()))
        },
        order: if is_static {
            None
        } else {
            // `Some(default)` would be two nulls in every smart playlist's
            // entry; absent says the same thing and says it shorter.
            Some(playlists::order(conn, playlist.id)?)
                .filter(|order| *order != SmartOrder::default())
        },
    })
}

/// Serializes an export to pretty JSON.
///
/// Pretty rather than compact on purpose: the file exists to be read and
/// diffed by a person or a script, and the size difference is irrelevant next
/// to being able to open it.
pub fn to_json(export: &Export) -> AppResult<String> {
    serde_json::to_string_pretty(export)
        .map_err(|e| crate::error::AppError::Internal(format!("could not build the export: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::model::{Combinator, FilterField, FilterNode, FilterOp, FilterRule, FilterValue};

    fn seeded() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        for (path, title, artist) in [
            ("/m/1.mp3", "Maki", "Guitar"),
            ("/m/2.mp3", "Sakura Coming", "Guitar"),
            ("/m/3.mp3", "Half Gate", "Grizzly Bear"),
        ] {
            conn.execute(
                "INSERT INTO tracks (path, mtime, size, duration_ms, title, artist, added_at)
                 VALUES (?1, 1, 1, 1000, ?2, ?3, 0)",
                rusqlite::params![path, title, artist],
            )
            .unwrap();
        }
        (dir, db)
    }

    fn artist_is(name: &str) -> FilterGroup {
        FilterGroup {
            combinator: Combinator::All,
            children: vec![FilterNode::Rule(FilterRule {
                field: FilterField::Artist,
                op: FilterOp::Is,
                value: FilterValue::Text {
                    text: name.to_owned(),
                },
            })],
        }
    }

    #[test]
    fn a_library_export_carries_tracks_playlists_and_a_version() {
        let (_dir, db) = seeded();
        let mut conn = db.conn().unwrap();
        let playlist = playlists::create(&conn, "Mix", 5).unwrap();
        playlists::add_tracks(&mut conn, playlist.id, &[3, 1]).unwrap();

        let export = build(&conn, &ExportScope::Library, 1_700_000_000).unwrap();

        assert_eq!(export.schema_version, SCHEMA_VERSION);
        assert_eq!(export.exported_at, 1_700_000_000);
        assert_eq!(export.scope, "library");
        assert_eq!(export.tracks.len(), 3);
        assert_eq!(export.playlists.len(), 1);
        assert_eq!(export.playlists[0].track_ids, Some(vec![3, 1]));
        assert_eq!(export.playlists[0].filter, None);
    }

    #[test]
    fn a_smart_playlist_exports_its_filter_rather_than_a_snapshot_of_its_members() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        playlists::create_smart(
            &conn,
            "Guitar",
            &artist_is("Guitar"),
            &crate::model::SmartOrder::default(),
            0,
        )
        .unwrap();

        let export = build(&conn, &ExportScope::Library, 0).unwrap();

        // A membership list would be a lie the moment the library changed.
        assert_eq!(export.playlists[0].filter, Some(artist_is("Guitar")));
        assert_eq!(export.playlists[0].track_ids, None);
        assert_eq!(export.playlists[0].kind, "smart");
        // No sort and no cutoff, so the key is absent rather than two nulls -
        // which is also what every export written before the field existed
        // looks like.
        assert_eq!(export.playlists[0].order, None);
    }

    #[test]
    fn a_limited_smart_playlist_exports_the_cutoff_that_decides_its_membership() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        let order = crate::model::SmartOrder {
            sort: Some(crate::model::SmartSort {
                field: SortField::PlayCount,
                direction: SortDirection::Desc,
            }),
            limit: Some(100),
        };
        playlists::create_smart(&conn, "Most Played", &artist_is("Guitar"), &order, 0).unwrap();

        let export = build(&conn, &ExportScope::Library, 0).unwrap();

        // Without this the filter alone would read back as every Guitar track
        // rather than the hundred most played of them.
        assert_eq!(export.playlists[0].order, Some(order));

        let json = to_json(&export).unwrap();
        assert!(json.contains(r#""limit": 100"#), "{json}");
        assert!(json.contains(r#""field": "playCount""#), "{json}");
    }

    #[test]
    fn a_selection_export_holds_only_what_was_selected() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        playlists::create(&conn, "Mix", 0).unwrap();

        let export = build(
            &conn,
            &ExportScope::Selection {
                track_ids: vec![3, 1],
            },
            0,
        )
        .unwrap();

        assert_eq!(
            export.tracks.iter().map(|t| t.id).collect::<Vec<_>>(),
            [3, 1],
            "a selection keeps the order it was given"
        );
        assert!(export.playlists.is_empty());
        assert!(
            export.settings.is_empty(),
            "a fragment is not a backup and carries no preferences"
        );
    }

    #[test]
    fn a_playlist_export_holds_the_playlist_and_its_tracks_in_order() {
        let (_dir, db) = seeded();
        let mut conn = db.conn().unwrap();
        let playlist = playlists::create(&conn, "Mix", 0).unwrap();
        playlists::add_tracks(&mut conn, playlist.id, &[3, 1]).unwrap();

        let export = build(
            &conn,
            &ExportScope::Playlist {
                playlist_id: playlist.id,
            },
            0,
        )
        .unwrap();

        assert_eq!(
            export.tracks.iter().map(|t| t.id).collect::<Vec<_>>(),
            [3, 1]
        );
        assert_eq!(export.playlists.len(), 1);
        assert_eq!(export.scope, "playlist");
    }

    #[test]
    fn a_selection_naming_a_track_that_is_gone_exports_what_survives() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();

        let export = build(
            &conn,
            &ExportScope::Selection {
                track_ids: vec![1, 9999],
            },
            0,
        )
        .unwrap();

        assert_eq!(export.tracks.len(), 1);
    }

    #[test]
    fn credentials_can_never_reach_an_export() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        settings::set(&conn, settings::VOLUME, "0.5").unwrap();
        settings::set(&conn, "lastfm.session_key", "super-secret").unwrap();
        settings::set(&conn, "discogs.token", "also-secret").unwrap();

        let json = to_json(&build(&conn, &ExportScope::Library, 0).unwrap()).unwrap();

        // Asserted against the serialized bytes, not the struct: this is the
        // thing that actually leaves the machine.
        assert!(json.contains("player.volume"));
        assert!(
            !json.contains("super-secret"),
            "a session key reached the export"
        );
        assert!(!json.contains("also-secret"), "a token reached the export");
        assert!(!json.contains("lastfm"));
        assert!(!json.contains("discogs"));
    }

    #[test]
    fn the_json_uses_the_documented_field_names() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();

        let json = to_json(&build(&conn, &ExportScope::Library, 0).unwrap()).unwrap();

        // The schema is a contract; a rename here breaks somebody's script.
        for field in [
            "\"schemaVersion\"",
            "\"exportedAt\"",
            "\"generator\"",
            "\"tracks\"",
            "\"playlists\"",
            "\"settings\"",
            "\"albumArtist\"",
            "\"durationMs\"",
            "\"playCount\"",
        ] {
            assert!(json.contains(field), "missing {field} from the export");
        }
    }

    #[test]
    fn no_artwork_of_any_kind_travels_in_an_export() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        conn.execute(
            "INSERT INTO covers (hash, mime, bytes) VALUES ('abc', 'image/jpeg', ?1)",
            [b"the-actual-image-bytes".to_vec()],
        )
        .unwrap();
        conn.execute("UPDATE tracks SET cover_hash = 'abc' WHERE id = 1", [])
            .unwrap();

        let json = to_json(&build(&conn, &ExportScope::Library, 0).unwrap()).unwrap();

        // Not the bytes, and not the hash either: an export carries the
        // library's text and nothing that describes a picture.
        assert!(!json.contains("the-actual-image-bytes"));
        assert!(
            !json.contains("abc"),
            "the cover hash leaked into the export"
        );
        assert!(!json.to_lowercase().contains("cover"));
    }

    #[test]
    fn an_empty_library_still_produces_a_valid_document() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();

        let json = to_json(&build(&conn, &ExportScope::Library, 0).unwrap()).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["tracks"].as_array().unwrap().len(), 0);
        assert_eq!(parsed["schemaVersion"], SCHEMA_VERSION);
    }

    #[test]
    fn a_library_larger_than_one_page_exports_completely() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let mut conn = db.conn().unwrap();
        let count = query::MAX_LIMIT + 7;
        let tx = conn.transaction().unwrap();
        for index in 0..count {
            tx.execute(
                "INSERT INTO tracks (path, mtime, size, added_at) VALUES (?1, 1, 1, 0)",
                [format!("/m/{index:05}.mp3")],
            )
            .unwrap();
        }
        tx.commit().unwrap();

        // The page cap applies to every query; an export that forgot to page
        // would silently stop at 1000 tracks.
        let export = build(&conn, &ExportScope::Library, 0).unwrap();
        assert_eq!(export.tracks.len(), count as usize);
    }
}
