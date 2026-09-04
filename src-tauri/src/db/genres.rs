//! What a genre tag means, and what it sits under.
//!
//! An ID3 genre frame is free text. "Atmospheric Black Metal", "atmo-black"
//! and "Trve Kvlt Black Metal" are three strings, and a drill-down that treats
//! them as three unrelated genres is a list, not a hierarchy. This turns one
//! such string into a genre and a parent.
//!
//! # Three layers
//!
//! **Wikidata label or alias, then suffix derivation, then the override.**
//!
//! The first two come from `scripts/genres.mjs` and migration 11: 6,575 genre
//! labels with one primary parent each, plus the aliases, so "DSBM" reaches
//! depressive black metal.
//!
//! Suffix derivation covers what Wikidata lacks, by treating a genre as a child
//! of any shorter genre its name ends with at a word boundary, longest match
//! winning. It is guesswork, so it says so - [`ParentSource::Derived`] is what
//! 84b's panel labels as derived, which turns a wrong guess into something to
//! see and fix rather than something to trust.
//!
//! The override is the user's, wins over both, and is the only one of the four
//! tables the app writes at runtime. It exists because the primary parent is
//! **arbitrary where a genre has several** - nothing makes black metal more the
//! parent of blackened death metal than death metal is - and because the
//! derivation guesses.
//!
//! # Why the whole tree is loaded at once
//!
//! [`Tree::load`] reads all four tables into memory and [`Tree::resolve`] is
//! then pure. 84b resolves every distinct genre in the library at once, and the
//! suffix derivation needs the entire label set to answer even one string, so
//! the alternative is thousands of round trips to answer questions against a
//! table that never changes while they run. The whole tree is a couple of
//! megabytes of short strings.

use std::collections::HashMap;

use rusqlite::Connection;

use crate::error::AppResult;

/// Where a resolved genre's parent came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParentSource {
    /// A Wikidata `subclass of` edge. With no parent, the genre is a root of
    /// the tree rather than one nothing was found for - which is the whole
    /// reason this is not a bare `Option`.
    Wikidata,
    /// Guessed from the label's suffix. 84b shows this as derived.
    Derived,
    /// The user's correction, which beats the other two.
    Override,
    /// No layer knew the label at all.
    Unknown,
}

/// A genre tag, resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    /// Normalised, and the canonical label where an alias named it.
    pub label: String,
    pub parent: Option<String>,
    pub parent_source: ParentSource,
}

/// The genre hierarchy, in memory.
#[derive(Debug, Clone, Default)]
pub struct Tree {
    /// Label to its primary parent. Present with `None` means a root.
    parents: HashMap<String, Option<String>>,
    aliases: HashMap<String, String>,
    /// Same shape as `parents`: `None` is "this genre has no parent", which is
    /// a correction someone may well want to make.
    overrides: HashMap<String, Option<String>>,
}

/// The form every label is stored and matched in.
///
/// Must stay in lockstep with `normalize` in `scripts/genres.mjs`, which is
/// what put the labels in the database. Rust's `to_lowercase` is Unicode-aware
/// where SQLite's `lower()` and `COLLATE NOCASE` are ASCII-only, which is why
/// this is not done in SQL: "Kosmische Musik" has to meet "kosmische musik",
/// and Motörhead-shaped labels have to survive it.
pub fn normalize(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut pending_space = false;
    for character in raw.trim().chars().flat_map(char::to_lowercase) {
        if character.is_whitespace() {
            pending_space = true;
            continue;
        }
        if pending_space {
            out.push(' ');
            pending_space = false;
        }
        out.push(character);
    }
    out
}

