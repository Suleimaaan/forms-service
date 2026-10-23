'use strict';
/*
 Хранилище: один JSON-файл внутри проекта (data/db.json).
 Без СУБД и нативных модулей — поэтому `npm install` не может сломаться на сборке.
 Запись атомарная (tmp-файл + rename), частые записи (аналитика) сгруппированы по таймеру.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

let state = { forms: [], responses: [], sessions: {} };
let timer = null;

/* Возвращает true, если файла ещё не было. */
function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    flush();
    return true;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    state = {
      forms: Array.isArray(parsed.forms) ? parsed.forms : [],
      responses: Array.isArray(parsed.responses) ? parsed.responses : [],
      sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
    };
  } catch (err) {
    const backup = `${FILE}.corrupt-${Date.now()}`;
    fs.copyFileSync(FILE, backup);
    console.error(`db.json повреждён, копия сохранена: ${backup}`);
  }
  return false;
}

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function scheduleSave() {
  if (!timer) timer = setTimeout(flush, 500);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try { flush(); } finally { process.exit(0); }
  });
}

module.exports = {
  load,
  flush,
  scheduleSave,
  get data() { return state; },
  FILE,
};
