// Kick-off rules for the match cards and the countdown, apart from app.js so test/kickoff.test.mjs can check
// them with fixed dates (no DOM here). Loaded before app.js on every page.
globalThis.mourinhoKickoff = {
  // The kick-off to count down to, or null when there is none: no next match, a kick-off time still to be
  // confirmed (its time is a placeholder), or a match that has started.
  kickoffOf(next, now = Date.now()) {
    if (!next || next.timeTbd) return null;
    const kickoff = new Date(next.date);
    return kickoff > now ? kickoff : null;
  },
  // "2 d 4 h 05 min 09 s": days and hours only when there are some, seconds always two digits. Japanese
  // writes number and unit together ("1日22時間05分09秒"), which `units.sep` ('') says.
  countdownText(secs, units) {
    const sp = units.sep ?? ' ';
    const pad = (n) => String(n).padStart(2, '0');
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return [d && `${d}${sp}${units.d}`, (d || h) && `${h}${sp}${units.h}`, `${d || h ? pad(m) : m}${sp}${units.m}`, `${pad(secs % 60)}${sp}${units.s}`]
      .filter(Boolean)
      .join(sp);
  },
  // The date line on a match card: "Sun, Nov 1, 16:15 (Madrid time)" in the club's time zone. With the
  // kick-off time still to be confirmed only the day is known (read in UTC, as the placeholder time could
  // shift it), so it reads "Sun, Nov 8 · TBC" and makes no claim about Madrid time.
  cardDate(m, lang, strings) {
    const d = new Date(m.date);
    const day = { weekday: 'short', day: 'numeric', month: 'short' };
    if (m.timeTbd) return `${new Intl.DateTimeFormat(lang, { ...day, timeZone: 'UTC' }).format(d)} · ${strings.tbd}`;
    const fmt = new Intl.DateTimeFormat(lang, { ...day, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: strings.timeZone });
    return `${fmt.format(d)} (${strings.localTime})`;
  },
};
