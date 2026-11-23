(function () {
  'use strict';

  // window.WebApp появляется, когда страница открыта внутри MAX.
  // В обычном браузере его нет — приложение всё равно работает.
  // Сам объект подгружается и в обычном браузере, но пустой, поэтому смотрим на данные запуска.
  var WA = (window.WebApp && (window.WebApp.initData || window.WebApp.platform)) ? window.WebApp : null;

  var view = document.getElementById('view');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var data = null;
  var state = { tab: 'program', day: null, query: '' };
  var detailOpen = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function haptic() {
    try {
      // На десктопе и в веб-версии MAX вибрации нет — метод отклоняет промис, это не ошибка.
      var p = WA && WA.HapticFeedback && WA.HapticFeedback.selectionChanged();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  function openExternal(url) {
    if (!url) return;
    try {
      if (WA && WA.openLink) { WA.openLink(url); return; }
    } catch (e) {}
    window.open(url, '_blank', 'noopener');
  }

  function placeById(id) {
    var list = data.places || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // ---- «Сейчас идёт» ----
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function minutes(hhmm) {
    var p = String(hhmm || '').split(':');
    return (+p[0]) * 60 + (+p[1] || 0);
  }
  function isLive(day, s) {
    if (day.date !== todayIso() || !s.start || !s.end) return false;
    var now = new Date();
    var m = now.getHours() * 60 + now.getMinutes();
    return m >= minutes(s.start) && m < minutes(s.end);
  }

  // ---- BackButton MAX ----
  function onBack() { closeDetail(); }
  function showBack() {
    detailOpen = true;
    try { if (WA && WA.BackButton) { WA.BackButton.onClick(onBack); WA.BackButton.show(); } } catch (e) {}
  }
  function hideBack() {
    detailOpen = false;
    try { if (WA && WA.BackButton) { WA.BackButton.offClick(onBack); WA.BackButton.hide(); } } catch (e) {}
  }
  function closeDetail() { hideBack(); render(); }

  // ---- Экраны ----
  function renderProgram() {
    var days = data.days || [];
    if (!days.length) return '<p class="muted">Программа появится позже.</p>';
    if (!state.day) {
      var t = todayIso();
      state.day = (days.filter(function (d) { return d.date === t; })[0] || days[0]).id;
    }
    var day = days.filter(function (d) { return d.id === state.day; })[0] || days[0];

    var html = '';
    if (days.length > 1) {
      html += '<div class="chips" role="group" aria-label="Дни форума">';
      days.forEach(function (d) {
        html += '<button class="chip" data-day="' + esc(d.id) + '" aria-pressed="' + (d.id === day.id) + '">' + esc(d.label || d.title) + '</button>';
      });
      html += '</div>';
    } else {
      html += '<h2>' + esc(day.label || day.title) + '</h2>';
    }

    var acts = data.activities || [];
    if (acts.length) {
      html += '<details class="card card--all"><summary>🎯 Весь день: интерактивные площадки</summary>' +
        acts.map(function (a) { return '<p><b>' + esc(a.title) + '</b><br>' + esc(a.description) + '</p>'; }).join('') +
        '</details>';
    }

    (day.sessions || []).forEach(function (s, i) {
      var place = placeById(s.place);
      var live = isLive(day, s);
      var plain = !s.people && !s.description;  // перерывы и т. п. — без подробностей
      html += '<button class="card' + (live ? ' card--live' : '') + (plain ? ' card--plain' : '') + '" data-session="' + i + '"' + (plain ? ' disabled' : '') + '>' +
        '<div class="card__time">' + esc(s.start) + (s.end ? '–' + esc(s.end) : '') + (live ? '<span class="badge">идёт сейчас</span>' : '') + '</div>' +
        '<div class="card__title">' + esc(s.title) + '</div>' +
        (s.tag ? '<div class="tag">' + esc(s.tag) + '</div>' : '') +
        (place ? '<div class="card__meta">📍 ' + esc(place.name) + '</div>' : '') +
        '</button>';
    });
    return html;
  }

  function mapUrl(p) {
    if (p.map) return p.map;
    return p.address ? 'https://yandex.ru/maps/?text=' + encodeURIComponent(p.address) : '';
  }

  function renderSession(dayId, idx) {
    var day = (data.days || []).filter(function (d) { return d.id === dayId; })[0];
    var s = day && day.sessions[idx];
    if (!s) return closeDetail();
    var place = placeById(s.place);
    var html = '<div class="detail">' +
      (WA ? '' : '<button class="back" data-back>← Назад</button>') +
      '<p class="muted">' + esc(day.label || day.title) + ', ' + esc(s.start) + (s.end ? '–' + esc(s.end) : '') + '</p>' +
      '<h2>' + esc(s.title) + '</h2>' +
      (s.tag ? '<div class="tag">' + esc(s.tag) + '</div>' : '');
    if (place) {
      html += '<div class="card"><div class="card__title">📍 ' + esc(place.name) + '</div>' +
        '<div class="card__meta">' + esc(place.address) + '</div>' +
        (mapUrl(place) ? '<button class="btn" data-map="' + esc(mapUrl(place)) + '">Открыть на карте</button>' : '') +
        '</div>';
    }
    if (s.description) html += '<p>' + esc(s.description) + '</p>';
    if (s.people) html += '<div class="card people"><p>' + esc(s.people) + '</p></div>';
    html += '</div>';
    view.innerHTML = html;
    showBack();
    window.scrollTo(0, 0);
  }

  function renderPlaces() {
    var list = data.places || [];
    if (!list.length) return '<p class="muted">Информация о площадках появится позже.</p>';
    return list.map(function (p) {
      return '<div class="card"><div class="card__title">' + esc(p.name) + '</div>' +
        '<div class="card__meta">' + esc(p.address) + '</div>' +
        (p.note ? '<div class="card__meta">' + esc(p.note) + '</div>' : '') +
        (mapUrl(p) ? '<button class="btn" data-map="' + esc(mapUrl(p)) + '">Как добраться</button>' : '') +
        '</div>';
    }).join('');
  }

  function renderFaq() {
    return '<input class="search" id="faq-search" type="search" placeholder="Поиск по вопросам" value="' + esc(state.query) + '">' +
      '<div id="faq-list">' + faqList() + '</div>';
  }
  function faqList() {
    var q = state.query.trim().toLowerCase();
    var items = (data.faq || []).filter(function (f) {
      return !q || (f.q + ' ' + f.a).toLowerCase().indexOf(q) !== -1;
    });
    if (!items.length) return '<p class="muted">Ничего не нашлось. Спросите оргкомитет во вкладке «Контакты».</p>';
    return items.map(function (f) {
      return '<details class="card"><summary>' + esc(f.q) + '</summary><p>' + esc(f.a) + '</p></details>';
    }).join('');
  }

  function renderContacts() {
    var c = data.contacts || {};
    var f = data.forum || {};
    var html = '';
    if (f.about) html += '<div class="card"><div class="card__title">О форуме</div><p style="margin:6px 0 0">' + esc(f.about) + '</p></div>';
    html += '<div class="card">' + (c.text ? '<p style="margin:0 0 6px">' + esc(c.text) + '</p>' : '');
    if (c.phone) html += '<a class="btn btn--wide" href="tel:' + esc(c.phone.replace(/[^\d+]/g, '')) + '">📞 ' + esc(c.phone) + '</a>';
    if (c.email) html += '<a class="btn btn--wide" href="mailto:' + esc(c.email) + '">✉️ ' + esc(c.email) + '</a>';
    if (c.site) html += '<button class="btn btn--wide" data-map="' + esc(c.site) + '">🌐 Сайт форума</button>';
    html += '</div>';
    return html;
  }

  function render() {
    if (!data) return;
    if (detailOpen) hideBack();
    tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.tab === state.tab)); });
    var html = { program: renderProgram, places: renderPlaces, faq: renderFaq, contacts: renderContacts }[state.tab]();
    view.innerHTML = html;
  }

  // ---- События ----
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      if (state.tab === t.dataset.tab && !detailOpen) return;
      state.tab = t.dataset.tab;
      haptic();
      render();
      window.scrollTo(0, 0);
    });
  });

  view.addEventListener('click', function (e) {
    var el = e.target.closest('[data-day],[data-session],[data-map],[data-back]');
    if (!el) return;
    if (el.hasAttribute('data-day')) { state.day = el.getAttribute('data-day'); haptic(); render(); }
    else if (el.hasAttribute('data-session')) { renderSession(state.day, +el.getAttribute('data-session')); }
    else if (el.hasAttribute('data-map')) { openExternal(el.getAttribute('data-map')); }
    else if (el.hasAttribute('data-back')) { closeDetail(); }
  });

  view.addEventListener('input', function (e) {
    if (e.target.id !== 'faq-search') return;
    state.query = e.target.value;
    document.getElementById('faq-list').innerHTML = faqList();
  });

  // ---- Старт ----
  function fillHeader() {
    var f = data.forum || {};
    document.title = f.name || 'Форум';
    document.getElementById('forum-name').textContent = f.name || 'Форум';
    document.getElementById('forum-sub').textContent = f.subtitle || '';
    document.getElementById('forum-meta').textContent = [f.dates, f.city].filter(Boolean).join(' · ');

    var user = WA && WA.initDataUnsafe && WA.initDataUnsafe.user;
    if (user && user.first_name) {
      document.getElementById('greet').textContent = 'Здравствуйте, ' + user.first_name + '!';
    }
  }

  // Ссылка https://max.ru/<бот>?startapp=faq откроет сразу нужную вкладку
  // (допустимые значения: program, places, faq, contacts).
  var start = WA && WA.initDataUnsafe && WA.initDataUnsafe.start_param;
  if (start && /^(program|places|faq|contacts)$/.test(start)) state.tab = start;

  fetch('content.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (json) { data = json; fillHeader(); render(); })
    .catch(function () {
      view.innerHTML = '<p class="muted">Не удалось загрузить данные. Проверьте интернет и откройте приложение ещё раз.</p>';
    });
})();
