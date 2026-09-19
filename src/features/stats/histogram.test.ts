import { describe, expect, test } from "vitest";

import { fillBins, toDecades } from "./histogram";

describe("fillBins", () => {
  test("puts back the bins the GROUP BY had nothing to return", () => {
    // 1994 against 2011 as its neighbour would draw a collection evenly
    // spread across its span, which is the opposite of what it is.
    expect(
      fillBins(
        [
          { value: 1994, count: 3 },
          { value: 1997, count: 1 },
        ],
        1,
      ),
    ).toStrictEqual([
      { value: 1994, count: 3 },
      { value: 1995, count: 0 },
      { value: 1996, count: 0 },
      { value: 1997, count: 1 },
    ]);
  });

  test("steps by the field's bin width rather than by one", () => {
    expect(
      fillBins(
        [
          { value: 128, count: 4 },
          { value: 224, count: 2 },
        ],
        32,
      ),
    ).toStrictEqual([
      { value: 128, count: 4 },
      { value: 160, count: 0 },
      { value: 192, count: 0 },
      { value: 224, count: 2 },
    ]);
  });

  test("leaves one bin and no bins alone", () => {
    expect(fillBins([{ value: 320, count: 9 }], 32)).toStrictEqual([{ value: 320, count: 9 }]);
    expect(fillBins([], 1)).toStrictEqual([]);
  });

  test("gives up rather than draw two thousand empty bars", () => {
    // One track tagged year 0 is an ordinary bad tag, and filling to it would
    // leave a chart that is correct about the spacing and blank.
    const bins = [
      { value: 0, count: 1 },
      { value: 2019, count: 40 },
    ];

    expect(fillBins(bins, 1)).toStrictEqual(bins);
  });
});

describe("toDecades", () => {
  test("sums the year bins ten at a time", () => {
    // The same query read coarser: a second aggregate over the same scan is
    // what this exists not to be.
    expect(
      toDecades([
        { value: 1994, count: 3 },
        { value: 1999, count: 2 },
        { value: 2001, count: 5 },
      ]),
    ).toStrictEqual([
      { value: 1990, count: 5 },
      { value: 2000, count: 5 },
    ]);
  });
});
