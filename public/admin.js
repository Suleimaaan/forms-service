(function () {
  'use strict';
  const { h, render } = FormKit;
  const app = document.getElementById('app');

  const TYPE_LABELS = {
    text: 'Короткий ответ', textarea: 'Длинный ответ', email: 'E-mail', phone: 'Телефон', number: 'Число',
    url: 'Ссылка', date: 'Дата', select: 'Выпадающий список', radio: 'Один вариант', checkbox: 'Несколько вариантов',
  };
  const CHOICE = ['select', 'radio', 'checkbox'];
  const NO_PLACEHOLDER = ['date', ...CHOICE];

  /*  утилиты  */
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Не удалось выполнить запрос');
      err.errors = data.errors;
      throw err;
    }
    return data;
  }

  function toast(text, isError) {
    const el = h('div', { class: `toast${isError ? ' err' : ''}`, role: 'status' }, text);
    document.body.append(el);
    setTimeout(() => el.remove(), 2800);
  }

  const formatDate = (iso) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
  const formUrl = (slug) => `${location.origin}/f/${slug}`;

  function plural(n, [one, few, many]) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function duration(sec) {
    if (sec === null || sec === undefined) return '—';
    if (sec < 60) return `${sec} с`;
    return `${Math.floor(sec / 60)} мин ${sec % 60} с`;
  }

  async function copy(text, inputEl) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Ссылка скопирована');
    } catch (e) {
      if (inputEl) { inputEl.select(); document.execCommand && document.execCommand('copy'); toast('Ссылка скопирована'); }
      else window.prompt('Скопируйте ссылку:', text);
    }
  }

  const statusBadge = (status) =>
    h('span', { class: `badge ${status === 'published' ? 'badge-live' : 'badge-draft'}` }, status === 'published' ? 'Опубликована' : 'Черновик');

  function linkBox(form) {
    const url = formUrl(form.slug);
    const input = h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Ссылка на форму' });
    input.addEventListener('focus', () => input.select());
    return h('div', { class: 'linkbox' },
      input,
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => copy(url, input) }, 'Копировать ссылку'),
      h('a', { class: 'btn btn-sm', href: url, target: '_blank', rel: 'noopener' }, 'Открыть форму'),
      form.status === 'published'
        ? null
        : h('p', { class: 'hint small muted' }, 'Форма в черновике: по ссылке она откроется, только когда вы её опубликуете.'));
  }

  /*  роутер  */
  let dirtyGuard = null; // функция, возвращающая true, если есть несохранённые правки

  function confirmLeave() {
    return !dirtyGuard || !dirtyGuard() || window.confirm('Есть несохранённые изменения. Уйти без сохранения?');
  }

  window.addEventListener('beforeunload', (e) => {
    if (dirtyGuard && dirtyGuard()) { e.preventDefault(); e.returnValue = ''; }
  });

  async function route() {
    dirtyGuard = null;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    try {
      if (parts.length === 0) await listView();
      else if (parts[0] === 'new') await builderView(null);
      else if (parts[0] === 'edit' && parts[1]) await builderView(parts[1]);
      else if (parts[0] === 'forms' && parts[1]) await resultsView(parts[1], parts[2] === 'analytics' ? 'analytics' : 'answers');
      else await listView();
    } catch (err) {
      app.replaceChildren(h('div', { class: 'panel empty' },
        h('h2', null, 'Не получилось открыть страницу'),
        h('p', null, err.message),
        h('a', { class: 'btn', href: '#/' }, 'К списку форм')));
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /*  список форм  */
  async function listView() {
    const forms = await api('GET', '/api/forms');
    const head = h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Формы отклика'), h('p', { class: 'muted sub' }, 'Соберите форму, опубликуйте и отправьте студентам ссылку.')),
      h('a', { class: 'btn btn-primary', href: '#/new' }, 'Создать форму'));

    if (forms.length === 0) {
      app.replaceChildren(head, h('div', { class: 'panel empty' },
        h('h2', null, 'Пока нет ни одной формы'),
        h('p', null, 'Добавьте вопросы, опубликуйте форму и отправьте студентам ссылку. Отклики появятся здесь.'),
        h('a', { class: 'btn btn-primary', href: '#/new' }, 'Создать первую форму')));
      return;
    }

    const rows = forms.map((f) => h('tr', null,
      h('td', null, h('a', { class: 'title-link', href: `#/forms/${f.id}` }, f.title)),
      h('td', null, statusBadge(f.status)),
      h('td', { class: 'num' }, String(f.responses)),
      h('td', { class: 'num' }, f.views ? `${Math.round((f.submitted / f.views) * 100)}%` : '—'),
      h('td', null, formatDate(f.updatedAt)),
      h('td', { class: 'actions' },
        h('a', { class: 'btn btn-ghost btn-sm', href: `#/forms/${f.id}` }, 'Ответы'),
        h('a', { class: 'btn btn-ghost btn-sm', href: `#/edit/${f.id}` }, 'Изменить'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => copy(formUrl(f.slug)) }, 'Ссылка'),
        h('button', {
          class: 'btn btn-ghost btn-sm btn-danger', type: 'button',
          async onclick() {
            if (!window.confirm(`Удалить форму «${f.title}» вместе с ${f.responses} ${plural(f.responses, ['ответом', 'ответами', 'ответами'])}? Это нельзя отменить.`)) return;
            try { await api('DELETE', `/api/forms/${f.id}`); toast('Форма удалена'); route(); }
            catch (err) { toast(err.message, true); }
          },
        }, 'Удалить'))));

    app.replaceChildren(head, h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null,
        h('th', null, 'Название'), h('th', null, 'Статус'), h('th', { class: 'num' }, 'Ответов'),
        h('th', { class: 'num', title: 'Доля открывших форму, кто её отправил' }, 'Конверсия'), h('th', null, 'Изменена'), h('th'))),
      h('tbody', null, rows))));
  }

  /*  конструктор  */
  const rid = () => `f${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

  const blankField = (type = 'text') => ({
    id: rid(), type, label: '', required: false, placeholder: '',
    optionsText: CHOICE.includes(type) ? 'Вариант 1\nВариант 2' : '',
  });

  const TEMPLATE = () => [
    { type: 'text', label: 'Имя и фамилия', required: true, placeholder: 'Анна Иванова' },
    { type: 'email', label: 'E-mail', required: true, placeholder: 'anna@example.com' },
    { type: 'phone', label: 'Телефон', required: false, placeholder: '+7 999 123-45-67' },
    { type: 'text', label: 'Вуз и курс', required: true, placeholder: 'МГУ, 3 курс' },
    { type: 'radio', label: 'Удобный формат работы', required: true, optionsText: 'Очно\nУдалённо\nГибрид' },
    { type: 'url', label: 'Ссылка на резюме или портфолио', required: false, placeholder: 'https://…' },
    { type: 'textarea', label: 'Почему вам интересна эта стажировка?', required: true, placeholder: 'Пара предложений своими словами' },
  ].map((f) => ({ id: rid(), placeholder: '', optionsText: '', ...f }));

  async function builderView(id) {
    let saved = null;
    const state = { title: '', description: '', status: 'draft', fields: [] };
    if (id) {
      saved = await api('GET', `/api/forms/${id}`);
      state.title = saved.title;
      state.description = saved.description || '';
      state.status = saved.status;
      state.fields = saved.fields.map((f) => ({
        id: f.id, type: f.type, label: f.label, required: f.required,
        placeholder: f.placeholder || '', optionsText: (f.options || []).join('\n'),
      }));
    }

    let dirty = false;
    dirtyGuard = () => dirty;
    const touch = () => { dirty = true; schedulePreview(); };

    const toApi = () => ({
      title: state.title, description: state.description, status: state.status,
      fields: state.fields.map((f) => ({
        id: f.id, type: f.type, label: f.label, required: f.required, placeholder: f.placeholder,
        options: CHOICE.includes(f.type) ? f.optionsText.split('\n').map((s) => s.trim()).filter(Boolean) : undefined,
      })),
    });

    /* превью */
    const previewBody = h('div', { class: 'preview-body' });
    let previewTimer = null;
    function renderPreview() {
      const payload = toApi();
      previewBody.replaceChildren(
        h('h2', null, payload.title || 'Название формы'),
        payload.description ? h('p', { class: 'muted small', style: 'white-space:pre-line;margin-top:.25rem' }, payload.description) : null,
        h('div', { style: 'height:1rem' }),
        payload.fields.length
          ? render(payload.fields).root
          : h('p', { class: 'muted' }, 'Добавьте вопросы — здесь появится форма в том виде, в каком её увидит студент.'));
    }
    function schedulePreview() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(renderPreview, 120);
    }

    /* карточки вопросов */
    const fieldsBox = h('div', { class: 'stack' });
    const emptyHint = h('div', { class: 'panel muted' }, 'В форме пока нет вопросов. Добавьте первый ниже или начните с готового шаблона.');

    function move(i, delta) {
      const j = i + delta;
      if (j < 0 || j >= state.fields.length) return;
      [state.fields[i], state.fields[j]] = [state.fields[j], state.fields[i]];
      renderFields(); touch();
    }

    function renderFields() {
      fieldsBox.replaceChildren(...state.fields.map((f, i) => {
        const typeSel = h('select', { id: `type_${f.id}`, 'aria-label': 'Тип вопроса' },
          Object.entries(TYPE_LABELS).map(([val, label]) => h('option', { value: val, selected: f.type === val }, label)));
        typeSel.addEventListener('change', () => {
          f.type = typeSel.value;
          if (CHOICE.includes(f.type) && !f.optionsText.trim()) f.optionsText = 'Вариант 1\nВариант 2';
          renderFields(); touch();
        });

        const labelInp = h('input', { type: 'text', id: `label_${f.id}`, value: f.label, maxlength: '200', placeholder: 'Например: Расскажите о себе' });
        labelInp.addEventListener('input', () => { f.label = labelInp.value; touch(); });

        const reqInp = h('input', { type: 'checkbox', checked: f.required });
        reqInp.addEventListener('change', () => { f.required = reqInp.checked; touch(); });

        let extra = null;
        if (CHOICE.includes(f.type)) {
          const ta = h('textarea', { id: `opts_${f.id}`, rows: 4, placeholder: 'Каждый вариант с новой строки' }, f.optionsText);
          ta.addEventListener('input', () => { f.optionsText = ta.value; touch(); });
          extra = h('div', null, h('label', { class: 'field-label', for: `opts_${f.id}` }, 'Варианты ответа (каждый с новой строки)'), ta);
        } else if (!NO_PLACEHOLDER.includes(f.type)) {
          const ph = h('input', { type: 'text', id: `ph_${f.id}`, value: f.placeholder, maxlength: '200', placeholder: 'Пример ответа, который увидит студент' });
          ph.addEventListener('input', () => { f.placeholder = ph.value; touch(); });
          extra = h('div', null, h('label', { class: 'field-label', for: `ph_${f.id}` }, 'Подсказка внутри поля'), ph);
        }

        return h('section', { class: 'q-card', 'aria-label': `Вопрос ${i + 1}` },
          h('div', { class: 'q-head' },
            h('strong', null, `Вопрос ${i + 1} из ${state.fields.length}`),
            h('div', { class: 'q-tools' },
              h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: i === 0, 'aria-label': 'Поднять вопрос выше', onclick: () => move(i, -1) }, 'Выше'),
              h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: i === state.fields.length - 1, 'aria-label': 'Опустить вопрос ниже', onclick: () => move(i, 1) }, 'Ниже'),
              h('button', {
                type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Дублировать вопрос',
                onclick() { state.fields.splice(i + 1, 0, { ...f, id: rid() }); renderFields(); touch(); },
              }, 'Дублировать'),
              h('button', {
                type: 'button', class: 'btn btn-ghost btn-sm btn-danger', 'aria-label': 'Удалить вопрос',
                onclick() { state.fields.splice(i, 1); renderFields(); touch(); },
              }, 'Удалить'))),
          h('div', { class: 'grid2' },
            h('div', null, h('label', { class: 'field-label', for: `label_${f.id}` }, 'Вопрос'), labelInp),
            h('div', null, h('label', { class: 'field-label', for: `type_${f.id}` }, 'Тип ответа'), typeSel)),
          extra,
          h('label', { class: 'q-check' }, reqInp, 'Обязательный вопрос'));
      }));
      if (state.fields.length === 0) fieldsBox.replaceChildren(emptyHint);
    }

    const addRow = h('div', { class: 'row' },
      Object.entries(TYPE_LABELS).map(([type, label]) => h('button', {
        type: 'button', class: 'btn btn-sm',
        onclick() {
          state.fields.push(blankField(type));
          renderFields(); touch();
          const last = fieldsBox.lastElementChild;
          const input = last && last.querySelector('input[type="text"]');
          if (input) { input.focus(); last.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        },
      }, `+ ${label}`)));

    const templateBtn = h('button', {
      type: 'button', class: 'btn btn-sm btn-primary',
      onclick() {
        if (state.fields.length && !window.confirm('Шаблон заменит текущие вопросы. Продолжить?')) return;
        state.fields = TEMPLATE();
        if (!state.title) { state.title = 'Стажировка: отклик'; titleInp.value = state.title; }
        renderFields(); touch();
      },
    }, 'Начать с шаблона «Стажировка»');

    /* шапка формы */
    const titleInp = h('input', { type: 'text', id: 'f_title', value: state.title, maxlength: '150', placeholder: 'Например: Стажировка в отделе аналитики' });
    titleInp.addEventListener('input', () => { state.title = titleInp.value; touch(); });
    const descInp = h('textarea', { id: 'f_desc', rows: 3, maxlength: '2000', placeholder: 'Пара слов для студента: о чём стажировка и сколько займёт заполнение' }, state.description);
    descInp.addEventListener('input', () => { state.description = descInp.value; touch(); });
    const statusSel = h('select', { id: 'f_status' },
      h('option', { value: 'draft', selected: state.status === 'draft' }, 'Черновик — по ссылке недоступна'),
      h('option', { value: 'published', selected: state.status === 'published' }, 'Опубликована — принимает ответы'));
    statusSel.addEventListener('change', () => { state.status = statusSel.value; dirty = true; });

    const errorBox = h('div', { class: 'errors', role: 'alert', hidden: true });
    const linkHolder = h('div');
    const saveBtn = h('button', { type: 'button', class: 'btn btn-primary' }, id ? 'Сохранить' : 'Создать форму');

    function showLink() {
      linkHolder.replaceChildren(...(saved ? [linkBox(saved)] : []));
    }

    saveBtn.addEventListener('click', async () => {
      errorBox.hidden = true;
      saveBtn.disabled = true;
      try {
        const result = id ? await api('PUT', `/api/forms/${id}`, toApi()) : await api('POST', '/api/forms', toApi());
        dirty = false;
        toast(state.status === 'published' ? 'Сохранено и опубликовано' : 'Сохранено');
        if (!id) { location.hash = `#/edit/${result.id}`; return; }
        saved = result;
        showLink();
      } catch (err) {
        const list = err.errors && err.errors.length ? err.errors : [err.message];
        errorBox.replaceChildren(h('strong', null, 'Форму пока нельзя сохранить:'), h('ul', null, list.map((m) => h('li', null, m))));
        errorBox.hidden = false;
        errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } finally {
        saveBtn.disabled = false;
      }
    });

    const backLink = h('a', { class: 'back', href: '#/' }, 'Все формы');
    backLink.addEventListener('click', (e) => { if (!confirmLeave()) e.preventDefault(); else dirtyGuard = null; });

    app.replaceChildren(
      backLink,
      h('div', { class: 'page-head' },
        h('h1', null, id ? 'Редактирование формы' : 'Новая форма'),
        h('div', { class: 'row' },
          id ? h('a', { class: 'btn', href: `#/forms/${id}` }, 'Ответы') : null,
          saveBtn)),
      h('div', { class: 'builder' },
        h('div', { class: 'builder-main' },
          errorBox,
          linkHolder,
          h('div', { class: 'panel stack' },
            h('div', null, h('label', { class: 'field-label', for: 'f_title' }, 'Название формы'), titleInp),
            h('div', null, h('label', { class: 'field-label', for: 'f_desc' }, 'Описание для студента'), descInp),
            h('div', null, h('label', { class: 'field-label', for: 'f_status' }, 'Статус'), statusSel)),
          fieldsBox,
          h('div', { class: 'add-bar' },
            h('strong', null, 'Добавить вопрос'),
            addRow,
            state.fields.length === 0 ? h('div', { class: 'row', style: 'margin-top:.75rem' }, templateBtn) : null)),
        h('aside', { class: 'preview', 'aria-label': 'Предпросмотр формы' },
          h('span', { class: 'preview-label' }, 'Так форму увидит студент'),
          previewBody)));

    renderFields();
    renderPreview();
    showLink();
  }

  /*  ответы и аналитика  */
  async function resultsView(id, tab) {
    const [formInfo, content] = await Promise.all([
      api('GET', `/api/forms/${id}`),
      tab === 'analytics' ? api('GET', `/api/forms/${id}/analytics`) : api('GET', `/api/forms/${id}/responses`),
    ]);

    const head = h('div', null,
      h('a', { class: 'back', href: '#/' }, 'Все формы'),
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', null, formInfo.title),
          h('div', { class: 'row sub' }, statusBadge(formInfo.status))),
        h('div', { class: 'row' },
          h('a', { class: 'btn', href: `#/edit/${id}` }, 'Изменить форму'),
          tab === 'answers' && content.rows.length
            ? h('a', { class: 'btn', href: `/api/forms/${id}/responses.csv` }, 'Скачать CSV')
            : null)),
      linkBox(formInfo),
      h('div', { style: 'height:1.25rem' }),
      h('nav', { class: 'tabs', 'aria-label': 'Разделы' },
        h('a', { class: 'tab', href: `#/forms/${id}`, 'aria-current': tab === 'answers' ? 'page' : null }, 'Ответы'),
        h('a', { class: 'tab', href: `#/forms/${id}/analytics`, 'aria-current': tab === 'analytics' ? 'page' : null }, 'Где бросают форму')));

    app.replaceChildren(head, tab === 'answers' ? answersTable(id, content) : funnel(content));
  }

  function cellText(v) {
    return Array.isArray(v) ? v.join(', ') : (v === undefined || v === null ? '' : String(v));
  }

  function answersTable(formId, data) {
    if (data.rows.length === 0) {
      return h('div', { class: 'panel empty' },
        h('h2', null, 'Ответов пока нет'),
        h('p', null, data.form.status === 'published'
          ? 'Отправьте студентам ссылку выше — отклики появятся здесь.'
          : 'Форма в черновике. Опубликуйте её, чтобы студенты смогли отвечать.'));
    }

    function openDialog(row) {
      const dlg = h('dialog', { 'aria-label': 'Ответ студента' });
      dlg.append(h('div', { class: 'dlg' },
        h('div', null, h('h2', null, 'Ответ студента'), h('p', { class: 'muted small' }, formatDate(row.createdAt))),
        h('dl', null, data.columns.map((c) => {
          const text = cellText(row.values[c.id]);
          return h('div', null, h('dt', null, c.label), h('dd', null, text || '—'));
        })),
        h('div', { class: 'row', style: 'justify-content:space-between' },
          h('button', {
            type: 'button', class: 'btn btn-danger',
            async onclick() {
              if (!window.confirm('Удалить этот ответ? Это нельзя отменить.')) return;
              try { await api('DELETE', `/api/forms/${formId}/responses/${row.id}`); dlg.close(); toast('Ответ удалён'); route(); }
              catch (err) { toast(err.message, true); }
            },
          }, 'Удалить ответ'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Закрыть'))));
      dlg.addEventListener('close', () => dlg.remove());
      document.body.append(dlg);
      dlg.showModal();
    }

    return h('div', null,
      h('p', { class: 'muted', style: 'margin-bottom:.75rem' },
        `${data.rows.length} ${plural(data.rows.length, ['ответ', 'ответа', 'ответов'])}, сначала новые`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Получен'), data.columns.map((c) => h('th', null, c.label)), h('th'))),
        h('tbody', null, data.rows.map((row) => h('tr', null,
          h('td', { style: 'white-space:nowrap' }, formatDate(row.createdAt)),
          data.columns.map((c) => h('td', { class: 'cell', title: cellText(row.values[c.id]) }, cellText(row.values[c.id]) || '—')),
          h('td', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openDialog(row) }, 'Открыть'))))))));
  }

  function funnel(d) {
    if (d.views === 0) {
      return h('div', { class: 'panel empty' },
        h('h2', null, 'Данных пока нет'),
        h('p', null, 'Как только студенты начнут открывать форму, здесь появится воронка: сколько человек дошло до каждого вопроса и на каком остановились.'));
    }

    const pct = (n) => (d.views ? Math.round((n / d.views) * 100) : 0);
    const worst = d.fields.reduce((a, f) => (f.leftHere > (a ? a.leftHere : 0) ? f : a), null);

    let insight;
    if (d.abandoned === 0) {
      insight = h('div', { class: 'insight good' }, 'Пока никто не бросил форму на середине: все, кто начал, отправили ответы.');
    } else if (worst) {
      insight = h('div', { class: 'insight' },
        h('strong', null, `Чаще всего форму бросают на вопросе «${worst.label}»`),
        ` — ${worst.leftHere} из ${d.abandoned} ${plural(d.abandoned, ['бросившего', 'бросивших', 'бросивших'])}. `,
        'Перечитайте формулировку: возможно, вопрос слишком личный или сложный. Попробуйте сделать его необязательным или поставить в конец.');
    } else {
      insight = h('div', { class: 'insight' }, `${d.abandoned} ${plural(d.abandoned, ['человек начал', 'человека начали', 'человек начали'])} заполнять форму и не отправили её.`);
    }

    const row = (label, count, cls, extra) => h('div', { class: `fn-row ${cls || ''}` },
      h('div', { class: 'fn-label' }, label),
      h('div', { class: 'fn-track', role: 'img', 'aria-label': `${pct(count)}% от открывших форму` }, h('div', { class: 'fn-fill', style: `width:${pct(count)}%` })),
      h('div', { class: 'fn-num' }, h('b', null, String(count)), ` (${pct(count)}%)`, extra));

    return h('div', null,
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'v' }, String(d.views)), h('div', { class: 'l' }, 'открыли форму')),
        h('div', { class: 'tile' }, h('div', { class: 'v' }, String(d.started)), h('div', { class: 'l' }, 'начали заполнять')),
        h('div', { class: 'tile' }, h('div', { class: 'v' }, String(d.submitted)), h('div', { class: 'l' }, 'отправили')),
        h('div', { class: 'tile' }, h('div', { class: 'v' }, `${pct(d.submitted)}%`), h('div', { class: 'l' }, 'конверсия')),
        h('div', { class: 'tile' }, h('div', { class: 'v' }, duration(d.medianSeconds)), h('div', { class: 'l' }, 'типичное время заполнения'))),
      insight,
      h('div', { class: 'panel' },
        h('h2', { style: 'margin-bottom:.25rem' }, 'Путь студента по форме'),
        h('p', { class: 'muted small', style: 'margin-bottom:1rem' }, 'Сколько человек дошло до каждого вопроса и сколько остановилось именно на нём.'),
        h('div', { class: 'funnel' },
          row('Открыли форму', d.views),
          row('Начали заполнять', d.started),
          d.fields.map((f) => row(f.label, f.reached, worst && f.id === worst.id ? 'is-worst' : '',
            f.leftHere ? h('span', { class: 'fn-left' }, `бросили здесь: ${f.leftHere}`) : null)),
          row('Отправили', d.submitted, 'is-final'))));
  }

  route();
})();
