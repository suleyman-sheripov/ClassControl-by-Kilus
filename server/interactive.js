'use strict';
const crypto = require('node:crypto');
const path = require('node:path');

/** Lesson-scoped quizzes, anonymous peer review and delivery receipts. */
module.exports = function attachInteractive({
  io,
  app,
  state,
  identity,
  allow,
  cleanText,
  worksDir,
  persist
}) {
  const text = (value, max) =>
    cleanText(typeof value === 'string' ? value : '', max);
  const blank = () => ({
    quizzes: [],
    reviews: [],
    receipts: {},
    feedback: {}
  });
  if (!state.interactive) state.interactive = blank();
  const timers = new Map();
  const id = () => crypto.randomBytes(8).toString('hex');
  const who = (socket) => {
    const person = identity(socket);
    return person && { ...person, key: socket.data.key };
  };
  const teacher = (socket) => socket.data.role === 'teacher';

  function view(socket) {
    const person = who(socket),
      full = teacher(socket),
      db = state.interactive;
    if (!person) return null;
    return {
      quizzes: db.quizzes
        .filter((q) => full || q.open || q.answers[person.key])
        .map((q) => ({
          id: q.id,
          title: q.title,
          open: q.open,
          endsAt: q.endsAt,
          questions: q.questions.map((question, index) => {
            const answer = q.answers[person.key]?.answers[index];
            return {
              text: question.text,
              options: question.options,
              answer: answer ?? null,
              correct:
                full || answer !== undefined || !q.open
                  ? question.correct
                  : undefined
            };
          }),
          results: full
            ? Object.values(q.answers).map((a) => ({
                name: a.name,
                answers: a.answers,
                score: q.questions.filter(
                  (question, i) => a.answers[i] === question.correct
                ).length
              }))
            : undefined
        })),
      reviews: db.reviews
        .map((r) => {
          if (full)
            return {
              id: r.id,
              title: r.title,
              open: r.open,
              assignments: r.assignments.map((a) => ({
                reviewer: a.reviewerName,
                author: a.authorName,
                score: a.score,
                comment: a.comment
              }))
            };
          const assignment = r.assignments.find(
            (a) => a.reviewer === person.key
          );
          if (!assignment) return null;
          return {
            id: r.id,
            title: r.title,
            open: r.open,
            url: `/peer-work/${r.id}/${assignment.token}`,
            score: assignment.score,
            comment: assignment.comment
          };
        })
        .filter(Boolean),
      deliveryNames: full
        ? Object.fromEntries(state.assignments.map((a) => [a.id, a.filename]))
        : undefined,
      receipts: full
        ? Object.fromEntries(
            state.assignments.map((a) => {
              const receipts = { ...(db.receipts[a.id] || {}) };
              for (const student of state.agents.values()) {
                const socket = io.sockets.sockets.get(student.id);
                const key = socket?.data.key;
                if (key && !receipts[key])
                  receipts[key] = { name: student.student || student.name };
              }
              return [a.id, receipts];
            })
          )
        : undefined,
      feedback: full
        ? db.feedback
        : Object.entries(db.feedback)
            .filter(([key]) => key.endsWith(':' + person.key))
            .map(([, value]) => value)
    };
  }
  function sync(socket) {
    const data = view(socket);
    if (data) socket.emit('interactive-update', data);
  }
  function broadcast() {
    for (const socket of io.sockets.sockets.values()) sync(socket);
    persist();
  }
  function closeQuiz(q) {
    q.open = false;
    clearTimeout(timers.get(q.id));
    timers.delete(q.id);
    broadcast();
  }

  io.on('connection', (socket) => {
    socket.on('interactive-sync', () => {
      if (allow('interactive-sync:' + socket.id, 30, 60000)) sync(socket);
    });
    socket.on('quiz-create', (data = {}, ack = () => {}) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!data || typeof data !== 'object')
        return ack({ ok: false, error: 'Неверные данные' });
      if (!teacher(socket)) return ack({ ok: false, error: 'Только учитель' });
      if (state.interactive.quizzes.length >= 30)
        return ack({ ok: false, error: 'Не больше 30 тестов за урок' });
      if (
        !Array.isArray(data.questions) ||
        data.questions.length > 20 ||
        data.questions.some((q) => !q || typeof q !== 'object')
      )
        return ack({ ok: false, error: 'Нужно от 1 до 20 вопросов' });
      const questions = (Array.isArray(data.questions) ? data.questions : [])
        .slice(0, 20)
        .map((q) => ({
          text: text(q.text, 300),
          options: (Array.isArray(q.options) ? q.options : [])
            .slice(0, 8)
            .map((x) => text(x, 120)),
          correct: q.correct
        }));
      if (
        !questions.length ||
        questions.some(
          (q) =>
            !q.text ||
            q.options.length < 2 ||
            q.options.some((x) => !x) ||
            !Number.isInteger(q.correct) ||
            q.correct < 0 ||
            q.correct >= q.options.length
        )
      )
        return ack({
          ok: false,
          error: 'Заполните вопросы, варианты и правильные ответы'
        });
      const seconds = Math.max(0, Math.min(3600, Number(data.seconds) || 0));
      const quiz = {
        id: id(),
        title: text(data.title, 160) || 'Тест',
        questions,
        open: true,
        endsAt: seconds ? Date.now() + seconds * 1000 : null,
        answers: {}
      };
      state.interactive.quizzes.push(quiz);
      if (seconds)
        timers.set(
          quiz.id,
          setTimeout(() => closeQuiz(quiz), seconds * 1000).unref()
        );
      ack({ ok: true, id: quiz.id });
      broadcast();
    });
    socket.on('quiz-answer', (data = {}, ack = () => {}) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!data || typeof data !== 'object')
        return ack({ ok: false, error: 'Неверные данные' });
      const person = who(socket),
        q = state.interactive.quizzes.find((q) => q.id === data.id);
      if (
        !person ||
        person.role === 'teacher' ||
        !person.key ||
        !q?.open ||
        (q.endsAt && Date.now() >= q.endsAt)
      )
        return ack({ ok: false, error: 'Тест завершён' });
      if (!allow('quiz:' + person.key, 100, 60000))
        return ack({ ok: false, error: 'Слишком часто' });
      if (
        !Number.isInteger(data.index) ||
        data.index < 0 ||
        data.index >= q.questions.length
      )
        return ack({ ok: false, error: 'Неверный вопрос' });
      const question = q.questions[data.index];
      if (
        !question ||
        !Number.isInteger(data.option) ||
        data.option < 0 ||
        data.option >= question.options.length
      )
        return ack({ ok: false, error: 'Неверный вариант' });
      const answer = (q.answers[person.key] ||= {
        name: person.name,
        answers: {}
      });
      // First answer is final, otherwise instant correctness feedback allows guessing.
      if (answer.answers[data.index] === undefined)
        answer.answers[data.index] = data.option;
      ack({
        ok: true,
        correct: question.correct,
        answer: answer.answers[data.index]
      });
      broadcast();
    });
    socket.on('quiz-close', (data) => {
      if (teacher(socket)) {
        const q = state.interactive.quizzes.find((q) => q.id === data?.id);
        if (q) closeQuiz(q);
      }
    });
    socket.on('review-create', (data = {}, ack = () => {}) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!data || typeof data !== 'object')
        return ack({ ok: false, error: 'Неверные данные' });
      if (!teacher(socket)) return ack({ ok: false, error: 'Только учитель' });
      const collection = state.collections.find(
        (c) => c.id === data.collectionId
      );
      if (!collection || collection.submissions.length < 2)
        return ack({ ok: false, error: 'Нужны минимум две сданные работы' });
      if (state.interactive.reviews.length >= 20)
        return ack({ ok: false, error: 'Слишком много взаимопроверок' });
      const submissions = collection.submissions.slice();
      // Shuffle, then rotate: no one ever receives their own work.
      for (let i = submissions.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [submissions[i], submissions[j]] = [submissions[j], submissions[i]];
      }
      const review = {
        id: id(),
        title: text(data.title, 160) || collection.title,
        open: true,
        assignments: submissions.map((reviewer, i) => {
          const author = submissions[(i + 1) % submissions.length];
          return {
            reviewer: reviewer.key,
            reviewerName: reviewer.name,
            author: author.key,
            authorName: author.name,
            collectionId: collection.id,
            stored: author.stored,
            token: id(),
            score: null,
            comment: ''
          };
        })
      };
      // Freeze files: replacing a submission must not change a work already under review.
      collection.open = false;
      io.emit('collect-closed', { id: collection.id });
      state.interactive.reviews.push(review);
      ack({ ok: true, id: review.id });
      broadcast();
    });
    socket.on('review-answer', (data = {}, ack = () => {}) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!data || typeof data !== 'object')
        return ack({ ok: false, error: 'Неверные данные' });
      const person = who(socket),
        review = state.interactive.reviews.find((r) => r.id === data.id),
        assignment = review?.assignments.find(
          (a) => a.reviewer === person?.key
        );
      if (
        !assignment ||
        !review.open ||
        !Number.isInteger(data.score) ||
        data.score < 1 ||
        data.score > 5
      )
        return ack({ ok: false, error: 'Проверка закрыта или оценка неверна' });
      assignment.score = data.score;
      assignment.comment = text(data.comment, 1000);
      ack({ ok: true });
      broadcast();
    });
    socket.on('review-close', (data) => {
      if (teacher(socket)) {
        const r = state.interactive.reviews.find((r) => r.id === data?.id);
        if (r) {
          r.open = false;
          broadcast();
        }
      }
    });
    socket.on('assignment-receipt', (data) => {
      const person = who(socket);
      if (
        !person ||
        person.role !== 'agent' ||
        !person.key ||
        !state.assignments.some((a) => a.id === data?.id) ||
        !['received', 'opened'].includes(data.status)
      )
        return;
      const receipt = (state.interactive.receipts[data.id] ||= {});
      const old = (receipt[person.key] ||= { name: person.name });
      old[data.status] = Date.now();
      broadcast();
    });
    socket.on('work-feedback', (data = {}, ack = () => {}) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!data || typeof data !== 'object')
        return ack({ ok: false, error: 'Неверные данные' });
      if (!teacher(socket)) return ack({ ok: false });
      const c = state.collections.find((c) => c.id === data.collectionId),
        sub = c?.submissions.find((s) => s.name === data.name);
      if (!sub) return ack({ ok: false, error: 'Работа не найдена' });
      state.interactive.feedback[c.id + ':' + sub.key] = {
        collectionId: c.id,
        title: c.title,
        text: text(data.text, 1000)
      };
      ack({ ok: true });
      broadcast();
    });
  });
  app.get('/peer-work/:review/:token', (req, res) => {
    const socket = io.sockets.sockets.get(String(req.query.socketId || ''));
    if (!socket || socket.data.uploadToken !== req.query.token)
      return res.sendStatus(403);
    const person = who(socket),
      r = state.interactive.reviews.find((r) => r.id === req.params.review);
    const a = r?.assignments.find(
      (a) => a.token === req.params.token && a.reviewer === person?.key
    );
    if (!a) return res.sendStatus(404);
    // Original filename and author are intentionally absent from headers/UI.
    const file = path.join(worksDir, a.collectionId, a.stored);
    res.download(file, 'Работа' + path.extname(a.stored));
  });
  return {
    sync,
    broadcast,
    snapshot: () => JSON.parse(JSON.stringify(state.interactive)),
    reset() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      state.interactive = blank();
      broadcast();
    },
    restore(data) {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      state.interactive = data || blank();
      for (const q of state.interactive.quizzes) {
        if (q.open && q.endsAt) {
          if (q.endsAt <= Date.now()) q.open = false;
          else
            timers.set(
              q.id,
              setTimeout(() => closeQuiz(q), q.endsAt - Date.now()).unref()
            );
        }
      }
      broadcast();
    },
    close() {
      for (const timer of timers.values()) clearTimeout(timer);
    }
  };
};
