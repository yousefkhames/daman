const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

const mk = (o) => C.normalize(Object.assign({ name: 'X', purchaseDate: '2026-01-10', warrantyMonths: 12 }, o));

test('addMonths clamps to month end and crosses years', () => {
  assert.strictEqual(C.addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(C.addMonths('2024-01-31', 1), '2024-02-29');
  assert.strictEqual(C.addMonths('2026-11-15', 3), '2027-02-15');
  assert.strictEqual(C.addMonths('2026-03-10', 24), '2028-03-10');
  assert.strictEqual(C.addMonths('nope', 1), null);
});
test('parseISO rejects impossible dates', () => {
  assert.strictEqual(C.parseISO('2026-02-30'), null);
  assert.strictEqual(C.parseISO('2026-13-01'), null);
  assert.ok(C.parseISO('2024-02-29'));
});
test('warranty ends the day before the anniversary', () => {
  assert.strictEqual(C.warrantyEnd(mk({ purchaseDate: '2025-03-10', warrantyMonths: 12 })), '2026-03-09');
  assert.strictEqual(C.warrantyEnd(mk({ warrantyMonths: 0 })), null);
});
test('status: active, soon, expired boundaries', () => {
  const it = mk({ purchaseDate: '2025-03-10', warrantyMonths: 12, alertDays: 30 }); // ends 2026-03-09
  assert.strictEqual(C.status(it, '2026-01-01').state, 'active');
  assert.strictEqual(C.status(it, '2026-02-07').state, 'soon'); // 30 days left
  assert.strictEqual(C.status(it, '2026-02-07').days, 30);
  assert.strictEqual(C.status(it, '2026-02-06').state, 'active'); // 31 days
  assert.strictEqual(C.status(it, '2026-03-09').state, 'soon');
  assert.strictEqual(C.status(it, '2026-03-09').days, 0);
  assert.strictEqual(C.status(it, '2026-03-10').state, 'expired');
  assert.strictEqual(C.status(it, '2026-03-10').days, -1);
  assert.strictEqual(C.status(mk({ warrantyMonths: 0 }), '2026-03-10').state, 'none');
});
test('status pct is clamped 0..100', () => {
  const it = mk({ purchaseDate: '2026-01-10', warrantyMonths: 12 });
  assert.strictEqual(C.status(it, '2025-01-01').pct, 0);
  assert.strictEqual(C.status(it, '2030-01-01').pct, 100);
  const mid = C.status(it, '2026-07-10').pct;
  assert.ok(mid > 40 && mid < 60);
});
test('validateItem', () => {
  assert.deepStrictEqual(C.validateItem(mk({})), []);
  assert.ok(C.validateItem(mk({ name: ' ' })).includes('name'));
  assert.ok(C.validateItem(mk({ purchaseDate: '2026-02-31' })).includes('purchaseDate'));
  assert.ok(C.validateItem(mk({ price: -5 })).includes('price'));
  assert.ok(C.validateItem(Object.assign(mk({}), { warrantyMonths: 9999 })).includes('warrantyMonths'));
});
test('filter and search', () => {
  const t = '2026-06-01';
  const a = mk({ id: 'a', name: 'Samsung TV', store: 'B.TECH', purchaseDate: '2025-06-20', warrantyMonths: 12, alertDays: 30 }); // ends 2026-06-19 soon
  const b = mk({ id: 'b', name: 'Fridge', store: 'Carrefour', purchaseDate: '2020-01-01', warrantyMonths: 24 }); // expired
  const c = mk({ id: 'c', name: 'Drill', purchaseDate: '2026-05-01', warrantyMonths: 36 }); // active
  const all = [a, b, c];
  assert.deepStrictEqual(C.filterItems(all, { filter: 'soon' }, t).map(x => x.id), ['a']);
  assert.deepStrictEqual(C.filterItems(all, { filter: 'expired' }, t).map(x => x.id), ['b']);
  assert.deepStrictEqual(C.filterItems(all, { filter: 'active' }, t).map(x => x.id), ['a', 'c']);
  assert.deepStrictEqual(C.filterItems(all, { query: 'b.tech' }, t).map(x => x.id), ['a']);
  assert.deepStrictEqual(C.filterItems(all, { query: 'zzz' }, t).length, 0);
});
test('sort by expiry: soonest running first, expired last', () => {
  const t = '2026-06-01';
  const a = mk({ id: 'a', purchaseDate: '2025-06-20', warrantyMonths: 12 });
  const b = mk({ id: 'b', purchaseDate: '2020-01-01', warrantyMonths: 24 });
  const c = mk({ id: 'c', purchaseDate: '2026-05-01', warrantyMonths: 36 });
  const d = mk({ id: 'd', warrantyMonths: 0 });
  assert.deepStrictEqual(C.sortItems([b, c, d, a], 'expiry', t).map(x => x.id), ['a', 'c', 'd', 'b']);
  assert.deepStrictEqual(C.sortItems([a, b, c], 'purchase', t).map(x => x.id), ['c', 'a', 'b']);
});
test('summary counts and covered value', () => {
  const t = '2026-06-01';
  const items = [mk({ id: 'a', price: 1000, purchaseDate: '2025-06-20' }), mk({ id: 'b', price: 500, purchaseDate: '2020-01-01' }), mk({ id: 'c', price: 200, purchaseDate: '2026-05-01', warrantyMonths: 36 })];
  const s = C.summary(items, t);
  assert.strictEqual(s.total, 3); assert.strictEqual(s.soon, 1); assert.strictEqual(s.expired, 1);
  assert.strictEqual(s.active, 2); assert.strictEqual(s.coveredValue, 1200);
});
test('CSV escapes quotes, commas and formula injection', () => {
  const csv = C.toCSV([mk({ name: 'He said "hi", ok', notes: '=HYPERLINK("x")' })], '2026-02-01');
  assert.ok(csv.includes('"He said ""hi"", ok"'));
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"x\"\")\""));
  assert.ok(csv.startsWith('\ufeffname,'));
});
test('ICS has all-day end date, alarm and escaping', () => {
  const it = mk({ id: 'z1', name: 'TV; big, 55"', purchaseDate: '2025-03-10', warrantyMonths: 12, alertDays: 14 });
  const ics = C.toICS(it, 'Warranty ends');
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260309'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20260310'));
  assert.ok(ics.includes('TRIGGER:-P14D'));
  assert.ok(ics.includes('TV\\; big\\, 55"'));
  assert.ok(ics.split('\r\n').every(l => l.length <= 75));
  assert.strictEqual(C.toICS(mk({ warrantyMonths: 0 })), null);
});
test('backup roundtrip and rejection of junk', () => {
  const it = mk({ id: 'q', name: 'Phone' });
  const text = JSON.stringify({ app: 'daman', version: 1, items: [it, { name: '' }, 5], photos: { q: 'data:image/jpeg;base64,AAAA' } });
  const r = C.parseBackup(text);
  assert.strictEqual(r.items.length, 1); assert.strictEqual(r.skipped, 2);
  assert.strictEqual(r.items[0].hasPhoto, true);
  assert.strictEqual(C.parseBackup('{bad').error, 'json');
  assert.strictEqual(C.parseBackup('{"app":"other","items":[]}').error, 'format');
  const evil = C.parseBackup(JSON.stringify({ app: 'daman', items: [it], photos: { q: 'javascript:alert(1)' } }));
  assert.strictEqual(evil.items[0].hasPhoto, false);
});
test('dueAlerts respects dismissal for that expiry date', () => {
  const t = '2026-02-20';
  const it = mk({ id: 'a', purchaseDate: '2025-03-10', warrantyMonths: 12, alertDays: 30 });
  assert.strictEqual(C.dueAlerts([it], t).length, 1);
  it.dismissedAt = '2026-03-09';
  assert.strictEqual(C.dueAlerts([it], t).length, 0);
  it.dismissedAt = '2025-03-09'; // dismissed for an older expiry
  assert.strictEqual(C.dueAlerts([it], t).length, 1);
});
