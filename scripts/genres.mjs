#!/usr/bin/env node
/**
 * Regenerates src-tauri/data/genres.sql - the genre hierarchy the donut in
 * phase 84b drills through - from Wikidata.
 *
 * Wikidata is the only source with the granularity the drill-down asks for
 * (black metal -> atmospheric black metal, raw black metal) and a licence that
 * lets it ship: CC0, so no attribution burden. Metal Archives is not
 * redistributable, MusicBrainz exposes genre-genre relationships in dumps but
 * not over its API, and Discogs and AcousticBrainz stop at two levels. The
 * alternatives are argued out in docs/plans/statistics.md.
 *
 * **The output is committed and the runtime never touches the network** - the
 * offline-first rule and the CSP both require it. This script is run by hand,
 * not from a build step: the answer changes when Wikidata changes, and a
 * committed snapshot is what makes the app's genre tree reproducible.
 *
 * For the same reason there is **no drift check**. A CI job asserting the file
 * matches the live endpoint would fail whenever a stranger edited an item,
 * which is neither this project's defect nor its problem to fix on a schedule.
 *
 * # Everything is a lowercased label
 *
 * The tables are keyed by label, not by QID, because the thing being resolved
 * is a genre string out of an ID3 tag - there is no QID on that side, ever.
 * Labels therefore get normalised (lowercased, whitespace collapsed) at
 * generation time, and `db::genres` normalises the tag the same way before
 * looking it up. Two items whose labels normalise the same are one genre as far
 * as a tag is concerned, so they are merged and keep the union of their edges.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUTPUT = join(root, "src-tauri", "data", "genres.sql");

const ENDPOINT = "https://query.wikidata.org/sparql";

/** WDQS blocks generic agents, and asks that a contact address be included. */
const USER_AGENT = "apex-genres/1.0 (https://github.com/ljosberinn/player-experiment)";

/** Music genre. Everything below is scoped to instances of its subclasses. */
const MUSIC_GENRE = "wd:Q188451";

/**
 * `P31/P279*` - instance of a music genre, or of anything that is a subclass
 * of one. `P31/P279*` rather than `P279*` alone: "black metal" is an *instance*
 * of "music genre" and a *subclass* of "extreme metal", and a query that only
 * walks subclass edges from Q188451 finds the metagenres, not the genres.
 */
const IS_A_GENRE = `?item wdt:P31/wdt:P279* ${MUSIC_GENRE} .`;

/**
 * English only, and `rdfs:label` rather than the label service.
 *
 * The label service falls back through a language chain, which silently mixes
 * in labels in other languages for items that have no English one. Those items
 * are better left out: a Japanese label cannot match an English tag, and it
 * would take the suffix derivation's shorter-genre slot away from a label that
 * could.
 */
const EN = (variable) => `FILTER(LANG(${variable}) = "en")`;

const QUERIES = {
  labels: `
    SELECT ?item ?label WHERE {
      ${IS_A_GENRE}
      ?item rdfs:label ?label .
      ${EN("?label")}
    }`,
  edges: `
    SELECT ?childLabel ?parentLabel WHERE {
      ?child  wdt:P31/wdt:P279* ${MUSIC_GENRE} ;
              wdt:P279 ?parent ;
              rdfs:label ?childLabel .
      ?parent wdt:P31/wdt:P279* ${MUSIC_GENRE} ;
              rdfs:label ?parentLabel .
      ${EN("?childLabel")}
      ${EN("?parentLabel")}
    }`,
  aliases: `
    SELECT ?alias ?label WHERE {
      ${IS_A_GENRE}
      ?item rdfs:label ?label ;
            skos:altLabel ?alias .
      ${EN("?label")}
      ${EN("?alias")}
    }`,
};

/** Rows of one SPARQL query, as plain `{ variable: value }` objects. */
async function ask(query) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/sparql-query",
      Accept: "application/sparql-results+json",
      "User-Agent": USER_AGENT,
    },
    body: query,
  });
  if (!response.ok) {
    // WDQS answers a timeout with 500 and a Java stack trace, which is worth
    // seeing: it is the difference between "retry" and "the query is wrong".
    const body = (await response.text()).slice(0, 2000);
    throw new Error(`SPARQL ${response.status} ${response.statusText}\n${body}`);
  }
  const json = await response.json();
  return json.results.bindings.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, cell.value])),
  );
}

/**
 * The form a label is stored and matched in.
 *
 * Must stay in lockstep with `db::genres::normalize`. Lowercasing is what makes
 * "Atmospheric Black Metal" in a tag meet "atmospheric black metal" from
 * Wikidata; collapsing whitespace covers the non-breaking spaces and stray
 * double spaces that a handful of labels carry.
 */
function normalize(text) {
  return text.toLowerCase().replace(/\s+/gu, " ").trim();
}

function sqlString(text) {
  return `'${text.replaceAll("'", "''")}'`;
}

/**
 * The primary parent of every genre, with cycles broken.
 *
 * 84b walks this one column downwards, so it has to be a forest: P279 in the
 * wild is not acyclic - "electro house" and "electro" have been each other's
 * subclass before now - and a parent chain that loops is a drill-down that
 * never terminates.
 *
 * The choice among several parents is **lexicographically smallest label, and
 * that is arbitrary**: nothing makes black metal more the parent of blackened
 * death metal than death metal is. It is affordable only because
 * `genre_overrides` exists to correct it and 84b labels what it shows.
 * `genre_edges` keeps the whole DAG, so picking one here loses nothing.
 *
 * Genres are settled shortest-chain-first so that a cycle costs the edge that
 * closes it rather than an arbitrary member's whole subtree, and the candidate
 * that would close one is skipped in favour of the next - a genre only ends up
 * parentless if every candidate it has would loop.
 */
