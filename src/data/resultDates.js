const lisbonDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Lisbon",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatPublicationDate(publishedAt) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(publishedAt);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: dateOnly ? "UTC" : "Europe/Lisbon",
    ...(!dateOnly && { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  }).format(new Date(publishedAt));
}

export function publicationDay(publishedAt) {
  if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) return publishedAt;
  const parts = lisbonDateFormatter.formatToParts(new Date(publishedAt));
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function sortAndFilterResults(
  results,
  todayOnly = false,
  now = new Date(),
) {
  const today = publicationDay(now.toISOString());
  return results
    .map((result) => ({ result, day: publicationDay(result.publishedAt) }))
    .filter(({ day }) => !todayOnly || day === today)
    .sort((a, b) => {
      if (!a.day || !b.day)
        return Number(Boolean(b.day)) - Number(Boolean(a.day));
      if (a.day !== b.day) return a.day < b.day ? 1 : -1;

      // Date-only values have no known time, so place them after timed results.
      const aTimed = a.result.publishedAt.length > 10;
      const bTimed = b.result.publishedAt.length > 10;
      if (aTimed !== bTimed) return Number(bTimed) - Number(aTimed);
      return aTimed
        ? Date.parse(b.result.publishedAt) - Date.parse(a.result.publishedAt)
        : 0;
    })
    .map(({ result }) => result);
}