impl Tree {
    pub fn load(conn: &Connection) -> AppResult<Self> {
        let mut parents = HashMap::new();
        let mut statement = conn.prepare("SELECT label, parent FROM genres")?;
        for row in statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })? {
            let (label, parent) = row?;
            parents.insert(label, parent);
        }

        let mut aliases = HashMap::new();
        let mut statement = conn.prepare("SELECT alias, label FROM genre_aliases")?;
        for row in statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })? {
            let (alias, label) = row?;
            aliases.insert(alias, label);
        }

        let mut overrides = HashMap::new();
        let mut statement = conn.prepare("SELECT label, parent FROM genre_overrides")?;
        for row in statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })? {
            let (label, parent) = row?;
            overrides.insert(label, parent);
        }

        Ok(Self {
            parents,
            aliases,
            overrides,
        })
    }

    /// Resolves one genre tag through the three layers.
    pub fn resolve(&self, raw: &str) -> Resolved {
        let mut label = normalize(raw);

        // The alias table is consulted only for a label the tree does not know,
        // so a genre that is also somebody else's alias stays itself. The
        // generator drops aliases that collide with a label for the same
        // reason, but a database seeded by an older generation is still a
        // database this has to answer for.
        if !self.parents.contains_key(&label) {
            if let Some(canonical) = self.aliases.get(&label) {
                label = canonical.clone();
            }
        }

        // The override first, so it beats a Wikidata parent as well as a guess.
        if let Some(parent) = self.overrides.get(&label) {
            return Resolved {
                label,
                parent: parent.clone(),
                parent_source: ParentSource::Override,
            };
        }

        if let Some(parent) = self.parents.get(&label) {
            return Resolved {
                label,
                parent: parent.clone(),
                parent_source: ParentSource::Wikidata,
            };
        }

        match self.derive(&label) {
            Some(parent) => Resolved {
                label,
                parent: Some(parent),
                parent_source: ParentSource::Derived,
            },
            None => Resolved {
                label,
                parent: None,
                parent_source: ParentSource::Unknown,
            },
        }
    }

    /// The longest known genre `label` ends with, at a word boundary.
    ///
    /// Driven from the spaces in `label` rather than by testing 6,575 labels
    /// for `ends_with`, which makes the word boundary structural instead of a
    /// filter: the only candidates that exist are whole trailing words. Without
    /// it "metalcore" would come out a child of "core", and "grindcore" a
    /// sibling of neither of the things it actually descends from.
    ///
    /// Leftmost space first, so the longest candidate wins - "atmospheric black
    /// metal" is filed under black metal, not under metal.
    fn derive(&self, label: &str) -> Option<String> {
        label
            .char_indices()
            .filter(|(_, character)| *character == ' ')
            .map(|(at, _)| &label[at + 1..])
            .find(|candidate| self.parents.contains_key(*candidate))
            .map(str::to_owned)
    }
}

/// Records that `label`'s parent is `parent`, replacing any earlier override.
///
/// `None` is not "forget this override" but "this genre has no parent" - the
/// correction that a genre Wikidata filed under something belongs at the top of
/// the tree. [`clear_override`] is what forgets one.
///
/// Both are normalised here rather than at the call site, so an override typed
/// as "Black Metal" is the same row as one typed as "black metal".
pub fn set_override(conn: &Connection, label: &str, parent: Option<&str>) -> AppResult<()> {
    let parent = parent.map(normalize);
    conn.execute(
        "INSERT INTO genre_overrides (label, parent) VALUES (?1, ?2)
         ON CONFLICT (label) DO UPDATE SET parent = excluded.parent",
        rusqlite::params![normalize(label), parent],
    )?;
    Ok(())
}

