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

  const strings = readJson('strings');
  suggestLanguage();
  if (!strings) return; // Only the home page has the dynamic sections below.

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

  // News
  const newsList = $('#news-list');
  getJson(`/api/news?lang=${lang}`)
    .then((data) => {
      if (!data.items?.length) return showMessage(newsList, strings.newsEmpty);
      newsList.replaceChildren(
        // The newest story leads, larger and across the whole row.
        ...data.items.map((item, i) =>
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
  const dateFmt = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
      el('p', { class: 'match-date' }, dateFmt.format(new Date(m.date)), m.competition ? el('br') : null, m.competition || null));
  getJson('/api/matches')
    .then((data) => {
      const cards = [data.latest && matchCard(data.latest, false), data.next && matchCard(data.next, true)].filter(Boolean);
      if (!cards.length) return showMessage(matchList, strings.matchesEmpty);
      matchList.replaceChildren(...cards);
      if (data.next) startCountdown(new Date(data.next.date));
    })
    .catch(() => showMessage(matchList, strings.matchesEmpty));

  // "Kick-off in 2 d 4 h 13 m", hidden once the match has started. Checked every 15 s rather than every
  // minute, so the minute shown turns over at most 15 s late instead of up to a minute.
  function startCountdown(kickoff) {
    const box = $('#countdown');
    const u = strings.units;
    const tick = () => {
      const mins = Math.floor((kickoff - Date.now()) / 60000);
      if (!(mins >= 0)) {
        box.hidden = true;
        return clearInterval(timer);
      }
      const d = Math.floor(mins / 1440);
      const h = Math.floor((mins % 1440) / 60);
      const parts = [d && `${d} ${u.d}`, (d || h) && `${h} ${u.h}`, `${mins % 60} ${u.m}`].filter(Boolean);
      box.replaceChildren(el('span', { class: 'card-label' }, strings.kickoffIn), ' ', el('strong', {}, parts.join(' ')));
      box.hidden = false;
    };
    const timer = setInterval(tick, 15000);
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
