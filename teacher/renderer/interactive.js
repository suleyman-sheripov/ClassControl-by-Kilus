(function () {
  'use strict';
  const { el, icon } = CC;
  const send = CC.interactiveSend;
  CC.createQuiz = function (socket, multiple = false) {
    const title = el('input', {
      class: 'input',
      value: multiple ? 'Мини-контрольная' : 'Тест',
      maxlength: 160,
      'aria-label': 'Название теста'
    });
    const seconds = el('input', {
      class: 'input',
      type: 'number',
      min: 0,
      max: 3600,
      value: 0,
      'aria-label': 'Время в секундах'
    });
    const questions = el('div', { class: 'help-articles' }),
      error = el('p', { class: 'error', role: 'alert' }),
      rows = [];
    function add(q = {}) {
      if (rows.length >= 20) return;
      const text = el('input', {
        class: 'input',
        maxlength: 300,
        placeholder: 'Вопрос',
        'aria-label': 'Вопрос'
      });
      text.value = q.text || '';
      const options = el('textarea', {
        class: 'input',
        placeholder: 'Варианты ответа, каждый с новой строки',
        'aria-label': 'Варианты ответа'
      });
      options.value = (q.options || []).join('\n');
      const correct = el('input', {
        class: 'input',
        type: 'number',
        min: 1,
        max: 8,
        value: (q.correct ?? 0) + 1,
        'aria-label': 'Номер правильного ответа'
      });
      const row = { text, options, correct };
      rows.push(row);
      const card = el(
        'section',
        { class: 'note' },
        el(
          'div',
          null,
          text,
          options,
          el('label', null, 'Номер правильного ответа', correct),
          el(
            'button',
            {
              class: 'btn btn--sm',
              type: 'button',
              onclick: () => {
                rows.splice(rows.indexOf(row), 1);
                card.remove();
              }
            },
            'Убрать вопрос'
          )
        )
      );
      questions.appendChild(card);
    }
    add();
    const payload = () => ({
      title: title.value.trim(),
      seconds: Number(seconds.value),
      questions: rows.map((r) => ({
        text: r.text.value.trim(),
        options: r.options.value
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
        correct: Number(r.correct.value) - 1
      }))
    });
    let templates = [];
    try {
      templates = JSON.parse(localStorage.getItem('cc-quiz-templates') || '[]');
      if (!Array.isArray(templates)) templates = [];
    } catch {}
    const select = el(
      'select',
      { class: 'select', 'aria-label': 'Шаблон' },
      el('option', { value: '', text: 'Загрузить шаблон' }),
      ...templates.map((t, i) => el('option', { value: i, text: t.title }))
    );
    select.addEventListener('change', () => {
      if (select.value === '') return;
      const t = templates[Number(select.value)];
      title.value = t.title;
      rows.length = 0;
      questions.replaceChildren();
      t.questions.forEach(add);
    });
    const save = el(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: () => {
          const data = payload();
          if (!data.title || !data.questions.length) return;
          try {
            templates = templates.filter((t) => t.title !== data.title);
            templates.push({ title: data.title, questions: data.questions });
            localStorage.setItem(
              'cc-quiz-templates',
              JSON.stringify(templates.slice(-20))
            );
            CC.toast('Шаблон сохранён без ответов учеников', {
              kind: 'positive'
            });
          } catch {
            CC.toast('Не удалось сохранить шаблон', { kind: 'warning' });
          }
        }
      },
      'Сохранить шаблон'
    );
    const form = el(
      'form',
      { class: 'field' },
      el('label', null, 'Название', title),
      select,
      questions,
      el(
        'button',
        { class: 'btn', type: 'button', onclick: () => add() },
        '＋ Вопрос'
      ),
      el('label', null, 'Время, секунд (0 — без ограничения)', seconds),
      save,
      error,
      el('button', { class: 'btn btn--primary', type: 'submit' }, 'Начать')
    );
    let close;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await send(socket, 'quiz-create', payload());
      if (r?.ok) close(true);
      else error.textContent = r?.error || 'Не удалось создать тест';
    });
    CC.dialog({
      title: multiple ? 'Мини-контрольная' : 'Тест с правильным ответом',
      body: form,
      wide: true,
      onOpen: (_, done) => {
        close = done;
      }
    });
  };
  CC.createReview = function (socket, collections) {
    const eligible = collections.filter((c) => c.submissions?.length >= 2);
    if (!eligible.length) {
      CC.toast('Сначала соберите минимум две работы', { kind: 'warning' });
      return;
    }
    const select = el(
      'select',
      { class: 'select' },
      ...eligible.map((c) => el('option', { value: c.id, text: c.title }))
    );
    CC.dialog({
      title: 'Взаимопроверка',
      sub: 'Работы распределятся без имён, каждый получит чужую. Сбор работ будет закрыт. Не включайте имена в содержимое файлов: программа скрывает только имя автора и имя файла.',
      body: select,
      actions: [
        { label: 'Отмена', value: false },
        { label: 'Раздать на проверку', value: true, kind: 'primary' }
      ]
    }).then(async (ok) => {
      if (ok) {
        const r = await send(socket, 'review-create', {
          collectionId: select.value
        });
        if (!r?.ok)
          CC.toast(r?.error || 'Не удалось начать проверку', {
            kind: 'warning'
          });
      }
    });
  };
  CC.teacherInteractive = function (socket, { collections, onChange }) {
    const root = document.getElementById('interactive-extra'),
      drafts = new Map();
    socket.on('activity', () => socket.emit('interactive-sync'));
    socket.on('interactive-update', (state) => {
      onChange(state);
      root.replaceChildren();
      for (const quiz of state.quizzes) {
        const results = quiz.results || [],
          rows = quiz.questions.map((q, i) => {
            const answered = results.filter((r) => r.answers[i] !== undefined),
              correct = answered.filter((r) => r.answers[i] === q.correct);
            return el('p', {
              text: `${i + 1}. ${q.text}: верно ${correct.length}/${answered.length}${answered.length ? ' (' + Math.round((correct.length / answered.length) * 100) + '%)' : ''}`
            });
          });
        root.appendChild(
          el(
            'article',
            { class: 'task' },
            el('h3', {
              text: quiz.title + (quiz.open ? ' · идёт' : ' · завершён')
            }),
            ...rows,
            ...results.map((r) =>
              el('p', {
                text: `${r.name}: ${r.score}/${quiz.questions.length}`
              })
            ),
            quiz.open
              ? el(
                  'button',
                  {
                    class: 'btn',
                    onclick: () => socket.emit('quiz-close', { id: quiz.id })
                  },
                  'Завершить тест'
                )
              : null
          )
        );
      }
      for (const review of state.reviews)
        root.appendChild(
          el(
            'article',
            { class: 'task' },
            el('h3', { text: 'Взаимопроверка: ' + review.title }),
            ...review.assignments.map((a) =>
              el('p', {
                text: `${a.reviewer} → ${a.author}: ${a.score ?? 'ещё не проверено'}${a.comment ? ' — ' + a.comment : ''}`
              })
            ),
            review.open
              ? el(
                  'button',
                  {
                    class: 'btn',
                    onclick: () =>
                      socket.emit('review-close', { id: review.id })
                  },
                  'Завершить'
                )
              : null
          )
        );
      for (const [id, receipts] of Object.entries(state.receipts || {}))
        root.appendChild(
          el(
            'article',
            { class: 'task' },
            el('h3', {
              text: 'Доставка: ' + (state.deliveryNames?.[id] || 'материалов')
            }),
            ...Object.values(receipts).map((r) =>
              el('p', {
                text: `${r.name}: ${r.opened ? 'открыл' : r.received ? 'получил' : 'ожидает'}`
              })
            )
          )
        );
      for (const c of collections())
        if (c.submissions?.length)
          root.appendChild(
            el(
              'article',
              { class: 'task' },
              el('h3', { text: 'Отзывы: ' + c.title }),
              ...c.submissions.map((sub) => {
                const input = el('textarea', {
                  class: 'input',
                  maxlength: 1000,
                  placeholder: 'Отзыв к работе ' + sub.name,
                  'aria-label': 'Отзыв к работе ' + sub.name
                });
                const key = c.id + ':' + sub.name;
                input.value = drafts.get(key) || '';
                input.addEventListener('input', () =>
                  drafts.set(key, input.value)
                );
                return el(
                  'div',
                  { class: 'field' },
                  el('strong', { text: sub.name }),
                  input,
                  el(
                    'button',
                    {
                      class: 'btn',
                      onclick: async () => {
                        const r = await send(socket, 'work-feedback', {
                          collectionId: c.id,
                          name: sub.name,
                          text: input.value
                        });
                        CC.toast(
                          r?.ok ? 'Отзыв отправлен' : r?.error || 'Ошибка',
                          { kind: r?.ok ? 'positive' : 'warning' }
                        );
                      }
                    },
                    'Отправить отзыв'
                  )
                );
              })
            )
          );
    });
    socket.on('connect', () => {});
  };
})();
