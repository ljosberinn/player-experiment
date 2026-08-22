/**
 * Where a song row can be looked up, and how those URLs are built.
 *
 * Pure and separate from the menu, because the part that can be wrong is the
 * URL: an unencoded `&` or `/` in a band name silently produces a link to
 * something else. The two hosts here are also the whole of what the opener
 * capability allows, alongside the repository - see
 * `src-tauri/capabilities/default.json`.
 */

const LAST_FM = "https://www.last.fm";
const DISCOGS = "https://www.discogs.com";

/** One entry of an "Open … on" submenu. */
export interface ExternalLink {
  label: string;
  url: string;
}

/**
 * The name to look the row up under.
 *
 * Album artist wins where both exist: it names a compilation's actual act
 * rather than whoever performed the one track, and it is what the album URL
 * needs. Blank is absent - a tag written as a space would link to `/music/%20`.
 */
export function linkArtist(track: { artist: string | null; album_artist: string | null }): string {
  return (track.album_artist ?? "").trim() || (track.artist ?? "").trim();
}

export function artistLinks(artist: string): ExternalLink[] {
  return [
    { label: "Last.fm", url: `${LAST_FM}/music/${encodeURIComponent(artist)}` },
    // Discogs resolves artists and releases by numeric id, not by name, so a
    // search URL is the honest link rather than a path that would 404.
    {
      label: "Discogs",
      url: `${DISCOGS}/search/?q=${encodeURIComponent(artist)}&type=artist`,
    },
  ];
}

export function albumLinks(artist: string, album: string): ExternalLink[] {
  const links: ExternalLink[] = [];

  // Last.fm addresses a release under its artist, so without one there is no
  // URL to build - `/music//Harbour` is a 404 dressed up as a link. Discogs
  // searches text, so the album alone is still a real query.
  if (artist !== "") {
    links.push({
      label: "Last.fm",
      url: `${LAST_FM}/music/${encodeURIComponent(artist)}/${encodeURIComponent(album)}`,
    });
  }

  const query = [artist, album].filter((term) => term !== "").join(" ");
  links.push({
    label: "Discogs",
    url: `${DISCOGS}/search/?q=${encodeURIComponent(query)}&type=release`,
  });

  return links;
}
