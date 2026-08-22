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
    /// When a scan, or a failed play, first could not find the file. Null for
    /// every track that is where it should be, which is nearly all of them.
    #[ts(type = "number | null")]
    pub missing_since: Option<i64>,
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
    /// Best match first, from FTS5's bm25 score.
    ///
    /// Only meaningful alongside a search; without one there is nothing to
    /// rank, and [`SortField::as_sql`] has no column to offer, so
    /// `db::query` substitutes a real column instead.
    Relevance,
    /// The order a static playlist stores its tracks in.
    ///
    /// Like [`SortField::Relevance`], a property of the query rather than of a
    /// track: outside a playlist there is no position, so `db::query`
    /// substitutes a real column.
    Position,
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
    /// The column this field sorts by.
    ///
    /// Every arm is a literal, so no caller input reaches the statement.
    /// `Relevance` is not a property of a track but of a match, and `Position`
    /// is a property of a playlist membership, so neither has a column of its
    /// own. They fall back to a real column for the case where there is
    /// nothing to rank and no playlist to be positioned in.
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::Relevance => "artist",
            Self::Position => "added_at",
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

    /// Whether this field is a column of `tracks` rather than a property of
    /// the query that produced the row.
    ///
    /// [`Self::Relevance`] needs an FTS join to rank against and
    /// [`Self::Position`] needs a playlist membership to be positioned in.
    /// Neither exists inside a smart playlist's own filter, so both are refused
    /// there rather than quietly falling back the way `db::query` does - a
    /// silent fallback is fine for a display order the user can see and change,
    /// but a smart playlist's sort decides *which songs it holds*, and picking
    /// a different hundred than the one asked for is not a detail.
    pub fn is_track_column(self) -> bool {
        !matches!(self, Self::Relevance | Self::Position)
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

/// A smart playlist's ordering.
///
/// Two jobs, which is why it is stored rather than left to the table's own
/// sort: it is the order the playlist opens in, and - when [`SmartOrder::limit`]
/// is set - it is what decides which songs are in the playlist at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SmartSort {
    pub field: SortField,
    pub direction: SortDirection,
}

/// The ordering and cutoff stored in `playlists.sort_json`.
///
/// Both parts optional and both defaulting to absent, which is exactly what
/// every smart playlist created before this existed has: a filter, no order,
/// no cutoff. That is why the column has been nullable and unread since
/// migration 1 and why nothing needed a schema change to start using it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SmartOrder {
    pub sort: Option<SmartSort>,
    /// How many songs the playlist holds at most. `None` is "all of them".
    #[ts(type = "number | null")]
    pub limit: Option<u32>,
}

/// Which grouping the browse views present.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum BrowseKind {
    Albums,
    Artists,
    Genres,
}

/// One row of a browse view: an album, an artist or a genre.
///
/// `key` is `None` for untagged files rather than an empty string, so "no
/// album" is one group instead of colliding with a real album literally named
/// "Unknown Album". The frontend supplies the label; the database says only
/// that the tag is absent.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BrowseGroup {
    pub key: Option<String>,
    /// Albums only: the artist the album is filed under. `None` everywhere
    /// else, and also for an album whose artist tags are all empty.
    pub secondary: Option<String>,
    pub track_count: u32,
    #[ts(type = "number")]
    pub duration_ms: i64,
    /// Any one cover from the group - they are per-album in practice, and
    /// `covers.hash` already dedupes the bytes behind them.
    pub cover_hash: Option<String>,
    #[ts(type = "number | null")]
    pub year: Option<i64>,
}

/// Restricts the songs table to one browse group.
///
/// Carried on [`TrackQuery`] rather than being a query of its own: drilling
/// into an album is the existing view with one more condition, so paging,
/// searching, sorting, select-all and the play queue keep working unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BrowseFilter {
    pub kind: BrowseKind,
    /// `None` matches the untagged group - `IS NULL`, not "no filter".
    pub key: Option<String>,
    /// Applied only when `kind` is `Albums`, where `None` likewise means the
    /// album whose artist is untagged.
    pub secondary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TrackQuery {
    /// Free-text search; matched through FTS5 when present.
    pub search: Option<String>,
    /// Restricts the query to one playlist's members.
    ///
    /// A playlist is a filter on the same query rather than a query of its own,
    /// so paging, searching, sorting, "select all" and the play queue all work
    /// inside a playlist without a second code path.
    #[ts(type = "number | null")]
    pub playlist_id: Option<i64>,
    /// Restricts the query to one album, artist or genre.
    ///
    /// Composes with everything else rather than replacing it: an album opened
    /// while a search is running shows that album's matching tracks.
    pub browse: Option<BrowseFilter>,
    pub sort_by: SortField,
    pub direction: SortDirection,
    pub offset: u32,
    pub limit: u32,
}

impl Default for TrackQuery {
    fn default() -> Self {
        Self {
            search: None,
            playlist_id: None,
            browse: None,
            sort_by: SortField::Artist,
            direction: SortDirection::Asc,
            offset: 0,
            limit: 100,
        }
    }
}

