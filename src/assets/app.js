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

  // Share buttons on quote and story pages. The network links work without JS; this adds the phone's
  // own share sheet (placed first, touch screens only) and copying the link.
  for (const box of document.querySelectorAll('.share')) {
    const { shareTitle: title, shareText: text, shareUrl: url } = box.dataset;
    const native = box.querySelector('.share-native');
    if (native && navigator.share && matchMedia('(pointer: coarse)').matches) {
      native.hidden = false;
      native.addEventListener('click', () => navigator.share({ title, text, url }).catch(() => {}));
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
      el('blockquote', { class: 'quote-text' }, `“${q.text}”`),
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
              el('span', {}, item.source || '')),
            el('h3', {}, item.title),
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
  const teamEl = (t, side) =>
    el('div', { class: 'team' },
      t.logo ? el('img', { src: t.logo, alt: '', width: '52', height: '52', loading: 'lazy' }) : null,
      t.name,
      el('small', {}, side));
  const matchCard = (m, isNext) =>
    el('article', { class: `card match${isNext ? ' next' : ''}` },
      el('span', { class: 'match-tag' }, isNext ? strings.next : strings.latest),
      el('div', { class: 'teams' },
        teamEl(m.home, strings.home),
        el('div', { class: 'score' }, isNext ? 'VS' : `${m.home.score ?? 0} - ${m.away.score ?? 0}`),
        teamEl(m.away, strings.away)),
      el('p', { class: 'match-date' }, kickoff?.cardDate(m, lang, strings) ?? '', m.competition ? el('br') : null, m.competition || null));
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
      if (resultList) fillRows(resultList, data.results);
      if (fixtureList) fillRows(fixtureList, data.fixtures);
      if (matchList) {
        const cards = [data.latest && matchCard(data.latest, false), data.next && matchCard(data.next, true)].filter(Boolean);
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

  // "Kick-off in 2 d 4 h 13 min 05 s", ticking every second (only the text changes, and browsers pause timers
  // in background tabs) and hidden once the match has started. Not a live region, so screen readers do not
  // announce every tick. When to count and the wording are in src/assets/kickoff.js.
  function startCountdown(at) {
    const box = $('#countdown');
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
    const target = preferred.find((l) => ['en', 'es', 'pt'].includes(l));
    if (!target || target === lang) return;
    const link = document.querySelector(`.lang-switch a[hreflang="${target}"]`);
    const text = readJson('lang-suggest')?.[target];
    if (!link || !text) return;
    const close = el('button', { type: 'button', 'aria-label': 'Close' }, '×');
    const banner = el('div', { class: 'lang-banner', lang: target }, el('a', { href: link.href }, text), close);
    close.addEventListener('click', () => {
      banner.remove();
      try { localStorage.setItem('lang-dismissed', '1'); } catch {}
    });
    document.body.append(banner);
  }
})();
