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
      tile('people', '🤝', 'Коллеги', 'Визитки и знакомства') +
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
    return '<h2>Частые вопросы</h2>' +
      '<input class="search" id="faq-search" type="search" placeholder="Поиск по вопросам" value="' + esc(state.query) + '">' +
      '<div id="faq-list">' + faqList() + '</div>';
  }

  // ---- Коллеги: визитки и знакомства ----
  var API_URL = location.origin + location.pathname;
  var net = { me: null, dir: null, error: '', busy: false, view: 'main', person: null, interest: '', q: '', confirmForget: false, pendingCode: '' };

  function api(op, extra) {
    var body = { op: op, initData: (WA && WA.initData) || '' };
    for (var k in (extra || {})) body[k] = extra[k];
    return fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.error || 'Сервис временно недоступен');
          return j;
        });
      });
  }

  function peopleRerender() { if (state.tab === 'people' && !detailOpen) { view.innerHTML = renderPeople(); } }

  function loadMe() {
    net.busy = true; net.error = ''; peopleRerender();
    return api('me').then(function (r) {
      net.me = r; net.busy = false;
      if (r.consent && r.card) return loadDir();
    }).then(function () {
      net.busy = false;
      if (net.pendingCode) { var c = net.pendingCode; net.pendingCode = ''; return lookupCode(c); }
      peopleRerender();
    }).catch(function (e) { net.busy = false; net.error = e.message; peopleRerender(); });
  }

  function loadDir() {
    return api('directory').then(function (r) { net.dir = r.items || []; peopleRerender(); });
  }

  function lookupCode(code) {
    code = String(code || '').trim();
    var m = code.match(/startapp=c_([A-Za-z0-9]+)/) || code.match(/^c_([A-Za-z0-9]+)$/) || code.match(/^([A-Za-z0-9]{4,12})$/);
    if (!m) { net.error = 'Это не код визитки'; peopleRerender(); return Promise.resolve(); }
    net.busy = true; peopleRerender();
    return api('lookup', { code: m[1] }).then(function (r) {
      net.busy = false; net.person = { code: m[1], card: r.card, connected: r.connected }; net.view = 'person'; peopleRerender();
    }).catch(function (e) { net.busy = false; net.error = e.message; peopleRerender(); });
  }

  function personHtml(c, contacts) {
    var job = [c.position, c.org].filter(Boolean).join(', ');
    var html = '<div class="card__title">' + esc(c.name) + '</div>' +
      (job ? '<div class="card__meta">' + esc(job) + '</div>' : '') +
      (c.region ? '<div class="card__meta">📍 ' + esc(c.region) + '</div>' : '') +
      (c.interests && c.interests.length ? '<div class="chips-s">' + c.interests.map(function (i) { return '<span class="tag">' + esc(i) + '</span>'; }).join(' ') + '</div>' : '') +
      (c.about ? '<p class="small" style="margin:6px 0 0">' + esc(c.about) + '</p>' : '');
    if (contacts) {
      html += '<div class="row">' +
        (c.phone ? '<a class="btn" href="tel:' + esc(String(c.phone).replace(/[^\d+]/g, '')) + '">📞 ' + esc(c.phone) + '</a>' : '') +
        (c.email ? '<a class="btn" href="mailto:' + esc(c.email) + '">✉️ ' + esc(c.email) + '</a>' : '') +
        '</div>';
    }
    return html;
  }

  function consentHtml(p) {
    return '<div class="card card--accent"><div class="card__title">Согласие на обработку персональных данных</div>' +
      '<p class="small">Чтобы заполнить визитку и обмениваться контактами, нужно ваше согласие на обработку персональных данных оператором — ' +
      esc(p.operator) + ': имени, организации, должности, региона, интересов и контактов, которые вы сами укажете.</p>' +
      '<p class="small">Согласие можно отозвать в любой момент кнопкой «Удалить мои данные» в этом разделе или письмом на ' + esc(p.email) + '.</p>' +
      '<button class="btn" data-map="' + esc(p.url) + '">📄 Текст согласия и политика</button>' +
      '<button class="btn btn--primary btn--wide" data-net="consent">✅ Даю согласие</button></div>';
  }

  function editForm(card) {
    card = card || {};
    var u = (WA && WA.initDataUnsafe && WA.initDataUnsafe.user) || {};
    var name = card.name || [u.first_name, u.last_name].filter(Boolean).join(' ');
    var interests = (net.me && net.me.interests) || [];
    var mine = card.interests || [];
    function field(id, label, value, type, ph) {
      return '<label class="field"><span>' + label + '</span><input id="f-' + id + '" type="' + (type || 'text') + '" value="' + esc(value || '') + '" placeholder="' + esc(ph || '') + '"></label>';
    }
    return '<div class="detail"><button class="back" data-net="back">← Назад</button><h2>' + (net.me && net.me.card ? 'Изменить визитку' : 'Моя визитка') + '</h2>' +
      '<div class="card form">' +
      field('name', 'Имя и фамилия *', name) +
      field('position', 'Должность', card.position) +
      field('org', 'Организация', card.org) +
      field('region', 'Регион', card.region, 'text', 'Например: Самарская область') +
      '<label class="field"><span>О себе: чем могу быть полезен</span><textarea id="f-about" rows="3" maxlength="300">' + esc(card.about || '') + '</textarea></label>' +
      '<div class="field"><span>Интересы (до 5)</span><div class="checks">' +
      interests.map(function (i) { return '<label class="check"><input type="checkbox" class="f-int" value="' + esc(i) + '"' + (mine.indexOf(i) >= 0 ? ' checked' : '') + '> ' + esc(i) + '</label>'; }).join('') +
      '</div></div>' +
      field('phone', 'Телефон', card.phone, 'tel') +
      field('email', 'Почта', card.email, 'email') +
      '<p class="small muted">Телефон и почту увидят только те, с кем вы обменяетесь визитками.</p>' +
      '<label class="check"><input type="checkbox" id="f-visible"' + (card.visible === false ? '' : ' checked') + '> Показывать мою визитку в списке участников</label>' +
      '<button class="btn btn--primary btn--wide" data-net="save">Сохранить</button>' +
      '</div></div>';
  }

  function renderPeople() {
    if (!WA) {
      return '<h2>Коллеги</h2><div class="card">Визитки работают внутри MAX. Откройте приложение из чата с ботом «Переправа».</div>';
    }
    if (!net.me) {
      if (!net.busy && !net.error) loadMe();
      return net.error ? '<div class="card">' + esc(net.error) + '<button class="btn btn--wide" data-net="reload">Повторить</button></div>'
                       : '<p class="muted">Загрузка…</p>';
    }
    var me = net.me;
    var err = net.error ? '<div class="card card--warn">' + esc(net.error) + '</div>' : '';
    if (net.view === 'edit') return err + editForm(me.card);
    if (net.view === 'qr' && me.card) {
      return '<div class="detail"><button class="back" data-net="back">← Назад</button><h2>Мой QR-код</h2>' +
        '<div class="card qr">' + me.qr + '<div class="code">' + esc(me.code) + '</div>' +
        '<p class="small">Покажите этот код коллеге. Он отсканирует его камерой телефона или в приложении («Коллеги» → «Сканировать QR»), и вы сразу обменяетесь визитками.</p></div></div>';
    }
    if (net.view === 'person' && net.person) {
      var pc = net.person;
      return '<div class="detail"><button class="back" data-net="back">← Назад</button>' + err +
        '<div class="card">' + personHtml(pc.card, pc.connected) + '</div>' +
        (pc.connected ? '<p class="muted small">Вы уже обменялись визитками.</p>'
          : (me.card ? '<button class="btn btn--primary btn--wide" data-net="exchange">🤝 Обменяться визитками</button>'
                     : '<p class="small">Чтобы обменяться визитками, сначала заполните свою.</p><button class="btn btn--wide" data-net="edit">Заполнить визитку</button>')) +
        '</div>';
    }

    var html = '<h2>Коллеги</h2>' + err;
    if (!me.consent) return html + consentHtml(me.privacy || {});
    if (!me.card) {
      return html + '<div class="card"><div class="card__title">Расскажите о себе</div>' +
        '<p class="small">Заполните визитку, чтобы коллеги из других регионов и ведомств могли вас найти. Это займёт пару минут.</p>' +
        '<button class="btn btn--primary btn--wide" data-net="edit">Заполнить визитку</button></div>' + forgetBlock();
    }

    html += '<div class="card mycard"><div class="muted small">Моя визитка' + (me.card.visible === false ? ' · скрыта из списка' : '') + '</div>' +
      personHtml(me.card, false) +
      '<div class="row"><button class="btn" data-net="edit">✏️ Изменить</button><button class="btn" data-net="qr">🔳 Мой QR-код</button></div></div>';
    html += '<div class="row"><button class="btn" data-net="scan">📷 Сканировать QR</button><button class="btn" data-net="code">⌨️ Ввести код</button></div>' +
      (net.view === 'code' ? '<div class="card row"><input class="search" id="code-input" placeholder="Код визитки, например K7M2QX" style="margin:0;flex:1"><button class="btn" data-net="lookup" style="margin:0">Найти</button></div>' : '');

    var contacts = me.contacts || [];
    if (contacts.length) {
      html += '<h2>Мои контакты · ' + contacts.length + '</h2>' + contacts.map(function (c) { return '<div class="card">' + personHtml(c, true) + '</div>'; }).join('');
    }

    html += '<h2>Участники</h2>';
    var list = net.dir;
    if (!list) return html + '<p class="muted">Загрузка…</p>' + forgetBlock();
    var used = {};
    list.forEach(function (p) { (p.interests || []).forEach(function (i) { used[i] = 1; }); });
    html += '<div class="filters"><select class="select" id="int-filter"><option value="">Все интересы</option>' +
      Object.keys(used).map(function (i) { return '<option' + (net.interest === i ? ' selected' : '') + '>' + esc(i) + '</option>'; }).join('') +
      '</select><input class="search" id="people-search" placeholder="Имя, регион, организация" value="' + esc(net.q) + '" style="margin:0;flex:1;min-width:150px"></div>' +
      '<div id="people-list">' + peopleList() + '</div>';
    return html + forgetBlock();
  }

  function peopleList() {
    var q = net.q.trim().toLowerCase();
    var items = (net.dir || []).filter(function (p) {
      if (net.interest && (p.interests || []).indexOf(net.interest) < 0) return false;
      return !q || [p.name, p.org, p.position, p.region].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    if (!items.length) return '<p class="muted">' + ((net.dir || []).length ? 'Никого не нашлось.' : 'Пока никто не заполнил визитку. Будьте первым!') + '</p>';
    return items.map(function (p) {
      var action = p.connected ? '<span class="tag">В контактах</span>'
        : p.sent ? '<span class="tag">Запрос отправлен</span>'
        : '<button class="btn" data-intro="' + esc(p.uid) + '">🤝 Познакомиться</button>';
      return '<div class="card">' + personHtml(p, false) + '<div class="row">' + action + '</div></div>';
    }).join('');
  }

  function forgetBlock() {
    if (!net.me || (!net.me.consent && !net.me.card)) return '';
    return '<div class="forget">' + (net.confirmForget
      ? '<p class="small">Удалить визитку, контакты и отозвать согласие? Это нельзя отменить.</p><div class="row"><button class="btn btn--danger" data-net="forget-yes">Да, удалить</button><button class="btn" data-net="forget-no">Отмена</button></div>'
      : '<button class="linkbtn" data-net="forget">Удалить мои данные и отозвать согласие</button>') + '</div>';
  }

  function netAction(a, el) {
    var done = function (r) { net.me = r; net.busy = false; net.error = ''; peopleRerender(); };
    var fail = function (e) { net.busy = false; net.error = e.message; peopleRerender(); };
    net.error = '';
    if (a === 'reload') { net.me = null; peopleRerender(); return; }
    if (a === 'consent') { api('consent').then(done).catch(fail); return; }
    if (a === 'edit') { net.view = 'edit'; peopleRerender(); window.scrollTo(0, 0); return; }
    if (a === 'qr') { net.view = 'qr'; peopleRerender(); window.scrollTo(0, 0); return; }
    if (a === 'back') { net.view = 'main'; net.person = null; peopleRerender(); return; }
    if (a === 'code') { net.view = net.view === 'code' ? 'main' : 'code'; peopleRerender(); return; }
    if (a === 'lookup') { lookupCode((document.getElementById('code-input') || {}).value); return; }
    if (a === 'scan') {
      try {
        quiet(WA.openCodeReader(true).then(function (r) { if (r && r.value) lookupCode(r.value); }));
      } catch (e) { net.error = 'Сканер недоступен на этом устройстве. Введите код вручную.'; peopleRerender(); }
      return;
    }
    if (a === 'save') {
      var val = function (id) { return (document.getElementById('f-' + id) || {}).value || ''; };
      var ints = Array.prototype.slice.call(document.querySelectorAll('.f-int:checked')).map(function (x) { return x.value; });
      if (ints.length > 5) { net.error = 'Выберите не больше 5 интересов'; peopleRerender(); return; }
      var card = { name: val('name'), position: val('position'), org: val('org'), region: val('region'), about: val('about'),
        phone: val('phone'), email: val('email'), interests: ints, visible: document.getElementById('f-visible').checked };
      el.disabled = true; el.textContent = 'Сохраняю…';
      api('save_card', { card: card }).then(function (r) { net.view = 'main'; done(r); return loadDir(); }).catch(fail);
      return;
    }
    if (a === 'exchange' && net.person) {
      el.disabled = true;
      api('exchange', { code: net.person.code }).then(function (r) {
        net.person = { code: net.person.code, card: r.card, connected: true };
        return api('me').then(function (m) { net.me = m; return loadDir(); });
      }).then(function () { peopleRerender(); }).catch(fail);
      return;
    }
    if (a === 'forget') { net.confirmForget = true; peopleRerender(); return; }
    if (a === 'forget-no') { net.confirmForget = false; peopleRerender(); return; }
    if (a === 'forget-yes') { net.confirmForget = false; net.dir = null; net.view = 'main'; api('forget').then(done).catch(fail); return; }
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
      '<p>🤝 <b>Коллеги</b> — заполните визитку, найдите коллег по интересам и нажмите «Познакомиться». ' +
      'Телефон и почту видят только те, с кем вы обменялись визитками. На месте можно обменяться визитками по QR-коду.</p>' +
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
    var pr = data.privacy || {};
    if (pr.url) html += '<p class="small muted">Оператор персональных данных — ' + esc(pr.operator) + '. <a href="#" data-map="' + esc(pr.url) + '">Политика обработки персональных данных</a>.</p>';
    return renderFaq() + html;
  }

  var screens = { home: renderHome, program: renderProgram, people: renderPeople, places: renderPlaces, faq: renderFaq, help: renderHelp };

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
    var el = e.target.closest('[data-net],[data-intro],[data-star],[data-plan],[data-go],[data-mine],[data-placeprog],[data-day],[data-session],[data-map],[data-back]');
    if (!el) return;
    if (el.tagName === 'A' && el.hasAttribute('data-map')) e.preventDefault();
    if (el.hasAttribute('data-net')) {
      netAction(el.getAttribute('data-net'), el);
    } else if (el.hasAttribute('data-intro')) {
      var to = el.getAttribute('data-intro');
      el.disabled = true; el.textContent = 'Отправляю…';
      api('intro', { to: to }).then(function () {
        (net.dir || []).forEach(function (p) { if (String(p.uid) === to) p.sent = true; });
        haptic(); peopleRerender();
      }).catch(function (err) { net.error = err.message; peopleRerender(); });
    } else if (el.hasAttribute('data-star')) {
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
    if (e.target.id === 'faq-search') {
      state.query = e.target.value;
      document.getElementById('faq-list').innerHTML = faqList();
    } else if (e.target.id === 'people-search') {
      net.q = e.target.value;
      document.getElementById('people-list').innerHTML = peopleList();
    }
  });

  view.addEventListener('change', function (e) {
    if (e.target.id === 'place-filter') {
      state.place = e.target.value; haptic(); render();
    } else if (e.target.id === 'int-filter') {
      net.interest = e.target.value; document.getElementById('people-list').innerHTML = peopleList();
    } else if (e.target.classList.contains('f-int')) {
      var n = document.querySelectorAll('.f-int:checked').length;
      if (n > 5) { e.target.checked = false; }
    }
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
  // (допустимые значения: home, program, people, places, faq, help; colleagues — то же, что people;
  // c_КОД — открыть визитку коллеги по коду из QR).
  var start = WA && WA.initDataUnsafe && WA.initDataUnsafe.start_param;
  if (start === 'colleagues') start = 'people';
  if (start && /^c_[A-Za-z0-9]+$/.test(start)) { net.pendingCode = start; start = 'people'; }
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
