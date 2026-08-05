//! Static playlists: the list itself, and the ordered membership behind it.
//!
//! Nothing here reads or writes track rows. A playlist is a set of ids plus an
//! order; the tracks it points at are fetched by the ordinary paged query in
//! [`crate::db::query`], with `playlist_id` set.

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::model::{FilterGroup, Playlist, PlaylistKind, SmartOrder};

/// Spacing between consecutive positions.
///
/// Positions are gapped rather than consecutive so that dropping a track
/// between two others is one UPDATE of the moved row, not a renumber of
/// everything after it. A playlist only gets renumbered when a gap actually
/// runs out, which takes many moves into the same spot.
pub const POSITION_GAP: i64 = 1024;

/// Long enough for any real playlist name, short enough that the sidebar and
/// the database are not asked to hold a pasted document.
const MAX_NAME_LEN: usize = 200;

fn normalize_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Internal("A playlist needs a name.".to_owned()));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(AppError::Internal(format!(
            "A playlist name may be at most {MAX_NAME_LEN} characters."
        )));
    }
    Ok(name.to_owned())
}

const SELECT: &str = "SELECT playlists.id, playlists.name, playlists.kind, playlists.created_at, \
                      (SELECT count(*) FROM playlist_tracks \
                       WHERE playlist_tracks.playlist_id = playlists.id) \
                      FROM playlists";

fn row_to_playlist(row: &rusqlite::Row<'_>) -> rusqlite::Result<Playlist> {
    let kind: String = row.get(2)?;
    Ok(Playlist {
        id: row.get(0)?,
        name: row.get(1)?,
        // A row whose `kind` is neither is impossible - the column has a CHECK
        // constraint - so an unreadable one is a corrupt database, not a case
        // to model. Falling back to static keeps the sidebar rendering.
        kind: PlaylistKind::parse(&kind).unwrap_or(PlaylistKind::Static),
        created_at: row.get(3)?,
        track_count: row.get(4)?,
    })
}

/// Every playlist, in the order the sidebar shows them.
///
/// Sorted by name rather than by creation: the sidebar is a place you look
/// things up in, so a stable alphabetical order beats "most recent last".
pub fn list(conn: &Connection) -> AppResult<Vec<Playlist>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY playlists.name COLLATE NOCASE"))?;
    let mut playlists = stmt
        .query_map([], row_to_playlist)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);

    for playlist in &mut playlists {
        if playlist.kind == PlaylistKind::Smart {
            // A smart playlist has no membership rows to count, so the count
            // is whatever its filter currently matches. Routed through the
            // ordinary count so the sidebar and the view cannot disagree.
            playlist.track_count = crate::db::query::count_tracks(
                conn,
                &crate::model::TrackQuery {
                    playlist_id: Some(playlist.id),
                    ..Default::default()
                },
            )? as i64;
        }
    }
    Ok(playlists)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Option<Playlist>> {
    Ok(conn
        .query_row(
            &format!("{SELECT} WHERE playlists.id = ?1"),
            [id],
            row_to_playlist,
        )
        .optional()?)
}

/// Creates an empty static playlist.
///
/// Duplicate names are allowed, as they are in iTunes: two playlists called
/// "Mix" are the user's business, and the id is what everything else keys on.
pub fn create(conn: &Connection, name: &str, at: i64) -> AppResult<Playlist> {
    let name = normalize_name(name)?;
    conn.execute(
        "INSERT INTO playlists (name, kind, created_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![name, PlaylistKind::Static.as_sql(), at],
    )?;
    let id = conn.last_insert_rowid();
    get(conn, id)?.ok_or_else(|| AppError::Internal("playlist vanished after insert".to_owned()))
}

/// The largest cutoff a smart playlist may carry.
///
/// A limit past this is not a limit, it is the library, and the point of the
/// bound is that the number reaches SQL as a value from a fixed range rather
/// than as whatever a corrupt `sort_json` happens to hold.
pub const MAX_SMART_LIMIT: u32 = 100_000;

/// Checks an order is one the query layer can actually run.
///
/// Validated here rather than at compile time because both halves are only
/// wrong in ways the type system cannot see: a sort field that is not a track
/// column, and a limit of zero - which would be a playlist that is empty by
/// construction, always a mistake rather than a request.
fn validate_order(order: &SmartOrder) -> AppResult<()> {
    if let Some(sort) = order.sort {
        if !sort.field.is_track_column() {
            return Err(AppError::Internal(format!(
                "A smart playlist cannot be sorted by {:?}.",
                sort.field
            )));
        }
    }
    match order.limit {
        Some(0) => Err(AppError::Internal(
            "A smart playlist limited to no songs would always be empty.".to_owned(),
        )),
        Some(limit) if limit > MAX_SMART_LIMIT => Err(AppError::Internal(format!(
            "A smart playlist may hold at most {MAX_SMART_LIMIT} songs."
        ))),
        _ => Ok(()),
    }
}

