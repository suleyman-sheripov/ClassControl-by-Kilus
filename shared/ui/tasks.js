/* ClassControl — опрос и сдача работы глазами ученика.
   Общий блок для окна агента в классе и для страницы урока из дома. */
(function () {
  'use strict';
  const { el, icon } = CC;

  /**
   * CC.renderStudentTasks(root, { poll, collect }, { onAnswer(pollId, index), onSubmit(collectId) -> Promise<{ok, filename, error, canceled}> })
   * poll: { id, question, options, open, myVote, counts?, total? }
   * collect: { id, title, submitted }
   */
  CC.renderStudentTasks = function (root, tasks, handlers) {
    root.replaceChildren();
    const { poll, collect } = tasks || {};
    if (poll) root.appendChild(pollBlock(poll, handlers));
    if (collect) root.appendChild(collectBlock(collect, handlers));
    if (!poll && !collect) {
      root.appendChild(el('div', { class: 'empty' }, icon('check', 'i-xl empty__icon'), el('div', { class: 'empty__title', text: 'Заданий сейчас нет' })));
    }
  };

  const LETTERS = 'АБВГДЕЖЗ';

  function pollBlock(p, handlers) {
    const box = el('section', { class: 'stask' });
    box.appendChild(el('div', { class: 'stask__kind' }, icon('poll', 'i-sm'), p.open !== false ? 'Опрос учителя' : 'Итоги опроса'));
    box.appendChild(el('h2', { class: 'stask__title', text: p.question }));
    if (p.open !== false) {
      const list = el('div', { class: 'choices', role: 'radiogroup', 'aria-label': p.question });
      p.options.forEach((opt, i) => {
        const b = el('button', { class: 'choice' + (p.myVote === i ? ' is-chosen' : ''), type: 'button', role: 'radio', 'aria-checked': String(p.myVote === i) },
          el('span', { class: 'choice__key', text: LETTERS[i] || String(i + 1) }),
          el('span', { class: 'choice__text', text: opt }),
          p.myVote === i ? icon('check', 'i-sm choice__check') : null);
        b.addEventListener('click', () => {
          p.myVote = i;
          handlers.onAnswer(p.id, i);
          list.querySelectorAll('.choice').forEach((x, j) => {
            x.classList.toggle('is-chosen', j === i);
            x.setAttribute('aria-checked', String(j === i));
            x.querySelector('.choice__check')?.remove();
            if (j === i) x.appendChild(icon('check', 'i-sm choice__check'));
          });
          hint.textContent = 'Ответ отправлен. Пока опрос идёт, его можно поменять.';
        });
        list.appendChild(b);
      });
      box.appendChild(list);
      const hint = el('p', { class: 'stask__hint', text: p.myVote != null ? 'Ответ отправлен. Пока опрос идёт, его можно поменять.' : 'Выберите один вариант — учитель увидит ответ сразу.' });
      box.appendChild(hint);
    } else {
      const max = Math.max(0, ...(p.counts || []));
      const bars = el('div', { class: 'bars' });
      p.options.forEach((opt, i) => {
        const c = (p.counts || [])[i] || 0;
        const pct = p.total ? Math.round(c / p.total * 100) : 0;
        bars.appendChild(el('div', { class: 'bar' + (c && c === max ? ' is-top' : '') },
          el('span', { class: 'bar__label' }, opt, p.myVote === i ? el('span', { class: 'bar__mine', text: 'ваш ответ' }) : null),
          el('span', { class: 'bar__value', text: `${pct}%` }),
          el('div', { class: 'bar__track' }, el('div', { class: 'bar__fill', style: { width: pct + '%' } }))));
      });
      box.appendChild(bars);
      box.appendChild(el('p', { class: 'stask__hint', text: `Ответили ${p.total || 0}` }));
    }
    return box;
  }

  function collectBlock(c, handlers) {
    const box = el('section', { class: 'stask' });
    box.appendChild(el('div', { class: 'stask__kind' }, icon('inbox', 'i-sm'), 'Учитель собирает работы'));
    box.appendChild(el('h2', { class: 'stask__title', text: c.title }));
    const status = el('div', { class: 'stask__status' });
    const btn = el('button', { class: 'btn btn--lg btn--block ' + (c.submitted ? '' : 'btn--primary'), type: 'button' });
    const render = () => {
      status.replaceChildren();
      if (c.submitted) status.append(el('span', { class: 'stask__done' }, icon('check', 'i-sm'), 'Сдано: '), el('span', { class: 'stask__file', text: c.submitted }));
      btn.replaceChildren(icon(c.submitted ? 'restart' : 'clip', 'i-sm'), c.submitted ? 'Сдать другой файл' : 'Выбрать файл и сдать');
      btn.className = 'btn btn--lg btn--block ' + (c.submitted ? '' : 'btn--primary');
    };
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const prev = btn.innerHTML;
      btn.replaceChildren(el('span', { class: 'spinner' }), 'Отправляю…');
      const r = await handlers.onSubmit(c.id);
      btn.disabled = false;
      if (r && r.ok) { c.submitted = r.filename; render(); CC.toast('Работа сдана', { kind: 'positive', gesture: 'thumb' }); }
      else { btn.innerHTML = prev; if (r && !r.canceled) CC.toast(r.error || 'Не удалось сдать работу', { kind: 'warning' }); }
    });
    render();
    box.append(status, btn, el('p', { class: 'stask__hint', text: 'Файл получит только учитель. Если сдать ещё раз, прежний файл заменится.' }));
    return box;
  }
})();