/// What decides a playlist's membership.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PlaylistKind {
    /// An explicit, ordered list of tracks.
    Static,
    /// A saved filter, evaluated live. Lands in phase 7.
    Smart,
}

impl PlaylistKind {
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::Static => "static",
            Self::Smart => "smart",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "static" => Some(Self::Static),
            "smart" => Some(Self::Smart),
            _ => None,
        }
    }
}

/// What one tag edit changes.
///
/// Every field is optional in two senses, which is the whole point: absent
/// means "the user did not touch this, leave it exactly as it is", and an
/// empty string means "clear it". That is what lets one edit apply to a
/// selection whose values differ - the fields showing a mixed-value dash stay
/// absent and survive untouched.
///
/// Numbers are strings here for the same reason: the editor's inputs hold
/// strings, and an empty one has to mean "clear" rather than zero.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TagEdit {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub comment: Option<String>,
    pub year: Option<String>,
    pub track_no: Option<String>,
    pub disc_no: Option<String>,
    pub cover: Option<CoverEdit>,
}

/// A cover art change. Absent from [`TagEdit`] means the artwork stays put.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum CoverEdit {
    Remove,
    /// The image file the user picked. A path rather than bytes: the picker
    /// already produced one, and megabytes of base64 over IPC would be waste.
    Replace {
        path: String,
    },
}

/// What a tag write actually managed to do.
///
/// A locked or read-only file in the middle of a 500-track edit should not
/// undo the other 499, so failures are counted and reported rather than
/// aborting the batch.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TagWriteSummary {
    pub written: u32,
    pub failed: u32,
    pub errors: Vec<String>,
}

/// A field whose values are worth suggesting.
///
/// Deliberately shorter than [`FilterField`]. A vocabulary only helps where two
/// songs genuinely ought to agree on a value - title, track number and comment
/// are per-song by nature, and a dropdown of other songs' comments is noise at
/// best and a way to paste the wrong data at worst.
///
/// Composer is absent because `tracks` has no composer column; adding one is a
/// schema change and a scan change, not an autocompletion change.
///
/// A whitelist enum for the same reason [`FilterField`] is one: the value is
/// interpolated into SQL.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TagValueField {
    Artist,
    AlbumArtist,
    Album,
    Genre,
    Year,
}

/// A track column a smart playlist can filter on.
///
/// A whitelist enum rather than a string, for the same reason [`SortField`] is
/// one: the column name is interpolated into SQL, so restricting it at the
/// type level is what keeps that interpolation safe. Every arm below returns a
/// literal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FilterField {
    Title,
    Artist,
    Album,
    AlbumArtist,
    Genre,
    Comment,
    Path,
    Year,
    TrackNo,
    DiscNo,
    DurationMs,
    Bitrate,
    SampleRate,
    PlayCount,
    AddedAt,
    LastPlayedAt,
}

/// What kind of value a field holds, which decides the operators it accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilterFieldKind {
    Text,
    Number,
    /// Unix seconds. Numeric underneath, but "in the last N days" only makes
    /// sense here, and a date picker is the right editor rather than a spinner.
    Timestamp,
}

impl FilterField {
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::Title => "title",
            Self::Artist => "artist",
            Self::Album => "album",
            Self::AlbumArtist => "album_artist",
            Self::Genre => "genre",
            Self::Comment => "comment",
            Self::Path => "path",
            Self::Year => "year",
            Self::TrackNo => "track_no",
            Self::DiscNo => "disc_no",
            Self::DurationMs => "duration_ms",
            Self::Bitrate => "bitrate",
            Self::SampleRate => "sample_rate",
            Self::PlayCount => "play_count",
            Self::AddedAt => "added_at",
            Self::LastPlayedAt => "last_played_at",
        }
    }

    pub fn kind(self) -> FilterFieldKind {
        match self {
            Self::Title
            | Self::Artist
            | Self::Album
            | Self::AlbumArtist
            | Self::Genre
            | Self::Comment
            | Self::Path => FilterFieldKind::Text,
            Self::Year
            | Self::TrackNo
            | Self::DiscNo
            | Self::DurationMs
            | Self::Bitrate
            | Self::SampleRate
            | Self::PlayCount => FilterFieldKind::Number,
            Self::AddedAt | Self::LastPlayedAt => FilterFieldKind::Timestamp,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FilterOp {
    Is,
    IsNot,
    Contains,
    DoesNotContain,
    StartsWith,
    EndsWith,
    GreaterThan,
    LessThan,
    Between,
    /// Within the last N days. Only meaningful on a timestamp field.
    InLast,
    IsEmpty,
    IsNotEmpty,
}

/// The right-hand side of a rule.
///
/// Typed rather than a bare JSON value: the compiler has to know whether it is
/// binding text or a number, and a rule whose value does not match its field
/// is a mistake worth reporting rather than coercing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum FilterValue {
    Text {
        text: String,
    },
    Number {
        #[ts(type = "number")]
        number: i64,
    },
    /// Both ends of a `Between`, inclusive.
    Range {
        #[ts(type = "number")]
        from: i64,
        #[ts(type = "number")]
        to: i64,
    },
    /// For operators that take no value at all.
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FilterRule {
    pub field: FilterField,
    pub op: FilterOp,
    pub value: FilterValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Combinator {
    All,
    Any,
}

/// One level of the filter tree: rules and nested groups, side by side.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export)]
pub enum FilterNode {
    Rule(FilterRule),
    Group(FilterGroup),
}

/// A saved filter, as stored in `playlists.filter_json`.
///
/// Persisted as a tree rather than as SQL: the editor has to read it back, and
/// a stored SQL string would be both unparseable for the UI and an injection
/// surface the moment anything wrote to it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FilterGroup {
    pub combinator: Combinator,
    pub children: Vec<FilterNode>,
}

impl Default for FilterGroup {
    fn default() -> Self {
        Self {
            combinator: Combinator::All,
            children: Vec::new(),
        }
    }
}

/// One entry in the sidebar's playlist section.
///
/// `track_count` is part of the row because the sidebar shows it and a second
/// round trip per playlist to fetch it would be waste; it is a `COUNT` over an
/// indexed column, not a scan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Playlist {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub kind: PlaylistKind,
    #[ts(type = "number")]
    pub track_count: i64,
    #[ts(type = "number")]
    pub created_at: i64,
}

/// What the player is doing right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PlaybackStatus {
    Stopped,
    Playing,
    Paused,
}