/// Creates a smart playlist: a name, the filter that decides its contents, and
/// the order it is held and shown in.
///
/// The filter is validated by compiling it before it is stored, so a filter
/// that cannot run never reaches the database and the error arrives while the
/// user is still looking at the editor. The order is checked the same way.
pub fn create_smart(
    conn: &Connection,
    name: &str,
    filter: &FilterGroup,
    order: &SmartOrder,
    at: i64,
) -> AppResult<Playlist> {
    let name = normalize_name(name)?;
    crate::smart::compile(filter, at)?;
    validate_order(order)?;
    conn.execute(
        "INSERT INTO playlists (name, kind, filter_json, sort_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            name,
            PlaylistKind::Smart.as_sql(),
            to_json(filter)?,
            order_to_json(order)?,
            at
        ],
    )?;
    let id = conn.last_insert_rowid();
    get(conn, id)?.ok_or_else(|| AppError::Internal("playlist vanished after insert".to_owned()))
}

/// Replaces a smart playlist's filter and order. Its membership follows
/// immediately, because membership is the filter - there is nothing to
/// recompute.
///
/// The two are written together rather than through separate setters: with a
/// limit in play they jointly decide what the playlist holds, and a moment
/// where the new filter is live against the old cutoff is a moment where the
/// sidebar count is a number nobody asked for.
pub fn set_smart(
    conn: &Connection,
    id: i64,
    filter: &FilterGroup,
    order: &SmartOrder,
    now: i64,
) -> AppResult<()> {
    match get(conn, id)? {
        None => {
            return Err(AppError::Internal(
                "That playlist no longer exists.".to_owned(),
            ))
        }
        Some(playlist) if playlist.kind != PlaylistKind::Smart => {
            return Err(AppError::Internal(
                "A static playlist's contents are the tracks in it, not a filter.".to_owned(),
            ))
        }
        Some(_) => {}
    }
    crate::smart::compile(filter, now)?;
    validate_order(order)?;
    conn.execute(
        "UPDATE playlists SET filter_json = ?2, sort_json = ?3 WHERE id = ?1",
        rusqlite::params![id, to_json(filter)?, order_to_json(order)?],
    )?;
    Ok(())
}

/// The stored order, for the editor, the query layer and the opening sort.
///
/// Absent or unreadable reads as the default - no order, no cutoff - for the
/// same reason [`filter`] does: a playlist whose `sort_json` got mangled should
/// be an editable playlist showing everything its filter matches, not one that
/// fails to open. Falling back to *no* limit rather than to some guess is the
/// safe direction: it can show too many songs, never too few.
pub fn order(conn: &Connection, id: i64) -> AppResult<SmartOrder> {
    let stored: Option<Option<String>> = conn
        .query_row(
            "SELECT sort_json FROM playlists WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    let order: SmartOrder = stored
        .flatten()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();
    // A limit that survived storage but not validation - a hand-edited row, or
    // one written by a future build - is dropped rather than trusted.
    if validate_order(&order).is_err() {
        return Ok(SmartOrder::default());
    }
    Ok(order)
}

fn order_to_json(order: &SmartOrder) -> AppResult<String> {
    serde_json::to_string(order)
        .map_err(|e| AppError::Internal(format!("could not store that order: {e}")))
}

/// The stored filter, for the editor and for the query layer.
///
/// A smart playlist whose `filter_json` is absent or unreadable reads as no
/// filter at all - which matches everything - rather than failing the view. A
/// corrupt row should be editable back into shape, not an unopenable playlist.
pub fn filter(conn: &Connection, id: i64) -> AppResult<Option<FilterGroup>> {
    let stored: Option<Option<String>> = conn
        .query_row(
            "SELECT filter_json FROM playlists WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored
        .flatten()
        .and_then(|json| serde_json::from_str(&json).ok()))
}

/// The playlist's stored column layout, as opaque JSON.
///
/// Opaque on purpose: which columns exist and how a width is stored is a
/// frontend concern, and mirroring `ColumnConfig` into Rust would mean two
/// definitions to keep in step for no gain. Nothing here reads inside it.
///
/// `None` means "never configured", which the frontend resolves to the global
/// layout rather than to a bare table.
pub fn columns(conn: &Connection, id: i64) -> AppResult<Option<String>> {
    let stored: Option<Option<String>> = conn
        .query_row(
            "SELECT columns_json FROM playlists WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored.flatten())
}

pub fn set_columns(conn: &Connection, id: i64, columns_json: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE playlists SET columns_json = ?2 WHERE id = ?1",
        rusqlite::params![id, columns_json],
    )?;
    Ok(())
}

/// How many songs each built-in holds.
const BUILT_IN_LIMIT: u32 = 100;

/// The smart playlists a library starts with.
///
/// Ordinary smart playlists, seeded once and then owned by the user: they can
/// be renamed, edited and deleted like any other, and nothing anywhere
/// special-cases them afterwards. That is only expressible because a smart
/// playlist can now carry a sort and a cutoff - "Most Played" is not a filter,
/// it is an ordering and a hundred.
///
/// Runs once per library, guarded by a settings flag rather than by looking for
/// the playlists themselves. Checking for them would mean a user who deletes
/// Most Played gets it back at the next launch, which is not what deleting
/// something means.
pub fn seed_built_ins(conn: &Connection, at: i64) -> AppResult<()> {
    use crate::db::settings;
    use crate::model::{
        Combinator, FilterField, FilterNode, FilterOp, FilterRule, FilterValue, SmartSort,
        SortDirection, SortField,
    };

    if settings::get(conn, settings::PLAYLISTS_SEEDED)?.is_some() {
        return Ok(());
    }
    // Written first, so a failure part-way through leaves a library with one
    // built-in rather than one that tries again and ends up with three.
    settings::set(conn, settings::PLAYLISTS_SEEDED, "1")?;

    let top = |field| SmartOrder {
        sort: Some(SmartSort {
            field,
            direction: SortDirection::Desc,
        }),
        limit: Some(BUILT_IN_LIMIT),
    };

    // No rules at all: every song is a candidate, and the cutoff does the work.
    create_smart(
        conn,
        "Recently Added",
        &FilterGroup::default(),
        &top(SortField::AddedAt),
        at,
    )?;

    // `plays > 0` is not redundant next to the cutoff: without it a library
    // with nothing played yet would show a hundred arbitrary songs under the
    // heading "Most Played", which is worse than showing none.
    create_smart(
        conn,
        "Most Played",
        &FilterGroup {
            combinator: Combinator::All,
            children: vec![FilterNode::Rule(FilterRule {
                field: FilterField::PlayCount,
                op: FilterOp::GreaterThan,
                value: FilterValue::Number { number: 0 },
            })],
        },
        &top(SortField::PlayCount),
        at,
    )?;

    Ok(())
}

fn to_json(filter: &FilterGroup) -> AppResult<String> {
    serde_json::to_string(filter)
        .map_err(|e| AppError::Internal(format!("could not store that filter: {e}")))
}

pub fn rename(conn: &Connection, id: i64, name: &str) -> AppResult<()> {
    let name = normalize_name(name)?;
    let changed = conn.execute(
        "UPDATE playlists SET name = ?2 WHERE id = ?1",
        rusqlite::params![id, name],
    )?;
    if changed == 0 {
        return Err(AppError::Internal(
            "That playlist no longer exists.".to_owned(),
        ));
    }
    Ok(())
}

/// Deletes a playlist. Its membership goes with it (ON DELETE CASCADE); the
/// tracks themselves are untouched.
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM playlists WHERE id = ?1", [id])?;
    Ok(())
}

