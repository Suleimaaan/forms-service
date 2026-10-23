'use strict';
const path = require('path');
const express = require('express');
const db = require('./lib/db');
const { newId, newSlug, sanitizeForm, validateAnswers } = require('./lib/forms');
const { analytics, responsesTable, toCsv } = require('./lib/reports');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const isFirstRun = db.load();
const data = db.data;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});

/* ---------- простой лимитер запросов (в памяти, по IP) ---------- */
function rateLimit(max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > max) return res.status(429).json({ error: 'Слишком много запросов. Попробуйте через минуту.' });
    next();
  };
}
const submitLimit = rateLimit(20, 60_000);
const eventLimit = rateLimit(600, 60_000);

/* ---------- страницы ---------- */
app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/f/:slug', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'form.html')));
app.use(express.static(PUBLIC_DIR, { index: false }));

/* ---------- API админки (без авторизации, как требует ТЗ) ---------- */
function findForm(req, res) {
  const form = data.forms.find((f) => f.id === req.params.id);
  if (!form) res.status(404).json({ error: 'Форма не найдена' });
  return form;
}

app.get('/api/forms', (req, res) => {
  const sessions = Object.values(data.sessions);
  const list = data.forms
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map((f) => {
      const own = sessions.filter((s) => s.formId === f.id);
      return {
        id: f.id,
        slug: f.slug,
        title: f.title,
        status: f.status,
        updatedAt: f.updatedAt,
        responses: data.responses.filter((r) => r.formId === f.id).length,
        views: own.length,
        submitted: own.filter((s) => s.submittedAt).length,
      };
    });
  res.json(list);
});

app.post('/api/forms', (req, res) => {
  const { errors, value } = sanitizeForm(req.body);
  if (errors.length) return res.status(422).json({ error: errors.join('. '), errors });
  const now = new Date().toISOString();
  const form = {
    id: newId('form'),
    slug: newSlug(),
    ...value,
    status: req.body.status === 'published' ? 'published' : 'draft',
    createdAt: now,
    updatedAt: now,
  };
  data.forms.push(form);
  db.flush();
  res.status(201).json(form);
});

app.get('/api/forms/:id', (req, res) => {
  const form = findForm(req, res);
  if (form) res.json(form);
});

app.put('/api/forms/:id', (req, res) => {
  const form = findForm(req, res);
  if (!form) return;
  const { errors, value } = sanitizeForm(req.body);
  if (errors.length) return res.status(422).json({ error: errors.join('. '), errors });
  Object.assign(form, value, {
    status: req.body.status === 'published' ? 'published' : 'draft',
    updatedAt: new Date().toISOString(),
  });
  db.flush();
  res.json(form);
});

app.delete('/api/forms/:id', (req, res) => {
  const form = findForm(req, res);
  if (!form) return;
  data.forms = data.forms.filter((f) => f.id !== form.id);
  data.responses = data.responses.filter((r) => r.formId !== form.id);
  for (const [sid, s] of Object.entries(data.sessions)) if (s.formId === form.id) delete data.sessions[sid];
  db.flush();
  res.status(204).end();
});

app.get('/api/forms/:id/responses', (req, res) => {
  const form = findForm(req, res);
  if (!form) return;
  const own = data.responses.filter((r) => r.formId === form.id);
  res.json({ form: { id: form.id, title: form.title, slug: form.slug, status: form.status }, ...responsesTable(form, own) });
});

app.get('/api/forms/:id/responses.csv', (req, res) => {
  const form = findForm(req, res);
  if (!form) return;
  const { columns, rows } = responsesTable(form, data.responses.filter((r) => r.formId === form.id));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${form.title}.csv`)}`);
  res.send(toCsv(columns, rows));
});

app.delete('/api/forms/:id/responses/:rid', (req, res) => {
  const form = findForm(req, res);
  if (!form) return;
  const before = data.responses.length;
  data.responses = data.responses.filter((r) => !(r.id === req.params.rid && r.formId === form.id));
  if (data.responses.length === before) return res.status(404).json({ error: 'Ответ не найден' });
  db.flush();
  res.status(204).end();
});

app.get('/api/forms/:id/analytics', (req, res) => {
  const form = findForm(req, res);
  if (!form) return;
  res.json({
    form: { id: form.id, title: form.title, slug: form.slug, status: form.status },
    ...analytics(form, Object.values(data.sessions)),
  });
});

