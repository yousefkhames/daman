/* Real-browser click-through. Usage: BASE=http://localhost:8137/ node tests/e2e.js  (needs puppeteer-core and Chrome; CHROME=/path) */
const puppeteer = require('puppeteer-core');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:8137/';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
let passed = 0;
function ok(c, m) { if (!c) throw new Error('FAIL: ' + m); passed++; console.log('  ok - ' + m); }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAF0lEQVR4nGP8z8Dwn4EIwESMolGFpCsEAHzXAhHBqDhIAAAAAElFTkSuQmCC', 'base64');

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.evaluateOnNewDocument(() => {
    window.__dl = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = b => { b.text().then(t => window.__dl.push(t)); return orig.call(URL, b); };
    window.print = () => { window.__printed = (window.__printed || 0) + 1; };
  });
  const $ = s => page.$(s), $$ = s => page.$$(s);
  const text = async s => page.$eval(s, e => e.textContent);
  const count = async s => (await $$(s)).length;
  const click = async s => { await page.waitForSelector(s, { visible: true }); await page.click(s); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('daman.settings.v1', JSON.stringify({ lang: 'en', currency: 'EGP', alertDays: 30 })); });
  await page.evaluate(() => indexedDB.deleteDatabase('daman'));
  await page.reload({ waitUntil: 'networkidle0' });

  console.log('empty state');
  ok(await count('.card') === 0, 'no cards at first');
  ok((await text('#empty h2')).length > 3, 'empty state shown');
  ok(await page.$eval('html', e => e.dir) === 'ltr', 'English is LTR');

  console.log('sample data');
  await click('#emptyDemo');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 6);
  ok(await count('.card') === 6, '6 sample cards');
  ok(await count('.card.soon') === 1 && await count('.card.expired') === 2 && await count('.card.none') === 1, 'statuses: 1 soon, 2 expired, 1 none');
  ok(await page.$eval('#alerts', e => !e.hidden), 'alert banner visible for ending-soon item');
  await page.waitForFunction(() => document.querySelectorAll('.card .mini img').length >= 6);
  ok(true, 'receipt thumbnails loaded from IndexedDB');
  const order = await page.$$eval('.card h3', h => h.map(x => x.textContent));
  ok(/Samsung/.test(order[0]), 'sorted by soonest expiry first: ' + order[0]);
  ok(/Toshiba|LG/.test(order[order.length - 1]), 'expired last');

  console.log('filter, search, sort');
  await click('[data-filter=active]');
  ok(await count('.card') === 3, 'Covered filter shows the 3 running warranties (not the no-warranty item)');
  await click('[data-filter=soon]');
  ok(await count('.card') === 1, 'Ending soon filter shows 1');
  await click('[data-filter=expired]');
  ok(await count('.card') === 2, 'Expired filter shows 2');
  await click('[data-filter=all]');
  await page.type('#q', 'iphone');
  ok(await count('.card') === 1, 'search "iphone" finds 1');
  await page.$eval('#q', e => { e.value = ''; e.dispatchEvent(new Event('input')); });
  await page.type('#q', 'zzzz');
  ok(await count('.card') === 0 && (await text('#empty')).length > 3, 'no-match message');
  await page.$eval('#q', e => { e.value = ''; e.dispatchEvent(new Event('input')); });
  await page.select('#sort', 'price');
  ok(/iPhone/.test(await page.$eval('.card h3', e => e.textContent)), 'sort by price puts iPhone first');
  await page.select('#sort', 'expiry');

  console.log('Arabic and RTL');
  await click('#langBtn');
  ok(await page.$eval('html', e => e.dir) === 'rtl' && await page.$eval('html', e => e.lang) === 'ar', 'Arabic switches to RTL');
  ok(/[\u0600-\u06FF]/.test(await text('.brand-text b')), 'brand shows Arabic name');
  ok(/يوم|ينتهي|مغطّى/.test(await text('.card')), 'card status text is Arabic');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal overflow in RTL');
  await click('#langBtn');
  ok(await page.$eval('html', e => e.dir) === 'ltr', 'back to LTR');

  console.log('add with validation and photo');
  await click('#addBtn');
  await page.waitForSelector('#formDlg[open]');
  await page.$eval('#fName', e => e.value = '');
  await click('#form button[type=submit]');
  ok((await text('#eName')).length > 3, 'empty name shows an error');
  ok(await page.$eval('#formDlg', d => d.open), 'form stays open');
  await page.type('#fName', 'Dell XPS laptop');
  await page.type('#fStore', 'Dream 2000');
  await page.$eval('#fDate', e => { e.value = '2026-09-01'; e.dispatchEvent(new Event('input')); });
  await page.type('#fPrice', '55000');
  await page.$eval('#fWar', e => { e.value = '2'; e.dispatchEvent(new Event('input')); });
  await page.select('#fUnit', 'y');
  await wait(100);
  ok(await page.$eval('#preview', e => !e.hidden && /2028/.test(e.textContent)), 'live preview shows end date in 2028');
  const tmp = path.join(os.tmpdir(), 'daman-test.png'); fs.writeFileSync(tmp, PNG);
  await (await $('#fPhoto')).uploadFile(tmp);
  await page.waitForSelector('#photoBox img');
  ok(true, 'photo preview appears');
  await click('#form button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 7);
  ok(await count('.card') === 7, 'new item added');

  console.log('detail, calendar, print, edit');
  await page.evaluate(() => { [...document.querySelectorAll('.card')].find(c => /Dell XPS/.test(c.textContent)).click(); });
  await page.waitForSelector('#detailDlg[open]');
  ok(/Dell XPS/.test(await text('#dTitle')), 'detail opens');
  await page.waitForSelector('#receiptLink img');
  ok(true, 'receipt photo displayed');
  ok(/2 years/.test(await text('.facts')), 'warranty length shown as 2 years');
  await click('#calBtn'); await wait(300);
  const ics = await page.evaluate(() => window.__dl.pop());
  ok(/BEGIN:VCALENDAR/.test(ics) && /DTSTART;VALUE=DATE:20280831/.test(ics) && /TRIGGER:-P30D/.test(ics), 'ICS download has the right end date (2028-08-31) and alarm');
  await click('#printBtn'); await wait(400);
  ok(await page.evaluate(() => window.__printed >= 1) && /Dell XPS/.test(await text('#printSheet')), 'claim sheet prepared and print called');
  await click('#editBtn');
  await page.waitForSelector('#formDlg[open]');
  ok(await page.$eval('#fWar', e => e.value) === '2' && await page.$eval('#fUnit', e => e.value) === 'y', 'edit form loads saved values');
  await page.$eval('#fName', e => e.value = ''); await page.type('#fName', 'Dell XPS 15');
  await click('#form button[type=submit]');
  await page.waitForFunction(() => /Dell XPS 15/.test(document.body.textContent));
  ok(true, 'edit saved');

  console.log('persistence');
  await page.reload({ waitUntil: 'networkidle0' });
  ok(await count('.card') === 7, 'items survive reload');
  await page.waitForFunction(() => document.querySelectorAll('.card .mini img').length === 7);
  ok(true, 'photos survive reload');

  console.log('dismiss alert');
  await click('.dismiss');
  ok(await page.$eval('#alerts', e => e.hidden), 'alert dismissed');
  await page.reload({ waitUntil: 'networkidle0' });
  ok(await page.$eval('#alerts', e => e.hidden), 'dismissal persists');

  console.log('backup, erase, restore');
  await click('#settingsBtn');
  await page.waitForFunction(() => /MB|ميجا/.test(document.getElementById('storageInfo').textContent));
  ok(true, 'settings shows browser storage use');
  await click('#exportBtn'); await wait(500);
  const backup = await page.evaluate(() => window.__dl.pop());
  const bj = JSON.parse(backup);
  ok(bj.app === 'daman' && bj.items.length === 7 && Object.keys(bj.photos).length === 7, 'backup JSON has 7 items and 7 photos');
  await click('#csvBtn'); await wait(300);
  const csv = await page.evaluate(() => window.__dl.pop());
  ok(csv.split('\r\n').length === 8 && /Dell XPS 15/.test(csv), 'CSV has header + 7 rows');
  await click('#clearBtn'); await click('#confirmYes');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 0);
  ok(await count('.card') === 0, 'erase everything works');
  const bf = path.join(os.tmpdir(), 'daman-backup.json'); fs.writeFileSync(bf, backup);
  await click('#settingsBtn');
  await (await $('#importFile')).uploadFile(bf);
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 7);
  ok(await count('.card') === 7, 'restore brings back 7 items');
  await page.waitForFunction(() => document.querySelectorAll('.card .mini img').length === 7);
  ok(true, 'restore brings back photos');
  const junk = path.join(os.tmpdir(), 'junk.json'); fs.writeFileSync(junk, '{"hello":1}');
  await (await $('#importFile')).uploadFile(junk); await wait(300);
  ok(await count('.card') === 7 && !(await page.$eval('#toast', e => e.hidden)), 'junk file rejected with a message, data intact');
  await page.keyboard.press('Escape');

  console.log('delete');
  await page.evaluate(() => { [...document.querySelectorAll('.card')].find(c => /Dell XPS/.test(c.textContent)).click(); });
  await page.waitForSelector('#detailDlg[open]');
  await click('#delBtn'); await click('#confirmYes');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 6);
  ok(await count('.card') === 6, 'delete removes the item');

  console.log('keyboard + layout');
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  ok(await page.$eval('#formDlg', d => d.open), 'N opens the add form');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal overflow at 390px');
  await page.setViewport({ width: 1100, height: 800 });
  await wait(200);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal overflow on desktop');

  ok(errors.length === 0, 'no console or page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log('\nE2E passed: ' + passed + ' checks');
})().catch(e => { console.error(e.message); process.exit(1); });
