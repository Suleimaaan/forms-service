/**
 * FormKit — общий рендерер полей формы.
 * Один и тот же код рисует превью в админке и настоящую форму для студента,
 * поэтому менеджер видит ровно то, что увидит студент.
 * Весь текст вставляется через textContent — XSS через названия вопросов невозможен.
 */
(function () {
  'use strict';

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_RE = /^\+?[\d\s()\-]{6,20}$/;
  const GROUP = new Set(['radio', 'checkbox']);
  const CHOICE = new Set(['select', 'radio', 'checkbox']);

  const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

  /** Те же правила, что на сервере (сервер всё равно перепроверяет). */
  function check(field, value) {
    if (isEmpty(value)) {
      if (!field.required) return '';
      return CHOICE.has(field.type) ? 'Выберите вариант ответа' : 'Ответьте на этот вопрос';
    }
    const v = String(value).trim();
    switch (field.type) {
      case 'email':
        return EMAIL_RE.test(v) ? '' : 'Проверьте адрес: он должен выглядеть как name@example.com';
      case 'phone':
        return PHONE_RE.test(v) ? '' : 'Введите номер телефона цифрами, например +7 999 123-45-67';
      case 'number':
        return Number.isFinite(Number(v)) ? '' : 'Введите число';
      case 'url':
        try {
          const u = new URL(v);
          return u.protocol === 'http:' || u.protocol === 'https:' ? '' : 'Введите ссылку целиком, например https://example.com';
        } catch (e) {
          return 'Введите ссылку целиком, например https://example.com';
        }
      default:
        return '';
    }
  }

  const INPUT_TYPE = { text: 'text', email: 'email', phone: 'tel', number: 'number', url: 'url', date: 'date' };
  const AUTOCOMPLETE = { email: 'email', phone: 'tel' };

  function makeControl(field, inputId, errId) {
    const common = {
      id: inputId,
      name: field.id,
      'aria-describedby': errId,
      'aria-required': field.required ? 'true' : null,
    };

    if (field.type === 'textarea') {
      const el = h('textarea', { ...common, rows: 4, placeholder: field.placeholder || null });
      return { node: el, inputs: [el], get: () => el.value.trim(), set: (v) => { el.value = v || ''; } };
    }

    if (field.type === 'select') {
      const el = h('select', common,
        h('option', { value: '' }, 'Выберите вариант'),
        (field.options || []).map((o) => h('option', { value: o }, o)));
      return { node: el, inputs: [el], get: () => el.value, set: (v) => { el.value = (field.options || []).includes(v) ? v : ''; } };
    }

    if (GROUP.has(field.type)) {
      const multi = field.type === 'checkbox';
      const inputs = (field.options || []).map((o, i) =>
        h('input', { type: multi ? 'checkbox' : 'radio', name: field.id, id: `${inputId}_${i}`, value: o, 'aria-describedby': errId }));
      const node = h('div', { class: 'fk-opts' },
        inputs.map((inp) => h('label', { class: 'fk-opt', for: inp.id }, inp, h('span', null, inp.value))));
      return {
        node,
        inputs,
        get: () => (multi ? inputs.filter((i) => i.checked).map((i) => i.value) : (inputs.find((i) => i.checked) || {}).value || ''),
        set: (v) => {
          const picked = Array.isArray(v) ? v : [v];
          inputs.forEach((i) => { i.checked = picked.includes(i.value); });
        },
      };
    }

    const el = h('input', {
      ...common,
      type: INPUT_TYPE[field.type] || 'text',
      placeholder: field.placeholder || null,
      autocomplete: AUTOCOMPLETE[field.type] || null,
      step: field.type === 'number' ? 'any' : null,
    });
    return { node: el, inputs: [el], get: () => el.value.trim(), set: (v) => { el.value = v || ''; } };
  }

  /**
   * Рисует поля. Возвращает { root, getValues, setValues, clear, validate, setErrors }.
   * opts.onFocus(fieldId) — студент дошёл до вопроса; opts.onChange(values) — ответ изменился.
   */
  function render(fields, opts = {}) {
    const root = h('div', { class: 'fk' });
    const ctrls = new Map();

    fields.forEach((field, i) => {
      const inputId = `fk_${field.id}`;
      const errId = `${inputId}_err`;
      const ctrl = makeControl(field, inputId, errId);
      const errEl = h('p', { class: 'fk-err', id: errId, role: 'alert', hidden: true });
      const text = field.label || 'Вопрос без названия';
      const req = field.required ? h('span', { class: 'fk-req', 'aria-hidden': 'true' }, '*') : null;

      let wrap;
      if (GROUP.has(field.type)) {
        wrap = h('fieldset', { class: 'fk-field' }, h('legend', { class: 'fk-q' }, text, req), ctrl.node, errEl);
      } else {
        wrap = h('div', { class: 'fk-field' }, h('label', { class: 'fk-q', for: inputId }, text, req), ctrl.node, errEl);
      }
      wrap.addEventListener('focusin', () => opts.onFocus && opts.onFocus(field.id));
      ctrls.set(field.id, { field, ...ctrl, errEl, wrap });
      root.append(wrap);
    });

    const getValues = () => {
      const out = {};
      for (const [id, c] of ctrls) out[id] = c.get();
      return out;
    };

    const setError = (id, msg) => {
      const c = ctrls.get(id);
      if (!c) return;
      c.errEl.textContent = msg || '';
      c.errEl.hidden = !msg;
      c.inputs.forEach((el) => (msg ? el.setAttribute('aria-invalid', 'true') : el.removeAttribute('aria-invalid')));
    };

    const onAnyChange = (e) => {
      const wrap = e.target.closest('.fk-field');
      const entry = [...ctrls.values()].find((c) => c.wrap === wrap);
      if (entry) setError(entry.field.id, '');
      if (opts.onChange) opts.onChange(getValues());
    };
    root.addEventListener('input', onAnyChange);
    root.addEventListener('change', onAnyChange);

    return {
      root,
      getValues,
      setValues(values) {
        for (const [id, c] of ctrls) if (values && id in values) c.set(values[id]);
        if (opts.onChange) opts.onChange(getValues());
      },
      clear() {
        for (const [id, c] of ctrls) { c.set(Array.isArray(c.get()) ? [] : ''); setError(id, ''); }
        if (opts.onChange) opts.onChange(getValues());
      },
      setErrors(errors) {
        let first = null;
        for (const [id, c] of ctrls) {
          const msg = errors && errors[id];
          setError(id, msg || '');
          if (msg && !first) first = c;
        }
        if (first) { first.wrap.scrollIntoView({ block: 'center', behavior: 'smooth' }); first.inputs[0] && first.inputs[0].focus({ preventScroll: true }); }
        return Boolean(first);
      },
      validate() {
        const errors = {};
        for (const [id, c] of ctrls) {
          const msg = check(c.field, c.get());
          if (msg) errors[id] = msg;
        }
        return Object.keys(errors).length ? (this.setErrors(errors), false) : (this.setErrors({}), true);
      },
    };
  }

  window.FormKit = { h, render, isEmpty };
})();