fn require_static(conn: &Connection, playlist_id: i64) -> AppResult<()> {
    match get(conn, playlist_id)? {
        None => Err(AppError::Internal(
            "That playlist no longer exists.".to_owned(),
        )),
        Some(playlist) if playlist.kind != PlaylistKind::Static => Err(AppError::Internal(
            "A smart playlist's contents come from its filter and cannot be edited directly."
                .to_owned(),
        )),
        Some(_) => Ok(()),
    }
}

/// Appends tracks to the end of a playlist, in the order given.
///
/// Returns how many were actually added. A track already in the playlist is
/// skipped rather than duplicated: the membership table is keyed on
/// `(playlist_id, track_id)`, so a playlist holds each track at most once.
pub fn add_tracks(conn: &mut Connection, playlist_id: i64, track_ids: &[i64]) -> AppResult<u32> {
    require_static(conn, playlist_id)?;
    if track_ids.is_empty() {
        return Ok(0);
    }

    let tx = conn.transaction()?;
    let mut next: i64 = tx
        .query_row(
            "SELECT coalesce(max(position), -1) FROM playlist_tracks WHERE playlist_id = ?1",
            [playlist_id],
            |row| row.get(0),
        )
        .map(|last: i64| last + POSITION_GAP)?;

    let mut added = 0;
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position)
             VALUES (?1, ?2, ?3)",
        )?;
        for &track_id in track_ids {
            // A track that vanished between the drag starting and landing is
            // skipped rather than failing the whole drop.
            let exists: bool = tx
                .query_row("SELECT 1 FROM tracks WHERE id = ?1", [track_id], |_| Ok(()))
                .optional()?
                .is_some();
            if !exists {
                continue;
            }
            if stmt.execute(rusqlite::params![playlist_id, track_id, next])? > 0 {
                added += 1;
                next += POSITION_GAP;
            }
        }
    }
    tx.commit()?;
    Ok(added)
}

/// Removes tracks from a playlist, returning how many rows went.
pub fn remove_tracks(conn: &mut Connection, playlist_id: i64, track_ids: &[i64]) -> AppResult<u32> {
    require_static(conn, playlist_id)?;
    if track_ids.is_empty() {
        return Ok(0);
    }

    let tx = conn.transaction()?;
    let mut removed = 0;
    {
        let mut stmt =
            tx.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2")?;
        for &track_id in track_ids {
            removed += stmt.execute(rusqlite::params![playlist_id, track_id])? as u32;
        }
    }
    tx.commit()?;
    Ok(removed)
}

