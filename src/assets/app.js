// Client-side behaviour. Pages are fully rendered at build time; this only adds the menu,
// quote shuffling, and the live news/match cards read from our own cached /api/* endpoints.
(() => {
  const lang = document.body.dataset.lang || 'en';
  const $ = (sel) => document.querySelector(sel);
  const readJson = (id) => {
    const el = document.getElementById(id);
    return el ? JSON.parse(el.textContent) : null;
  };
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  };

  // Mobile menu
  const menuBtn = $('.menu-btn');
  const nav = $('#site-nav');
  if (menuBtn && nav) {
    const set = (open) => {
      nav.classList.toggle('open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
    };
    menuBtn.addEventListener('click', () => set(!nav.classList.contains('open')));
    nav.addEventListener('click', (e) => e.target.closest('a') && set(false));
  }

  // Language menu (<details>): also closes on a click outside it or on Escape.
  const langMenu = $('.lang-switch');
  if (langMenu) {
    document.addEventListener('click', (e) => { if (langMenu.open && !langMenu.contains(e.target)) langMenu.open = false; });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && langMenu.open) {
        langMenu.open = false;
        langMenu.querySelector('summary').focus();
      }
    });
  }

  // Share buttons on quote and story pages and under the quiz score. The network links work without JS;
  // this adds the phone's own share sheet (placed first, touch screens only) and copying the link. The text
  // is read when the button is pressed, since the quiz writes the score into it after the page loads.
  for (const box of document.querySelectorAll('.share')) {
    const { shareUrl: url } = box.dataset;
    const native = box.querySelector('.share-native');
    if (native && navigator.share && matchMedia('(pointer: coarse)').matches) {
      native.hidden = false;
      native.addEventListener('click', () => {
        const { shareTitle: title, shareText: text } = box.dataset;
        navigator.share({ title, text, url }).catch(() => {});
      });
    }
    const copy = box.querySelector('.share-copy');
    if (copy && navigator.clipboard) {
      copy.hidden = false;
      copy.addEventListener('click', () =>
        navigator.clipboard.writeText(url).then(() => {
          copy.textContent = copy.dataset.copied;
          // Announced by screen readers, which do not report a button's label changing.
          box.querySelector('.share-status').textContent = copy.dataset.copied;
        }, () => {}),
      );
    }
  }

  // Videos: play in place with YouTube's privacy-enhanced player instead of leaving the site.
  // The card stays a plain link to YouTube for videos that cannot be embedded, or without JS.
  for (const card of document.querySelectorAll('.video[data-video-id]')) {
    card.addEventListener('click', (e) => {
      // Cmd/Ctrl/Shift-click and middle-click keep their usual meaning: open YouTube in a new tab or window.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      const id = card.dataset.videoId;
      const frame = el('iframe', {
        class: 'video-frame',
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`,
        title: card.querySelector('h3').textContent,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: '',
      });
      // The label stays a link to YouTube, a way out if the video later stops allowing embeds.
      const [, title, label] = card.children;
      const out = el('a', { class: 'card-label', href: card.href, target: '_blank', rel: 'noopener' }, label.textContent);
      card.replaceWith(el('div', { class: 'card video' }, frame, title, out));
    });
  }

  // Quiz: the HTML has ten questions with their answers in <details>; this marks a pick right or wrong,
  // keeps the score and deals ten more from the embedded list (quizPage in scripts/build.mjs).
  const quiz = readJson('quiz-data');
  const quizList = $('#quiz-list');
  if (quiz && quizList) {
    const s = quiz.strings;
    const scoreBox = $('#quiz-score');
    let answered = 0;
    let right = 0;
    quizList.addEventListener('click', (e) => {
      const pick = e.target.closest('button[data-era]');
      const q = pick?.closest('.quiz-q');
      if (!q || q.dataset.done) return;
      q.dataset.done = '1';
      const ok = pick.dataset.era === q.dataset.answer;
      for (const b of q.querySelectorAll('button[data-era]')) {
        b.disabled = true;
        if (b.dataset.era === q.dataset.answer) b.classList.add('is-right');
      }
      if (!ok) pick.classList.add('is-wrong');
      q.querySelector('.quiz-result').textContent = ok ? s.correct : s.wrong;
      q.querySelector('details').open = true;
      answered += 1;
      right += ok ? 1 : 0;
      if (answered === quizList.children.length) {
        scoreBox.textContent = s.score.replace('{n}', right).replace('{total}', answered);
        scoreBox.hidden = false;
        shareScore(s.shareScore.replace('{n}', right).replace('{total}', answered));
      }
    });
    const question = (q) =>
      el('li', { class: 'card quiz-q', 'data-id': q.id, 'data-answer': q.answer },
        el('p', { class: 'card-label' }, q.label),
        el('h3', {}, s.prompt),
        el('div', { class: 'quiz-options' },
          ...q.options.map((o) => el('button', { type: 'button', class: 'btn btn-sm btn-dark', 'data-era': o.era }, o.club))),
        el('p', { class: 'quiz-result', 'aria-live': 'polite' }),
        el('details', {},
          el('summary', {}, s.show),
          el('p', {}, el('a', { href: q.answerPath }, s.answer.replace('{club}', q.answerClub))),
          el('p', { class: 'sources' },
            el('span', { class: 'card-label' }, s.sources), ' ',
            ...q.sources.flatMap((src, i) => [
              i ? ' · ' : null,
              el('a', { href: src.url, target: '_blank', rel: 'noopener' }, `${src.publisher}${src.date ? ` (${src.date})` : ''}`),
            ]))));
    // The share links carry the score: the same networks and URL shapes as shareButtons in scripts/build.mjs.
    const shareBox = $('#quiz-share');
    const shareScore = (text) => {
      const box = shareBox?.querySelector('.share');
      if (!box) return;
      const url = box.dataset.shareUrl;
      const e = encodeURIComponent;
      box.dataset.shareText = text;
      for (const a of box.querySelectorAll('a[href]')) {
        if (a.href.startsWith('https://wa.me/')) a.href = `https://wa.me/?text=${e(`${text} ${url}`)}`;
        else if (a.href.startsWith('https://twitter.com/')) a.href = `https://twitter.com/intent/tweet?text=${e(text)}&url=${e(url)}`;
      }
      shareBox.hidden = false;
    };
    const again = $('#quiz-again');
    again.hidden = false;
    again.addEventListener('click', () => {
      // Questions not on screen first, so the next ten do not repeat the last ones.
      const shown = new Set([...quizList.children].map((q) => q.dataset.id));
      const shuffle = (list) => {
        for (let i = list.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
      };
      const deck = [...shuffle(quiz.items.filter((q) => !shown.has(q.id))), ...shuffle(quiz.items.filter((q) => shown.has(q.id)))];
      quizList.replaceChildren(...deck.slice(0, quiz.size).map(question));
      answered = 0;
      right = 0;
      scoreBox.hidden = true;
      if (shareBox) shareBox.hidden = true;
      quizList.scrollIntoView({ block: 'start' });
    });
  }

  const strings = readJson('strings');
  suggestLanguage();
  if (!strings) return; // Only the home, news and matches pages have the dynamic sections below.

  // On this day: the HTML holds the event picked on the build's date (UTC). Builds are not daily, so pick
  // again for the visitor's UTC day and swap the text in only when it differs. Same rule as
  // pickOnThisDay in scripts/content.mjs: change both together.
  const otd = readJson('otd-data');
  const otdCard = $('#on-this-day');
  if (otd && otdCard && otdCard.dataset.built !== new Date().toISOString().slice(0, 10)) {
    const today = new Date().toISOString().slice(5, 10);
    const same = otd.events.find((e) => e.date.slice(5) === today);
    const e = same || otd.events.find((x) => x.date.slice(5) > today) || otd.events[0];
    $('#otd-label').textContent = (same ? otd.labels.today : otd.labels.next).replace('{day}', e.day);
    $('#otd-year').textContent = e.date.slice(0, 4);
    $('#otd-text').textContent = e.text;
    $('#otd-link').setAttribute('href', e.path);
  }

  // Quote & story of the day
  const daily = readJson('daily-data');
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  $('#shuffle')?.addEventListener('click', () => {
    const q = pick(daily.quotes);
    const e = pick(daily.episodes);
    const box = $('#daily-quote');
    box.replaceChildren(
      el('blockquote', { class: 'quote-text', lang: 'en' }, `“${q.text}”`),
      el('p', { class: 'quote-context' }, `— ${q.context}${q.year ? `, ${q.year}` : ''}`),
    );
    $('#daily-quote-link').setAttribute('href', q.path);
    $('#daily-episode-title').textContent = e.title;
    $('#daily-episode-text').textContent = e.text;
    $('#daily-episode-link').setAttribute('href', e.path);
  });
  // Shares the quote's own page, which has its share image, rather than the home page.
  $('#share-quote')?.addEventListener('click', () => {
    const text = `${$('#daily-quote .quote-text').textContent} — José Mourinho #Mourinho`;
    const page = strings.siteUrl + $('#daily-quote-link').getAttribute('href');
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(page)}`;
    window.open(url, '_blank', 'noopener');
  });

  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const relative = (iso) => {
    // Never in the future: a server clock slightly ahead of the visitor's showed "in 1 second".
    const diff = Math.min(0, (new Date(iso) - Date.now()) / 1000);
    const steps = [['minute', 60], ['hour', 3600], ['day', 86400]];
    let unit = 'second', value = diff;
    for (const [u, s] of steps) if (Math.abs(diff) >= s) { unit = u; value = diff / s; }
    return rtf.format(Math.round(value), unit);
  };

  const getJson = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    return res.json();
  };

  const showMessage = (container, text) =>
    container.replaceChildren(el('p', { class: 'loading muted' }, text));

  // News: the home page shows the newest few (data-limit), /news/ all of them.
  const newsList = $('#news-list');
  if (newsList) getJson(`/api/news?lang=${lang}`)
    .then((data) => {
      if (!data.items?.length) return showMessage(newsList, strings.newsEmpty);
      const limit = Number(newsList.dataset.limit) || data.items.length;
      newsList.replaceChildren(
        // The newest story leads, larger and across the whole row.
        ...data.items.slice(0, limit).map((item, i) =>
          el('a', { class: `card card-link news-card${i === 0 ? ' news-lead' : ''}`, href: item.link, target: '_blank', rel: 'noopener' },
            el('div', { class: 'news-meta' },
              item.publishedAt ? el('time', { datetime: item.publishedAt }, relative(item.publishedAt)) : el('span'),
              // The press it comes from; headlines stay as printed whatever the page language. Only an outlet's
              // item has a known language (`lang`), set on the headline for screen readers and translators.
              el('span', {}, item.source || '', item.press ? el('small', { class: 'news-lang' }, item.press.toUpperCase()) : null)),
            el('h3', item.lang ? { lang: item.lang } : {}, item.title),
            el('span', { class: 'read' }, strings.readArticle, ' →')),
        ),
      );
      if (data.updatedAt) $('#news-updated').textContent = `${strings.newsUpdated} ${relative(data.updatedAt)}`;
    })
    .catch(() => showMessage(newsList, strings.newsEmpty));

  // Matches
  const matchList = $('#match-list');
  // Kick-off times in the club's time zone (strings.timeZone, e.g. Europe/Madrid), labelled "Madrid time",
  // so a visitor in Tokyo or Lima sees the time the match is listed with, not a converted one.
  // The card's date line and the countdown rules are in src/assets/kickoff.js. Up to five minutes after a
  // deploy, /matches/ can still be the cached HTML without that script, so it is used with `?.`.
  const kickoff = globalThis.mourinhoKickoff;
  const zone = { timeZone: strings.timeZone, hourCycle: 'h23' };
  // Only for that cached HTML: the day, with no time and so no claim about Madrid time.
  const plainDay = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const teamEl = (t, side) =>
    el('div', { class: 'team' },
      t.logo ? el('img', { src: t.logo, alt: '', width: '52', height: '52', loading: 'lazy' }) : null,
      t.name,
      el('small', {}, side));
  // The next match comes first and carries the countdown: on the home page the #countdown from the HTML is
  // moved into its card (/matches/ has no cards and keeps it where it is).
  const matchCard = (m, isNext) =>
    el('article', { class: `card match${isNext ? ' next' : ''}` },
      el('span', { class: 'match-tag' }, isNext ? strings.next : strings.latest),
      isNext ? $('#countdown') : null,
      el('div', { class: 'teams' },
        teamEl(m.home, strings.home),
        el('div', { class: 'score' }, isNext ? 'VS' : `${m.home.score ?? 0} - ${m.away.score ?? 0}`),
        teamEl(m.away, strings.away)),
      el('p', { class: 'match-date' }, kickoff ? kickoff.cardDate(m, lang, strings) : plainDay.format(new Date(m.date)), m.competition ? el('br') : null, m.competition || null));
  // One line per match on /matches/: date, home, score (or kick-off time), away, competition. The server draws
  // the same rows first, also in the club's time zone (matchRowsHtml in lib/matches-page.js): change both together.
  const dayFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', ...zone });
  const timeFmt = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', ...zone });
  // Without a kick-off time only the day is known, so it is read in UTC rather than shifted by the
  // placeholder time into the next or previous day.
  const tbdDayFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const matchRow = (m) => {
    const d = new Date(m.date);
    const score = m.completed ? `${m.home.score ?? 0} - ${m.away.score ?? 0}` : m.timeTbd ? strings.tbd : timeFmt.format(d);
    return el('li', { class: 'match-row' },
      el('time', { datetime: m.date }, (m.timeTbd ? tbdDayFmt : dayFmt).format(d)),
      el('span', { class: 'row-team home' }, m.home.name),
      el('strong', { class: 'row-score' }, score),
      el('span', { class: 'row-team' }, m.away.name),
      el('small', { class: 'muted' }, m.competition || ''));
  };
  const fillRows = (list, matches) =>
    matches?.length
      ? list.replaceChildren(...matches.map(matchRow))
      : list.replaceChildren(el('li', { class: 'loading muted' }, strings.matchesEmpty));
  const resultList = $('#result-list');
  const fixtureList = $('#fixture-list');
  if (matchList || resultList) getJson('/api/matches')
    .then((data) => {
      // The cached /matches/ HTML of the previous deploy (up to five minutes) has no strings.timeZone: its rows
      // were drawn on the server and say "UTC", so they are kept rather than redrawn in the visitor's zone.
      const redraw = (list) => list && (strings.timeZone || !list.querySelector('.match-row'));
      if (redraw(resultList)) fillRows(resultList, data.results);
      if (redraw(fixtureList)) fillRows(fixtureList, data.fixtures);
      showPredict(data);
      if (matchList) {
        const cards = [data.next && matchCard(data.next, true), data.latest && matchCard(data.latest, false)].filter(Boolean);
        if (!cards.length) return showMessage(matchList, strings.matchesEmpty);
        matchList.replaceChildren(...cards);
      }
      const next = kickoff?.kickoffOf(data.next);
      if (next) startCountdown(next);
    })
    .catch(() => {
      if (matchList) showMessage(matchList, strings.matchesEmpty);
      for (const list of [resultList, fixtureList]) if (list) fillRows(list, []);
    });

  // Fan prediction (lib/predict.js, functions/api/predict.js). For the next match: a score to send until
  // kick-off; after sending (or after kick-off) the tally, shown as percentages once there are enough votes,
  // so a handful cannot look like a trend; after the match, the result and how many called it exactly.
  // The visitor's own pick is remembered in this browser only (localStorage), to show it back.
  function showPredict(data) {
    const box = $('#predict');
    const p = strings.predict;
    if (!box || !p) return;
    // The next match without a kick-off time cannot take votes yet: say so, under the last match's tally if any.
    const tbd = data.next?.timeTbd ? el('p', { class: 'muted predict-note' }, p.tbd) : null;
    const m = data.next && !data.next.timeTbd ? data.next : data.latest;
    const key = `predict:${m?.id}`;
    const mine = () => { try { return localStorage.getItem(key); } catch { return null; } };
    const fmtPct = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 });
    const club = (s) => (s.clubIsHome ? m.home.name : m.away.name);
    const scoreText = (h, a) => `${h}-${a}`;
    const head = (s) => el('div', { class: 'predict-head' },
      el('span', { class: 'card-label' }, p.heading),
      s ? el('small', { class: 'muted' }, p.votes.replace('{n}', new Intl.NumberFormat(lang).format(s.total))) : null);
    const tally = (s) => {
      const parts = [];
      const pick = mine();
      if (pick) parts.push(el('p', { class: 'predict-mine' }, p.yourPick.replace('{score}', pick)));
      if (s.result) {
        const pct = s.total ? fmtPct.format(s.result.hits / s.total) : fmtPct.format(0);
        parts.push(el('p', { class: 'predict-result' }, p.result.replace('{score}', scoreText(s.result.home, s.result.away)).replace('{pct}', pct).replace('{n}', s.result.hits)));
        if (pick) parts.push(el('p', { class: pick === scoreText(s.result.home, s.result.away) ? 'predict-hit' : 'muted' }, pick === scoreText(s.result.home, s.result.away) ? p.hit : p.miss));
      }
      if (s.total < s.minVotes) {
        parts.push(el('p', { class: 'muted' }, p.tooFew.replace('{min}', s.minVotes)));
        return parts;
      }
      parts.push(el('p', { class: 'card-label predict-caption' }, p.outcomes.replace('{club}', club(s))));
      parts.push(el('div', { class: 'predict-bar' }, ...['win', 'draw', 'loss'].map((o) => {
        const share = s.outcomes[o] / s.total;
        const seg = el('span', { class: `seg seg-${o}${s.result?.outcome === o ? ' is-result' : ''}` });
        seg.style.flexGrow = String(Math.max(share, 0.0001));
        return seg;
      })));
      parts.push(el('ul', { class: 'predict-legend' }, ...['win', 'draw', 'loss'].map((o) =>
        el('li', { class: `leg-${o}` }, el('strong', {}, fmtPct.format(s.outcomes[o] / s.total)), ' ', p[o]))));
      parts.push(el('p', { class: 'card-label predict-caption' }, p.topScores));
      parts.push(el('ol', { class: 'predict-top' }, ...s.top.map((t) =>
        el('li', {}, el('strong', {}, scoreText(t.home, t.away)), el('small', {}, fmtPct.format(t.votes / s.total))))));
      return parts;
    };
    const show = (...children) => { box.replaceChildren(...children.flat().filter(Boolean), ...(tbd ? [tbd] : [])); box.hidden = false; };
    if (!m) return tbd ? show(head(null)) : undefined;
    const form = (s) => {
      const goals = { home: 1, away: 1 };
      const row = (side) => {
        const out = el('output', { class: 'predict-goals' }, String(goals[side]));
        const step = (d) => () => { goals[side] = Math.min(15, Math.max(0, goals[side] + d)); out.textContent = String(goals[side]); };
        const less = el('button', { type: 'button', class: 'btn btn-dark btn-sm', 'aria-label': p.less.replace('{team}', m[side].name) }, '−');
        const more = el('button', { type: 'button', class: 'btn btn-dark btn-sm', 'aria-label': p.more.replace('{team}', m[side].name) }, '+');
        less.addEventListener('click', step(-1));
        more.addEventListener('click', step(1));
        return el('div', { class: 'predict-row' }, el('span', { class: 'predict-team' }, m[side].name), less, out, more);
      };
      const send = el('button', { type: 'submit', class: 'btn btn-gold' }, p.submit);
      const note = el('p', { class: 'muted predict-note' });
      const f = el('form', { class: 'predict-form' }, row('home'), row('away'), send, note);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        send.disabled = true;
        fetch('/api/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ match: m.id, ...goals }) })
          .then(async (res) => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(res.status === 409 ? p.closed : p.error);
            if (body.recorded) { try { localStorage.setItem(key, scoreText(goals.home, goals.away)); } catch {} }
            show(head(body), body.duplicate && !mine() ? el('p', { class: 'muted' }, p.already) : null, tally(body));
          })
          .catch((err) => { note.textContent = err.message || p.error; send.disabled = false; });
      });
      return [head(s), f];
    };
    getJson(`/api/predict?match=${encodeURIComponent(m.id)}`)
      .then((s) => {
        const open = m === data.next && new Date(m.date) > Date.now();
        if (open && !mine()) return show(form(s));
        if ((!open && !m.completed && m !== data.next) || (!s.total && !open)) return tbd ? show(head(null)) : undefined; // no tally to show
        show(head(s), open || s.result ? null : el('p', { class: 'muted' }, p.closed), tally(s));
      })
      .catch(() => { if (tbd) show(head(null)); });
  }

  // "Kick-off in 2 d 4 h 13 min 05 s", ticking every second (only the text changes, and browsers pause timers
  // in background tabs) and hidden once the match has started. Not a live region, so screen readers do not
  // announce every tick. When to count and the wording are in src/assets/kickoff.js.
  function startCountdown(at) {
    const box = $('#countdown');
    if (!box) return;
    const tick = () => {
      const secs = Math.floor((at - Date.now()) / 1000);
      if (!(secs >= 0)) {
        box.hidden = true;
        return;
      }
      const text = kickoff.countdownText(secs, strings.units);
      box.replaceChildren(el('span', { class: 'card-label' }, strings.kickoffIn), ' ', el('strong', {}, text));
      box.hidden = false;
      // Wait for the next whole second, so the seconds turn over evenly instead of drifting.
      setTimeout(tick, 1000 - (Date.now() % 1000) + 20);
    };
    tick();
  }

  // Offer (never force) the visitor's own language. Search engines are not redirected.
  function suggestLanguage() {
    try {
      if (localStorage.getItem('lang-dismissed')) return;
    } catch {}
    const preferred = (navigator.languages || [navigator.language]).map((l) => l.slice(0, 2).toLowerCase());
    const target = preferred.find((l) => ['en', 'es', 'pt', 'ja'].includes(l));
    if (!target || target === lang) return;
    const link = document.querySelector(`.lang-switch a[hreflang="${target}"]`);
    const text = readJson('lang-suggest')?.[target];
    if (!link || !text) return;
    // The banner speaks the suggested language, so its close button is named in that language too.
    const close = el('button', { type: 'button', 'aria-label': readJson('lang-close')?.[target] || 'Close' }, '×');
    const banner = el('div', { class: 'lang-banner', lang: target }, el('a', { href: link.href }, text), close);
    close.addEventListener('click', () => {
      banner.remove();
      try { localStorage.setItem('lang-dismissed', '1'); } catch {}
    });
    document.body.append(banner);
  }
})();
