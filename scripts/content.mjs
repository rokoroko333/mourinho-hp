// Content helpers shared by the build (scripts/build.mjs) and the share images (scripts/og.mjs).

// A quote's year comes from its `date` (YYYY or YYYY-MM-DD), so the two can never disagree.
export function withYears(quotes) {
  for (const q of quotes) q.year = q.date ? Number(q.date.slice(0, 4)) : null;
  return quotes;
}

// What the On this day card shows, as a timeline (oldest first): everything dated today (UTC) in any
// year; when today has none, everything dated this month; when the month has none, the next dated day.
// `items` mixes the On this day events and the dated quotes; each needs `date` (YYYY-MM-DD) and the
// events `event: true`. Past `limit`, events are kept before quotes, then the newest of each go.
// The build picks with its own date; app.js picks again from the embedded list when the visitor's UTC
// day differs (builds are not daily). Keep the two in step: app.js repeats this rule (search for
// "On this day" there).
export const OTD_LIMIT = 8;
export function pickOnThisDay(items, now = new Date(), limit = OTD_LIMIT) {
  const today = now.toISOString().slice(5, 10);
  const md = (x) => x.date.slice(5);
  const timeline = (list) => {
    const kept = [...list].sort((a, b) => Number(!!b.event) - Number(!!a.event) || b.date.localeCompare(a.date)).slice(0, limit);
    return kept.sort((a, b) => a.date.localeCompare(b.date));
  };
  const same = items.filter((x) => md(x) === today);
  if (same.length) return { kind: 'today', day: today, items: timeline(same) };
  const month = items.filter((x) => md(x).slice(0, 2) === today.slice(0, 2));
  if (month.length) return { kind: 'month', day: today, items: timeline(month) };
  const days = [...new Set(items.map(md))].sort();
  const day = days.find((d) => d > today) || days[0];
  return { kind: 'next', day, items: timeline(items.filter((x) => md(x) === day)) };
}

// A seeded random integer in [0, n) (mulberry32), so the same seed always gives the same quiz.
function random(seedText) {
  let seed = [...String(seedText)].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 2654435761) >>> 0, 7);
  return (n) => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let x = Math.imul(seed ^ (seed >>> 15), seed | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return (((x ^ (x >>> 14)) >>> 0) / 4294967296) * n | 0;
  };
}

// The questions in the quiz page's HTML: `size` of them, shuffled with the day as the seed, so they are
// spread across clubs rather than ten trophies in a row from trophies.json (which runs in date order).
export function dealQuiz(items, day, size) {
  const next = random(`day-${day}`);
  const deck = [...items];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = next(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, size);
}

// Quiz questions, one per trophy in trophies.json: "Which club did he win this with?". The answer is the
// trophy's era; the three wrong options are other clubs he managed as head coach (`managed`, era ids), by
// name so Chelsea's two spells count once. Picks and order come from the trophy id, so every build writes
// the same quiz.
export function quizQuestions(trophies, history, managed) {
  const clubOf = (era) => history.find((h) => h.id === era).club.en;
  const clubs = [...new Map(managed.map((era) => [clubOf(era), era])).values()];
  return trophies.map((t) => {
    const next = random(t.id);
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
