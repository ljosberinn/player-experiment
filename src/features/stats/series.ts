import type { TimeBucket, TimeCount, TimeRange } from "../../ipc";

const DAY = 86_400;

/**
 * How finely a span is cut: the finest bucket that still draws as bars.
 *
 * From the span rather than the range id, because a custom range has no id to
 * go by and all time is only a span once the history has been read. Two weeks
 * of all time is days, not one bar for the month they fell in.
 */
export function bucketFor(span: TimeRange): TimeBucket {
  const days = (span.to - span.from) / DAY;
  if (days <= 62) {
    return "day";
  }
  if (days <= 400) {
    return "week";
  }
  if (days <= 25 * 366) {
    return "month";
  }
  return "year";
}

/**
 * Past this many buckets the gaps are not filled - `fillBins`' guard, for a
 * custom range typed as the year 1.
 */
const MAX_BUCKETS = 400;

/**
 * `series` with a zero for every empty bucket of `span`, oldest first.
 *
 * The aggregate is a `GROUP BY`, so a month with no plays is not a row, and
 * drawn as it arrives a silent month would sit beside a loud one as its
 * neighbour. Stepped by the calendar in local time rather than by adding
 * seconds: a local day is 23 or 25 hours twice a year, and a month is never a
 * fixed length.
 */
export function fillSeries(
  series: readonly TimeCount[],
  bucket: TimeBucket,
  span: TimeRange,
): TimeCount[] {
  const counts = new Map(series.map((entry) => [entry.start, entry.count]));
  const last = bucketStart(new Date((span.to - 1) * 1000), bucket);

  const filled: TimeCount[] = [];
  for (
    let at = bucketStart(new Date(span.from * 1000), bucket);
    at <= last;
    at = nextBucket(at, bucket)
  ) {
    if (filled.length === MAX_BUCKETS) {
      return [...series];
    }
    const start = dayKey(at);
    filled.push({ start, count: counts.get(start) ?? 0 });
  }
  return filled;
}

/** The local midnight opening the bucket `date` falls in. Weeks start Monday. */
function bucketStart(date: Date, bucket: TimeBucket): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  switch (bucket) {
    case "day":
      return new Date(year, month, date.getDate());
    case "week":
      // `getDay` counts from Sunday.
      return new Date(year, month, date.getDate() - ((date.getDay() + 6) % 7));
    case "month":
      return new Date(year, month, 1);
    case "year":
      return new Date(year, 0, 1);
  }
}

function nextBucket(start: Date, bucket: TimeBucket): Date {
  const year = start.getFullYear();
  const month = start.getMonth();
  switch (bucket) {
    case "day":
      return new Date(year, month, start.getDate() + 1);
    case "week":
      return new Date(year, month, start.getDate() + 7);
    case "month":
      return new Date(year, month + 1, 1);
    case "year":
      return new Date(year + 1, 0, 1);
  }
}

/** `YYYY-MM-DD` in local time, which is how the backend names a bucket. */
function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * A `YYYY-MM-DD` as a local date.
 *
 * By hand: `new Date("2024-03-01")` is UTC midnight, which in a negative
 * offset is the day before.
 */
function localDay(key: string): Date {
  const [year = 1970, month = 1, day = 1] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

const FORMATS: Record<TimeBucket, Intl.DateTimeFormatOptions> = {
  day: { month: "short", day: "numeric" },
  week: { month: "short", day: "numeric" },
  month: { month: "short", year: "numeric" },
  year: { year: "numeric" },
};

/**
 * What a bucket is called on the axis.
 *
 * A day or a week leaves the year off: the bucket rule keeps either under
 * sixty bars, and within that no two share a month and a day.
 */
export function bucketLabel(start: string, bucket: TimeBucket): string {
  return localDay(start).toLocaleDateString(undefined, FORMATS[bucket]);
}

export const BUCKET_TITLES: Record<TimeBucket, string> = {
  day: "Day",
  week: "Week of",
  month: "Month",
  year: "Year",
};

/**
 * The stretch of time a period crumb covers: its bucket's first local midnight
 * to the next bucket's, stepped by the calendar as `fillSeries` steps.
 *
 * The key is `<YYYY-MM-DD>/<bucket>`, the bar's own name and cut, so a crumb
 * compares as a string and history needs nothing new.
 */
export function periodSpan(key: string): TimeRange {
  const { start, bucket } = parsePeriod(key);
  return {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(nextBucket(start, bucket).getTime() / 1000),
  };
}

const PERIOD_FORMATS: Record<TimeBucket, Intl.DateTimeFormatOptions> = {
  day: { day: "numeric", month: "short", year: "numeric" },
  week: { day: "numeric", month: "short", year: "numeric" },
  month: { month: "long", year: "numeric" },
  year: { year: "numeric" },
};

/**
 * What the breadcrumb calls a period crumb.
 *
 * With the year, unlike `bucketLabel`: a crumb stands alone, without the
 * neighbouring bars that let an axis leave it off.
 */
export function periodLabel(key: string): string {
  const { start, bucket } = parsePeriod(key);
  const date = start.toLocaleDateString(undefined, PERIOD_FORMATS[bucket]);
  return bucket === "week" ? `${BUCKET_TITLES.week} ${date}` : date;
}

function parsePeriod(key: string): { start: Date; bucket: TimeBucket } {
  const [day = "", bucket = ""] = key.split("/");
  return {
    start: localDay(day),
    bucket: bucket in BUCKET_TITLES ? (bucket as TimeBucket) : "day",
  };
}