/// One colour extracted from a cover, sRGB, 0-255 per channel.
///
/// Three channels rather than a CSS string: the frontend composes these into
/// `rgb()` itself, and a string would put a rendering decision in Rust and
/// make the value untestable as a colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Colour {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// Everything the UI needs to render the transport, emitted on
/// `player://state` whenever any of it changes.
///
/// Carries the whole current [`Track`] rather than an id: the track being
/// played is frequently not in the frontend's page cache (it may have been
/// evicted, or the user may have scrolled elsewhere), and one row is small.
/// Position is deliberately *not* the reason this is emitted - that would mean
/// a track payload four times a second - see [`PlayerPosition`].
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlayerSnapshot {
    pub status: PlaybackStatus,
    pub track: Option<Track>,
    /// The playing cover's three dominant colours, for the background that
    /// follows the music.
    ///
    /// Carried on the snapshot rather than on its own event: the frontend
    /// already learns what is playing here, and the colours are a property of
    /// that rather than news of their own. `None` for silence, for a track
    /// with no artwork, and for a cover stored before the palette column
    /// existed and not seen since - all three mean the same thing downstream,
    /// which is the default scheme with no blobs. Always three entries when
    /// present; see [`crate::palette`].
    pub palette: Option<Vec<Colour>>,
    #[ts(type = "number | null")]
    pub queue_index: Option<u32>,
    pub queue_len: u32,
    #[ts(type = "number")]
    pub position_ms: i64,
    #[ts(type = "number")]
    pub duration_ms: i64,
    pub volume: f32,
    /// Silent, but not turned down: `volume` is still the level the rail shows
    /// and the level unmuting returns to.
    pub muted: bool,
    pub repeat_one: bool,
}

/// Playhead ticks, emitted on `player://position` a few times a second.
///
/// Split out from [`PlayerSnapshot`] so the frequent event stays tiny.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlayerPosition {
    #[ts(type = "number")]
    pub position_ms: i64,
    #[ts(type = "number")]
    pub duration_ms: i64,
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
    /// Files that have gone from disk. Marked, not deleted - see migration 4.
    pub missing: u32,
    pub done: bool,
}

/// The totals behind a view, for the footer.
///
/// `duration_ms` and `bytes` are `i64` rather than `u32`: a library of tens of
/// thousands of tracks passes four billion milliseconds at about seven hundred
/// hours, and four billion bytes long before that.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LibraryStats {
    pub tracks: u32,
    #[ts(type = "number")]
    pub duration_ms: i64,
    #[ts(type = "number")]
    pub bytes: i64,
    /// How many of `tracks` are marked missing. Drives whether the library
    /// offers to clear them out at all; in a healthy library it is zero and
    /// nothing about missing files appears anywhere.
    pub missing: u32,
}

/// What a completed scan changed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScanSummary {
    pub added: u32,
    pub updated: u32,
    /// Newly gone from disk, and marked as such rather than deleted.
    pub missing: u32,
    /// Marked files that turned up again, and are no longer marked.
    pub returned: u32,
    pub unchanged: u32,
}

/// A panic the previous run wrote down.
///
/// Carries the full text as well as the one-line summary so that "show me the
/// details" costs no second round trip, and the path so the app can offer to
/// open the file in the OS file manager - which is the only route to the
/// *older* reports, since only the most recent one is ever surfaced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CrashReport {
    /// Unix seconds. Compared against what the user has already dismissed, so
    /// a crash is reported once rather than at every launch after it.
    #[ts(type = "number")]
    pub when: i64,
    /// The panic message alone, which is what the notice shows.
    pub summary: String,
    /// The whole report: thread, location, backtrace.
    pub details: String,
    pub path: String,
}