/* ---------- публичное API (студенты) ---------- */
function publicForm(req, res) {
  const form = data.forms.find((f) => f.slug === req.params.slug);
  if (!form) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  if (form.status !== 'published') {
    res.status(410).json({ error: 'closed' });
    return null;
  }
  return form;
}

const validSid = (sid) => typeof sid === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(sid);

function touchSession(form, sid) {
  let s = data.sessions[sid];
  if (!s) {
    s = data.sessions[sid] = { formId: form.id, createdAt: new Date().toISOString(), reached: [] };
  }
  return s.formId === form.id ? s : null;
}

app.get('/api/public/forms/:slug', (req, res) => {
  const form = publicForm(req, res);
  if (!form) return;
  res.json({ title: form.title, description: form.description, fields: form.fields });
});

// События воронки: «открыл форму» (view) и «дошёл до вопроса» (focus)
app.post('/api/public/forms/:slug/events', eventLimit, (req, res) => {
  const form = publicForm(req, res);
  if (!form) return;
  const { sid, type, fieldId } = req.body || {};
  if (!validSid(sid)) return res.status(400).json({ error: 'bad_sid' });
  const s = touchSession(form, sid);
  if (!s) return res.status(400).json({ error: 'bad_sid' });

  const now = new Date().toISOString();
  if (type === 'focus' && form.fields.some((f) => f.id === fieldId)) {
    s.startedAt = s.startedAt || now;
    s.lastFieldId = fieldId;
    if (!s.reached.includes(fieldId)) s.reached.push(fieldId);
  }
  s.updatedAt = now;
  db.scheduleSave();
  res.status(204).end();
});

app.post('/api/public/forms/:slug/submit', submitLimit, (req, res) => {
  const form = publicForm(req, res);
  if (!form) return;
  const { errors, clean } = validateAnswers(form, req.body && req.body.answers);
  if (Object.keys(errors).length) return res.status(422).json({ errors });

  const now = new Date().toISOString();
  data.responses.push({
    id: newId('resp'),
    formId: form.id,
    createdAt: now,
    // снимок названий и типов: ответ остаётся читаемым, даже если форму потом изменят
    answers: form.fields.map((f) => ({
      fieldId: f.id,
      label: f.label,
      type: f.type,
      value: clean[f.id],
    })),
  });

  const sid = req.body && req.body.sid;
  if (validSid(sid)) {
    const s = touchSession(form, sid);
    if (s) {
      s.startedAt = s.startedAt || now;
      s.submittedAt = now;
      s.reached = form.fields.map((f) => f.id);
    }
  }
  db.flush();
  res.status(201).json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ---------- демо-форма при первом запуске, чтобы сразу было что смотреть ---------- */
function seedDemo() {
  const now = new Date().toISOString();
  data.forms.push({
    id: newId('form'),
    slug: newSlug(),
    title: 'Стажировка: младший разработчик',
    description: 'Расскажите о себе — это займёт около пяти минут. Ответы можно сохранить и вернуться позже.',
    status: 'published',
    createdAt: now,
    updatedAt: now,
    fields: [
      { id: 'f_name', type: 'text', label: 'Имя и фамилия', required: true, placeholder: 'Анна Иванова' },
      { id: 'f_email', type: 'email', label: 'E-mail', required: true, placeholder: 'anna@example.com' },
      { id: 'f_phone', type: 'phone', label: 'Телефон', required: false, placeholder: '+7 999 123-45-67' },
      { id: 'f_uni', type: 'text', label: 'Вуз и курс', required: true, placeholder: 'МГУ, 3 курс' },
      { id: 'f_format', type: 'radio', label: 'Удобный формат работы', required: true, options: ['Очно', 'Удалённо', 'Гибрид'] },
      { id: 'f_stack', type: 'checkbox', label: 'С чем уже работали', required: false, options: ['HTML/CSS', 'JavaScript', 'Node.js', 'Python', 'SQL'] },
      { id: 'f_link', type: 'url', label: 'Ссылка на резюме или GitHub', required: false, placeholder: 'https://github.com/…' },
      { id: 'f_why', type: 'textarea', label: 'Почему вам интересна эта стажировка?', required: true, placeholder: 'Пара предложений своими словами' },
    ],
  });
  db.flush();
}

if (isFirstRun && data.forms.length === 0) seedDemo();

app.listen(PORT, () => {
  console.log(`Сервис форм запущен:   http://localhost:${PORT}`);
  console.log(`Админка:               http://localhost:${PORT}/admin`);
  const demo = data.forms[0];
  if (demo && isFirstRun) console.log(`Демо-форма для студента: http://localhost:${PORT}/f/${demo.slug}`);
});
