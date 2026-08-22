import { describe, expect, it } from "vitest";
import { albumLinks, artistLinks, linkArtist } from "./externalLinks";

/** The labels, in order, so a reordering shows up as itself. */
function labels(links: ReturnType<typeof artistLinks>): string[] {
  return links.map((link) => link.label);
}

function urlOf(links: ReturnType<typeof artistLinks>, label: string): string | undefined {
  return links.find((link) => link.label === label)?.url;
}

describe("artistLinks", () => {
  it("points Last.fm at the artist's page and Discogs at a search", () => {
    const links = artistLinks("Blue Room");

    expect(labels(links)).toEqual(["Last.fm", "Discogs"]);
    expect(urlOf(links, "Last.fm")).toBe("https://www.last.fm/music/Blue%20Room");
    // Discogs resolves artists by numeric id, so a search is the honest link
    // rather than a guess at a path that would 404.
    expect(urlOf(links, "Discogs")).toBe(
      "https://www.discogs.com/search/?q=Blue%20Room&type=artist",
    );
  });

  it("encodes the characters band names actually contain", () => {
    const links = artistLinks("AC/DC & Friends + 1");

    // A bare `/` would invent a path segment and `&` would end the query.
    expect(urlOf(links, "Last.fm")).toBe(
      "https://www.last.fm/music/AC%2FDC%20%26%20Friends%20%2B%201",
    );
    expect(urlOf(links, "Discogs")).toBe(
      "https://www.discogs.com/search/?q=AC%2FDC%20%26%20Friends%20%2B%201&type=artist",
    );
  });
});

describe("albumLinks", () => {
  it("points Last.fm at the release and Discogs at a search for both terms", () => {
    const links = albumLinks("Blue Room", "Harbour");

    expect(labels(links)).toEqual(["Last.fm", "Discogs"]);
    expect(urlOf(links, "Last.fm")).toBe("https://www.last.fm/music/Blue%20Room/Harbour");
    expect(urlOf(links, "Discogs")).toBe(
      "https://www.discogs.com/search/?q=Blue%20Room%20Harbour&type=release",
    );
  });

  it("drops Last.fm when there is no artist to build the path from", () => {
    // Last.fm addresses a release under its artist; without one the URL would
    // be `/music//Harbour`, which is a 404 dressed up as a link. Discogs
    // searches text, so the album alone is still a real query.
    const links = albumLinks("", "Harbour");

    expect(labels(links)).toEqual(["Discogs"]);
    expect(urlOf(links, "Discogs")).toBe("https://www.discogs.com/search/?q=Harbour&type=release");
  });
});

describe("linkArtist", () => {
  it("prefers the album artist, which is what the album URL needs", () => {
    // On a compilation the track artist is whoever performed this one track;
    // the album belongs to the act named by the album artist.
    expect(linkArtist({ artist: "Cascade", album_artist: "Various Artists" })).toBe(
      "Various Artists",
    );
  });

  it("falls back to the track artist", () => {
    expect(linkArtist({ artist: "Cascade", album_artist: null })).toBe("Cascade");
  });

  it("treats blank tags as absent", () => {
    // A tag written as a space is not an artist, and it would produce a link
    // to `/music/%20`.
    expect(linkArtist({ artist: "Cascade", album_artist: "   " })).toBe("Cascade");
    expect(linkArtist({ artist: "  ", album_artist: null })).toBe("");
  });
});
