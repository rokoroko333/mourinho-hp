// The kick-off countdown's rules, apart from app.js so test/countdown.test.mjs can check them with fixed
// dates (no DOM here). Loaded before app.js on every page.
globalThis.mourinhoCountdown = {
  // The kick-off to count down to, or null when there is none: no next match, a kick-off time still to be
  // confirmed (its time is a placeholder), or a match that has started.
  kickoffOf(next, now = Date.now()) {
    if (!next || next.timeTbd) return null;
    const kickoff = new Date(next.date);
    return kickoff > now ? kickoff : null;
  },
  // "2 d 4 h 05 min 09 s": days and hours only when there are some, seconds always two digits.
  text(secs, units) {
    const pad = (n) => String(n).padStart(2, '0');
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return [d && `${d} ${units.d}`, (d || h) && `${h} ${units.h}`, `${d || h ? pad(m) : m} ${units.m}`, `${pad(secs % 60)} ${units.s}`]
      .filter(Boolean)
      .join(' ');
  },
};
