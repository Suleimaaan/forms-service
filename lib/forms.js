'use strict';
const crypto = require('crypto');

const TYPES = ['text', 'textarea', 'email', 'phone', 'number', 'url', 'date', 'select', 'radio', 'checkbox'];
const CHOICE = new Set(['select', 'radio', 'checkbox']);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s()\-]{6,20}$/;

// Алфавит без похожих символов (0/o, 1/l/i) 
const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function newSlug(length = 8) {
  let out = '';
  for (let i = 0; i < length; i++) out += SLUG_ALPHABET[crypto.randomInt(SLUG_ALPHABET.length)];
  return out;
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

function str(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/*
 Приводит вход из админки к безопасной структуре формы.
 Возвращает { errors: string[], value } — ошибки показываем менеджеру списком.
 */
function sanitizeForm(input) {
  const src = input && typeof input === 'object' ? input : {};
  const errors = [];

  const title = str(src.title, 150);
  if (!title) errors.push('Укажите название формы');
  const description = str(src.description, 2000);

  const rawFields = Array.isArray(src.fields) ? src.fields.slice(0, 50) : [];
  if (rawFields.length === 0) errors.push('Добавьте хотя бы один вопрос');

  const usedIds = new Set();
  const fields = rawFields.map((raw, index) => {
    const f = raw && typeof raw === 'object' ? raw : {};
    const n = index + 1;
    const type = TYPES.includes(f.type) ? f.type : 'text';

    // id поля стабильный: на него ссылаются ответы, даже если форму потом отредактировали
    let id = typeof f.id === 'string' && /^[a-z0-9_]{1,24}$/.test(f.id) ? f.id : '';
    if (!id || usedIds.has(id)) id = newId('f');
    usedIds.add(id);

    const label = str(f.label, 200);
    if (!label) errors.push(`Вопрос ${n}: заполните формулировку`);

    const field = { id, type, label, required: Boolean(f.required) };

    if (CHOICE.has(type)) {
      const seen = new Set();
      field.options = (Array.isArray(f.options) ? f.options : [])
        .map((o) => str(o, 150))
        .filter((o) => o && !seen.has(o) && seen.add(o))
        .slice(0, 50);
      if (field.options.length < 2) errors.push(`Вопрос ${n}: добавьте минимум два варианта ответа`);
    } else if (!['date'].includes(type)) {
      field.placeholder = str(f.placeholder, 200);
    }
    return field;
  });

  return { errors, value: { title, description, fields } };
}

function isEmpty(v) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/* Проверка одного значения. Возвращает { error } или { value } */
function checkValue(field, raw) {
  if (isEmpty(raw)) {
    if (field.required) {
      return { error: CHOICE.has(field.type) ? 'Выберите вариант ответа' : 'Ответьте на этот вопрос' };
    }
    return { value: field.type === 'checkbox' ? [] : '' };
  }

  if (field.type === 'checkbox') {
    if (!Array.isArray(raw)) return { error: 'Некорректный ответ' };
    const picked = [...new Set(raw)];
    if (!picked.every((v) => typeof v === 'string' && field.options.includes(v))) {
      return { error: 'Выберите варианты из списка' };
    }
    return { value: picked };
  }

  if (typeof raw !== 'string' && typeof raw !== 'number') return { error: 'Некорректный ответ' };
  const v = String(raw).trim();
  if (v === '') return field.required ? { error: 'Ответьте на этот вопрос' } : { value: '' };

  switch (field.type) {
    case 'text':
      return v.length <= 500 ? { value: v } : { error: 'Слишком длинный ответ (максимум 500 символов)' };
    case 'textarea':
      return v.length <= 5000 ? { value: v } : { error: 'Слишком длинный ответ (максимум 5000 символов)' };
    case 'email':
      return v.length <= 254 && EMAIL_RE.test(v)
        ? { value: v }
        : { error: 'Проверьте адрес: он должен выглядеть как name@example.com' };
    case 'phone':
      return PHONE_RE.test(v)
        ? { value: v }
        : { error: 'Введите номер телефона цифрами, например +7 999 123-45-67' };
    case 'number':
      return Number.isFinite(Number(v)) && v.length <= 30 ? { value: v } : { error: 'Введите число' };
    case 'url': {
      try {
        const u = new URL(v);
        if ((u.protocol === 'http:' || u.protocol === 'https:') && v.length <= 500) return { value: v };
      } catch (e) { /* fallthrough */ }
      return { error: 'Введите ссылку целиком, например https://example.com' };
    }
    case 'date': {
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
      return ok ? { value: v } : { error: 'Укажите дату' };
    }
    case 'select':
    case 'radio':
      return field.options.includes(v) ? { value: v } : { error: 'Выберите вариант из списка' };
    default:
      return { error: 'Неизвестный тип вопроса' };
  }
}

/** Серверная валидация ответов студента */
function validateAnswers(form, answers) {
  const src = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  const errors = {};
  const clean = {};
  for (const field of form.fields) {
    const res = checkValue(field, src[field.id]);
    if (res.error) errors[field.id] = res.error;
    else clean[field.id] = res.value;
  }
  return { errors, clean };
}

module.exports = { TYPES, CHOICE, newId, newSlug, sanitizeForm, validateAnswers };