/// Drops `label`'s override, so it resolves the way it did before.
pub fn clear_override(conn: &Connection, label: &str) -> AppResult<()> {
    conn.execute(
        "DELETE FROM genre_overrides WHERE label = ?1",
        [normalize(label)],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn open() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    /// The seed is committed data, so these are facts about the file rather
    /// than about the loader - and the file is what every other test here
    /// stands on.
    #[test]
    fn the_migration_seeds_the_tree_it_ships() {
        let (_dir, conn) = open();
        let tree = Tree::load(&conn).unwrap();

        assert_eq!(
            tree.resolve("Atmospheric Black Metal"),
            Resolved {
                label: "atmospheric black metal".to_owned(),
                parent: Some("black metal".to_owned()),
                parent_source: ParentSource::Wikidata,
            }
        );

        // The multi-parent case the whole DAG exists for: the primary parent is
        // one of the two, and both edges survive.
        let edges: Vec<String> = conn
            .prepare("SELECT parent FROM genre_edges WHERE child = 'blackened death metal' ORDER BY parent")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(edges, ["black metal", "death metal"]);
    }

    #[test]
    fn an_alias_reaches_the_genre_it_names() {
        let (_dir, conn) = open();
        let tree = Tree::load(&conn).unwrap();

        assert_eq!(
            tree.resolve("DSBM"),
            Resolved {
                label: "depressive black metal".to_owned(),
                parent: Some("black metal".to_owned()),
                parent_source: ParentSource::Wikidata,
            }
        );
    }

    /// A root has no parent and is still known, which is the distinction
    /// `ParentSource` exists to carry: the donut draws this genre, and does not
    /// draw one nothing was found for.
    #[test]
    fn a_root_genre_is_known_and_parentless() {
        let (_dir, conn) = open();
        let tree = Tree::load(&conn).unwrap();

        let resolved = tree.resolve("popular music");
        assert_eq!(resolved.parent, None);
        assert_eq!(resolved.parent_source, ParentSource::Wikidata);
    }

    #[test]
    fn a_genre_wikidata_lacks_is_derived_from_its_suffix_and_flagged() {
        let (_dir, conn) = open();
        let tree = Tree::load(&conn).unwrap();

        // Longest match: "raw black metal" over "black metal" over "metal".
        assert_eq!(
            tree.resolve("Trve Kvlt Raw Black Metal"),
            Resolved {
                label: "trve kvlt raw black metal".to_owned(),
                parent: Some("raw black metal".to_owned()),
                parent_source: ParentSource::Derived,
            }
        );
    }

    /// The rule that makes the derivation defensible rather than a substring
    /// search: only whole trailing words are candidates.
    #[test]
    fn derivation_does_not_split_a_word() {
        let (_dir, conn) = open();
        let mut tree = Tree::load(&conn).unwrap();
        tree.parents.insert("core".to_owned(), None);

        assert_eq!(
            tree.resolve("windowlicker").parent_source,
            ParentSource::Unknown
        );
        assert_eq!(
            tree.resolve("nintendo core").parent,
            Some("core".to_owned()),
            "a trailing word is still a candidate"
        );
    }

    #[test]
    fn a_genre_no_layer_knows_resolves_to_nothing() {
        let (_dir, conn) = open();
        let tree = Tree::load(&conn).unwrap();

        assert_eq!(
            tree.resolve("Unknown"),
            Resolved {
                label: "unknown".to_owned(),
                parent: None,
                parent_source: ParentSource::Unknown,
            }
        );
    }

    #[test]
    fn an_override_beats_wikidata_and_the_derivation() {
        let (_dir, conn) = open();

        set_override(&conn, "Blackened Death Metal", Some("Death Metal")).unwrap();
        set_override(&conn, "trve kvlt raw black metal", Some("black metal")).unwrap();
        let tree = Tree::load(&conn).unwrap();

        assert_eq!(
            tree.resolve("blackened death metal"),
            Resolved {
                label: "blackened death metal".to_owned(),
                parent: Some("death metal".to_owned()),
                parent_source: ParentSource::Override,
            }
        );
        assert_eq!(
            tree.resolve("Trve Kvlt Raw Black Metal"),
            Resolved {
                label: "trve kvlt raw black metal".to_owned(),
                parent: Some("black metal".to_owned()),
                parent_source: ParentSource::Override,
            }
        );
    }

    #[test]
    fn an_override_can_say_a_genre_has_no_parent() {
        let (_dir, conn) = open();
        set_override(&conn, "black metal", None).unwrap();
        let tree = Tree::load(&conn).unwrap();

        let resolved = tree.resolve("black metal");
        assert_eq!(resolved.parent, None);
        assert_eq!(resolved.parent_source, ParentSource::Override);
    }

    #[test]
    fn setting_an_override_twice_replaces_it_and_clearing_it_restores_wikidata() {
        let (_dir, conn) = open();

        set_override(&conn, "black metal", Some("death metal")).unwrap();
        set_override(&conn, "black metal", Some("doom metal")).unwrap();
        assert_eq!(
            Tree::load(&conn).unwrap().resolve("black metal").parent,
            Some("doom metal".to_owned())
        );

        clear_override(&conn, "Black Metal").unwrap();
        assert_eq!(
            Tree::load(&conn).unwrap().resolve("black metal"),
            Resolved {
                label: "black metal".to_owned(),
                parent: Some("extreme metal".to_owned()),
                parent_source: ParentSource::Wikidata,
            }
        );
    }

    /// A parent nothing knows is a branch the donut cannot draw, so the foreign
    /// key refuses it rather than storing a dead end.
    #[test]
    fn an_override_onto_an_unknown_parent_is_refused() {
        let (_dir, conn) = open();

        let error = set_override(&conn, "black metal", Some("not a genre")).unwrap_err();
        assert!(
            error.to_string().to_lowercase().contains("foreign key"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn normalization_folds_case_and_collapses_whitespace() {
        assert_eq!(
            normalize("  Atmospheric   Black\tMetal "),
            "atmospheric black metal"
        );
        // Unicode, which is the reason this is not SQLite's `lower()`.
        assert_eq!(normalize("Kosmische MUSIK"), "kosmische musik");
        assert_eq!(normalize("MOTÖRHEAD"), "motörhead");
    }
}
