'use strict';
/**
 * Дымовой тест всего ключевого сценария через HTTP (без внешних зависимостей).
 * Запуск: npm test — сам поднимает сервер на свободном порту с временной БД.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-test-'));

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const j = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: res.status, data };
};

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}/admin`); return; } catch (e) { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('Сервер не запустился');
}

let passed = 0;
const ok = (name, fn) => fn().then(() => { passed++; console.log(`  ✓ ${name}`); });

(async () => {
  await waitUp();
  console.log('Дымовой тест:');

  await ok('админка открывается без авторизации', async () => {
    const res = await fetch(`${BASE}/admin`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Формы отклика/);
  });

  let form;
  await ok('демо-форма создана при первом запуске', async () => {
    const { data } = await j('GET', '/api/forms');
    assert.equal(data.length, 1);
    assert.equal(data[0].status, 'published');
  });

  await ok('нельзя сохранить пустую форму (422 со списком ошибок)', async () => {
    const r = await j('POST', '/api/forms', { title: '', fields: [] });
    assert.equal(r.status, 422);
    assert.ok(r.data.errors.length >= 2);
  });

  await ok('создание формы', async () => {
    const r = await j('POST', '/api/forms', {
      title: 'Тест', status: 'published',
      fields: [
        { type: 'text', label: 'Имя', required: true },
        { type: 'email', label: 'Почта', required: true },
        { type: 'select', label: 'Курс', options: ['1', '2', '2', ''] },
        { type: 'checkbox', label: 'Навыки', options: ['JS', 'SQL'] },
        { type: 'text', label: 'Заметка' },
      ],
    });
    assert.equal(r.status, 201);
    form = r.data;
    assert.match(form.slug, /^[a-z2-9]{8}$/);
    assert.deepEqual(form.fields[2].options, ['1', '2']); // дубли и пустые убраны
  });

  await ok('публичная форма доступна по ссылке', async () => {
    const res = await fetch(`${BASE}/f/${form.slug}`);
    assert.equal(res.status, 200);
    const r = await j('GET', `/api/public/forms/${form.slug}`);
    assert.equal(r.data.title, 'Тест');
  });

  await ok('серверная валидация ответов', async () => {
    const r = await j('POST', `/api/public/forms/${form.slug}/submit`, {
      answers: { [form.fields[0].id]: '', [form.fields[1].id]: 'не-почта', [form.fields[2].id]: '99' },
    });
    assert.equal(r.status, 422);
    assert.ok(r.data.errors[form.fields[0].id]);
    assert.ok(r.data.errors[form.fields[1].id]);
    assert.ok(r.data.errors[form.fields[2].id]);
  });

  const sid = 'test-session-0001';
  await ok('воронка: просмотр, фокус, отказ', async () => {
    await j('POST', `/api/public/forms/${form.slug}/events`, { sid: 'abandon-session-1', type: 'view' });
    await j('POST', `/api/public/forms/${form.slug}/events`, { sid: 'abandon-session-1', type: 'focus', fieldId: form.fields[0].id });
    await j('POST', `/api/public/forms/${form.slug}/events`, { sid: 'abandon-session-1', type: 'focus', fieldId: form.fields[1].id });
    await j('POST', `/api/public/forms/${form.slug}/events`, { sid, type: 'view' });
    await j('POST', `/api/public/forms/${form.slug}/events`, { sid, type: 'focus', fieldId: form.fields[0].id });
  });

  await ok('успешная отправка ответа', async () => {
    const r = await j('POST', `/api/public/forms/${form.slug}/submit`, {
      sid,
      answers: {
        [form.fields[0].id]: '  Анна  ', [form.fields[1].id]: 'anna@example.com',
        [form.fields[2].id]: '2', [form.fields[3].id]: ['JS', 'SQL'],
      },
    });
    assert.equal(r.status, 201);
  });

  await ok('менеджер видит ответ в админке', async () => {
    const r = await j('GET', `/api/forms/${form.id}/responses`);
    assert.equal(r.data.rows.length, 1);
    assert.equal(r.data.rows[0].values[form.fields[0].id], 'Анна');
    assert.deepEqual(r.data.rows[0].values[form.fields[3].id], ['JS', 'SQL']);
  });

  await ok('аналитика показывает, где бросили форму', async () => {
    await new Promise((r) => setTimeout(r, 50));
    const { data } = await j('GET', `/api/forms/${form.id}/analytics`);
    assert.equal(data.views, 2);
    assert.equal(data.started, 2);
    assert.equal(data.submitted, 1);
    assert.equal(data.abandoned, 1);
    const email = data.fields.find((f) => f.id === form.fields[1].id);
    assert.equal(email.leftHere, 1); // бросил на вопросе «Почта»
  });

  await ok('CSV: BOM, разделитель, защита от формул', async () => {
    await j('POST', `/api/public/forms/${form.slug}/submit`, {
      answers: { [form.fields[0].id]: '=HYPERLINK("http://x")', [form.fields[1].id]: 'b@example.com', [form.fields[2].id]: '1' },
    });
    const res = await fetch(`${BASE}/api/forms/${form.id}/responses.csv`);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // BOM для Excel
    const text = buf.toString('utf8');
    assert.ok(text.includes(`"'=HYPERLINK`));
    assert.match(res.headers.get('content-disposition'), /attachment/);
  });

  await ok('изменение формы не ломает старые ответы', async () => {
    const f = (await j('GET', `/api/forms/${form.id}`)).data;
    f.fields = f.fields.filter((x) => x.id !== form.fields[4].id && x.id !== form.fields[3].id);
    const r = await j('PUT', `/api/forms/${form.id}`, f);
    assert.equal(r.status, 200);
    const t = (await j('GET', `/api/forms/${form.id}/responses`)).data;
    assert.ok(t.columns.some((c) => /вопрос удалён/.test(c.label)));
  });

  await ok('черновик по ссылке закрыт (410), несуществующая форма — 404', async () => {
    const f = (await j('GET', `/api/forms/${form.id}`)).data;
    await j('PUT', `/api/forms/${form.id}`, { ...f, status: 'draft' });
    assert.equal((await j('GET', `/api/public/forms/${form.slug}`)).status, 410);
    assert.equal((await j('POST', `/api/public/forms/${form.slug}/submit`, { answers: {} })).status, 410);
    assert.equal((await j('GET', '/api/public/forms/nonexistent')).status, 404);
  });

  await ok('данные переживают перезапись на диск', async () => {
    const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
    assert.equal(db.forms.length, 2);
    assert.equal(db.responses.length, 2);
  });

  await ok('удаление формы удаляет её ответы', async () => {
    assert.equal((await j('DELETE', `/api/forms/${form.id}`)).status, 204);
    assert.equal((await j('GET', `/api/forms/${form.id}`)).status, 404);
    const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
    assert.equal(db.responses.length, 0);
  });

  console.log(`\nГотово: ${passed} проверок пройдено`);
})()
  .catch((err) => { console.error('\nПровал:', err.message); process.exitCode = 1; })
  .finally(() => {
    // дожидаемся завершения сервера: при остановке он сбрасывает данные на диск
    server.once('exit', () => {
      try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* временная папка, не критично */ }
    });
    server.kill();
  });