function primaryParents(labels, parentsOf) {
  const parent = new Map();

  const wouldLoop = (child, candidate) => {
    let walker = candidate;
    const seen = new Set();
    while (walker !== undefined) {
      if (walker === child) {
        return true;
      }
      // Defensive: a cycle among already-settled genres cannot happen, but a
      // silent infinite loop here is a hung script with no output.
      if (seen.has(walker)) {
        return true;
      }
      seen.add(walker);
      walker = parent.get(walker);
    }
    return false;
  };

  // Fewest candidates first, then alphabetical, so the result does not depend
  // on the order WDQS happened to return rows in.
  const order = [...labels].sort((a, b) => {
    const byCount = (parentsOf.get(a)?.size ?? 0) - (parentsOf.get(b)?.size ?? 0);
    return byCount !== 0 ? byCount : a.localeCompare(b, "en");
  });

  for (const label of order) {
    const candidates = [...(parentsOf.get(label) ?? [])].sort((a, b) => a.localeCompare(b, "en"));
    const chosen = candidates.find((candidate) => !wouldLoop(label, candidate));
    if (chosen !== undefined) {
      parent.set(label, chosen);
    }
  }

  return parent;
}

/** One `INSERT` per chunk of rows: 6.6k single-row statements is 6.6k parses. */
function insertBatches(table, columns, rows, perStatement = 250) {
  const statements = [];
  for (let at = 0; at < rows.length; at += perStatement) {
    const values = rows
      .slice(at, at + perStatement)
      .map((row) => `  (${row.join(", ")})`)
      .join(",\n");
    statements.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES\n${values};`);
  }
  return statements;
}

const [labelRows, edgeRows, aliasRows] = await Promise.all([
  ask(QUERIES.labels),
  ask(QUERIES.edges),
  ask(QUERIES.aliases),
]);

const labels = new Set(labelRows.map((row) => normalize(row.label)).filter(Boolean));

/** Every parent an edge gives a genre, self-edges and unknown labels dropped. */
const parentsOf = new Map();
for (const row of edgeRows) {
  const child = normalize(row.childLabel);
  const parent = normalize(row.parentLabel);
  // A self-edge is what merging two items onto one label produces, and is not
  // a relationship - it is the same genre twice.
  if (!labels.has(child) || !labels.has(parent) || child === parent) {
    continue;
  }
  const known = parentsOf.get(child) ?? new Set();
  known.add(parent);
  parentsOf.set(child, known);
}

/**
 * The aliases that identify exactly one genre.
 *
 * An alias two genres share - "prog", for both progressive rock and
 * progressive metal - identifies neither, and storing one of them would be a
 * coin flip presented as a fact. Dropping it lets the tag fall through to the
 * suffix derivation, which at least says it is guessing. An alias that is also
 * a label goes too: the label layer answers first, so the row could only ever
 * contradict it.
 */
const aliasTargets = new Map();
for (const row of aliasRows) {
  const alias = normalize(row.alias);
  const label = normalize(row.label);
  if (!alias || !labels.has(label) || labels.has(alias)) {
    continue;
  }
  const targets = aliasTargets.get(alias) ?? new Set();
  targets.add(label);
  aliasTargets.set(alias, targets);
}
const aliases = [...aliasTargets]
  .filter(([, targets]) => targets.size === 1)
  .map(([alias, targets]) => [alias, [...targets][0]]);

const parent = primaryParents(labels, parentsOf);

const edges = [...parentsOf]
  .flatMap(([child, parents]) => [...parents].map((one) => [child, one]))
  .sort((a, b) => a[0].localeCompare(b[0], "en") || a[1].localeCompare(b[1], "en"));

const sorted = [...labels].sort((a, b) => a.localeCompare(b, "en"));

const statements = [
  ...insertBatches(
    "genres",
    ["label", "parent"],
    sorted.map((label) => [
      sqlString(label),
      parent.has(label) ? sqlString(parent.get(label)) : "NULL",
    ]),
  ),
  ...insertBatches(
    "genre_edges",
    ["child", "parent"],
    edges.map(([child, one]) => [sqlString(child), sqlString(one)]),
  ),
  ...insertBatches(
    "genre_aliases",
    ["alias", "label"],
    aliases
      .sort((a, b) => a[0].localeCompare(b[0], "en"))
      .map(([alias, label]) => [sqlString(alias), sqlString(label)]),
  ),
];

const header = [
  "-- The genre hierarchy, from Wikidata. CC0, so it ships with no attribution",
  "-- burden. See docs/knowledge/data-model.md for what the tables mean.",
  "--",
  "-- **Generated by scripts/genres.mjs. Do not edit by hand.** It is committed",
  "-- because the runtime never touches the network, and it is regenerated by",
  "-- hand rather than by CI because it is a snapshot of a wiki other people",
  "-- edit - there is nothing here for a drift check to be right about.",
  "--",
  `-- ${sorted.length} genres, ${edges.length} subclass edges, ${aliases.length} aliases.`,
  "",
];

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${header.join("\n")}${statements.join("\n\n")}\n`, "utf8");

const rooted = sorted.filter((label) => !parent.has(label)).length;
const broken = [...parentsOf.keys()].filter((label) => !parent.has(label)).length;
console.log(`${OUTPUT}`);
console.log(`  ${sorted.length} genres, ${rooted} of them without a parent`);
console.log(`  ${edges.length} subclass edges`);
console.log(
  `  ${aliases.length} aliases (${aliasTargets.size - aliases.length} dropped as ambiguous)`,
);
console.log(`  ${broken} genres left parentless because every candidate would have looped`);