/// The playlist's membership, in play order.
fn ordered(conn: &Connection, playlist_id: i64) -> AppResult<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT track_id, position FROM playlist_tracks
         WHERE playlist_id = ?1 ORDER BY position, track_id",
    )?;
    let rows = stmt
        .query_map([playlist_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Track ids in play order - what a playlist view's "play from here" uses.
pub fn track_ids(conn: &Connection, playlist_id: i64) -> AppResult<Vec<i64>> {
    Ok(ordered(conn, playlist_id)?
        .into_iter()
        .map(|(track_id, _)| track_id)
        .collect())
}

/// `count` positions strictly between `lower` and `upper`, or `None` when
/// there are not that many integers left in the gap.
fn allocate(lower: Option<i64>, upper: Option<i64>, count: usize) -> Option<Vec<i64>> {
    let count = count as i64;
    Some(match (lower, upper) {
        (None, None) => (0..count).map(|i| i * POSITION_GAP).collect(),
        (Some(lower), None) => (1..=count).map(|i| lower + i * POSITION_GAP).collect(),
        // Dropping above the first row walks backwards from it, which is why
        // positions are allowed to go negative: renumbering the rows below
        // instead would be a whole-playlist write for a one-row move.
        (None, Some(upper)) => (0..count)
            .map(|i| upper - (count - i) * POSITION_GAP)
            .collect(),
        (Some(lower), Some(upper)) => {
            let step = (upper - lower) / (count + 1);
            if step < 1 {
                return None;
            }
            (1..=count).map(|i| lower + i * step).collect()
        }
    })
}

/// Rewrites every position as a multiple of `gap`, preserving the order.
fn renumber(conn: &mut Connection, playlist_id: i64, gap: i64) -> AppResult<()> {
    let current = ordered(conn, playlist_id)?;
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "UPDATE playlist_tracks SET position = ?3 WHERE playlist_id = ?1 AND track_id = ?2",
        )?;
        for (index, (track_id, _)) in current.iter().enumerate() {
            stmt.execute(rusqlite::params![playlist_id, track_id, index as i64 * gap])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// One attempt at the move; `false` means the gap was too tight.
fn try_move(
    conn: &mut Connection,
    playlist_id: i64,
    moving: &HashSet<i64>,
    target_index: usize,
) -> AppResult<bool> {
    let current = ordered(conn, playlist_id)?;

    // The moved rows keep their existing relative order rather than the order
    // the caller listed them in: dragging a multi-selection moves a block, it
    // does not also reshuffle the block.
    let moved: Vec<i64> = current
        .iter()
        .map(|(track_id, _)| *track_id)
        .filter(|track_id| moving.contains(track_id))
        .collect();
    if moved.is_empty() {
        return Ok(true);
    }

    // The new neighbours are rows that stay put, so an index expressed against
    // the full list has to be translated into the list with the moved rows
    // taken out - otherwise dragging downwards lands short by its own length.
    let rest: Vec<(usize, i64)> = current
        .iter()
        .enumerate()
        .filter(|(_, (track_id, _))| !moving.contains(track_id))
        .map(|(index, (_, position))| (index, *position))
        .collect();
    let insert_at = rest
        .iter()
        .filter(|(index, _)| *index < target_index)
        .count();

    let lower = insert_at
        .checked_sub(1)
        .and_then(|index| rest.get(index))
        .map(|(_, position)| *position);
    let upper = rest.get(insert_at).map(|(_, position)| *position);

    let Some(positions) = allocate(lower, upper, moved.len()) else {
        return Ok(false);
    };

    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "UPDATE playlist_tracks SET position = ?3 WHERE playlist_id = ?1 AND track_id = ?2",
        )?;
        for (track_id, position) in moved.iter().zip(positions) {
            stmt.execute(rusqlite::params![playlist_id, track_id, position])?;
        }
    }
    tx.commit()?;
    Ok(true)
}

/// Moves `track_ids` so they sit immediately before the track currently at
/// `target_index`; an index at or past the end appends.
///
/// Ids not in the playlist are ignored, so a drop of a mixed selection is not
/// an error.
pub fn move_tracks(
    conn: &mut Connection,
    playlist_id: i64,
    track_ids: &[i64],
    target_index: usize,
) -> AppResult<()> {
    require_static(conn, playlist_id)?;
    if track_ids.is_empty() {
        return Ok(());
    }
    let moving: HashSet<i64> = track_ids.iter().copied().collect();

    if try_move(conn, playlist_id, &moving, target_index)? {
        return Ok(());
    }

    // The integers between the drop's neighbours ran out. Spreading the whole
    // playlist out again is O(n) writes, but it only happens after repeated
    // moves into the same spot, and the gap it leaves is wide enough that the
    // retry cannot fail for the same reason.
    renumber(conn, playlist_id, POSITION_GAP.max(moving.len() as i64 + 1))?;
    if !try_move(conn, playlist_id, &moving, target_index)? {
        return Err(AppError::Internal(
            "Could not find room to reorder that playlist.".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn seeded() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        for id in 1..=6i64 {
            conn.execute(
                "INSERT INTO tracks (id, path, mtime, size, title, added_at)
                 VALUES (?1, ?2, 0, 0, ?3, 0)",
                rusqlite::params![id, format!("C:\\music\\{id}.mp3"), format!("Track {id}")],
            )
            .unwrap();
        }
        (dir, conn)
    }

    fn with_playlist() -> (tempfile::TempDir, Connection, i64) {
        let (dir, mut conn) = seeded();
        let playlist = create(&conn, "Mix", 0).unwrap();
        add_tracks(&mut conn, playlist.id, &[1, 2, 3, 4]).unwrap();
        (dir, conn, playlist.id)
    }

    #[test]
    fn a_new_playlist_is_static_named_and_empty() {
        let (_dir, conn) = seeded();
        let playlist = create(&conn, "  Road Trip  ", 1_700_000_000).unwrap();

        assert_eq!(playlist.name, "Road Trip", "the name should be trimmed");
        assert_eq!(playlist.kind, PlaylistKind::Static);
        assert_eq!(playlist.track_count, 0);
        assert_eq!(playlist.created_at, 1_700_000_000);
    }

    #[test]
    fn a_blank_name_is_refused_on_create_and_on_rename() {
        let (_dir, conn) = seeded();
        assert!(create(&conn, "   ", 0).is_err());

        let playlist = create(&conn, "Mix", 0).unwrap();
        assert!(rename(&conn, playlist.id, "\t\n").is_err());
        assert_eq!(get(&conn, playlist.id).unwrap().unwrap().name, "Mix");
    }

    #[test]
    fn an_overlong_name_is_refused() {
        let (_dir, conn) = seeded();
        assert!(create(&conn, &"x".repeat(MAX_NAME_LEN + 1), 0).is_err());
        assert!(create(&conn, &"x".repeat(MAX_NAME_LEN), 0).is_ok());
    }

    #[test]
    fn renaming_a_playlist_that_is_gone_is_an_error_not_a_silent_no_op() {
        let (_dir, conn) = seeded();
        assert!(rename(&conn, 404, "Anything").is_err());
    }

    #[test]
    fn playlists_are_listed_alphabetically_regardless_of_case() {
        let (_dir, conn) = seeded();
        for name in ["zeta", "Alpha", "beta"] {
            create(&conn, name, 0).unwrap();
        }
        let names: Vec<String> = list(&conn).unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, ["Alpha", "beta", "zeta"]);
    }

    #[test]
    fn adding_tracks_appends_in_the_order_given() {
        let (_dir, mut conn) = seeded();
        let playlist = create(&conn, "Mix", 0).unwrap();

        assert_eq!(add_tracks(&mut conn, playlist.id, &[3, 1]).unwrap(), 2);
        assert_eq!(add_tracks(&mut conn, playlist.id, &[2]).unwrap(), 1);

        assert_eq!(track_ids(&conn, playlist.id).unwrap(), [3, 1, 2]);
        assert_eq!(get(&conn, playlist.id).unwrap().unwrap().track_count, 3);
    }

    #[test]
    fn a_track_already_in_the_playlist_is_not_added_twice() {
        let (_dir, conn, playlist_id) = with_playlist();
        let mut conn = conn;

        assert_eq!(add_tracks(&mut conn, playlist_id, &[2, 5]).unwrap(), 1);
        assert_eq!(track_ids(&conn, playlist_id).unwrap(), [1, 2, 3, 4, 5]);
    }

    #[test]
    fn adding_a_track_the_library_no_longer_has_is_skipped_not_fatal() {
        let (_dir, conn, playlist_id) = with_playlist();
        let mut conn = conn;

        assert_eq!(add_tracks(&mut conn, playlist_id, &[99, 5]).unwrap(), 1);
        assert_eq!(track_ids(&conn, playlist_id).unwrap(), [1, 2, 3, 4, 5]);
    }

    #[test]
    fn removing_reports_what_actually_went() {
        let (_dir, conn, playlist_id) = with_playlist();
        let mut conn = conn;

        assert_eq!(remove_tracks(&mut conn, playlist_id, &[2, 99]).unwrap(), 1);
        assert_eq!(track_ids(&conn, playlist_id).unwrap(), [1, 3, 4]);
    }

    #[test]
    fn deleting_a_playlist_takes_its_membership_but_not_its_tracks() {
        let (_dir, conn, playlist_id) = with_playlist();
        delete(&conn, playlist_id).unwrap();

        assert!(get(&conn, playlist_id).unwrap().is_none());
        let orphans: i64 = conn
            .query_row("SELECT count(*) FROM playlist_tracks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(orphans, 0);
        let tracks: i64 = conn
            .query_row("SELECT count(*) FROM tracks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(tracks, 6, "deleting a playlist must not delete music");
    }

    #[test]
    fn deleting_a_track_takes_it_out_of_every_playlist() {
        let (_dir, conn, playlist_id) = with_playlist();
        conn.execute("DELETE FROM tracks WHERE id = 2", []).unwrap();

        assert_eq!(track_ids(&conn, playlist_id).unwrap(), [1, 3, 4]);
    }

    #[test]
    fn moving_a_track_down_lands_before_the_row_that_was_at_the_target() {
        let (_dir, conn, playlist_id) = with_playlist();
        let mut conn = conn;

        // [1,2,3,4], move 1 to index 3 -> it goes before 4.
        move_tracks(&mut conn, playlist_id, &[1], 3).unwrap();
        assert_eq!(track_ids(&conn, playlist_id).unwrap(), [2, 3, 1, 4]);
    }

    #[test]
    fn moving_a_track_up_lands_before_the_row_at_the_target() {
        let (_dir, conn, playlist_id) = with_playlist();
        let mut conn = conn;

        move_tracks(&mut conn, playlist_id, &[4], 1).unwrap();
        assert_eq!(track_ids(&conn, playlist_id).unwrap(), [1, 4, 2, 3]);
    }

    #[test]
    fn moving_to_the_top_and_to_the_end_both_work() {
        let (_dir, conn, playlist_id) = with_playlist();
        let mut conn = conn;

        move_tracks(&mut conn, playlist_id, &[3], 0).unwrap();
        assert_eq!(track_ids(&conn, playlist_id).unwrap(), [3, 1, 2, 4]);

        move_tracks(&mut conn, playlist_id, &[3], 99).unwrap();
        assert_eq!(track_ids(&conn, playlist_id).unwrap(), [1, 2, 4, 3]);
    }

    #[test]
    fn a_multi_selection_moves_as_one_block_in_its_existing_order() {
        let (_dir, conn, playlist_id) = with_playlist();
        let mut conn = conn;

        // Listed 3-then-1, but they are moved in playlist order: 1 then 3.
        move_tracks(&mut conn, playlist_id, &[3, 1], 4).unwrap();
        assert_eq!(track_ids(&conn, playlist_id).unwrap(), [2, 4, 1, 3]);
    }

    #[test]
    fn moving_a_block_out_of_the_middle_still_lands_where_it_was_aimed() {
        let (_dir, mut conn) = seeded();
        let playlist = create(&conn, "Mix", 0).unwrap();
        add_tracks(&mut conn, playlist.id, &[1, 2, 3, 4, 5, 6]).unwrap();

        // Aiming 2 and 3 at index 5 means "before 6", and the target index is
        // stated against the list as it looks now, moved rows included.
        move_tracks(&mut conn, playlist.id, &[2, 3], 5).unwrap();
        assert_eq!(track_ids(&conn, playlist.id).unwrap(), [1, 4, 5, 2, 3, 6]);
    }

    #[test]
    fn moving_a_track_onto_itself_changes_nothing() {
        let (_dir, conn, playlist_id) = with_playlist();
        let mut conn = conn;

        move_tracks(&mut conn, playlist_id, &[2], 1).unwrap();
        assert_eq!(track_ids(&conn, playlist_id).unwrap(), [1, 2, 3, 4]);
    }

    #[test]
    fn ids_that_are_not_in_the_playlist_are_ignored() {
        let (_dir, conn, playlist_id) = with_playlist();
        let mut conn = conn;

        move_tracks(&mut conn, playlist_id, &[99], 0).unwrap();
        assert_eq!(track_ids(&conn, playlist_id).unwrap(), [1, 2, 3, 4]);
    }

    #[test]
    fn repeated_moves_into_the_same_gap_survive_it_running_out() {
        let (_dir, conn, playlist_id) = with_playlist();
        let mut conn = conn;

        // Moving the last row to index 1 puts it between the first row and
        // whatever was moved there previously, so each pass halves the gap.
        // Twenty passes is well past log2(POSITION_GAP), so the renumber path
        // is taken and every later move has to keep working through it.
        for pass in 0..20 {
            let order = track_ids(&conn, playlist_id).unwrap();
            let last = *order.last().unwrap();
            move_tracks(&mut conn, playlist_id, &[last], 1).unwrap();

            let moved = track_ids(&conn, playlist_id).unwrap();
            assert_eq!(moved.len(), 4, "pass {pass} lost or duplicated a row");
            assert_eq!(moved[0], 1, "pass {pass} moved a row that was not asked to");
            assert_eq!(moved[1], last, "pass {pass} did not land where it aimed");
        }
    }

    #[test]
    fn renumbering_preserves_the_order_it_found() {
        let (_dir, conn, playlist_id) = with_playlist();
        let mut conn = conn;
        move_tracks(&mut conn, playlist_id, &[4], 0).unwrap();

        renumber(&mut conn, playlist_id, POSITION_GAP).unwrap();

        assert_eq!(track_ids(&conn, playlist_id).unwrap(), [4, 1, 2, 3]);
        let positions: Vec<i64> = ordered(&conn, playlist_id)
            .unwrap()
            .into_iter()
            .map(|(_, position)| position)
            .collect();
        assert_eq!(
            positions,
            [0, POSITION_GAP, POSITION_GAP * 2, POSITION_GAP * 3]
        );
    }

    #[test]
    fn a_smart_playlists_membership_cannot_be_edited_directly() {
        let (_dir, mut conn) = seeded();
        conn.execute(
            "INSERT INTO playlists (id, name, kind, created_at) VALUES (7, 'Recent', 'smart', 0)",
            [],
        )
        .unwrap();

        assert!(add_tracks(&mut conn, 7, &[1]).is_err());
        assert!(remove_tracks(&mut conn, 7, &[1]).is_err());
        assert!(move_tracks(&mut conn, 7, &[1], 0).is_err());
    }

    #[test]
    fn editing_a_playlist_that_is_gone_is_an_error() {
        let (_dir, mut conn) = seeded();
        assert!(add_tracks(&mut conn, 404, &[1]).is_err());
    }

    fn year_is(year: i64) -> FilterGroup {
        FilterGroup {
            combinator: crate::model::Combinator::All,
            children: vec![crate::model::FilterNode::Rule(crate::model::FilterRule {
                field: crate::model::FilterField::Year,
                op: crate::model::FilterOp::Is,
                value: crate::model::FilterValue::Number { number: year },
            })],
        }
    }

    #[test]
    fn a_smart_playlist_stores_and_returns_its_filter() {
        let (_dir, conn) = seeded();
        let playlist =
            create_smart(&conn, "Recent", &year_is(2012), &SmartOrder::default(), 0).unwrap();

        assert_eq!(playlist.kind, PlaylistKind::Smart);
        assert_eq!(filter(&conn, playlist.id).unwrap(), Some(year_is(2012)));
    }

    #[test]
    fn a_filter_that_cannot_run_is_refused_before_it_is_stored() {
        let (_dir, conn) = seeded();
        let broken = FilterGroup {
            combinator: crate::model::Combinator::All,
            children: vec![crate::model::FilterNode::Rule(crate::model::FilterRule {
                // A text value on a numeric field: caught by the compiler.
                field: crate::model::FilterField::Year,
                op: crate::model::FilterOp::Is,
                value: crate::model::FilterValue::Text {
                    text: "2012".to_owned(),
                },
            })],
        };

        assert!(create_smart(&conn, "Broken", &broken, &SmartOrder::default(), 0).is_err());
        assert!(
            list(&conn).unwrap().is_empty(),
            "nothing should have been stored"
        );
    }

    #[test]
    fn the_two_kinds_do_not_accept_each_others_edits() {
        let (_dir, conn) = seeded();
        let stat = create(&conn, "Mix", 0).unwrap();
        let smart =
            create_smart(&conn, "Recent", &year_is(2012), &SmartOrder::default(), 0).unwrap();

        assert!(set_smart(&conn, stat.id, &year_is(2017), &SmartOrder::default(), 0).is_err());
        assert!(add_tracks(&mut seeded().1, smart.id, &[1]).is_err());
    }

    #[test]
    fn replacing_a_filter_replaces_it_wholesale() {
        let (_dir, conn) = seeded();
        let playlist =
            create_smart(&conn, "Recent", &year_is(2012), &SmartOrder::default(), 0).unwrap();

        set_smart(
            &conn,
            playlist.id,
            &year_is(2017),
            &SmartOrder::default(),
            0,
        )
        .unwrap();

        assert_eq!(filter(&conn, playlist.id).unwrap(), Some(year_is(2017)));
    }

    #[test]
    fn an_unreadable_filter_reads_as_no_filter_rather_than_an_unopenable_playlist() {
        let (_dir, conn) = seeded();
        let playlist =
            create_smart(&conn, "Recent", &year_is(2012), &SmartOrder::default(), 0).unwrap();
        conn.execute(
            "UPDATE playlists SET filter_json = 'not json' WHERE id = ?1",
            [playlist.id],
        )
        .unwrap();

        // Matching everything is recoverable - the user can edit it back into
        // shape. Failing the view would leave them with no way in.
        assert_eq!(filter(&conn, playlist.id).unwrap(), None);
    }

    fn desc(field: crate::model::SortField, limit: u32) -> SmartOrder {
        SmartOrder {
            sort: Some(crate::model::SmartSort {
                field,
                direction: crate::model::SortDirection::Desc,
            }),
            limit: Some(limit),
        }
    }

    #[test]
    fn a_smart_playlist_stores_and_returns_its_order() {
        let (_dir, conn) = seeded();
        let wanted = desc(crate::model::SortField::PlayCount, 100);
        let playlist = create_smart(&conn, "Top", &year_is(2012), &wanted, 0).unwrap();

        assert_eq!(order(&conn, playlist.id).unwrap(), wanted);
    }

    #[test]
    fn a_playlist_with_no_order_reads_as_no_order_rather_than_a_guess() {
        let (_dir, conn) = seeded();
        let playlist =
            create_smart(&conn, "Any", &year_is(2012), &SmartOrder::default(), 0).unwrap();

        let stored = order(&conn, playlist.id).unwrap();
        assert_eq!(stored.sort, None);
        assert_eq!(
            stored.limit, None,
            "absent must not become some default cap"
        );
    }

    #[test]
    fn the_filter_and_the_order_are_replaced_together() {
        let (_dir, conn) = seeded();
        let playlist = create_smart(
            &conn,
            "Top",
            &year_is(2012),
            &desc(crate::model::SortField::PlayCount, 100),
            0,
        )
        .unwrap();

        set_smart(
            &conn,
            playlist.id,
            &year_is(2017),
            &desc(crate::model::SortField::AddedAt, 10),
            0,
        )
        .unwrap();

        assert_eq!(filter(&conn, playlist.id).unwrap(), Some(year_is(2017)));
        assert_eq!(
            order(&conn, playlist.id).unwrap(),
            desc(crate::model::SortField::AddedAt, 10)
        );
    }

    #[test]
    fn a_sort_that_is_not_a_track_column_is_refused() {
        let (_dir, conn) = seeded();

        // Relevance needs a search to rank against and Position needs a static
        // playlist to be positioned in. Inside a smart playlist's own cutoff
        // neither exists, and picking a different hundred than the one asked
        // for is worse than saying no.
        for field in [
            crate::model::SortField::Relevance,
            crate::model::SortField::Position,
        ] {
            assert!(
                create_smart(&conn, "Nope", &year_is(2012), &desc(field, 10), 0).is_err(),
                "{field:?} should not be a smart playlist's sort"
            );
        }
        assert!(list(&conn).unwrap().is_empty(), "nothing should be stored");
    }

    #[test]
    fn a_cutoff_of_zero_or_an_absurd_one_is_refused() {
        let (_dir, conn) = seeded();
        let with_limit = |limit| SmartOrder {
            sort: None,
            limit: Some(limit),
        };

        // Zero would be a playlist that is empty by construction - always a
        // slip rather than a request.
        assert!(create_smart(&conn, "None", &year_is(2012), &with_limit(0), 0).is_err());
        assert!(create_smart(
            &conn,
            "Everything",
            &year_is(2012),
            &with_limit(MAX_SMART_LIMIT + 1),
            0
        )
        .is_err());
        assert!(create_smart(
            &conn,
            "Plenty",
            &year_is(2012),
            &with_limit(MAX_SMART_LIMIT),
            0
        )
        .is_ok());
    }

    #[test]
    fn an_unreadable_order_reads_as_none_rather_than_an_unopenable_playlist() {
        let (_dir, conn) = seeded();
        let playlist = create_smart(
            &conn,
            "Top",
            &year_is(2012),
            &desc(crate::model::SortField::PlayCount, 10),
            0,
        )
        .unwrap();

        for stored in [
            "not json",
            // Valid JSON, but a cutoff `validate_order` would never have let in
            // - a hand-edited row, or one written by a build that is not this
            // one. Dropped rather than trusted, and dropped towards showing too
            // many songs rather than too few.
            r#"{"sort":null,"limit":0}"#,
            r#"{"sort":{"field":"relevance","direction":"desc"},"limit":10}"#,
        ] {
            conn.execute(
                "UPDATE playlists SET sort_json = ?2 WHERE id = ?1",
                rusqlite::params![playlist.id, stored],
            )
            .unwrap();

            assert_eq!(
                order(&conn, playlist.id).unwrap(),
                SmartOrder::default(),
                "{stored} should have been dropped"
            );
        }
    }

    #[test]
    fn a_fresh_library_gets_the_two_built_ins() {
        let (_dir, conn) = seeded();
        seed_built_ins(&conn, 1_700_000_000).unwrap();

        let names: Vec<String> = list(&conn).unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, ["Most Played", "Recently Added"]);

        let built_ins = list(&conn).unwrap();
        for playlist in &built_ins {
            assert_eq!(playlist.kind, PlaylistKind::Smart);
            let stored = order(&conn, playlist.id).unwrap();
            assert_eq!(stored.limit, Some(BUILT_IN_LIMIT));
            assert_eq!(
                stored.sort.map(|sort| sort.direction),
                Some(crate::model::SortDirection::Desc)
            );
        }
    }

    #[test]
    fn seeding_twice_does_not_produce_four_playlists() {
        let (_dir, conn) = seeded();
        seed_built_ins(&conn, 0).unwrap();
        seed_built_ins(&conn, 0).unwrap();

        assert_eq!(list(&conn).unwrap().len(), 2);
    }

    #[test]
    fn a_built_in_the_user_deleted_stays_deleted() {
        let (_dir, conn) = seeded();
        seed_built_ins(&conn, 0).unwrap();
        let most_played = list(&conn)
            .unwrap()
            .into_iter()
            .find(|p| p.name == "Most Played")
            .unwrap();

        delete(&conn, most_played.id).unwrap();
        // The next launch. Deleting something has to mean deleting it, which is
        // why the guard is a flag rather than a check for the playlists.
        seed_built_ins(&conn, 0).unwrap();

        let names: Vec<String> = list(&conn).unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, ["Recently Added"]);
    }

    #[test]
    fn the_built_ins_are_ordinary_playlists_the_user_owns() {
        let (_dir, conn) = seeded();
        seed_built_ins(&conn, 0).unwrap();
        let recent = list(&conn)
            .unwrap()
            .into_iter()
            .find(|p| p.name == "Recently Added")
            .unwrap();

        // Nothing special-cases them: renaming and re-filtering both work, and
        // that is the point of building them out of sort and limit rather than
        // out of a flag on the row.
        rename(&conn, recent.id, "My Newest").unwrap();
        set_smart(&conn, recent.id, &year_is(2012), &SmartOrder::default(), 0).unwrap();

        assert_eq!(get(&conn, recent.id).unwrap().unwrap().name, "My Newest");
        assert_eq!(order(&conn, recent.id).unwrap(), SmartOrder::default());
    }

    #[test]
    fn allocating_between_neighbours_stays_strictly_inside_them() {
        let positions = allocate(Some(0), Some(100), 3).unwrap();
        assert_eq!(positions.len(), 3);
        assert!(positions.iter().all(|p| *p > 0 && *p < 100));
        assert!(positions.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn allocating_reports_a_gap_with_no_room_rather_than_colliding() {
        assert!(allocate(Some(5), Some(6), 1).is_none());
        assert!(allocate(Some(5), Some(7), 1).is_some());
    }

    #[test]
    fn a_new_playlist_has_no_column_layout_of_its_own() {
        let (_dir, conn, playlist_id) = with_playlist();

        // Not an empty layout - absent, so the caller can tell "never
        // configured" from "configured to show nothing" and inherit the
        // library's columns instead of opening bare.
        assert_eq!(columns(&conn, playlist_id).unwrap(), None);
    }

    #[test]
    fn a_playlist_keeps_its_own_column_layout() {
        let (_dir, conn, playlist_id) = with_playlist();
        let other = create(&conn, "Other", 0).unwrap();

        set_columns(&conn, playlist_id, r#"{"ids":["title"]}"#).unwrap();

        assert_eq!(
            columns(&conn, playlist_id).unwrap().as_deref(),
            Some(r#"{"ids":["title"]}"#)
        );
        // Per playlist, not per app: configuring one must not configure the rest.
        assert_eq!(columns(&conn, other.id).unwrap(), None);
    }

    #[test]
    fn a_column_layout_is_stored_verbatim_rather_than_interpreted() {
        let (_dir, conn, playlist_id) = with_playlist();

        // Which columns exist is a frontend concern; this layer only carries
        // the string, so it must not validate or rewrite it.
        set_columns(&conn, playlist_id, "not json at all").unwrap();

        assert_eq!(
            columns(&conn, playlist_id).unwrap().as_deref(),
            Some("not json at all")
        );
    }

    #[test]
    fn the_layout_of_a_playlist_that_is_gone_reads_as_absent() {
        let (_dir, conn) = seeded();

        assert_eq!(columns(&conn, 404).unwrap(), None);
    }
}
