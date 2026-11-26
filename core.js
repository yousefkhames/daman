/* Daman core: pure logic, no DOM. Works in browser (window.DamanCore) and Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DamanCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

  function parseISO(s) {
    const m = ISO.exec(String(s || ''));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return dt;
  }
  function toISO(dt) {
    return dt.getUTCFullYear().toString().padStart(4, '0') + '-' +
      String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  }
  function todayISO(now) {
    const n = now || new Date();
    return n.getFullYear().toString().padStart(4, '0') + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }
  /* Add months, clamping to the last day of the target month (31 Jan + 1 month = 28/29 Feb). */
  function addMonths(iso, n) {
    const dt = parseISO(iso);
    if (!dt) return null;
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth(), d = dt.getUTCDate();
    const total = m + Math.round(n);
    const ty = y + Math.floor(total / 12);
    const tm = ((total % 12) + 12) % 12;
    const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return toISO(new Date(Date.UTC(ty, tm, Math.min(d, last))));
  }
  function addDays(iso, n) {
    const dt = parseISO(iso);
    if (!dt) return null;
    return toISO(new Date(dt.getTime() + n * 86400000));
  }
  function diffDays(aISO, bISO) {
    const a = parseISO(aISO), b = parseISO(bISO);
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
  }

  /* The warranty ends on the day before the anniversary: bought 2025-03-10 with 12 months covers through 2026-03-09. */
  function warrantyEnd(item) {
    if (!item || !item.purchaseDate || !(item.warrantyMonths > 0)) return null;
    const e = addMonths(item.purchaseDate, item.warrantyMonths);
    return e ? addDays(e, -1) : null;
  }

  /* state: none (no warranty), active, soon (inside alert window), expired */
  function status(item, today) {
    const end = warrantyEnd(item);
    if (!end) return { state: 'none', days: null, end: null, pct: 0 };
    const days = diffDays(today, end);
    const total = Math.max(1, diffDays(item.purchaseDate, end) + 1);
    const used = Math.min(total, Math.max(0, diffDays(item.purchaseDate, today) + 1));
    const pct = Math.round((used / total) * 100);
    const alertDays = Number.isFinite(item.alertDays) ? item.alertDays : 30;
    let state = 'active';
    if (days < 0) state = 'expired';
    else if (days <= alertDays) state = 'soon';
    return { state, days, end, pct };
  }

  function validateItem(it) {
    const errors = [];
    if (!it.name || !String(it.name).trim()) errors.push('name');
    if (!parseISO(it.purchaseDate)) errors.push('purchaseDate');
    if (!(Number(it.warrantyMonths) >= 0) || Number(it.warrantyMonths) > 600) errors.push('warrantyMonths');
    if (it.price !== '' && it.price != null && !(Number(it.price) >= 0)) errors.push('price');
    if (!(Number(it.alertDays) >= 0) || Number(it.alertDays) > 365) errors.push('alertDays');
    return errors;
  }

  function uid() {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalize(raw) {
    return {
      id: String(raw.id || uid()),
      name: String(raw.name || '').trim().slice(0, 120),
      store: String(raw.store || '').trim().slice(0, 120),
      category: String(raw.category || 'other'),
      price: raw.price === '' || raw.price == null ? null : Number(raw.price),
      purchaseDate: String(raw.purchaseDate || ''),
      warrantyMonths: Number(raw.warrantyMonths) || 0,
      alertDays: raw.alertDays === '' || raw.alertDays == null ? 30 : Number(raw.alertDays),
      serial: String(raw.serial || '').trim().slice(0, 80),
      notes: String(raw.notes || '').trim().slice(0, 1000),
      hasPhoto: !!raw.hasPhoto,
      sample: !!raw.sample,
      createdAt: raw.createdAt || new Date().toISOString(),
      dismissedAt: raw.dismissedAt || null
    };
  }

  function filterItems(items, opts, today) {
    const q = (opts.query || '').trim().toLowerCase();
    return items.filter(function (it) {
      if (opts.filter && opts.filter !== 'all') {
        const st = status(it, today).state;
        if (opts.filter === 'soon' && st !== 'soon') return false;
        if (opts.filter === 'active' && st !== 'active' && st !== 'soon') return false;
        if (opts.filter === 'expired' && st !== 'expired') return false;
      }
      if (q) {
        const hay = [it.name, it.store, it.serial, it.notes, it.category].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function sortItems(items, by, today) {
    const arr = items.slice();
    const key = function (it) {
      const s = status(it, today);
      return s.days == null ? 1e9 : s.days;
    };
    if (by === 'name') arr.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else if (by === 'purchase') arr.sort(function (a, b) { return b.purchaseDate.localeCompare(a.purchaseDate); });
    else if (by === 'price') arr.sort(function (a, b) { return (b.price || 0) - (a.price || 0); });
    else {
      /* expiry: running warranties soonest-first, then no-warranty, then expired (most recent first) */
      arr.sort(function (a, b) {
        const ka = key(a), kb = key(b);
        const ea = ka < 0, eb = kb < 0;
        if (ea !== eb) return ea ? 1 : -1;
        if (ea) return kb - ka;
        return ka - kb;
      });
    }
    return arr;
  }

  function summary(items, today) {
    const out = { total: items.length, active: 0, soon: 0, expired: 0, none: 0, coveredValue: 0 };
    items.forEach(function (it) {
      const s = status(it, today).state;
      if (s === 'soon') { out.soon++; out.active++; }
      else out[s]++;
      if ((s === 'active' || s === 'soon') && it.price) out.coveredValue += it.price;
    });
    return out;
  }

  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; /* neutralise spreadsheet formulas */
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(items, today) {
    const head = ['name', 'store', 'category', 'price', 'purchase_date', 'warranty_months', 'warranty_ends', 'status', 'days_left', 'serial', 'notes'];
    const rows = items.map(function (it) {
      const s = status(it, today);
      return [it.name, it.store, it.category, it.price == null ? '' : it.price, it.purchaseDate, it.warrantyMonths, s.end || '', s.state, s.days == null ? '' : s.days, it.serial, it.notes].map(csvCell).join(',');
    });
    return '\ufeff' + [head.join(',')].concat(rows).join('\r\n');
  }

  function foldIcs(line) {
    const out = [];
    while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
    out.push(line);
    return out.join('\r\n');
  }
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  /* All-day event on the last covered day, with a reminder alertDays before. */
  function toICS(item, label) {
    const end = warrantyEnd(item);
    if (!end) return null;
    const d = end.replace(/-/g, '');
    const next = addDays(end, 1).replace(/-/g, '');
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daman//Warranty Vault//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:' + item.id + '@daman.local',
      'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''),
      'DTSTART;VALUE=DATE:' + d,
      'DTEND;VALUE=DATE:' + next,
      'SUMMARY:' + icsEscape((label || 'Warranty ends') + ': ' + item.name),
      'DESCRIPTION:' + icsEscape([item.store, item.serial].filter(Boolean).join(' | ')),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape((label || 'Warranty ends') + ': ' + item.name),
      'TRIGGER:-P' + Math.max(0, Number(item.alertDays) || 0) + 'D', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'
    ];
    return lines.map(foldIcs).join('\r\n') + '\r\n';
  }

  /* Backup format: { app:'daman', version:1, items:[...], photos:{id:dataURL}, settings:{} } */
  function parseBackup(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { error: 'json' }; }
    if (!data || data.app !== 'daman' || !Array.isArray(data.items)) return { error: 'format' };
    const items = [], photos = {};
    data.items.forEach(function (raw) {
      if (!raw || typeof raw !== 'object') return;
      const it = normalize(raw);
      if (validateItem(it).length) return;
      const p = data.photos && data.photos[raw.id];
      if (typeof p === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(p)) { photos[it.id] = p; it.hasPhoto = true; }
      else it.hasPhoto = false;
      items.push(it);
    });
    return { items: items, photos: photos, settings: data.settings && typeof data.settings === 'object' ? data.settings : {}, skipped: data.items.length - items.length };
  }

  /* Items whose alert window has opened and the user has not dismissed for this expiry date. */
  function dueAlerts(items, today) {
    return items.map(function (it) { return { item: it, st: status(it, today) }; })
      .filter(function (x) { return x.st.state === 'soon' && x.item.dismissedAt !== x.st.end; })
      .sort(function (a, b) { return a.st.days - b.st.days; });
  }

  return { parseISO, toISO, todayISO, addMonths, addDays, diffDays, warrantyEnd, status, validateItem, normalize, uid, filterItems, sortItems, summary, toCSV, toICS, parseBackup, dueAlerts };
});
