// Панель организатора: объявления и рассылка, редактирование программы, вопросов и контактов, статистика.
// Видна только тем, чей id MAX указан в переменной ADMINS функции (проверяется на сервере).
(function () {
  'use strict';
  var PP = window.PP;
  if (!PP) return;
  var esc = PP.esc;

  var adm = { info: null, busy: false, error: '', section: 'home', edit: null, confirm: '', bc: null };

  function data() { return PP.getData(); }
  function rerender() { if (PP.state.tab === 'admin') { PP.view.innerHTML = renderAdmin(); } }
  function fail(e) { adm.busy = false; adm.error = e.message; rerender(); }

  function load() {
    adm.busy = true; adm.error = ''; rerender();
    PP.api('admin_info').then(function (r) {
      adm.info = r; adm.busy = false;
      if (r.content) PP.setData(r.content);
      if (r.broadcast && !r.broadcast.done) adm.bc = r.broadcast;
      rerender();
    }).catch(fail);
  }

  function back(to) { return '<button class="back" data-adm="go:' + (to || 'home') + '">← Назад</button>'; }

  function renderAdmin() {
    if (!PP.WA) return '<div class="card">Панель организатора работает внутри MAX.</div>';
    if (!adm.info) {
      if (!adm.busy && !adm.error) load();
      return adm.error ? '<div class="card card--warn">' + esc(adm.error) + '</div><button class="btn" data-adm="reload">Повторить</button>'
                       : '<p class="muted">Загрузка…</p>';
    }
    var err = adm.error ? '<div class="card card--warn">' + esc(adm.error) + '</div>' : '';
    var s = { notice: secNotice, program: secProgram, faq: secFaq, contacts: secContacts, stats: secStats }[adm.section];
    if (s) return err + s();

    var st = adm.info.stats || {};
    return '<h2>⚙️ Панель организатора</h2>' + err +
      '<div class="tiles">' +
      '<button class="tile" data-adm="go:notice"><span class="tile__icon">📢</span><span class="tile__title">Объявление</span><span class="tile__sub">Баннер и рассылка в чат</span></button>' +
      '<button class="tile" data-adm="go:program"><span class="tile__icon">🗓</span><span class="tile__title">Программа</span><span class="tile__sub">Изменить расписание</span></button>' +
      '<button class="tile" data-adm="go:faq"><span class="tile__icon">❓</span><span class="tile__title">Вопросы</span><span class="tile__sub">Частые вопросы</span></button>' +
      '<button class="tile" data-adm="go:contacts"><span class="tile__icon">☎️</span><span class="tile__title">Контакты и ссылки</span><span class="tile__sub">Оргкомитет, анкета, материалы</span></button>' +
      '<button class="tile" data-adm="go:stats"><span class="tile__icon">📊</span><span class="tile__title">Статистика</span><span class="tile__sub">' + (st.subscribers || 0) + ' ' + PP.plural(st.subscribers || 0, 'участник', 'участника', 'участников') + ' в боте</span></button>' +
      '</div>' +
      (adm.bc && !adm.bc.done ? '<div class="card card--warn">Рассылка не завершена: ' + adm.bc.pos + ' из ' + adm.bc.total +
        '. <button class="btn" data-adm="bc-continue">Продолжить</button></div>' : '') +
      '<p class="small muted">Изменения видят все участники сразу (бот — в течение минуты).</p>';
  }

  // ---------- Объявление ----------
  function secNotice() {
    var n = adm.info.notice;
    var subs = (adm.info.stats || {}).subscribers || 0;
    var html = back() + '<h2>📢 Объявление</h2>';
    if (n) {
      html += '<div class="card card--notice"><div class="card__meta">Сейчас на Главной и в меню бота:</div><p>' + esc(n.text) + '</p>' +
        '<button class="btn" data-adm="notice-clear">Снять баннер</button></div>';
    }
    if (adm.bc) {
      var b = adm.bc;
      html += '<div class="card"><div class="card__title">' + (b.done ? '✅ Рассылка завершена' : '⏳ Идёт рассылка…') + '</div>' +
        '<div class="progress"><span style="width:' + Math.round(100 * b.pos / Math.max(1, b.total)) + '%"></span></div>' +
        '<div class="card__meta">Отправлено ' + b.sent + ' из ' + b.total + (b.failed ? ', не доставлено ' + b.failed : '') + '</div>' +
        (b.done ? '' : '<p class="small">Не закрывайте приложение до конца рассылки.</p>') + '</div>';
    }
    html += '<div class="card form">' +
      '<label class="field"><span>Текст объявления</span><textarea id="a-text" rows="4" maxlength="500" placeholder="Например: Площадка №2 переносится в Актовый зал">' + esc(adm.draft || '') + '</textarea></label>' +
      '<label class="check"><input type="checkbox" id="a-banner"' + (adm.optBanner === false ? '' : ' checked') + '> Показать баннером на Главной и в меню бота</label>' +
      '<label class="check"><input type="checkbox" id="a-send"' + (adm.optSend ? ' checked' : '') + '> Разослать в чат всем, кто писал боту (' + subs + ')</label>';
    if (adm.confirm === 'notice') {
      html += '<p class="small"><b>Отправить объявление ' + subs + ' ' + PP.plural(subs, 'участнику', 'участникам', 'участникам') + '?</b> Отменить отправку будет нельзя.</p>' +
        '<div class="row"><button class="btn btn--primary" data-adm="notice-go">Да, отправить</button><button class="btn" data-adm="cancel">Отмена</button></div>';
    } else {
      html += '<button class="btn btn--primary btn--wide" data-adm="notice-publish"' + (adm.busy ? ' disabled' : '') + '>Опубликовать</button>';
    }
    return html + '</div>';
  }

  function runBroadcast() {
    if (!adm.bc || adm.bc.done) return;
    PP.api('admin_bc_batch', { id: adm.bc.id }).then(function (r) {
      adm.bc = r; rerender();
      if (!r.done) runBroadcast(); else { PP.toast('Рассылка завершена'); load(); }
    }).catch(fail);
  }

  // ---------- Программа ----------
  function days() { return (data().days || []); }
  function places() { return (data().places || []); }
  function curDay() {
    var d = days();
    return d.filter(function (x) { return x.id === adm.day; })[0] || d[0];
  }

  function secProgram() {
    var html = back() + '<h2>🗓 Программа</h2>';
    var d = curDay();
    if (!d) return html + '<p class="muted">В программе нет дней.</p>';
    if (adm.edit && adm.edit.kind === 'session') return sessionForm(d, adm.edit);
    if (days().length > 1) {
      html += '<div class="chips">' + days().map(function (x) {
        return '<button class="chip" data-adm="day:' + esc(x.id) + '" aria-pressed="' + (x.id === d.id) + '">' + esc(x.label || x.title) + '</button>';
      }).join('') + '</div>';
    }
    html += '<button class="btn btn--primary btn--wide" data-adm="s-new">+ Добавить пункт</button>';
    html += d.sessions.map(function (s, i) {
      return '<div class="card row-item"><div><div class="card__time">' + esc(s.start) + (s.end ? '–' + esc(s.end) : '') + '</div>' +
        '<div class="card__title">' + esc(s.title) + '</div></div>' +
        '<button class="btn" data-adm="s-edit:' + i + '">✏️</button></div>';
    }).join('');
    html += overrideNote();
    return html;
  }

  function sessionForm(d, ed) {
    var s = ed.index >= 0 ? d.sessions[ed.index] : { start: '', end: '', title: '', place: '', tag: '', people: '', description: '' };
    function f(id, label, val, ph) {
      return '<label class="field"><span>' + label + '</span><input id="s-' + id + '" value="' + esc(val || '') + '" placeholder="' + esc(ph || '') + '"></label>';
    }
    var html = back('program') + '<h2>' + (ed.index >= 0 ? 'Изменить пункт' : 'Новый пункт') + '</h2><div class="card form">' +
      '<div class="row">' + f('start', 'Начало *', s.start, '10:00') + f('end', 'Окончание', s.end, '11:30') + '</div>' +
      '<label class="field"><span>Название *</span><textarea id="s-title" rows="2">' + esc(s.title) + '</textarea></label>' +
      '<label class="field"><span>Зал</span><select id="s-place" class="select"><option value="">— не указан —</option>' +
      places().map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === s.place ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
      '</select></label>' +
      f('tag', 'Метка (например, «Закрытое заседание»)', s.tag) +
      '<label class="field"><span>Ведущие, спикеры</span><textarea id="s-people" rows="4">' + esc(s.people) + '</textarea></label>' +
      '<label class="field"><span>Описание</span><textarea id="s-description" rows="5">' + esc(s.description) + '</textarea></label>' +
      '<button class="btn btn--primary btn--wide" data-adm="s-save"' + (adm.busy ? ' disabled' : '') + '>Сохранить и опубликовать</button>';
    if (ed.index >= 0) {
      html += adm.confirm === 'delete'
        ? '<div class="row"><button class="btn btn--danger" data-adm="s-del-yes">Да, удалить пункт</button><button class="btn" data-adm="cancel">Отмена</button></div>'
        : '<button class="linkbtn" data-adm="s-del">Удалить этот пункт</button>';
    }
    return html + '</div>';
  }

  function overrideNote() {
    if (!adm.info.override) return '<p class="small muted">Сейчас программа берётся из content.json на GitHub. После первого сохранения здесь будет использоваться версия из приложения.</p>';
    return '<p class="small muted">Программа отредактирована в приложении, файл на GitHub сейчас не используется.</p>' +
      (adm.confirm === 'reset'
        ? '<div class="row"><button class="btn btn--danger" data-adm="reset-yes">Да, вернуть версию с GitHub</button><button class="btn" data-adm="cancel">Отмена</button></div>'
        : '<button class="linkbtn" data-adm="reset">Вернуть версию с GitHub</button>');
  }

  // ---------- Вопросы ----------
  function secFaq() {
    var faq = data().faq || [];
    if (adm.edit && adm.edit.kind === 'faq') {
      var item = adm.edit.index >= 0 ? faq[adm.edit.index] : { q: '', a: '' };
      return back('faq') + '<h2>' + (adm.edit.index >= 0 ? 'Изменить вопрос' : 'Новый вопрос') + '</h2><div class="card form">' +
        '<label class="field"><span>Вопрос *</span><textarea id="q-q" rows="2">' + esc(item.q) + '</textarea></label>' +
        '<label class="field"><span>Ответ</span><textarea id="q-a" rows="6">' + esc(item.a) + '</textarea></label>' +
        '<button class="btn btn--primary btn--wide" data-adm="q-save">Сохранить и опубликовать</button>' +
        (adm.edit.index >= 0 ? (adm.confirm === 'delete'
          ? '<div class="row"><button class="btn btn--danger" data-adm="q-del-yes">Да, удалить</button><button class="btn" data-adm="cancel">Отмена</button></div>'
          : '<button class="linkbtn" data-adm="q-del">Удалить вопрос</button>') : '') + '</div>';
    }
    return back() + '<h2>❓ Частые вопросы</h2><button class="btn btn--primary btn--wide" data-adm="q-new">+ Добавить вопрос</button>' +
      faq.map(function (f, i) {
        return '<div class="card row-item"><div class="card__title">' + esc(f.q) + '</div><button class="btn" data-adm="q-edit:' + i + '">✏️</button></div>';
      }).join('');
  }

  // ---------- Контакты и ссылки ----------
  function secContacts() {
    var c = adm.cdraft || data().contacts || {};
    var links = adm.links || (data().links || []).slice();
    adm.links = links;
    function f(id, label, val, ph) {
      return '<label class="field"><span>' + label + '</span><input id="c-' + id + '" value="' + esc(val || '') + '" placeholder="' + esc(ph || '') + '"></label>';
    }
    return back() + '<h2>☎️ Контакты и ссылки</h2><div class="card form">' +
      '<label class="field"><span>Текст</span><textarea id="c-text" rows="2">' + esc(c.text) + '</textarea></label>' +
      f('phone', 'Телефон', c.phone, '+7 ...') + f('email', 'Почта', c.email) + f('site', 'Сайт', c.site, 'https://...') +
      '</div><h2>Кнопки-ссылки</h2><p class="small muted">Появятся на Главной и во вкладке «Помощь»: анкета, материалы, программа в PDF.</p>' +
      links.map(function (l, i) {
        return '<div class="card form">' +
          '<div class="row"><label class="field" style="width:70px"><span>Значок</span><input class="l-icon" data-i="' + i + '" value="' + esc(l.icon || '🔗') + '"></label>' +
          '<label class="field" style="flex:1"><span>Название</span><input class="l-title" data-i="' + i + '" value="' + esc(l.title) + '" placeholder="Заполнить анкету"></label></div>' +
          '<label class="field"><span>Ссылка (https://...)</span><input class="l-url" data-i="' + i + '" value="' + esc(l.url) + '"></label>' +
          '<button class="linkbtn" data-adm="l-del:' + i + '">Убрать ссылку</button></div>';
      }).join('') +
      '<button class="btn btn--wide" data-adm="l-add">+ Добавить ссылку</button>' +
      '<button class="btn btn--primary btn--wide" data-adm="c-save"' + (adm.busy ? ' disabled' : '') + '>Сохранить и опубликовать</button>';
  }

  function readLinks() {
    var rows = [];
    document.querySelectorAll('.l-url').forEach(function (inp) {
      var i = inp.getAttribute('data-i');
      rows.push({ url: inp.value.trim(), title: (document.querySelector('.l-title[data-i="' + i + '"]') || {}).value || '',
        icon: (document.querySelector('.l-icon[data-i="' + i + '"]') || {}).value || '🔗' });
    });
    return rows;
  }

  // ---------- Статистика ----------
  function secStats() {
    var s = adm.info.stats || {};
    function row(label, v) { return '<div class="stat"><span>' + label + '</span><b>' + (v || 0) + '</b></div>'; }
    return back() + '<h2>📊 Статистика</h2><div class="card">' +
      row('Писали боту', s.subscribers) + row('Дали согласие на визитки', s.consents) +
      row('Заполнили визитку', s.cards) + row('Видны в списке участников', s.visible_cards) +
      row('Запросов на знакомство', s.intros_sent) + row('Принято запросов', s.intros_accepted) +
      row('Обменов по QR', s.qr_exchanges) + row('Включили напоминания', s.remind_users) +
      row('Разослано объявлений', s.broadcasts) + row('Удалили свои данные', s.forgets) + '</div>' +
      (s.popular && s.popular.length ? '<h2>Чаще всего в «Моих планах»</h2><div class="card">' + s.popular.map(function (p) {
        return '<div class="stat"><span>' + esc(p.title) + '</span><b>' + p.count + '</b></div>';
      }).join('') + '</div>' : '<p class="small muted">Пока никто не отмечал мероприятия в «Моих планах».</p>') +
      '<div class="row"><button class="btn" data-adm="reload">🔄 Обновить</button><button class="btn" data-adm="stats-chat">📩 Прислать сводку в чат</button></div>';
  }

  // ---------- сохранение программы ----------
  function publish(mutate, okText) {
    var c = JSON.parse(JSON.stringify(data()));
    try { mutate(c); } catch (e) { adm.error = e.message; rerender(); return; }
    adm.busy = true; adm.error = ''; rerender();
    PP.api('admin_save_content', { content: { days: c.days, faq: c.faq, contacts: c.contacts, links: c.links } }).then(function (r) {
      adm.busy = false; adm.edit = null; adm.confirm = ''; adm.links = null; adm.cdraft = null;
      adm.info.override = true; PP.setData(r.content);
      PP.toast(okText || 'Опубликовано'); PP.haptic(); rerender(); window.scrollTo(0, 0);
    }).catch(fail);
  }

  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }

  function action(a, el) {
    var parts = a.split(':'), cmd = parts[0], arg = parts.slice(1).join(':');
    adm.error = '';
    if (cmd === 'reload') { adm.info = null; rerender(); return; }
    if (cmd === 'go') { adm.section = arg; adm.edit = null; adm.confirm = ''; adm.links = null; adm.cdraft = null; rerender(); window.scrollTo(0, 0); return; }
    if (cmd === 'cancel') { adm.confirm = ''; rerender(); return; }
    if (cmd === 'day') { adm.day = arg; rerender(); return; }

    if (cmd === 'notice-clear') {
      PP.api('admin_notice', { text: '' }).then(function () { window.__NOTICE__ = null; adm.info.notice = null; PP.toast('Баннер снят'); rerender(); }).catch(fail);
      return;
    }
    if (cmd === 'notice-publish' || cmd === 'notice-go') {
      var text = val('a-text') || adm.draft || '';
      var banner = document.getElementById('a-banner') ? document.getElementById('a-banner').checked : adm.optBanner;
      var send = document.getElementById('a-send') ? document.getElementById('a-send').checked : adm.optSend;
      if (!text) { adm.error = 'Введите текст объявления'; rerender(); return; }
      if (!banner && !send) { adm.error = 'Выберите: баннер, рассылка или и то и другое'; rerender(); return; }
      adm.draft = text; adm.optBanner = banner; adm.optSend = send;
      if (send && cmd === 'notice-publish') { adm.confirm = 'notice'; rerender(); return; }
      adm.confirm = ''; adm.busy = true; rerender();
      var p = banner ? PP.api('admin_notice', { text: text }).then(function (r) { window.__NOTICE__ = r.notice; adm.info.notice = r.notice; })
                     : Promise.resolve();
      p.then(function () {
        if (!send) { adm.busy = false; adm.draft = ''; adm.optSend = false; PP.toast('Баннер опубликован'); rerender(); return; }
        return PP.api('admin_bc_start', { text: text }).then(function (r) {
          adm.bc = r; adm.busy = false; adm.draft = ''; adm.optSend = false; rerender(); runBroadcast();
        });
      }).catch(fail);
      return;
    }
    if (cmd === 'bc-continue') { adm.section = 'notice'; rerender(); runBroadcast(); return; }

    // программа
    if (cmd === 's-new') { adm.edit = { kind: 'session', index: -1 }; rerender(); window.scrollTo(0, 0); return; }
    if (cmd === 's-edit') { adm.edit = { kind: 'session', index: +arg }; rerender(); window.scrollTo(0, 0); return; }
    if (cmd === 's-del') { adm.confirm = 'delete'; rerender(); return; }
    if (cmd === 's-save' || cmd === 's-del-yes') {
      var dayId = curDay().id, idx = adm.edit.index;
      var item = { start: val('s-start'), end: val('s-end'), title: val('s-title'), place: val('s-place'),
        tag: val('s-tag'), people: val('s-people'), description: val('s-description') };
      if (cmd === 's-save' && (!/^\d{1,2}:\d{2}$/.test(item.start) || !item.title)) {
        adm.error = 'Укажите время начала в формате 10:00 и название'; rerender(); return;
      }
      publish(function (c) {
        var d = c.days.filter(function (x) { return x.id === dayId; })[0];
        if (idx >= 0) {
          // сохраняем прежний id, чтобы не потерять отметки «Мои планы» и напоминания
          var old = d.sessions[idx];
          item.id = old.id || (dayId + '|' + old.start + '|' + old.title);
        } else {
          item.new = true;
        }
        if (cmd === 's-del-yes') d.sessions.splice(idx, 1);
        else if (idx >= 0) d.sessions[idx] = item;
        else d.sessions.push(item);
      }, cmd === 's-del-yes' ? 'Пункт удалён' : 'Программа обновлена');
      return;
    }
    if (cmd === 'reset') { adm.confirm = 'reset'; rerender(); return; }
    if (cmd === 'reset-yes') {
      adm.busy = true; rerender();
      PP.api('admin_reset_content').then(function (r) {
        adm.busy = false; adm.confirm = ''; adm.info.override = false; PP.setData(r.content); PP.toast('Вернули версию с GitHub'); rerender();
      }).catch(fail);
      return;
    }

    // вопросы
    if (cmd === 'q-new') { adm.edit = { kind: 'faq', index: -1 }; rerender(); return; }
    if (cmd === 'q-edit') { adm.edit = { kind: 'faq', index: +arg }; rerender(); return; }
    if (cmd === 'q-del') { adm.confirm = 'delete'; rerender(); return; }
    if (cmd === 'q-save' || cmd === 'q-del-yes') {
      var qi = adm.edit.index, q = { q: val('q-q'), a: val('q-a') };
      if (cmd === 'q-save' && !q.q) { adm.error = 'Введите вопрос'; rerender(); return; }
      publish(function (c) {
        c.faq = c.faq || [];
        if (cmd === 'q-del-yes') c.faq.splice(qi, 1);
        else if (qi >= 0) c.faq[qi] = q;
        else c.faq.push(q);
      }, 'Вопросы обновлены');
      return;
    }

    // контакты и ссылки
    var readContacts = function () { return { text: val('c-text'), phone: val('c-phone'), email: val('c-email'), site: val('c-site') }; };
    if (cmd === 'l-add') { adm.cdraft = readContacts(); adm.links = readLinks(); adm.links.push({ icon: '🔗', title: '', url: '' }); rerender(); return; }
    if (cmd === 'l-del') { adm.cdraft = readContacts(); adm.links = readLinks(); adm.links.splice(+arg, 1); rerender(); return; }
    if (cmd === 'c-save') {
      var links = readLinks().filter(function (l) { return l.url || l.title; });
      for (var i = 0; i < links.length; i++) {
        if (!/^https:\/\//.test(links[i].url) || !links[i].title) { adm.error = 'У каждой ссылки нужны название и адрес, начинающийся с https://'; rerender(); return; }
      }
      var contacts = { text: val('c-text'), phone: val('c-phone'), email: val('c-email'), site: val('c-site') };
      publish(function (c) { c.contacts = contacts; c.links = links; }, 'Контакты обновлены');
      return;
    }

    if (cmd === 'stats-chat') { PP.api('admin_stats_to_chat').then(function () { PP.toast('Сводка отправлена в чат с ботом'); }).catch(fail); return; }
  }

  PP.screens.admin = renderAdmin;
  window.PPAdmin = {
    action: action,
    reset: function () { adm.section = 'home'; adm.edit = null; adm.confirm = ''; adm.error = ''; adm.links = null; adm.cdraft = null; adm.info = null; }
  };
})();
