(function () {
  'use strict';
  var C = window.DamanCore;
  var I18N = window.DAMAN_I18N;
  var LS_ITEMS = 'daman.items.v1', LS_SET = 'daman.settings.v1', LS_NOTIFIED = 'daman.notified.v1';
  var CATS = ['electronics', 'appliance', 'phone', 'furniture', 'car', 'other'];
  var CURRENCIES = ['EGP', 'SAR', 'AED', 'USD', 'EUR', 'GBP'];

  var settings = Object.assign({ lang: null, currency: 'EGP', alertDays: 30 }, load(LS_SET, {}));
  if (!settings.lang) settings.lang = (navigator.language || 'en').toLowerCase().indexOf('ar') === 0 ? 'ar' : 'en';
  var items = load(LS_ITEMS, []).map(C.normalize);
  var ui = { filter: 'all', query: '', sort: 'expiry', photo: undefined /* undefined = unchanged, null = removed, string = new */, editing: null, detailId: null };
  var photoCache = {};

  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { toast(t('storage_full')); return false; }
  }
  function $(id) { return document.getElementById(id); }
  function T() { return I18N[settings.lang]; }
  function t(k) { var v = T()[k]; if (typeof v === 'function') return v.apply(null, [].slice.call(arguments, 1)); return v == null ? k : v; }
  function today() { return C.todayISO(); }

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  /* ---------- formatting ---------- */
  function loc() { return T().locale + '-u-nu-latn'; }
  function fmtDate(iso) {
    var d = C.parseISO(iso); if (!d) return '';
    return new Intl.DateTimeFormat(loc(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
  }
  function fmtMoney(n) {
    if (n == null) return '';
    try { return new Intl.NumberFormat(loc(), { style: 'currency', currency: settings.currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); }
    catch (e) { return String(n); }
  }
  function fmtNum(n) { return new Intl.NumberFormat(loc()).format(n); }

  /* ---------- photo storage (IndexedDB, memory fallback) ---------- */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      try {
        var r = indexedDB.open('daman', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('photos'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      if (!d) return fn(null);
      return new Promise(function (res, rej) {
        var s = d.transaction('photos', mode).objectStore('photos');
        var rq = fn(s);
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function putPhoto(id, data) {
    photoCache[id] = data;
    return db().then(function (d) { if (!d) return; return tx('readwrite', function (s) { return s.put(data, id); }); });
  }
  function getPhoto(id) {
    if (photoCache[id]) return Promise.resolve(photoCache[id]);
    return db().then(function (d) {
      if (!d) return null;
      return tx('readonly', function (s) { return s.get(id); }).then(function (v) { if (v) photoCache[id] = v; return v || null; });
    });
  }
  function delPhoto(id) {
    delete photoCache[id];
    return db().then(function (d) { if (!d) return; return tx('readwrite', function (s) { return s.delete(id); }); });
  }
  function clearPhotos() {
    photoCache = {};
    return db().then(function (d) { if (!d) return; return tx('readwrite', function (s) { return s.clear(); }); });
  }

  function compressImage(file) {
    return new Promise(function (res, rej) {
      if (!file || !/^image\//.test(file.type)) return rej(new Error('type'));
      var fr = new FileReader();
      fr.onerror = function () { rej(new Error('read')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { rej(new Error('decode')); };
        img.onload = function () {
          var max = 1400, w = img.naturalWidth, hh = img.naturalHeight, k = Math.min(1, max / Math.max(w, hh));
          var c = document.createElement('canvas');
          c.width = Math.round(w * k); c.height = Math.round(hh * k);
          var cx = c.getContext('2d');
          cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
          cx.drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', 0.72));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* ---------- i18n apply ---------- */
  function applyLang() {
    var d = T();
    document.documentElement.lang = settings.lang;
    document.documentElement.dir = d.dir;
    document.title = settings.lang === 'ar' ? 'ضمان | Daman' : 'Daman | ضمان';
    document.querySelectorAll('[data-i]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i')); });
    document.querySelectorAll('[data-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-ph')); });
    document.querySelectorAll('[data-label]').forEach(function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-label'))); });
    document.querySelectorAll('[data-close]').forEach(function (el) { if (el.classList.contains('icon-btn')) el.setAttribute('aria-label', t('close')); });
    $('langBtn').textContent = settings.lang === 'ar' ? 'English' : 'العربية';
    $('langBtn').setAttribute('lang', settings.lang === 'ar' ? 'en' : 'ar');
    var fc = $('fCat'); fc.textContent = '';
    CATS.forEach(function (c) { fc.appendChild(h('option', { value: c, text: t('cat_' + c) })); });
    var u = $('fUnit'); u.options[0].textContent = t('f_unit_m'); u.options[1].textContent = t('f_unit_y');
    var cs = $('sCur'); cs.textContent = '';
    CURRENCIES.forEach(function (c) { cs.appendChild(h('option', { value: c, text: c })); });
    cs.value = settings.currency; $('sLang').value = settings.lang; $('sAlert').value = settings.alertDays;
    var so = $('sort'); so.textContent = '';
    [['expiry', 's_expiry'], ['purchase', 's_purchase'], ['name', 's_name'], ['price', 's_price']].forEach(function (p) { so.appendChild(h('option', { value: p[0], text: t(p[1]) })); });
    so.value = ui.sort;
    renderNotifyState(); renderStorage();
    $('addBtn').setAttribute('title', t('kb_hint'));
  }

  /* ---------- rendering ---------- */
  function render() {
    var td = today();
    var sm = C.summary(items, td);
    var st = $('stats'); st.textContent = '';
    [['stat_total', fmtNum(sm.total), ''], ['stat_covered', fmtNum(sm.active), 'ok'], ['stat_soon', fmtNum(sm.soon), sm.soon ? 'warn' : ''], ['stat_value', fmtMoney(sm.coveredValue), 'wide']].forEach(function (s) {
      st.appendChild(h('div', { class: 'stat ' + s[2] }, [h('b', { text: s[1] }), h('span', { text: t(s[0]) })]));
    });
    st.hidden = !items.length;

    renderAlerts(td);

    $('toolbar').hidden = !items.length;
    var fl = $('filters'); fl.textContent = '';
    [['all', 'f_all'], ['active', 'f_active'], ['soon', 'f_soon'], ['expired', 'f_expired']].forEach(function (f) {
      var n = f[0] === 'all' ? sm.total : f[0] === 'active' ? sm.active : f[0] === 'soon' ? sm.soon : sm.expired;
      fl.appendChild(h('button', { type: 'button', class: 'tab' + (ui.filter === f[0] ? ' on' : ''), 'aria-pressed': ui.filter === f[0] ? 'true' : 'false', 'data-filter': f[0], onclick: function () { ui.filter = f[0]; render(); } }, [t(f[1]), h('small', { text: String(n) })]));
    });

    var list = $('list'); list.textContent = '';
    var shown = C.sortItems(C.filterItems(items, { filter: ui.filter, query: ui.query }, td), ui.sort, td);
    shown.forEach(function (it) { list.appendChild(card(it, td)); });
    var em = $('empty'); em.textContent = '';
    if (!items.length) {
      em.hidden = false;
      em.appendChild(h('img', { src: 'assets/empty.svg', alt: '', width: '160', height: '160' }));
      em.appendChild(h('h2', { text: t('empty_title') }));
      em.appendChild(h('p', { text: t('empty_text') }));
      em.appendChild(h('div', { class: 'empty-btns' }, [
        h('button', { type: 'button', class: 'btn primary', id: 'emptyAdd', onclick: function () { openForm(); }, text: t('empty_cta') }),
        h('button', { type: 'button', class: 'btn link', id: 'emptyDemo', onclick: function () { loadSample(); }, text: t('empty_demo') })]));
    } else if (!shown.length) {
      em.hidden = false; em.appendChild(h('p', { class: 'nomatch', text: t('no_match') }));
    } else em.hidden = true;
  }

  function statusText(s) {
    if (s.state === 'none') return t('st_none');
    if (s.days < 0) return t('ago_days', -s.days);
    return t('left_days', s.days);
  }

  function card(it, td) {
    var s = C.status(it, td);
    var stub = h('div', { class: 'stub' }, [
      s.state === 'none' ? h('b', { class: 'big', text: '–' }) : h('b', { class: 'big', text: String(Math.abs(s.days)) }),
      h('span', { class: 'unit', text: s.state === 'none' ? '' : (settings.lang === 'ar' ? 'يوم' : (Math.abs(s.days) === 1 ? 'day' : 'days')) }),
      h('span', { class: 'stamp', text: t('st_' + s.state) })
    ]);
    var meta = [];
    if (it.store) meta.push(it.store);
    meta.push(t('bought') + ' ' + fmtDate(it.purchaseDate));
    var body = h('div', { class: 'body' }, [
      h('div', { class: 'title-row' }, [h('h3', { text: it.name }), it.sample ? h('span', { class: 'tag', text: t('sample_tag') }) : null]),
      h('p', { class: 'meta', text: meta.join(' · ') }),
      s.state === 'none' ? null : h('div', { class: 'bar', role: 'img', 'aria-label': statusText(s) }, [h('i', { style: 'width:' + s.pct + '%' })]),
      h('p', { class: 'foot' }, [
        h('span', { text: s.state === 'none' ? t('st_none') : t('ends_on') + ' ' + fmtDate(s.end) }),
        it.price != null ? h('span', { class: 'price', text: fmtMoney(it.price) }) : null
      ])
    ]);
    var el = h('article', { class: 'card ' + s.state, tabindex: '0', role: 'button', 'data-id': it.id, 'aria-label': it.name + ', ' + statusText(s), onclick: function () { openDetail(it.id); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(it.id); } } }, [stub, body]);
    if (it.hasPhoto) {
      var th = h('div', { class: 'mini' });
      el.appendChild(th);
      getPhoto(it.id).then(function (p) { if (p) th.appendChild(h('img', { src: p, alt: '', loading: 'lazy' })); });
    }
    return el;
  }

  function renderAlerts(td) {
    var box = $('alerts'); box.textContent = '';
    var due = C.dueAlerts(items, td);
    box.hidden = !due.length;
    if (!due.length) return;
    box.appendChild(h('div', { class: 'alert-head' }, [h('b', { text: t('alert_title', due.length) }), h('span', { text: t('alert_hint') })]));
    due.forEach(function (x) {
      box.appendChild(h('div', { class: 'alert-row' }, [
        h('button', { type: 'button', class: 'alert-name', onclick: function () { openDetail(x.item.id); }, text: x.item.name + ' · ' + statusText(x.st) }),
        h('button', { type: 'button', class: 'btn link dismiss', 'data-id': x.item.id, onclick: function () { x.item.dismissedAt = x.st.end; save(LS_ITEMS, items); render(); }, text: t('dismiss') })
      ]));
    });
  }

  /* ---------- toast / confirm ---------- */
  var toastTimer;
  function toast(msg) {
    var el = $('toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }
  function confirmBox(text, yesLabel) {
    return new Promise(function (res) {
      var d = $('confirmDlg'); $('confirmText').textContent = text; $('confirmYes').textContent = yesLabel;
      var done = function (v) { $('confirmYes').onclick = $('confirmNo').onclick = null; d.close(); res(v); };
      $('confirmYes').onclick = function () { done(true); };
      $('confirmNo').onclick = function () { done(false); };
      d.oncancel = function () { res(false); };
      d.showModal();
    });
  }

  /* ---------- form ---------- */
  function setErr(id, msg) { $(id).textContent = msg || ''; }
  function warrantyMonthsFromForm() {
    var v = parseFloat($('fWar').value);
    if (!(v >= 0)) return NaN;
    return $('fUnit').value === 'y' ? Math.round(v * 12) : Math.round(v);
  }
  function updatePreview() {
    var pv = $('preview'); pv.textContent = '';
    var m = warrantyMonthsFromForm();
    var probe = { purchaseDate: $('fDate').value, warrantyMonths: m, alertDays: parseInt($('fAlert').value, 10) };
    var end = C.warrantyEnd(probe);
    if (!end) { pv.hidden = true; return; }
    pv.hidden = false;
    var s = C.status(probe, today());
    pv.className = 'preview ' + s.state;
    pv.appendChild(h('span', { text: t('preview_ends') }));
    pv.appendChild(h('b', { text: fmtDate(end) }));
    pv.appendChild(h('small', { text: statusText(s) }));
  }
  function showPhoto(src) {
    var box = $('photoBox'); box.textContent = '';
    if (src) box.appendChild(h('img', { src: src, alt: '' }));
    else box.appendChild(h('span', { class: 'ph', text: '\u{1F9FE}' }));
    box.classList.toggle('has', !!src);
    $('photoRemove').hidden = !src; $('photoRemove').textContent = t('f_photo_remove');
    $('photoLabelText').textContent = src ? t('f_photo_change') : t('f_photo_pick');
  }
  function openForm(id) {
    var it = id ? items.filter(function (x) { return x.id === id; })[0] : null;
    ui.editing = it ? it.id : null; ui.photo = undefined;
    $('formTitle').textContent = it ? t('edit_item') : t('new_item');
    $('fId').value = it ? it.id : '';
    $('fName').value = it ? it.name : '';
    $('fStore').value = it ? it.store : '';
    $('fCat').value = it ? it.category : 'electronics';
    $('fDate').value = it ? it.purchaseDate : today();
    $('fDate').max = '';
    $('fPrice').value = it && it.price != null ? it.price : '';
    var m = it ? it.warrantyMonths : 12;
    if (m && m % 12 === 0) { $('fWar').value = m / 12; $('fUnit').value = 'y'; } else { $('fWar').value = m; $('fUnit').value = 'm'; }
    $('fAlert').value = it ? it.alertDays : settings.alertDays;
    $('fSerial').value = it ? it.serial : '';
    $('fNotes').value = it ? it.notes : '';
    ['eName', 'eDate', 'ePrice', 'eWar', 'eAlert'].forEach(function (e) { setErr(e); });
    showPhoto(null);
    if (it && it.hasPhoto) getPhoto(it.id).then(function (p) { if (ui.photo === undefined && ui.editing === it.id) showPhoto(p); });
    updatePreview();
    if ($('detailDlg').open) $('detailDlg').close();
    $('formDlg').showModal();
    setTimeout(function () { $('fName').focus(); }, 30);
  }
  function submitForm(e) {
    e.preventDefault();
    var raw = {
      id: $('fId').value || undefined, name: $('fName').value, store: $('fStore').value, category: $('fCat').value,
      price: $('fPrice').value, purchaseDate: $('fDate').value, warrantyMonths: warrantyMonthsFromForm(),
      alertDays: $('fAlert').value === '' ? NaN : parseInt($('fAlert').value, 10), serial: $('fSerial').value, notes: $('fNotes').value
    };
    var errs = C.validateItem(raw);
    setErr('eName', errs.indexOf('name') > -1 ? t('err_name') : '');
    setErr('eDate', errs.indexOf('purchaseDate') > -1 ? t('err_date') : '');
    setErr('ePrice', errs.indexOf('price') > -1 ? t('err_price') : '');
    setErr('eWar', errs.indexOf('warrantyMonths') > -1 ? t('err_warranty') : '');
    setErr('eAlert', errs.indexOf('alertDays') > -1 ? t('err_alert') : '');
    if (errs.length) {
      var first = { name: 'fName', purchaseDate: 'fDate', price: 'fPrice', warrantyMonths: 'fWar', alertDays: 'fAlert' }[errs[0]];
      $(first).focus(); return;
    }
    var prev = ui.editing ? items.filter(function (x) { return x.id === ui.editing; })[0] : null;
    var it = C.normalize(Object.assign({}, prev || {}, raw, { hasPhoto: prev ? prev.hasPhoto : false, sample: prev ? prev.sample : false, createdAt: prev ? prev.createdAt : undefined }));
    if (prev && (prev.purchaseDate !== it.purchaseDate || prev.warrantyMonths !== it.warrantyMonths)) it.dismissedAt = null;
    var photoOp = Promise.resolve();
    if (typeof ui.photo === 'string') { it.hasPhoto = true; photoOp = putPhoto(it.id, ui.photo); }
    else if (ui.photo === null) { it.hasPhoto = false; photoOp = delPhoto(it.id); }
    photoOp.then(function () {
      if (prev) items[items.indexOf(prev)] = it; else items.push(it);
      if (!save(LS_ITEMS, items)) { return; }
      $('formDlg').close(); render(); toast(t('saved'));
    }).catch(function () { toast(t('storage_full')); });
  }

  /* ---------- detail ---------- */
  function openDetail(id) {
    var it = items.filter(function (x) { return x.id === id; })[0]; if (!it) return;
    ui.detailId = id;
    var s = C.status(it, today());
    var root = $('detail'); root.textContent = '';
    root.appendChild(h('header', { class: 'sheet-head' }, [h('h2', { id: 'dTitle', text: it.name }), h('button', { type: 'button', class: 'icon-btn', 'data-close': true, 'aria-label': t('close'), text: '×', onclick: function () { $('detailDlg').close(); } })]));
    var body = h('div', { class: 'sheet-body' });
    body.appendChild(h('div', { class: 'hero ' + s.state }, [h('span', { class: 'stamp', text: t('st_' + s.state) }), h('b', { text: statusText(s) }), s.end ? h('small', { text: t('ends_on') + ' ' + fmtDate(s.end) }) : null]));
    var dl = h('dl', { class: 'facts' });
    function fact(k, v, ltr) { if (v) { dl.appendChild(h('dt', { text: k })); dl.appendChild(h('dd', { text: v, dir: ltr ? 'ltr' : null })); } }
    fact(t('bought'), fmtDate(it.purchaseDate));
    fact(t('f_warranty'), it.warrantyMonths ? t('months', it.warrantyMonths) : t('st_none'));
    fact(t('d_store'), it.store);
    fact(t('d_price'), it.price != null ? fmtMoney(it.price) : '');
    fact(t('f_category'), t('cat_' + it.category));
    fact(t('d_serial'), it.serial, true);
    fact(t('d_notes'), it.notes);
    body.appendChild(dl);
    var rc = h('div', { class: 'receipt-view' }, [h('h4', { text: t('d_receipt') })]);
    if (it.hasPhoto) {
      var slot = h('div', { class: 'receipt-img' });
      rc.appendChild(slot);
      getPhoto(id).then(function (p) {
        if (!p) { slot.appendChild(h('p', { class: 'hint', text: t('d_no_receipt') })); return; }
        slot.appendChild(h('a', { href: p, target: '_blank', rel: 'noopener', title: t('d_zoom'), id: 'receiptLink' }, [h('img', { src: p, alt: t('d_receipt') + ': ' + it.name })]));
      });
    } else rc.appendChild(h('p', { class: 'hint', text: t('d_no_receipt') }));
    body.appendChild(rc);
    root.appendChild(body);
    var foot = h('footer', { class: 'sheet-foot wrap' });
    if (s.end) foot.appendChild(h('button', { type: 'button', class: 'btn ghost', id: 'calBtn', text: t('d_calendar'), onclick: function () { download(it.name.replace(/[^\w\u0600-\u06FF]+/g, '-') + '-warranty.ics', C.toICS(it, t('cal_label')), 'text/calendar'); } }));
    foot.appendChild(h('button', { type: 'button', class: 'btn ghost', id: 'printBtn', text: t('d_print'), onclick: function () { printClaim(it); } }));
    foot.appendChild(h('button', { type: 'button', class: 'btn ghost', id: 'editBtn', text: t('d_edit'), onclick: function () { openForm(it.id); } }));
    foot.appendChild(h('button', { type: 'button', class: 'btn danger', id: 'delBtn', text: t('d_delete'), onclick: function () {
      confirmBox(t('confirm_delete'), t('yes_delete')).then(function (ok) {
        if (!ok) return;
        delPhoto(it.id); items = items.filter(function (x) { return x.id !== it.id; }); save(LS_ITEMS, items);
        $('detailDlg').close(); render(); toast(t('deleted'));
      });
    } }));
    root.appendChild(foot);
    $('detailDlg').showModal();
  }

  function printClaim(it) {
    var s = C.status(it, today());
    var ps = $('printSheet'); ps.textContent = '';
    ps.appendChild(h('h1', { text: t('claim_title') + ' | ' + t('appName') }));
    ps.appendChild(h('p', { text: t('claim_hint') }));
    var dl = h('dl');
    [[t('f_name'), it.name], [t('d_store'), it.store], [t('d_serial'), it.serial], [t('bought'), fmtDate(it.purchaseDate)], [t('f_warranty'), it.warrantyMonths ? t('months', it.warrantyMonths) : ''], [t('preview_ends'), s.end ? fmtDate(s.end) : ''], [t('d_price'), it.price != null ? fmtMoney(it.price) : ''], [t('d_notes'), it.notes]].forEach(function (r) {
      if (r[1]) { dl.appendChild(h('dt', { text: r[0] })); dl.appendChild(h('dd', { text: r[1] })); }
    });
    ps.appendChild(dl);
    var done = function () { window.print(); };
    if (it.hasPhoto) getPhoto(it.id).then(function (p) { if (p) { var im = h('img', { src: p, alt: '' }); ps.appendChild(im); if (im.decode) im.decode().then(done, done); else done(); } else done(); });
    else done();
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ---------- backup / sample ---------- */
  function exportBackup() {
    Promise.all(items.filter(function (i) { return i.hasPhoto; }).map(function (i) { return getPhoto(i.id).then(function (p) { return [i.id, p]; }); })).then(function (pairs) {
      var photos = {}; pairs.forEach(function (p) { if (p[1]) photos[p[0]] = p[1]; });
      var data = { app: 'daman', version: 1, exportedAt: new Date().toISOString(), settings: settings, items: items, photos: photos };
      download('daman-backup-' + today() + '.json', JSON.stringify(data), 'application/json');
    });
  }
  function importBackup(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var r = C.parseBackup(String(fr.result));
      if (r.error) { toast(t('import_fail')); return; }
      var byId = {}; items.forEach(function (i) { byId[i.id] = i; });
      r.items.forEach(function (i) { byId[i.id] = i; });
      var puts = Object.keys(r.photos).map(function (id) { return putPhoto(id, r.photos[id]); });
      Promise.all(puts).then(function () {
        items = Object.keys(byId).map(function (k) { return byId[k]; });
        save(LS_ITEMS, items); render(); toast(t('imported', r.items.length, r.skipped));
      });
    };
    fr.readAsText(file);
  }
  function receiptImage(name, store, date, price) {
    var c = document.createElement('canvas'); c.width = 520; c.height = 760;
    var x = c.getContext('2d');
    x.fillStyle = '#fbfaf6'; x.fillRect(0, 0, 520, 760);
    x.fillStyle = '#1b2a30'; x.font = 'bold 34px monospace'; x.textAlign = 'center'; x.fillText(store.toUpperCase(), 260, 80);
    x.font = '18px monospace'; x.fillStyle = '#6b6a60'; x.fillText('------------------------------', 260, 115);
    x.textAlign = 'left'; x.fillStyle = '#1b2a30'; x.font = '22px monospace';
    x.fillText(date, 40, 160); x.fillText('1 x ' + name.slice(0, 22), 40, 230);
    x.textAlign = 'right'; x.fillText(price, 480, 230);
    x.textAlign = 'left'; x.fillStyle = '#6b6a60'; x.fillText('Tax incl.', 40, 290);
    x.fillStyle = '#1b2a30'; x.font = 'bold 30px monospace'; x.fillText('TOTAL', 40, 380); x.textAlign = 'right'; x.fillText(price, 480, 380);
    x.textAlign = 'center'; x.font = '18px monospace'; x.fillStyle = '#6b6a60'; x.fillText('WARRANTY CARD ATTACHED', 260, 470);
    for (var i = 0; i < 46; i++) { x.fillStyle = '#1b2a30'; x.fillRect(60 + i * 8.5, 520, (i % 3) + 2, 90); }
    x.fillText('THANK YOU', 260, 680);
    return c.toDataURL('image/jpeg', 0.7);
  }
  function loadSample() {
    var ar = settings.lang === 'ar';
    var td = today();
    var S = [
      [ar ? 'تلفزيون سامسونج 55 بوصة' : 'Samsung 55" QLED TV', 'B.TECH', 18500, -347, 12, 'electronics', 'QN55-80231'],
      [ar ? 'آيفون 15' : 'iPhone 15', 'Raya Shop', 42000, -120, 24, 'phone', 'F2LX9K41'],
      [ar ? 'غسالة إل جي 9 كيلو' : 'LG washing machine 9 kg', 'Carrefour', 14500, -800, 24, 'appliance', 'LG-WM-77120'],
      [ar ? 'شنيور بوش لاسلكي' : 'Bosch cordless drill', 'Obour Tools', 3200, -30, 36, 'car', ''],
      [ar ? 'ميكروويف توشيبا' : 'Toshiba microwave', 'Hyper One', 4200, -500, 12, 'appliance', 'TSB-MW-5521'],
      [ar ? 'كرسي مكتب' : 'Office chair', 'IKEA', 2800, -15, 0, 'furniture', '']
    ];
    var added = 0;
    var ops = S.map(function (r) {
      var d = C.addDays(td, r[3]);
      var it = C.normalize({ name: r[0], store: r[1], price: r[2], purchaseDate: d, warrantyMonths: r[4], category: r[5], serial: r[6], alertDays: 30, sample: true, hasPhoto: true });
      items.push(it); added++;
      return putPhoto(it.id, receiptImage(r[0], r[1], d, String(r[2])));
    });
    Promise.all(ops).then(function () { save(LS_ITEMS, items); render(); toast(t('sample_added')); if ($('settingsDlg').open) $('settingsDlg').close(); });
  }

  /* ---------- notifications ---------- */
  function renderNotifyState() {
    var el = $('notifyState'), b = $('notifyBtn');
    if (!('Notification' in window)) { el.textContent = t('set_notify_unsupported'); b.disabled = true; return; }
    el.textContent = t('set_notify_state_' + Notification.permission);
    b.hidden = Notification.permission !== 'default';
  }
  function renderStorage() {
    var el = $('storageInfo');
    if (!navigator.storage || !navigator.storage.estimate) { el.textContent = ''; return; }
    navigator.storage.estimate().then(function (e) {
      var mb = (e.usage || 0) / 1048576;
      el.textContent = t('storage_used', mb < 0.1 ? '0.1' : mb.toFixed(1), e.quota ? Math.round(e.quota / 1048576) : 0);
    }, function () { el.textContent = ''; });
  }
  function notifyDue() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var seen = load(LS_NOTIFIED, {}), td = today(), changed = false;
    C.dueAlerts(items, td).forEach(function (x) {
      var key = x.item.id + '|' + x.st.end;
      if (seen[key] === td) return;
      try { new Notification(t('appName') + ': ' + x.item.name, { body: statusText(x.st) + ' (' + fmtDate(x.st.end) + ')', icon: 'assets/logo.svg', tag: key }); } catch (e) { /* some mobile browsers need a service worker */ }
      seen[key] = td; changed = true;
    });
    if (changed) save(LS_NOTIFIED, seen);
  }

  /* ---------- wiring ---------- */
  function setLang(l) { settings.lang = l; save(LS_SET, settings); applyLang(); render(); updatePreview(); }

  function init() {
    applyLang();
    $('langBtn').onclick = function () { setLang(settings.lang === 'ar' ? 'en' : 'ar'); };
    $('settingsBtn').onclick = function () { renderStorage(); $('settingsDlg').showModal(); };
    $('addBtn').onclick = function () { openForm(); };
    $('q').oninput = function (e) { ui.query = e.target.value; render(); };
    $('sort').onchange = function (e) { ui.sort = e.target.value; render(); };
    $('form').addEventListener('submit', submitForm);
    ['fDate', 'fWar', 'fUnit', 'fAlert'].forEach(function (id) { $(id).addEventListener('input', updatePreview); });
    $('fPhoto').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      compressImage(f).then(function (d) { ui.photo = d; showPhoto(d); }, function () { toast(t('photo_fail')); });
      e.target.value = '';
    };
    $('photoRemove').onclick = function () { ui.photo = null; showPhoto(null); };
    document.querySelectorAll('dialog').forEach(function (d) {
      d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
      d.querySelectorAll('[data-close]').forEach(function (b) { if (!b.onclick) b.addEventListener('click', function () { d.close(); }); });
    });
    $('sLang').onchange = function (e) { setLang(e.target.value); };
    $('sCur').onchange = function (e) { settings.currency = e.target.value; save(LS_SET, settings); render(); };
    $('sAlert').onchange = function (e) { var v = parseInt(e.target.value, 10); if (v >= 0 && v <= 365) { settings.alertDays = v; save(LS_SET, settings); } else e.target.value = settings.alertDays; };
    $('notifyBtn').onclick = function () { Notification.requestPermission().then(function () { renderNotifyState(); notifyDue(); }); };
    $('exportBtn').onclick = exportBackup;
    $('importFile').onchange = function (e) { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; };
    $('csvBtn').onclick = function () { download('daman-' + today() + '.csv', C.toCSV(items, today()), 'text/csv'); };
    $('sampleBtn').onclick = loadSample;
    $('clearBtn').onclick = function () {
      confirmBox(t('confirm_clear'), t('set_clear')).then(function (ok) {
        if (!ok) return;
        items = []; save(LS_ITEMS, items); clearPhotos().then(function () { $('settingsDlg').close(); render(); toast(t('cleared')); });
      });
    };
    document.addEventListener('keydown', function (e) {
      if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector('dialog[open]') && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); openForm(); }
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { render(); notifyDue(); } });
    render(); notifyDue();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  document.addEventListener('DOMContentLoaded', init);
  window.__daman = { get items() { return items; } };
})();
