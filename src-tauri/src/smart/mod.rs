//! Compiles a saved filter tree into a parameterized `WHERE` clause.
//!
//! Nothing a user types ever reaches the statement as text. Fields and
//! operators are enums whose SQL forms are literals; every value is bound.
//! That is the whole security argument for smart playlists, so this module is
//! deliberately small, pure, and tested against the hostile cases directly.

use rusqlite::ToSql;

use crate::error::{AppError, AppResult};
use crate::model::{Combinator, FilterFieldKind, FilterGroup, FilterNode, FilterOp, FilterValue};

/// How deeply groups may nest.
///
/// Compilation recurses, so an unbounded tree from a corrupt or hand-edited
/// `filter_json` would be a stack overflow. Ten is far past anything a person
/// builds in the editor.
pub const MAX_DEPTH: usize = 10;

/// How many rules one filter may hold in total.
///
/// SQLite caps how many parameters a statement may bind, and a filter that
/// large is a mistake rather than a query.
pub const MAX_RULES: usize = 200;

/// The character `LIKE` patterns escape with.
///
/// A user searching for a literal `%` must not get a wildcard, so `%`, `_` and
/// the escape character itself are escaped before the pattern is built.
pub(crate) const LIKE_ESCAPE: char = '\\';

pub struct Compiled {
    /// A complete boolean expression, safe to drop into a `WHERE`.
    pub sql: String,
    pub params: Vec<Box<dyn ToSql>>,
}

/// Compiles `group` against a clock reading of `now` (unix seconds).
///
/// `now` is passed in rather than read here so "added in the last 7 days" is
/// testable without waiting a week.
pub fn compile(group: &FilterGroup, now: i64) -> AppResult<Compiled> {
    let mut params: Vec<Box<dyn ToSql>> = Vec::new();
    let mut rules = 0;
    let sql = compile_group(group, now, 0, &mut params, &mut rules)?;
    Ok(Compiled { sql, params })
}

fn compile_group(
    group: &FilterGroup,
    now: i64,
    depth: usize,
    params: &mut Vec<Box<dyn ToSql>>,
    rules: &mut usize,
) -> AppResult<String> {
    if depth > MAX_DEPTH {
        return Err(AppError::Internal(format!(
            "This filter nests more than {MAX_DEPTH} groups deep."
        )));
    }

    let mut parts = Vec::with_capacity(group.children.len());
    for child in &group.children {
        parts.push(match child {
            FilterNode::Rule(rule) => {
                *rules += 1;
                if *rules > MAX_RULES {
                    return Err(AppError::Internal(format!(
                        "This filter has more than {MAX_RULES} rules."
                    )));
                }
                compile_rule(rule, now, params)?
            }
            FilterNode::Group(nested) => compile_group(nested, now, depth + 1, params, rules)?,
        });
    }

    if parts.is_empty() {
        // A group with nothing in it matches everything. A smart playlist the
        // user has just created has no rules yet, and showing them the whole
        // library to narrow down beats showing them nothing to look at.
        return Ok("1 = 1".to_owned());
    }

    let joiner = match group.combinator {
        Combinator::All => " AND ",
        Combinator::Any => " OR ",
    };
    Ok(format!("({})", parts.join(joiner)))
}

