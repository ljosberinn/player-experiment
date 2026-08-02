//! Static playlists: the list itself, and the ordered membership behind it.
//!
//! Nothing here reads or writes track rows. A playlist is a set of ids plus an
//! order; the tracks it points at are fetched by the ordinary paged query in
//! [`crate::db::query`], with `playlist_id` set.

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::model::{Playlist, PlaylistKind};

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
    let playlists = stmt
        .query_map([], row_to_playlist)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
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
}
