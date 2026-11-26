const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../i18n.js'), 'utf8'), ctx);
const { en, ar } = ctx.window.DAMAN_I18N;

test('both languages define exactly the same keys', () => {
  assert.deepStrictEqual(Object.keys(en).sort(), Object.keys(ar).sort());
});
test('function strings stay functions in both languages', () => {
  Object.keys(en).forEach(k => assert.strictEqual(typeof en[k], typeof ar[k], k));
});
test('no empty strings', () => {
  [en, ar].forEach(l => Object.keys(l).forEach(k => { if (typeof l[k] === 'string') assert.ok(l[k].length > 0, k); }));
});
test('English plurals', () => {
  assert.strictEqual(en.left_days(0), 'Ends today');
  assert.strictEqual(en.left_days(1), '1 day left');
  assert.strictEqual(en.left_days(5), '5 days left');
  assert.strictEqual(en.months(12), '1 year');
  assert.strictEqual(en.months(24), '2 years');
  assert.strictEqual(en.months(18), '18 months');
  assert.strictEqual(en.months(1), '1 month');
});
test('Arabic plurals follow dual / 3-10 / 11+ forms', () => {
  assert.strictEqual(ar.left_days(1), 'باقي يوم');
  assert.strictEqual(ar.left_days(2), 'باقي يومان');
  assert.strictEqual(ar.left_days(7), 'باقي 7 أيام');
  assert.strictEqual(ar.left_days(17), 'باقي 17 يومًا');
  assert.strictEqual(ar.months(12), 'سنة');
  assert.strictEqual(ar.months(24), 'سنتان');
  assert.strictEqual(ar.months(36), '3 سنوات');
  assert.strictEqual(ar.months(6), '6 أشهر');
  assert.strictEqual(ar.months(18), '18 شهرًا');
  assert.strictEqual(ar.alert_title(2), 'ضمانان على وشك الانتهاء');
});
test('RTL flag is set only for Arabic', () => {
  assert.strictEqual(en.dir, 'ltr'); assert.strictEqual(ar.dir, 'rtl');
});
