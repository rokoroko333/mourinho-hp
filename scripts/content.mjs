// Content helpers shared by the build (scripts/build.mjs) and the share images (scripts/og.mjs).

// A quote's year comes from its `date` (YYYY or YYYY-MM-DD), so the two can never disagree.
export function withYears(quotes) {
  for (const q of quotes) q.year = q.date ? Number(q.date.slice(0, 4)) : null;
  return quotes;
}

// Today's event (UTC), or the next one in the calendar when today has none. `events` must be sorted by
// month and day (the build sorts onthisday.json). The build picks with its own date; app.js picks again
// from the embedded list when the visitor's UTC day differs (builds are not daily). Keep the two in step:
// app.js repeats this rule (search for "On this day" there).
export function pickOnThisDay(events, now = new Date()) {
  const today = now.toISOString().slice(5, 10);
  const same = events.find((e) => e.date.slice(5) === today);
  return same ? { event: same, today: true } : { event: events.find((e) => e.date.slice(5) > today) || events[0], today: false };
}
