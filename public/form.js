(function () {
  'use strict';
  const { h, render, isEmpty } = FormKit;
  const root = document.getElementById('root');

  const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
  const SID_KEY = `sid:${slug}`;
  const DRAFT_KEY = `draft:${slug}`;

  const store = {
    get(area, key) { try { return window[area].getItem(key); } catch (e) { return null; } },
    set(area, key, val) { try { window[area].setItem(key, val); } catch (e) { /* ignore */ } },
    del(area, key) { try { window[area].removeItem(key); } catch (e) { /* ignore */ } },
  };

  function getSid() {
    let sid = store.get('sessionStorage', SID_KEY);
    if (!sid) {
      sid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      store.set('sessionStorage', SID_KEY, sid);
    }
    return sid;
  }
  const sid = getSid();

  function sendEvent(type, fieldId) {
    fetch(`/api/public/forms/${encodeURIComponent(slug)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid, type, fieldId }),
      keepalive: true,
    }).catch(() => { /* аналитика не должна мешать заполнению */ });
  }

  function showMessage(title, text) {
    document.title = title;
    root.replaceChildren(h('div', { class: 'pub-card msg' }, h('h1', null, title), h('p', null, text)));
  }

  async function main() {
    let form;
    try {
      const res = await fetch(`/api/public/forms/${encodeURIComponent(slug)}`);
      if (res.status === 404) return showMessage('Форма не найдена', 'Проверьте ссылку: возможно, в ней не хватает символов.');
      if (res.status === 410) return showMessage('Приём откликов закрыт', 'Организаторы пока не принимают ответы по этой форме.');
      if (!res.ok) throw new Error('bad status');
      form = await res.json();
    } catch (e) {
      return showMessage('Не удалось загрузить форму', 'Проверьте интернет-соединение и обновите страницу.');
    }

    document.title = form.title;
    sendEvent('view');

    /* прогресс */
    const fill = h('div', { class: 'progress-fill' });
    const progressText = h('p', { class: 'progress-text' });
    const progress = h('div', { class: 'progress' },
      h('div', { class: 'progress-track', role: 'progressbar', 'aria-label': 'Заполнено вопросов', 'aria-valuemin': '0', 'aria-valuemax': String(form.fields.length) }, fill),
      progressText);
    const progressTrack = progress.firstChild;

    function updateProgress(values) {
      const done = form.fields.filter((f) => !isEmpty(values[f.id])).length;
      fill.style.width = `${form.fields.length ? (done / form.fields.length) * 100 : 0}%`;
      progressTrack.setAttribute('aria-valuenow', String(done));
      progressText.textContent = `Заполнено ${done} из ${form.fields.length}`;
    }

    /* автосохранение черновика: закрыл вкладку — вернулся и продолжил с того же места */
    let saveTimer = null;
    function saveDraft(values) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const hasAny = Object.values(values).some((v) => !isEmpty(v));
        if (hasAny) store.set('localStorage', DRAFT_KEY, JSON.stringify(values));
        else store.del('localStorage', DRAFT_KEY);
      }, 300);
    }

    let lastFocused = null;
    const kit = render(form.fields, {
      onFocus(fieldId) {
        if (fieldId === lastFocused) return;
        lastFocused = fieldId;
        sendEvent('focus', fieldId);
      },
      onChange(values) {
        updateProgress(values);
        saveDraft(values);
      },
    });

    const notice = h('div', { class: 'notice', hidden: true },
      h('span', null, 'Мы восстановили ваши ответы с прошлого визита.'),
      h('button', {
        type: 'button', class: 'btn btn-sm',
        onclick() { kit.clear(); store.del('localStorage', DRAFT_KEY); notice.hidden = true; },
      }, 'Начать заново'));

    const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Отправить отклик');
    const failBox = h('p', { class: 'fk-err', role: 'alert', hidden: true });
    const formEl = h('form', { novalidate: true }, kit.root, h('div', { class: 'pub-actions' }, submitBtn), failBox,
      h('p', { class: 'pub-note' }, 'Ответы сохраняются на этом устройстве, пока вы не отправите форму: страницу можно закрыть и вернуться позже.'));

    root.replaceChildren(h('div', { class: 'pub-card' },
      h('h1', null, form.title),
      form.description ? h('p', { class: 'pub-desc' }, form.description) : null,
      notice, progress, formEl));

    /* восстановление черновика */
    const raw = store.get('localStorage', DRAFT_KEY);
    if (raw) {
      try {
        const draft = JSON.parse(raw);
        kit.setValues(draft);
        notice.hidden = !Object.values(kit.getValues()).some((v) => !isEmpty(v));
      } catch (e) { store.del('localStorage', DRAFT_KEY); }
    }
    updateProgress(kit.getValues());

    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      failBox.hidden = true;
      if (!kit.validate()) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Отправляем…';
      try {
        const res = await fetch(`/api/public/forms/${encodeURIComponent(slug)}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sid, answers: kit.getValues() }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 422) { kit.setErrors(data.errors); return; }
        if (res.status === 410) return showMessage('Приём откликов закрыт', 'Пока вы заполняли форму, приём ответов закончился.');
        if (!res.ok) throw new Error(data.error || 'Ошибка отправки');

        clearTimeout(saveTimer);
        store.del('localStorage', DRAFT_KEY);
        store.del('sessionStorage', SID_KEY);
        showMessage('Отклик отправлен', 'Спасибо! Мы получили ваши ответы.');
      } catch (err) {
        failBox.textContent = 'Не удалось отправить ответы. Ваши данные сохранены — проверьте соединение и попробуйте ещё раз.';
        failBox.hidden = false;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Отправить отклик';
      }
    });
  }

  main();
})();
