(function () {
  'use strict';
  const { el, icon } = CC;
  CC.interactiveSend = (socket, event, data) =>
    new Promise((resolve) =>
      socket
        .timeout(5000)
        .emit(event, data, (err, result) =>
          resolve(err ? { ok: false, error: 'Нет ответа от учителя' } : result)
        )
    );
  const reviewDrafts = new Map();
  CC.interactiveStudent = function (state, handlers) {
    if (!state.reviews?.length) reviewDrafts.clear();
    const root = el('div', { class: 'interactive-student' });
    for (const q of state.quizzes || []) {
      const card = el(
        'section',
        { class: 'stask' },
        el('h2', { text: q.title })
      );
      if (q.endsAt)
        card.appendChild(
          el('p', {
            class: 'field__hint',
            text:
              'До ' +
              new Date(q.endsAt).toLocaleTimeString('ru-RU') +
              (q.open ? '' : ' · завершён')
          })
        );
      q.questions.forEach((question, index) => {
        const row = el(
          'div',
          { class: 'field' },
          el('h3', { text: `${index + 1}. ${question.text}` })
        );
        question.options.forEach((option, i) => {
          const button = el('button', {
            class:
              'btn btn--block' + (question.answer === i ? ' btn--accent' : ''),
            type: 'button',
            disabled: !q.open || question.answer !== null,
            text: option
          });
          button.addEventListener('click', async () => {
            button.disabled = true;
            const r = await handlers.send('quiz-answer', {
              id: q.id,
              index,
              option: i
            });
            if (!r?.ok) {
              button.disabled = false;
              CC.toast(r?.error || 'Не удалось отправить ответ', {
                kind: 'warning'
              });
            }
          });
          row.appendChild(button);
        });
        if (question.answer !== null)
          row.appendChild(
            el('p', {
              class: 'field__hint',
              text:
                question.answer === question.correct
                  ? 'Верно'
                  : 'Неверно. Правильный ответ: ' +
                    question.options[question.correct]
            })
          );
        card.appendChild(row);
      });
      root.appendChild(card);
    }
    for (const review of state.reviews || []) {
      const score = el(
        'select',
        { class: 'select', 'aria-label': 'Оценка' },
        ...[1, 2, 3, 4, 5].map((n) =>
          el('option', { value: n, text: String(n) })
        )
      );
      score.value = String(review.score || 5);
      const comment = el('textarea', {
        class: 'input',
        maxlength: 1000,
        placeholder: 'Что получилось и что улучшить',
        'aria-label': 'Комментарий проверяющего'
      });
      comment.value =
        reviewDrafts.get(review.id)?.comment ?? review.comment ?? '';
      score.value = String(
        reviewDrafts.get(review.id)?.score ?? review.score ?? 5
      );
      const remember = () =>
        reviewDrafts.set(review.id, {
          comment: comment.value,
          score: score.value
        });
      comment.addEventListener('input', remember);
      score.addEventListener('change', remember);
      const status = el('p', {
        class: 'field__hint',
        role: 'status',
        text: review.score ? 'Проверка отправлена' : ''
      });
      const button = el(
        'button',
        { class: 'btn btn--primary', type: 'button', disabled: !review.open },
        review.open ? 'Отправить проверку' : 'Проверка завершена'
      );
      button.addEventListener('click', async () => {
        button.disabled = true;
        const r = await handlers.send('review-answer', {
          id: review.id,
          score: Number(score.value),
          comment: comment.value
        });
        if (!r?.ok)
          CC.toast(r?.error || 'Не удалось отправить', { kind: 'warning' });
        button.disabled = !review.open;
        status.textContent = r?.ok ? 'Проверка отправлена' : '';
      });
      root.appendChild(
        el(
          'section',
          { class: 'stask' },
          el('h2', { text: 'Взаимопроверка: ' + review.title }),
          el('p', {
            text: 'Проверьте работу одноклассника. Автор и проверяющий скрыты от учеников.'
          }),
          el('a', {
            class: 'btn',
            href: handlers.workUrl(review.url),
            target: '_blank',
            rel: 'noopener',
            text: 'Скачать работу'
          }),
          score,
          comment,
          button,
          status
        )
      );
    }
    for (const f of state.feedback || [])
      root.appendChild(
        el(
          'section',
          { class: 'stask' },
          el('h3', { text: 'Отзыв учителя: ' + f.title }),
          el('p', { text: f.text })
        )
      );
    return root;
  };
})();
