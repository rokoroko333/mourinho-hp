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

// Quiz questions, one per trophy in trophies.json: "Which club did he win this with?". The answer is the
// trophy's era; the three wrong options are other clubs he managed as head coach (`managed`, era ids), by
// name so Chelsea's two spells count once. Picks and order come from the trophy id, so every build writes
// the same quiz.
export function quizQuestions(trophies, history, managed) {
  const clubOf = (era) => history.find((h) => h.id === era).club.en;
  const clubs = [...new Map(managed.map((era) => [clubOf(era), era])).values()];
  return trophies.map((t) => {
    // mulberry32, seeded from the id.
    let seed = [...t.id].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 2654435761) >>> 0, 7);
    const next = (n) => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let x = Math.imul(seed ^ (seed >>> 15), seed | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return (((x ^ (x >>> 14)) >>> 0) / 4294967296) * n | 0;
    };
    const pool = clubs.filter((era) => clubOf(era) !== clubOf(t.era));
    if (pool.length < 3) throw new Error(`quiz ${t.id}: needs three other managed clubs, has ${pool.length}`);
    const wrong = [];
    while (wrong.length < 3) wrong.push(...pool.splice(next(pool.length), 1));
    const options = [t.era, ...wrong];
    for (let i = options.length - 1; i > 0; i--) {
      const j = next(i + 1);
      [options[i], options[j]] = [options[j], options[i]];
    }
    return { id: t.id, answer: t.era, options, trophy: t };
  });
}