fn compile_rule(
    rule: &crate::model::FilterRule,
    now: i64,
    params: &mut Vec<Box<dyn ToSql>>,
) -> AppResult<String> {
    // Table-qualified: a smart filter runs in the same statement as the FTS
    // join, which carries columns of the same names.
    let column = format!("tracks.{}", rule.field.as_sql());
    let kind = rule.field.kind();

    match rule.op {
        FilterOp::IsEmpty => return Ok(format!("({column} IS NULL OR {column} = '')")),
        FilterOp::IsNotEmpty => return Ok(format!("({column} IS NOT NULL AND {column} <> '')")),
        _ => {}
    }

    match (kind, rule.op) {
        // ---- text ----
        (FilterFieldKind::Text, FilterOp::Is) => {
            params.push(Box::new(text(rule)?));
            Ok(format!("{column} = ? COLLATE NOCASE"))
        }
        (FilterFieldKind::Text, FilterOp::IsNot) => {
            params.push(Box::new(text(rule)?));
            // A NULL column is "not X" to a person, but `NULL <> 'x'` is NULL
            // and would drop the row. Untagged files have to survive an
            // exclusion rule or "not by this artist" quietly loses them.
            Ok(format!(
                "({column} IS NULL OR {column} <> ? COLLATE NOCASE)"
            ))
        }
        (FilterFieldKind::Text, FilterOp::Contains) => {
            params.push(Box::new(format!("%{}%", like_escape(&text(rule)?))));
            Ok(like(&column, false))
        }
        (FilterFieldKind::Text, FilterOp::DoesNotContain) => {
            params.push(Box::new(format!("%{}%", like_escape(&text(rule)?))));
            Ok(like(&column, true))
        }
        (FilterFieldKind::Text, FilterOp::StartsWith) => {
            params.push(Box::new(format!("{}%", like_escape(&text(rule)?))));
            Ok(like(&column, false))
        }
        (FilterFieldKind::Text, FilterOp::EndsWith) => {
            params.push(Box::new(format!("%{}", like_escape(&text(rule)?))));
            Ok(like(&column, false))
        }

        // ---- numbers and timestamps ----
        (FilterFieldKind::Number | FilterFieldKind::Timestamp, FilterOp::Is) => {
            params.push(Box::new(number(rule)?));
            Ok(format!("{column} = ?"))
        }
        (FilterFieldKind::Number | FilterFieldKind::Timestamp, FilterOp::IsNot) => {
            params.push(Box::new(number(rule)?));
            Ok(format!("({column} IS NULL OR {column} <> ?)"))
        }
        (FilterFieldKind::Number | FilterFieldKind::Timestamp, FilterOp::GreaterThan) => {
            params.push(Box::new(number(rule)?));
            Ok(format!("{column} > ?"))
        }
        (FilterFieldKind::Number | FilterFieldKind::Timestamp, FilterOp::LessThan) => {
            params.push(Box::new(number(rule)?));
            Ok(format!("{column} < ?"))
        }
        (FilterFieldKind::Number | FilterFieldKind::Timestamp, FilterOp::Between) => {
            let (from, to) = match rule.value {
                // Accepted in either order: a range typed backwards is a slip,
                // not a request for an empty playlist.
                FilterValue::Range { from, to } => (from.min(to), from.max(to)),
                _ => return Err(mismatch(rule, "a range")),
            };
            params.push(Box::new(from));
            params.push(Box::new(to));
            Ok(format!("{column} BETWEEN ? AND ?"))
        }
        (FilterFieldKind::Timestamp, FilterOp::InLast) => {
            let days = number(rule)?;
            if days < 0 {
                return Err(AppError::Internal(
                    "\"in the last\" needs a number of days that is not negative.".to_owned(),
                ));
            }
            // Saturating, so an absurd number of days becomes "ever" rather
            // than wrapping into the future and matching nothing.
            params.push(Box::new(now.saturating_sub(days.saturating_mul(86_400))));
            Ok(format!("{column} >= ?"))
        }

        (_, op) => Err(AppError::Internal(format!(
            "{:?} does not accept the operator {op:?}.",
            rule.field
        ))),
    }
}

/// `LIKE` with an explicit escape, optionally negated.
///
/// The negation spells out the NULL case for the same reason `IsNot` does:
/// `NOT (NULL LIKE …)` is NULL, which would drop every untagged row.
fn like(column: &str, negated: bool) -> String {
    if negated {
        format!("({column} IS NULL OR {column} NOT LIKE ? ESCAPE '{LIKE_ESCAPE}')")
    } else {
        format!("{column} LIKE ? ESCAPE '{LIKE_ESCAPE}'")
    }
}

/// Neutralises the wildcards in a user's text so it matches literally.
///
/// Shared with the tag-value lookup, which faces the same problem: a band name
/// containing `_` must not become a single-character wildcard.
pub(crate) fn like_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if character == '%' || character == '_' || character == LIKE_ESCAPE {
            escaped.push(LIKE_ESCAPE);
        }
        escaped.push(character);
    }
    escaped
}

fn text(rule: &crate::model::FilterRule) -> AppResult<String> {
    match &rule.value {
        FilterValue::Text { text } => Ok(text.clone()),
        _ => Err(mismatch(rule, "text")),
    }
}

fn number(rule: &crate::model::FilterRule) -> AppResult<i64> {
    match &rule.value {
        FilterValue::Number { number } => Ok(*number),
        _ => Err(mismatch(rule, "a number")),
    }
}

