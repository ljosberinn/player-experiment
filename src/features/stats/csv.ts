import { save } from "@tauri-apps/plugin-dialog";
import { saveTextFile } from "../../ipc";

/**
 * A panel's rows as a CSV file.
 *
 * Nothing to do with `export/`, which walks the whole library a page at a time
 * behind `export://progress`. A panel's export is forty rows it has already
 * fetched and drawn: no scope, no progress, nothing to read back.
 */

/** Which fields RFC 4180 requires to be quoted. */
const NEEDS_QUOTES = /[",\r\n]/;

function field(value: string): string {
  return NEEDS_QUOTES.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * `headers` and `rows` as one CSV document.
 *
 * CRLF between records, which is what RFC 4180 says and what stops Excel on
 * Windows - the program most likely to open this - reading the whole file as
 * one cell.
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [headers, ...rows].map((row) => `${row.map(field).join(",")}\r\n`).join("");
}

/**
 * Asks where to put `contents` and writes it there.
 *
 * The write is a command rather than `@tauri-apps/plugin-fs`: that plugin
 * arrives with a capability and an fs scope over whatever path the dialog
 * returned, which is a permission surface the app does not otherwise have.
 *
 * A cancelled dialog is not a failure and reports nothing - the user closed a
 * box they opened.
 */
export async function saveCsv(fileName: string, contents: string): Promise<void> {
  const path = await save({
    defaultPath: fileName,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (path === null) {
    return;
  }
  await saveTextFile(path, contents);
}
