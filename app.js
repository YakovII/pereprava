(function () {
  'use strict';

  // window.WebApp подгружается и в обычном браузере, но там он пустой,
  // поэтому считаем, что мы внутри MAX, только если есть данные запуска.
  var WA = (window.WebApp && (window.WebApp.initData || window.WebApp.platform)) ? window.WebApp : null;

  var view = document.getElementById('view');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var data = null;
  var state = { tab: 'home', day: null, query: '', place: '', mine: false };
  var detailOpen = false;
  var plans = {};               // id выступления -> true
  var PLANS_KEY = 'pereprava_plans';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function quiet(p) { if (p && p.catch) p.catch(function () {}); }  // методы MAX иногда отклоняют промис — это не ошибка

  function haptic() {
    try { quiet(WA && WA.HapticFeedback && WA.HapticFeedback.selectionChanged()); } catch (e) {}
  }

  function openExternal(url) {
    if (!url) return;
    try { if (WA && WA.openLink) { WA.openLink(url); return; } } catch (e) {}
    window.open(url, '_blank', 'noopener');
  }

  function placeById(id) {
    var list = data.places || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function mapUrl(p) {
    if (p.map) return p.map;
    return p.address ? 'https://yandex.ru/maps/?text=' + encodeURIComponent(p.address) : '';
  }

  // ---- Время мероприятия (по умолчанию московское, UTC+3) ----
  function eventNow() {
    var offset = (data.forum && typeof data.forum.utcOffset === 'number') ? data.forum.utcOffset : 3;
    var d = new Date(Date.now() + offset * 3600 * 1000);
    return {
      date: d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'),
      min: d.getUTCHours() * 60 + d.getUTCMinutes()
    };
  }
  function minutes(hhmm) {
    var p = String(hhmm || '').split(':');
    return (+p[0]) * 60 + (+p[1] || 0);
  }
  function isLive(day, s) {
    var now = eventNow();
    return day.date === now.date && s.start && s.end && now.min >= minutes(s.start) && now.min < minutes(s.end);
  }
  function timeOf(s) { return esc(s.start) + (s.end ? '–' + esc(s.end) : ''); }

  // ---- «Мои планы»: хранятся на устройстве участника ----
  function sessionId(day, s) { return day.id + '|' + s.start + '|' + s.title; }
  function loadPlans() {
    var fromLocal = function () {
      try { return JSON.parse(localStorage.getItem(PLANS_KEY) || '{}') || {}; } catch (e) { return {}; }
    };
    return new Promise(function (resolve) {
      try {
        if (WA && WA.DeviceStorage) {
          WA.DeviceStorage.getItem(PLANS_KEY).then(function (r) {
            try { resolve(r && r.value ? JSON.parse(r.value) : fromLocal()); } catch (e) { resolve(fromLocal()); }
          }).catch(function () { resolve(fromLocal()); });
          return;
        }
      } catch (e) {}
      resolve(fromLocal());
    });
  }
  function savePlans() {
    var json = JSON.stringify(plans);
    try { localStorage.setItem(PLANS_KEY, json); } catch (e) {}
    try { if (WA && WA.DeviceStorage) quiet(WA.DeviceStorage.setItem(PLANS_KEY, json)); } catch (e) {}
  }
  function togglePlan(id) {
    if (plans[id]) delete plans[id]; else plans[id] = true;
    haptic();
    savePlans();
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

  function currentDay() {
    var days = data.days || [];
    if (!state.day) {
      var t = eventNow().date;
      state.day = (days.filter(function (d) { return d.date === t; })[0] || days[0] || {}).id;
    }
    return days.filter(function (d) { return d.id === state.day; })[0] || days[0];
  }

  function sessionCard(day, s, i) {
    var place = placeById(s.place);
    var live = isLive(day, s);
    var plain = !s.people && !s.description;  // перерывы и т. п. — без подробностей
    var id = sessionId(day, s);
    var star = plain ? '' :
      '<button class="star' + (plans[id] ? ' star--on' : '') + '" data-star="' + esc(id) + '" aria-label="' +
      (plans[id] ? 'Убрать из моих планов' : 'Добавить в мои планы') + '">' + (plans[id] ? '★' : '☆') + '</button>';
    return '<div class="card session' + (live ? ' card--live' : '') + (plain ? ' card--plain' : ' card--click') + '"' +
      (plain ? '' : ' data-session="' + i + '" data-dayid="' + esc(day.id) + '" role="button" tabindex="0"') + '>' + star +
      '<div class="card__time">' + timeOf(s) + (live ? '<span class="badge">идёт сейчас</span>' : '') + '</div>' +
      '<div class="card__title">' + esc(s.title) + '</div>' +
      (s.tag ? '<div class="tag">' + esc(s.tag) + '</div>' : '') +
      (place ? '<div class="card__meta">📍 ' + esc(place.name) + '</div>' : '') +
      '</div>';
  }

  // ---- Главная ----
  function renderHome() {
    var f = data.forum || {};
    var days = data.days || [];
    var now = eventNow();
    var html = '';

    // Что идёт сейчас и что дальше
    var first = days[0], last = days[days.length - 1];
    if (first && now.date < first.date) {
      var diff = Math.round((Date.parse(first.date) - Date.parse(now.date)) / 86400000);
      html += '<div class="card card--accent"><div class="card__meta">До начала</div><div class="big">' + diff + ' ' + plural(diff, 'день', 'дня', 'дней') + '</div>' +
        '<div class="card__meta">' + esc(f.dates) + (f.city ? ' · ' + esc(f.city) : '') + '</div></div>';
    } else if (last && now.date > last.date) {
      html += '<div class="card card--accent"><div class="card__title">Форум завершён</div><div class="card__meta">Спасибо, что были с нами!</div></div>';
    } else {
      var today = days.filter(function (d) { return d.date === now.date; })[0];
      if (today) {
        var liveNow = [], next = [];
        today.sessions.forEach(function (s, i) {
          if (isLive(today, s)) liveNow.push([s, i]);
          else if (minutes(s.start) > now.min && (!next.length || s.start === next[0][0].start)) next.push([s, i]);
        });
        if (liveNow.length) {
          html += '<h2>Сейчас идёт</h2>' + liveNow.map(function (x) { return sessionCard(today, x[0], x[1]); }).join('');
        }
        if (next.length) {
          html += '<h2>Далее</h2>' + next.map(function (x) { return sessionCard(today, x[0], x[1]); }).join('');
        }
      }
    }

    // Быстрые разделы
    var myCount = Object.keys(plans).length;
    html += '<div class="tiles">' +
      tile('program', '🗓', 'Программа', (days[0] && days[0].sessions ? days.reduce(function (n, d) { return n + d.sessions.length; }, 0) + ' пунктов' : '')) +
      tile('mine', '⭐', 'Мои планы', myCount ? myCount + ' ' + plural(myCount, 'мероприятие', 'мероприятия', 'мероприятий') : 'Отметьте звёздочкой') +
      tile('places', '📍', 'Площадки', (data.places || []).length + ' ' + plural((data.places || []).length, 'зал', 'зала', 'залов')) +
      tile('faq', '❓', 'Вопросы', 'Частые вопросы') +
      '</div>';

    // Интерактив весь день
    var acts = data.activities || [];
    if (acts.length) {
      html += '<details class="card card--all"><summary>🎯 Весь день: интерактивные площадки</summary>' +
        acts.map(function (a) { return '<p><b>' + esc(a.title) + '</b><br>' + esc(a.description) + '</p>'; }).join('') +
        '</details>';
    }

    html += linksBlock();
    if (f.timezone) html += '<p class="muted small">🕒 ' + esc(f.timezone) + '</p>';
    return html;
  }

  function tile(go, icon, title, sub) {
    return '<button class="tile" data-go="' + go + '"><span class="tile__icon">' + icon + '</span>' +
      '<span class="tile__title">' + esc(title) + '</span><span class="tile__sub">' + esc(sub) + '</span></button>';
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function linksBlock() {
    var links = (data.links || []).filter(function (l) { return l && l.url; });
    if (!links.length) return '';
    return '<div class="card">' + links.map(function (l) {
      return '<button class="btn btn--wide" data-map="' + esc(l.url) + '">' + esc(l.icon || '🔗') + ' ' + esc(l.title) + '</button>';
    }).join('') + '</div>';
  }

  // ---- Программа ----
  function renderProgram() {
    var days = data.days || [];
    if (!days.length) return '<p class="muted">Программа появится позже.</p>';
    var day = currentDay();
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

    // Фильтры: все / мои планы, площадка
    var usedPlaces = (data.places || []).filter(function (p) {
      return days.some(function (d) { return d.sessions.some(function (s) { return s.place === p.id; }); });
    });
    html += '<div class="filters">' +
      '<div class="seg" role="group" aria-label="Что показать">' +
      '<button class="seg__btn" data-mine="0" aria-pressed="' + !state.mine + '">Вся программа</button>' +
      '<button class="seg__btn" data-mine="1" aria-pressed="' + state.mine + '">⭐ Мои планы</button></div>' +
      '<select class="select" id="place-filter" aria-label="Площадка"><option value="">Все площадки</option>' +
      usedPlaces.map(function (p) { return '<option value="' + esc(p.id) + '"' + (state.place === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
      '</select></div>';

    var acts = data.activities || [];
    if (acts.length && !state.mine && !state.place) {
      html += '<details class="card card--all"><summary>🎯 Весь день: интерактивные площадки</summary>' +
        acts.map(function (a) { return '<p><b>' + esc(a.title) + '</b><br>' + esc(a.description) + '</p>'; }).join('') +
        '</details>';
    }

    var shown = 0;
    (day.sessions || []).forEach(function (s, i) {
      if (state.place && s.place !== state.place) return;
      if (state.mine && !plans[sessionId(day, s)]) return;
      html += sessionCard(day, s, i);
      shown++;
    });
    if (!shown) {
      html += '<p class="muted">' + (state.mine
        ? 'Здесь пока пусто. Нажмите ☆ у мероприятия, чтобы добавить его в свои планы.'
        : 'На этой площадке мероприятий нет.') + '</p>';
    }
    if ((data.forum || {}).timezone) html += '<p class="muted small">🕒 ' + esc(data.forum.timezone) + '</p>';
    return html;
  }

  function renderSession(dayId, idx) {
    var day = (data.days || []).filter(function (d) { return d.id === dayId; })[0];
    var s = day && day.sessions[idx];
    if (!s) return closeDetail();
    var place = placeById(s.place);
    var id = sessionId(day, s);
    var html = '<div class="detail">' +
      (WA ? '' : '<button class="back" data-back>← Назад</button>') +
      '<p class="muted">' + esc(day.label || day.title) + ', ' + timeOf(s) + '</p>' +
      '<h2>' + esc(s.title) + '</h2>' +
      (s.tag ? '<div class="tag">' + esc(s.tag) + '</div>' : '') +
      '<button class="btn btn--wide' + (plans[id] ? ' btn--on' : '') + '" data-plan="' + esc(id) + '">' +
      (plans[id] ? '★ В моих планах' : '☆ Добавить в мои планы') + '</button>';
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
    view.dataset.detail = dayId + ':' + idx;
    showBack();
    window.scrollTo(0, 0);
  }

  // ---- Площадки ----
  function renderPlaces() {
    var list = data.places || [];
    if (!list.length) return '<p class="muted">Информация о площадках появится позже.</p>';
    return list.map(function (p) {
      return '<div class="card"><div class="card__title">' + esc(p.name) + '</div>' +
        '<div class="card__meta">' + esc(p.address) + '</div>' +
        (p.note ? '<div class="card__meta">' + esc(p.note) + '</div>' : '') +
        '<div class="row">' +
        '<button class="btn" data-placeprog="' + esc(p.id) + '">Программа зала</button>' +
        (mapUrl(p) ? '<button class="btn" data-map="' + esc(mapUrl(p)) + '">Как добраться</button>' : '') +
        '</div></div>';
    }).join('');
  }

  // ---- Вопросы ----
  function renderFaq() {
    return '<input class="search" id="faq-search" type="search" placeholder="Поиск по вопросам" value="' + esc(state.query) + '">' +
      '<div id="faq-list">' + faqList() + '</div>';
  }
  function faqList() {
    var q = state.query.trim().toLowerCase();
    var items = (data.faq || []).filter(function (f) {
      return !q || (f.q + ' ' + f.a).toLowerCase().indexOf(q) !== -1;
    });
    if (!items.length) return '<p class="muted">Ничего не нашлось. Загляните во вкладку «Помощь».</p>';
    return items.map(function (f) {
      return '<details class="card"><summary>' + esc(f.q) + '</summary><p>' + esc(f.a) + '</p></details>';
    }).join('');
  }

  // ---- Помощь ----
  function renderHelp() {
    var c = data.contacts || {};
    var f = data.forum || {};
    var html = '<h2>Как пользоваться приложением</h2>' +
      '<div class="card howto">' +
      '<p>🗓 <b>Программа</b> — нажмите на мероприятие, чтобы увидеть описание, спикеров и зал.</p>' +
      '<p>⭐ <b>Мои планы</b> — нажмите ☆ у мероприятия, и оно появится в вашем личном расписании. Отметки хранятся на этом устройстве.</p>' +
      '<p>📍 <b>Фильтр по площадкам</b> — в программе можно оставить мероприятия только одного зала.</p>' +
      '<p>🟢 Мероприятие, которое идёт прямо сейчас, подсвечено зелёным.</p>' +
      '<p>💬 Бот «Переправа» в чате отвечает на вопросы: просто напишите ему, например, «когда обед».</p>' +
      '</div>';
    html += linksBlock();
    html += '<h2>Контакты</h2><div class="card">' + (c.text ? '<p style="margin:0 0 6px">' + esc(c.text) + '</p>' : '');
    if (c.phone) html += '<a class="btn btn--wide" href="tel:' + esc(c.phone.replace(/[^\d+]/g, '')) + '">📞 ' + esc(c.phone) + '</a>';
    if (c.email) html += '<a class="btn btn--wide" href="mailto:' + esc(c.email) + '">✉️ ' + esc(c.email) + '</a>';
    if (c.site) html += '<button class="btn btn--wide" data-map="' + esc(c.site) + '">🌐 Сайт</button>';
    html += '</div>';
    if (f.about) html += '<div class="card"><div class="card__title">О мероприятии</div><p style="margin:6px 0 0">' + esc(f.about) + '</p></div>';
    return html;
  }

  var screens = { home: renderHome, program: renderProgram, places: renderPlaces, faq: renderFaq, help: renderHelp };

  function render() {
    if (!data) return;
    if (detailOpen) hideBack();
    delete view.dataset.detail;
    tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.tab === state.tab)); });
    view.innerHTML = (screens[state.tab] || renderHome)();
  }

  function go(tab) {
    state.tab = tab;
    haptic();
    render();
    window.scrollTo(0, 0);
  }

  // ---- События ----
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      if (state.tab === t.dataset.tab && !detailOpen) return;
      go(t.dataset.tab);
    });
  });

  view.addEventListener('click', function (e) {
    var el = e.target.closest('[data-star],[data-plan],[data-go],[data-mine],[data-placeprog],[data-day],[data-session],[data-map],[data-back]');
    if (!el) return;
    if (el.hasAttribute('data-star')) {
      togglePlan(el.getAttribute('data-star'));
      var y = window.scrollY; render(); window.scrollTo(0, y);
    } else if (el.hasAttribute('data-plan')) {
      togglePlan(el.getAttribute('data-plan'));
      var p = view.dataset.detail.split(':'); renderSession(p[0], +p[1]);
    } else if (el.hasAttribute('data-go')) {
      var target = el.getAttribute('data-go');
      if (target === 'mine') { state.mine = true; state.place = ''; target = 'program'; }
      else if (target === 'program') { state.mine = false; }
      go(target);
    } else if (el.hasAttribute('data-mine')) {
      state.mine = el.getAttribute('data-mine') === '1'; haptic(); render();
    } else if (el.hasAttribute('data-placeprog')) {
      state.place = el.getAttribute('data-placeprog'); state.mine = false; go('program');
    } else if (el.hasAttribute('data-day')) {
      state.day = el.getAttribute('data-day'); haptic(); render();
    } else if (el.hasAttribute('data-session')) {
      renderSession(el.getAttribute('data-dayid'), +el.getAttribute('data-session'));
    } else if (el.hasAttribute('data-map')) {
      openExternal(el.getAttribute('data-map'));
    } else if (el.hasAttribute('data-back')) {
      closeDetail();
    }
  });

  view.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-session]')) { e.preventDefault(); e.target.click(); }
  });

  view.addEventListener('input', function (e) {
    if (e.target.id !== 'faq-search') return;
    state.query = e.target.value;
    document.getElementById('faq-list').innerHTML = faqList();
  });

  view.addEventListener('change', function (e) {
    if (e.target.id !== 'place-filter') return;
    state.place = e.target.value;
    haptic();
    render();
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
  // (допустимые значения: home, program, places, faq, help).
  var start = WA && WA.initDataUnsafe && WA.initDataUnsafe.start_param;
  if (start && screens[start]) state.tab = start;

  // В облачной версии программа уже встроена в страницу, иначе загружаем content.json рядом.
  (window.__CONTENT__ ? Promise.resolve(window.__CONTENT__) :
    fetch('content.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }))
    .then(function (json) { data = json; fillHeader(); return loadPlans(); })
    .then(function (p) { plans = p || {}; render(); })
    .catch(function () {
      view.innerHTML = '<p class="muted">Не удалось загрузить данные. Проверьте интернет и откройте приложение ещё раз.</p>';
    });
})();