fn mismatch(rule: &crate::model::FilterRule, wanted: &str) -> AppError {
    AppError::Internal(format!(
        "The rule on {:?} needs {wanted}, but was given {:?}.",
        rule.field, rule.value
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::model::{FilterField, FilterRule};

    const NOW: i64 = 1_700_000_000;

    fn rule(field: FilterField, op: FilterOp, value: FilterValue) -> FilterNode {
        FilterNode::Rule(FilterRule { field, op, value })
    }

    fn text_value(value: &str) -> FilterValue {
        FilterValue::Text {
            text: value.to_owned(),
        }
    }

    fn all(children: Vec<FilterNode>) -> FilterGroup {
        FilterGroup {
            combinator: Combinator::All,
            children,
        }
    }

    fn any(children: Vec<FilterNode>) -> FilterGroup {
        FilterGroup {
            combinator: Combinator::Any,
            children,
        }
    }

    /// The library the SQL is actually run against, so a compiled filter is
    /// checked by what it selects rather than by the string it produced.
    fn seeded() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        let rows = [
            // path, title, artist, genre, year, play_count, added_at
            (
                "/m/1.mp3",
                "Maki",
                "Guitar",
                "Shoegaze",
                2012,
                5,
                NOW - 86_400,
            ),
            (
                "/m/2.mp3",
                "Sakura Coming",
                "Guitar",
                "Shoegaze",
                2012,
                0,
                NOW - 86_400 * 30,
            ),
            (
                "/m/3.mp3",
                "Half Gate",
                "Grizzly Bear",
                "Indie",
                2012,
                12,
                NOW - 86_400 * 400,
            ),
            (
                "/m/4.mp3",
                "Gun-Shy",
                "Grizzly Bear",
                "Indie",
                2017,
                3,
                NOW - 3600,
            ),
            // 100% literal wildcards in the title, to pin LIKE escaping down.
            ("/m/5.mp3", "50% Off_Sale", "Ads", "Noise", 2020, 0, NOW),
        ];
        for (path, title, artist, genre, year, plays, added) in rows {
            conn.execute(
                "INSERT INTO tracks (path, mtime, size, title, artist, genre, year,
                                     play_count, added_at)
                 VALUES (?1, 1, 1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![path, title, artist, genre, year, plays, added],
            )
            .unwrap();
        }
        // An untagged file: every NULL-handling case below turns on it.
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, added_at) VALUES ('/m/6.mp3', 1, 1, 0)",
            [],
        )
        .unwrap();
        (dir, db)
    }

    /// Paths matched by `group`, in path order.
    fn matches(db: &Db, group: &FilterGroup) -> Vec<String> {
        let compiled = compile(group, NOW).expect("compile");
        let conn = db.conn().unwrap();
        let sql = format!(
            "SELECT tracks.path FROM tracks WHERE {} ORDER BY tracks.path",
            compiled.sql
        );
        let mut stmt = conn.prepare(&sql).expect("prepare");
        stmt.query_map(rusqlite::params_from_iter(compiled.params.iter()), |row| {
            row.get(0)
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap()
    }

    #[test]
    fn an_empty_filter_matches_the_whole_library() {
        let (_dir, db) = seeded();
        // A smart playlist that has just been created has no rules yet.
        assert_eq!(matches(&db, &FilterGroup::default()).len(), 6);
    }

    #[test]
    fn all_narrows_and_any_widens() {
        let (_dir, db) = seeded();
        let artist = rule(FilterField::Artist, FilterOp::Is, text_value("Guitar"));
        let year = rule(
            FilterField::Year,
            FilterOp::GreaterThan,
            FilterValue::Number { number: 2015 },
        );

        assert_eq!(
            matches(&db, &all(vec![artist.clone(), year.clone()])),
            [] as [String; 0]
        );
        assert_eq!(
            matches(&db, &any(vec![artist, year])),
            ["/m/1.mp3", "/m/2.mp3", "/m/4.mp3", "/m/5.mp3"]
        );
    }

    #[test]
    fn groups_nest() {
        let (_dir, db) = seeded();
        // Grizzly Bear, or anything from 2020 onwards.
        let group = any(vec![
            FilterNode::Group(all(vec![rule(
                FilterField::Artist,
                FilterOp::Is,
                text_value("Grizzly Bear"),
            )])),
            FilterNode::Group(all(vec![rule(
                FilterField::Year,
                FilterOp::GreaterThan,
                FilterValue::Number { number: 2019 },
            )])),
        ]);

        assert_eq!(matches(&db, &group), ["/m/3.mp3", "/m/4.mp3", "/m/5.mp3"]);
    }

    #[test]
    fn text_comparison_ignores_case() {
        let (_dir, db) = seeded();

        assert_eq!(
            matches(
                &db,
                &all(vec![rule(
                    FilterField::Artist,
                    FilterOp::Is,
                    text_value("guitar")
                )])
            ),
            ["/m/1.mp3", "/m/2.mp3"]
        );
    }

    #[test]
    fn wildcards_in_the_users_text_are_matched_literally() {
        let (_dir, db) = seeded();
        // Unescaped, "50%" would match every title starting with "50", and
        // "Off_Sale" would match "OffXSale".
        assert_eq!(
            matches(
                &db,
                &all(vec![rule(
                    FilterField::Title,
                    FilterOp::Contains,
                    text_value("50% Off_Sale")
                )])
            ),
            ["/m/5.mp3"]
        );
        assert_eq!(
            matches(
                &db,
                &all(vec![rule(
                    FilterField::Title,
                    FilterOp::Contains,
                    text_value("%")
                )])
            ),
            ["/m/5.mp3"],
            "a bare % must be a literal, not \"everything\""
        );
        assert_eq!(
            matches(
                &db,
                &all(vec![rule(
                    FilterField::Title,
                    FilterOp::Contains,
                    text_value("_")
                )])
            ),
            ["/m/5.mp3"]
        );
    }

    #[test]
    fn an_untagged_row_survives_an_exclusion_rule() {
        let (_dir, db) = seeded();

        // `NULL <> 'Guitar'` is NULL, so a naive translation drops /m/6.mp3
        // entirely - "not by Guitar" would quietly lose every untagged file.
        assert_eq!(
            matches(
                &db,
                &all(vec![rule(
                    FilterField::Artist,
                    FilterOp::IsNot,
                    text_value("Guitar")
                )])
            ),
            ["/m/3.mp3", "/m/4.mp3", "/m/5.mp3", "/m/6.mp3"]
        );
        assert_eq!(
            matches(
                &db,
                &all(vec![rule(
                    FilterField::Genre,
                    FilterOp::DoesNotContain,
                    text_value("Indie")
                )])
            ),
            ["/m/1.mp3", "/m/2.mp3", "/m/5.mp3", "/m/6.mp3"]
        );
    }

    #[test]
    fn empty_and_not_empty_treat_a_blank_string_as_missing() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        conn.execute("UPDATE tracks SET genre = '' WHERE path = '/m/5.mp3'", [])
            .unwrap();

        assert_eq!(
            matches(
                &db,
                &all(vec![rule(
                    FilterField::Genre,
                    FilterOp::IsEmpty,
                    FilterValue::None
                )])
            ),
            ["/m/5.mp3", "/m/6.mp3"]
        );
        assert_eq!(
            matches(
                &db,
                &all(vec![rule(
                    FilterField::Genre,
                    FilterOp::IsNotEmpty,
                    FilterValue::None
                )])
            ),
            ["/m/1.mp3", "/m/2.mp3", "/m/3.mp3", "/m/4.mp3"]
        );
    }

    #[test]
    fn starts_with_and_ends_with_anchor() {
        let (_dir, db) = seeded();

        assert_eq!(
            matches(
                &db,
                &all(vec![rule(
                    FilterField::Title,
                    FilterOp::StartsWith,
                    text_value("Ma")
                )])
            ),
            ["/m/1.mp3"]
        );
        assert_eq!(
            matches(
                &db,
                &all(vec![rule(
                    FilterField::Title,
                    FilterOp::EndsWith,
                    text_value("Gate")
                )])
            ),
            ["/m/3.mp3"]
        );
    }

    #[test]
    fn between_is_inclusive_and_accepts_its_ends_in_either_order() {
        let (_dir, db) = seeded();
        let forwards = all(vec![rule(
            FilterField::Year,
            FilterOp::Between,
            FilterValue::Range {
                from: 2012,
                to: 2017,
            },
        )]);
        let backwards = all(vec![rule(
            FilterField::Year,
            FilterOp::Between,
            FilterValue::Range {
                from: 2017,
                to: 2012,
            },
        )]);

        assert_eq!(
            matches(&db, &forwards),
            ["/m/1.mp3", "/m/2.mp3", "/m/3.mp3", "/m/4.mp3"]
        );
        assert_eq!(matches(&db, &backwards), matches(&db, &forwards));
    }

    #[test]
    fn in_last_counts_back_from_the_clock_it_was_given() {
        let (_dir, db) = seeded();
        let within = |days| {
            matches(
                &db,
                &all(vec![rule(
                    FilterField::AddedAt,
                    FilterOp::InLast,
                    FilterValue::Number { number: days },
                )]),
            )
        };

        assert_eq!(within(0), ["/m/5.mp3"]);
        assert_eq!(
            within(1),
            ["/m/1.mp3", "/m/4.mp3", "/m/5.mp3"],
            "a track added exactly a day ago is within the last day"
        );
        assert_eq!(within(60).len(), 4);
        assert_eq!(
            within(500).len(),
            5,
            "the untagged row has no added_at to be within"
        );
    }

    #[test]
    fn an_absurd_number_of_days_becomes_ever_rather_than_wrapping() {
        let (_dir, db) = seeded();

        // i64::MAX days overflows the multiply; wrapping would land in the
        // future and match nothing, which is the opposite of what was asked.
        let found = matches(
            &db,
            &all(vec![rule(
                FilterField::AddedAt,
                FilterOp::InLast,
                FilterValue::Number { number: i64::MAX },
            )]),
        );
        assert_eq!(found.len(), 6);
    }

    #[test]
    fn a_negative_number_of_days_is_refused() {
        let group = all(vec![rule(
            FilterField::AddedAt,
            FilterOp::InLast,
            FilterValue::Number { number: -1 },
        )]);

        assert!(compile(&group, NOW).is_err());
    }

    #[test]
    fn a_value_that_does_not_match_its_field_is_refused() {
        for group in [
            all(vec![rule(
                FilterField::Year,
                FilterOp::Is,
                text_value("2012"),
            )]),
            all(vec![rule(
                FilterField::Artist,
                FilterOp::Is,
                FilterValue::Number { number: 1 },
            )]),
            all(vec![rule(
                FilterField::Year,
                FilterOp::Between,
                FilterValue::Number { number: 1 },
            )]),
        ] {
            assert!(
                compile(&group, NOW).is_err(),
                "a mismatched value must be reported, not coerced"
            );
        }
    }

    #[test]
    fn an_operator_a_field_cannot_take_is_refused() {
        // "in the last N days" on a text column, and ">" on one.
        for group in [
            all(vec![rule(
                FilterField::Artist,
                FilterOp::InLast,
                FilterValue::Number { number: 7 },
            )]),
            all(vec![rule(
                FilterField::Artist,
                FilterOp::GreaterThan,
                FilterValue::Number { number: 7 },
            )]),
            all(vec![rule(
                FilterField::Year,
                FilterOp::Contains,
                text_value("20"),
            )]),
        ] {
            assert!(compile(&group, NOW).is_err());
        }
    }

    #[test]
    fn a_tree_that_nests_too_deep_is_refused_rather_than_overflowing_the_stack() {
        let mut group = all(vec![]);
        for _ in 0..MAX_DEPTH + 2 {
            group = all(vec![FilterNode::Group(group)]);
        }

        assert!(compile(&group, NOW).is_err());
    }

    #[test]
    fn a_tree_at_the_depth_limit_still_compiles() {
        let mut group = all(vec![rule(
            FilterField::Year,
            FilterOp::Is,
            FilterValue::Number { number: 2012 },
        )]);
        for _ in 0..MAX_DEPTH {
            group = all(vec![FilterNode::Group(group)]);
        }

        assert!(compile(&group, NOW).is_ok());
    }

    #[test]
    fn a_filter_with_too_many_rules_is_refused() {
        let children = (0..MAX_RULES + 1)
            .map(|_| {
                rule(
                    FilterField::Year,
                    FilterOp::Is,
                    FilterValue::Number { number: 2012 },
                )
            })
            .collect();

        assert!(compile(&any(children), NOW).is_err());
    }

    #[test]
    fn nothing_a_user_types_can_reach_the_statement_as_text() {
        let (_dir, db) = seeded();

        // Every one of these is inert because the value is bound, not spliced.
        for hostile in [
            "'; DROP TABLE tracks; --",
            "' OR 1=1 --",
            "\" UNION SELECT password FROM users --",
            "%' --",
        ] {
            let found = matches(
                &db,
                &all(vec![rule(
                    FilterField::Artist,
                    FilterOp::Is,
                    text_value(hostile),
                )]),
            );
            assert!(found.is_empty(), "{hostile:?} matched something");
        }

        let conn = db.conn().unwrap();
        let still_there: i64 = conn
            .query_row("SELECT count(*) FROM tracks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(still_there, 6, "the library must still be there");
    }

    #[test]
    fn the_compiled_sql_carries_exactly_as_many_placeholders_as_it_binds() {
        let compiled = compile(
            &all(vec![
                rule(FilterField::Artist, FilterOp::Contains, text_value("a")),
                rule(
                    FilterField::Year,
                    FilterOp::Between,
                    FilterValue::Range {
                        from: 2000,
                        to: 2010,
                    },
                ),
                rule(FilterField::Genre, FilterOp::IsEmpty, FilterValue::None),
            ]),
            NOW,
        )
        .unwrap();

        // A drift between the two is the classic way a rebuilt clause starts
        // binding the wrong value to the wrong slot.
        assert_eq!(compiled.sql.matches('?').count(), compiled.params.len());
    }
}
