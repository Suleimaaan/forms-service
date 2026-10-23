'use strict';

/*
 Аналитика отказов. Для каждого визита («сессии») хранится, до каких вопросов
 студент дошёл и на каком остановился. Отсюда видно не просто «конверсия 12%»,
 а КОНКРЕТНЫЙ вопрос, на котором форму бросают.
 */
function analytics(form, allSessions) {
  const sessions = allSessions.filter((s) => s.formId === form.id);
  const views = sessions.length;
  const started = sessions.filter((s) => s.startedAt).length;
  const submitted = sessions.filter((s) => s.submittedAt).length;

  const durations = sessions
    .filter((s) => s.submittedAt && s.startedAt)
    .map((s) => (new Date(s.submittedAt) - new Date(s.startedAt)) / 1000)
    .sort((a, b) => a - b);
  const medianSeconds = durations.length ? Math.round(durations[Math.floor(durations.length / 2)]) : null;

  const abandonedSessions = sessions.filter((s) => s.startedAt && !s.submittedAt);

  const fields = form.fields.map((f) => ({
    id: f.id,
    label: f.label,
    reached: sessions.filter((s) => (s.reached || []).includes(f.id)).length,
    leftHere: abandonedSessions.filter((s) => s.lastFieldId === f.id).length,
  }));

  return { views, started, submitted, abandoned: abandonedSessions.length, medianSeconds, fields };
}

/*
 Таблица ответов. Колонки — текущие вопросы формы по порядку;
 если вопрос удалили после получения ответов, колонка остаётся
 */
function responsesTable(form, responses) {
  const columns = form.fields.map((f) => ({ id: f.id, label: f.label, type: f.type }));
  const known = new Set(columns.map((c) => c.id));

  const rows = responses
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((r) => {
      const values = {};
      for (const a of r.answers) {
        values[a.fieldId] = a.value;
        if (!known.has(a.fieldId)) {
          known.add(a.fieldId);
          columns.push({ id: a.fieldId, label: `${a.label} (вопрос удалён)`, type: a.type });
        }
      }
      return { id: r.id, createdAt: r.createdAt, values };
    });

  return { columns, rows };
}

function csvCell(value, type) {
  let text = Array.isArray(value) ? value.join('; ') : String(value ?? '');
  // Защита от CSV-инъекций: ячейка, начинающаяся с = + - @, исполняется Excel как формула.
  // Телефоны и числа уже прошли строгую проверку формата, их не трогаем.
  if (!['phone', 'number'].includes(type) && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/* CSV с BOM и разделителем «;» — так файл корректно открывается в русскоязычном Excel. */
function toCsv(columns, rows) {
  const sep = ';';
  const head = ['Дата отправки', ...columns.map((c) => c.label)].map((l) => csvCell(l, 'text')).join(sep);
  const lines = rows.map((r) =>
    [csvCell(new Date(r.createdAt).toLocaleString('ru-RU', { timeZone: 'UTC' }) + ' UTC', 'phone'),
      ...columns.map((c) => csvCell(r.values[c.id], c.type))].join(sep)
  );
  return `\uFEFF${[head, ...lines].join('\r\n')}\r\n`;
}

module.exports = { analytics, responsesTable, toCsv };
