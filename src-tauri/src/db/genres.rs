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
//! 84d's donut labels as derived, which turns a wrong guess into something to
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
//! then pure. [`members`] resolves every distinct genre in the library at
//! once, and the suffix derivation needs the entire label set to answer even
//! one string, so the alternative is thousands of round trips to answer
//! questions against a table that never changes while they run. The whole tree
//! is a couple of megabytes of short strings.

use std::collections::HashMap;

use rusqlite::Connection;

use crate::error::AppResult;

/// Where a resolved genre's parent came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ParentSource {
    /// A Wikidata `subclass of` edge. With no parent, the genre is a root of
    /// the tree rather than one nothing was found for - which is the whole
    /// reason this is not a bare `Option`.
    Wikidata,
    /// Guessed from the label's suffix. 84d shows this as derived.
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

    /// `raw`'s resolved label followed by each parent above it, up to a root.
    ///
    /// Stops at a label it has already passed: `genres.parent` is a forest,
    /// but an override can point a genre at its own descendant, and a walk
    /// that followed it would never end.
    pub fn lineage(&self, raw: &str) -> Vec<String> {
        let mut resolved = self.resolve(raw);
        let mut lineage = vec![resolved.label];
        while let Some(parent) = resolved.parent {
            if lineage.contains(&parent) {
                break;
            }
            resolved = self.resolve(&parent);
            lineage.push(parent);
        }
        lineage
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

/// Every raw `tracks.genre` at or below `genre`, as a JSON array.
///
/// Resolved through [`Tree`] rather than a recursive walk of `genre_edges`: a
/// tag reaches a label only through Rust-side normalization, aliases, the
/// suffix derivation and overrides, none of which the edge table holds, and
/// the edges are the whole DAG where the donut draws one parent. Filtering on
/// them would keep blackened death metal under black metal after an override
/// moved it, and the filter and the donut would disagree.
///
/// Over the whole library rather than a scope. For `ListenQuery` that is
/// because a play is matched to any file, not to the ones some view happens to
/// show; for `TrackQuery` it is because the caller is `query::scope`, and a
/// scope that narrowed itself before deciding what it contains is circular.
///
/// Here rather than in [`crate::db::stats`], which is where it was written:
/// `db::stats` imports `db::query`, so `scope` calling back into it would be a
/// back-edge, and the question is about the tree either way.
pub fn members(conn: &Connection, genre: &str) -> AppResult<String> {
    let tree = Tree::load(conn)?;
    let target = tree.resolve(genre).label;

    let mut statement =
        conn.prepare("SELECT DISTINCT genre FROM tracks WHERE genre IS NOT NULL AND genre <> ''")?;
    let members = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .filter_map(|raw| match raw {
            Ok(raw) if tree.lineage(&raw).contains(&target) => Some(Ok(raw)),
            Ok(_) => None,
            Err(error) => Some(Err(error)),
        })
        .collect::<rusqlite::Result<Vec<_>>>()?;

    serde_json::to_string(&members)
        .map_err(|e| crate::error::AppError::Internal(format!("encoding genres: {e}")))
}

/// How many labels a lookup offers.
///
/// [`crate::db::tag_values::SUGGESTION_LIMIT`]'s number, for its reason: eight
/// fits under a field without covering the rest of the dialog, and a longer
/// list is one you read rather than glance at.
pub const SUGGESTION_LIMIT: u32 = 8;

/// Known genre labels for what someone has typed so far, best match first.
///
/// The same rule [`crate::db::tag_values::suggest`] applies to a band name:
/// matched anywhere in the label, **ranked by prefix first**, with `%` and `_`
/// escaped so a label containing either is not a wildcard. Typing `metal`
/// offers `black metal`, and two autocompletes in one window that filter by
/// different rules is a papercut.
///
/// `genres` has no `uses` column to break ties with, so the tie-break is the
/// shorter label and then the label itself: `metal` is a better answer to
/// `metal` than `metalcore` is.
///
/// Over `genres` alone rather than the aliases as well. `set_override`
/// resolves an alias, so one still works if it is typed in full - but an
/// aliases-in-the-list version would offer several names for one branch, and
/// the field is asking which branch rather than what to call it.
pub fn suggest(conn: &Connection, query: &str, limit: u32) -> AppResult<Vec<String>> {
    let trimmed = normalize(query);
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let escaped = crate::smart::like_escape(&trimmed);
    let escape = crate::smart::LIKE_ESCAPE;
    let mut statement = conn.prepare(&format!(
        "SELECT label FROM genres
         WHERE label LIKE ?1 ESCAPE '{escape}'
         ORDER BY (label LIKE ?2 ESCAPE '{escape}') DESC, length(label), label
         LIMIT ?3"
    ))?;
    let rows = statement.query_map(
        rusqlite::params![format!("%{escaped}%"), format!("{escaped}%"), limit],
        |row| row.get(0),
    )?;
    Ok(rows.collect::<Result<Vec<String>, _>>()?)
}

/// Records that `label`'s parent is `parent`, replacing any earlier override.
///
/// `None` is not "forget this override" but "this genre has no parent" - the
/// correction that a genre Wikidata filed under something belongs at the top of
/// the tree. [`clear_override`] is what forgets one.
///
/// Both are normalised here rather than at the call site, so an override typed
/// as "Black Metal" is the same row as one typed as "black metal". **The parent
/// is resolved rather than only normalised**: `genre_overrides.parent` points
/// into `genres`, and an alias is a name the rest of the app accepts and that
/// table does not.
///
/// # Refusals
///
/// Both are here rather than in the command, so no caller can skip them.
///
/// - A parent no layer of the tree knows. The foreign key would catch it, but
///   a constraint violation names neither the genre nor what was typed.
/// - A parent that is already at or below `label`, which would close a loop.
///   [`Tree::lineage`] survives one by stopping at a label it has seen, but the
///   donut would draw it and 84d's subtree filter would return the wrong
///   members. `lineage` starts at the resolved label itself, so the same
///   condition catches a genre named as its own parent.
pub fn set_override(conn: &Connection, label: &str, parent: Option<&str>) -> AppResult<()> {
    let label = normalize(label);
    let parent = match parent {
        None => None,
        Some(parent) => {
            let tree = Tree::load(conn)?;
            let resolved = tree.resolve(parent);
            if resolved.parent_source == ParentSource::Unknown
                && !tree.parents.contains_key(&resolved.label)
            {
                return Err(crate::error::AppError::NotFound(format!(
                    "no genre called \"{}\"",
                    resolved.label
                )));
            }
            if tree.lineage(&resolved.label).contains(&label) {
                return Err(crate::error::AppError::Internal(format!(
                    "\"{label}\" is at or above \"{}\", so this would make it its own parent",
                    resolved.label
                )));
            }
            Some(resolved.label)
        }
    };

    conn.execute(
        "INSERT INTO genre_overrides (label, parent) VALUES (?1, ?2)
         ON CONFLICT (label) DO UPDATE SET parent = excluded.parent",
        rusqlite::params![label, parent],
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

    /// `lineage` survives a cycle by stopping at a label it has seen, so this
    /// is not about hanging: the donut would draw a loop and 84d's subtree
    /// filter would return the wrong members.
    #[test]
    fn an_override_that_makes_a_genre_its_own_ancestor_is_refused() {
        let (_dir, conn) = open();

        // `black metal` is under `extreme metal` in the seed, so filing
        // `extreme metal` under it closes the loop.
        let closed = set_override(&conn, "Extreme Metal", Some("Black Metal"));

        assert!(closed.is_err(), "a cycle must not be stored");
        assert_eq!(
            Tree::load(&conn)
                .unwrap()
                .resolve("extreme metal")
                .parent_source,
            ParentSource::Wikidata,
            "the tree is unchanged after the refusal"
        );
    }

    #[test]
    fn a_genre_cannot_be_its_own_parent() {
        let (_dir, conn) = open();

        // The degenerate case of the same rule, and the one somebody reaches
        // by pressing Enter on a field they meant to clear.
        assert!(set_override(&conn, "Black Metal", Some("black metal")).is_err());
    }

    #[test]
    fn suggestions_rank_a_prefix_above_a_match_in_the_middle() {
        let (_dir, conn) = open();

        let found = suggest(&conn, "black metal", 20).unwrap();

        assert_eq!(
            found.first().map(String::as_str),
            Some("black metal"),
            "the exact label is the shortest prefix match, got: {found:?}"
        );
        let symphonic = found
            .iter()
            .position(|label| label == "symphonic black metal");
        assert!(
            symphonic.is_some(),
            "a match in the middle is still offered"
        );
        assert!(
            found.iter().position(|l| l == "black metal") < symphonic,
            "prefix matches rank first, got: {found:?}"
        );
    }

    #[test]
    fn suggestions_honour_their_limit() {
        let (_dir, conn) = open();

        assert_eq!(suggest(&conn, "metal", 5).unwrap().len(), 5);
    }

    /// A label is allowed to contain `%` and `_`, and must not turn into a
    /// wildcard - the treatment `tag_values::suggest` already gives a band
    /// name for the same reason.
    #[test]
    fn a_wildcard_in_the_query_is_matched_literally() {
        let (_dir, conn) = open();

        assert!(suggest(&conn, "%metal%", 20).unwrap().is_empty());
    }

    /// An alias is a name the rest of the app accepts and `genres` does not,
    /// so the parent is stored resolved. Normalising it alone wrote the alias
    /// and hit the foreign key.
    #[test]
    fn an_alias_is_a_parent_the_tree_knows() {
        let (_dir, conn) = open();

        set_override(&conn, "windowlicker", Some("DSBM")).unwrap();

        assert_eq!(
            Tree::load(&conn).unwrap().resolve("windowlicker").parent,
            Some("depressive black metal".to_owned())
        );
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

    /// A parent nothing knows is a branch the donut cannot draw, so it is
    /// refused rather than stored as a dead end.
    ///
    /// The foreign key would catch it either way. What is asserted here is
    /// that it does not get that far: a constraint violation names neither the
    /// genre nor what was typed, and this is a message an editor shows someone
    /// who mistyped a label.
    #[test]
    fn an_override_onto_an_unknown_parent_is_refused() {
        let (_dir, conn) = open();

        let error = set_override(&conn, "black metal", Some("Not A Genre")).unwrap_err();

        assert!(
            error.to_string().contains("not a genre"),
            "the refusal has to name what was typed, got: {error}"
        );
        assert!(
            !error.to_string().to_lowercase().contains("foreign key"),
            "the write should not have reached the constraint, got: {error}"
        );
    }

    #[test]
    fn a_lineage_runs_from_the_tag_up_to_a_root() {
        let (_dir, conn) = open();
        let tree = Tree::load(&conn).unwrap();

        let lineage = tree.lineage("Trve Kvlt Raw Black Metal");
        assert_eq!(
            lineage[..3],
            [
                "trve kvlt raw black metal",
                "raw black metal",
                "black metal"
            ]
        );
        let root = lineage.last().unwrap();
        assert_eq!(tree.resolve(root).parent, None, "{lineage:?}");
    }

    /// Written straight into the table rather than through [`set_override`],
    /// which refuses to build one. The reader still has to survive a cycle: a
    /// database written before that refusal existed, or edited by hand, is a
    /// database this has to answer for, and `lineage` is what every genre
    /// filter and the donut walk.
    #[test]
    fn a_lineage_through_a_cycle_of_overrides_ends() {
        let (_dir, conn) = open();
        conn.execute(
            "INSERT INTO genre_overrides (label, parent)
             VALUES ('black metal', 'atmospheric black metal')",
            [],
        )
        .unwrap();
        let tree = Tree::load(&conn).unwrap();

        assert_eq!(
            tree.lineage("Atmospheric Black Metal"),
            ["atmospheric black metal", "black metal"]
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
