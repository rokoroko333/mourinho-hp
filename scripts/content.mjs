// Content helpers shared by the build (scripts/build.mjs) and the share images (scripts/og.mjs).

// A quote's year comes from its `date` (YYYY or YYYY-MM-DD), so the two can never disagree.
export function withYears(quotes) {
  for (const q of quotes) q.year = q.date ? Number(q.date.slice(0, 4)) : null;
  return quotes;
}
