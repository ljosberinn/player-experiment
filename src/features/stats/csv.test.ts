import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveCsv, toCsv } from "./csv";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../../ipc", () => ({ saveTextFile: vi.fn() }));

const dialog = async () => vi.mocked((await import("@tauri-apps/plugin-dialog")).save);
const writer = async () => vi.mocked((await import("../../ipc")).saveTextFile);

describe("toCsv", () => {
  it("writes a header and one line per row, CRLF", () => {
    // CRLF because RFC 4180 says so and because Excel on Windows - the one
    // program most likely to open this - treats a lone LF as one long cell.
    expect(toCsv(["Artist", "Plays"], [["Boards of Canada", "412"]])).toBe(
      "Artist,Plays\r\nBoards of Canada,412\r\n",
    );
  });

  it("quotes a field holding a comma, a quote or a newline", () => {
    expect(
      toCsv(["Field"], [["a,b"], ['say "hi"'], ["two\nlines"], ["carriage\rreturn"], ["plain"]]),
    ).toBe('Field\r\n"a,b"\r\n"say ""hi"""\r\n"two\nlines"\r\n"carriage\rreturn"\r\nplain\r\n');
  });

  it("writes an empty field as nothing rather than as two quotes", () => {
    expect(toCsv(["A", "B"], [["", "x"]])).toBe("A,B\r\n,x\r\n");
  });

  it("writes the header alone when there are no rows", () => {
    // A file with the columns in it says "nothing matched"; a zero-byte file
    // says the export broke.
    expect(toCsv(["A"], [])).toBe("A\r\n");
  });
});

describe("saveCsv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes what the dialog named", async () => {
    (await dialog()).mockResolvedValue("C:/somewhere/heard.csv");

    await saveCsv("heard.csv", "A\r\n");

    expect(await dialog()).toHaveBeenCalledWith({
      defaultPath: "heard.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    expect(await writer()).toHaveBeenCalledWith("C:/somewhere/heard.csv", "A\r\n");
  });

  it("writes nothing when the dialog is cancelled", async () => {
    (await dialog()).mockResolvedValue(null);

    await saveCsv("heard.csv", "A\r\n");

    expect(await writer()).not.toHaveBeenCalled();
  });
});
