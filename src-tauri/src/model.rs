use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Types shared with the frontend live here and derive [`TS`], so the
/// TypeScript definitions in `src/ipc/bindings/` are generated, never written
/// by hand.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

/// One row of the songs table.
///
/// Cover art is referenced by hash only - the bytes are served separately so a
/// page of rows stays small enough to send over IPC cheaply.
///
/// The `i64` fields are annotated as `number` rather than taking ts-rs's
/// default of `bigint`: these cross the boundary as JSON, and `JSON.parse`
/// produces numbers, never bigints. Every one of them (row ids, durations,
/// unix seconds, play counts) is far inside the 2^53 range where that is
/// lossless, so `bigint` would describe a value the frontend never receives.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct Track {
    #[ts(type = "number")]
    pub id: i64,
    pub path: String,
    #[ts(type = "number")]
    pub duration_ms: i64,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    #[ts(type = "number | null")]
    pub year: Option<i64>,
    #[ts(type = "number | null")]
    pub track_no: Option<i64>,
    #[ts(type = "number | null")]
    pub disc_no: Option<i64>,
    pub comment: Option<String>,
    #[ts(type = "number | null")]
    pub bitrate: Option<i64>,
    #[ts(type = "number | null")]
    pub sample_rate: Option<i64>,
    pub cover_hash: Option<String>,
    #[ts(type = "number")]
    pub added_at: i64,
    #[ts(type = "number")]
    pub play_count: i64,
    #[ts(type = "number | null")]
    pub last_played_at: Option<i64>,
}

/// Columns a query may sort by.
///
/// An enum rather than a string: the sort column is interpolated into SQL (it
/// cannot be a bound parameter), so restricting it at the type level is what
/// keeps that interpolation safe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SortField {
    Title,
    Artist,
    Album,
    AlbumArtist,
    Genre,
    Year,
    TrackNo,
    DurationMs,
    AddedAt,
    PlayCount,
    LastPlayedAt,
    Path,
}

impl SortField {
    /// The SQL fragment for this field. Every arm is a literal, so no caller
    /// input reaches the statement.
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::Title => "title",
            Self::Artist => "artist",
            Self::Album => "album",
            Self::AlbumArtist => "album_artist",
            Self::Genre => "genre",
            Self::Year => "year",
            Self::TrackNo => "track_no",
            Self::DurationMs => "duration_ms",
            Self::AddedAt => "added_at",
            Self::PlayCount => "play_count",
            Self::LastPlayedAt => "last_played_at",
            Self::Path => "path",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SortDirection {
    Asc,
    Desc,
}

impl SortDirection {
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::Asc => "ASC",
            Self::Desc => "DESC",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TrackQuery {
    /// Free-text search; matched through FTS5 when present.
    pub search: Option<String>,
    pub sort_by: SortField,
    pub direction: SortDirection,
    pub offset: u32,
    pub limit: u32,
}

impl Default for TrackQuery {
    fn default() -> Self {
        Self {
            search: None,
            sort_by: SortField::Artist,
            direction: SortDirection::Asc,
            offset: 0,
            limit: 100,
        }
    }
}

/// Progress of a library scan, emitted on `scan://progress`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScanProgress {
    pub scanned: u32,
    pub total: u32,
    pub added: u32,
    pub updated: u32,
    pub removed: u32,
    pub done: bool,
}

/// What a completed scan changed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScanSummary {
    pub added: u32,
    pub updated: u32,
    pub removed: u32,
    pub unchanged: u32,
}
