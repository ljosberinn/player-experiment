import type { ReactNode } from "react";

/**
 * What the chip is saying, which is the only thing that varies.
 *
 * The sheet draws a tag and a badge identically and distinguishes them only
 * by what they label - a genre against a file's state - so this is one
 * component with four tones rather than two components with one drawing. The
 * same reasoning that folded `--dim` into `--muted`: two names for one thing
 * is worse than one name.
 *
 * - `accent`, a solid fill, for a property worth finding across a list.
 * - `selection`, the highlight wash, for something the app derived rather
 *   than read off the file.
 * - `neutral`, a flat veil, for a state that is a fact rather than a warning.
 * - `outline`, an edge and nothing else, for a value out of the library's own
 *   vocabulary - a genre, an artist.
 */
export type TagTone = "accent" | "selection" | "neutral" | "outline";

/**
 * A chip.
 *
 * `<span>` rather than a `<button>` or an `<li>`: a tag is a label, and the
 * places it is read out - a row, a dialog field - carry their own semantics.
 * One that ever becomes clickable wants a button around it, not a handler on
 * it.
 */
export function Tag({ tone = "outline", children }: { tone?: TagTone; children: ReactNode }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

/**
 * A figure beside the thing it counts.
 *
 * Its own component rather than a fifth tone: it drops the uppercasing and
 * the letter-spacing that make a tag read as a word, and takes the tabular
 * figures that keep a column of them from shifting - which is the whole
 * difference between a label and a number.
 */
export function Count({ children }: { children: ReactNode }) {
  return <span className="count">{children}</span>;
}
