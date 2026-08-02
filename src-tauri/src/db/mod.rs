pub mod query;
pub mod schema;

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Handle to the library database.
///
/// Holds a path rather than a connection: with WAL enabled SQLite allows many
/// concurrent readers alongside a single writer, so each operation opens its
/// own connection and the UI can keep querying while a scan writes.
#[derive(Debug, Clone)]
pub struct Db {
    path: PathBuf,
}

impl Db {
    /// Opens (creating if needed) the database at `path` and migrates it.
    pub fn open(path: impl Into<PathBuf>) -> AppResult<Self> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::Internal(format!("creating {}: {e}", parent.display())))?;
        }
        let db = Self { path };
        let mut conn = db.conn()?;
        migrate(&mut conn)?;
        Ok(db)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// A fresh connection with the pragmas every caller depends on.
    pub fn conn(&self) -> AppResult<Connection> {
        let conn = Connection::open(&self.path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        // NORMAL is the documented-safe pairing with WAL: a crash can lose the
        // tail of the last transaction but cannot corrupt the database, and it
        // avoids an fsync per commit while ingesting tens of thousands of rows.
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_secs(30))?;
        Ok(conn)
    }
}

/// Applies every migration the database has not seen yet.
pub fn migrate(conn: &mut Connection) -> AppResult<()> {
    let version: u32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let applied = version as usize;

    if applied > schema::MIGRATIONS.len() {
        return Err(AppError::Internal(format!(
            "database is at version {applied}, but this build only knows {}. \
             Refusing to run against a newer schema.",
            schema::MIGRATIONS.len()
        )));
    }

    for (index, sql) in schema::MIGRATIONS.iter().enumerate().skip(applied) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        // PRAGMA does not accept bound parameters.
        tx.pragma_update(None, "user_version", (index + 1) as i64)?;
        tx.commit()?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = Db::open(dir.path().join("library.sqlite3")).expect("open");
        (dir, db)
    }

    #[test]
    fn migrates_to_the_latest_version() {
        let (_dir, db) = temp_db();
        let conn = db.conn().unwrap();
        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version as usize, schema::MIGRATIONS.len());
    }

    #[test]
    fn migrating_twice_is_a_no_op() {
        let (_dir, db) = temp_db();
        let mut conn = db.conn().unwrap();
        migrate(&mut conn).expect("second migrate must be a no-op");

        let tables: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='tracks'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 1);
    }

    #[test]
    fn refuses_a_database_from_a_newer_build() {
        let (_dir, db) = temp_db();
        let mut conn = db.conn().unwrap();
        conn.pragma_update(None, "user_version", 9999_i64).unwrap();

        let err = migrate(&mut conn).expect_err("must refuse a newer schema");
        assert!(
            err.to_string().contains("9999"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn fts_triggers_track_row_changes() {
        let (_dir, db) = temp_db();
        let conn = db.conn().unwrap();
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, title, artist, added_at)
             VALUES ('/music/a.mp3', 1, 2, 'Sakura Coming', 'Guitar', 0)",
            [],
        )
        .unwrap();

        let hits = |q: &str| -> i64 {
            conn.query_row(
                "SELECT count(*) FROM tracks_fts WHERE tracks_fts MATCH ?1",
                [q],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(hits("Sakura"), 1);

        conn.execute(
            "UPDATE tracks SET title = 'Akiko' WHERE path = '/music/a.mp3'",
            [],
        )
        .unwrap();
        assert_eq!(
            hits("Sakura"),
            0,
            "stale row left in the index after update"
        );
        assert_eq!(hits("Akiko"), 1);

        conn.execute("DELETE FROM tracks WHERE path = '/music/a.mp3'", [])
            .unwrap();
        assert_eq!(hits("Akiko"), 0, "stale row left in the index after delete");
    }
}
