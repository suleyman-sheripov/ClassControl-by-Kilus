# ClassControl — Список задач

> **Полное ТЗ:** `TZ.md` (обязательно прочитай перед началом работы)
> **Обзорный план:** `.agent/workflows/classcontrol-implementation.md`

Выполняй задачи **строго по порядку**. Не начинай следующую, пока не пройдена проверка (✅) текущей.

## Порядок выполнения

| # | Файл | Что делаем | Зависит от |
|---|------|-----------|------------|
| 0 | `tasks/task-00-restructure.md` | Реструктуризация папок проекта | — |
| 1 | `tasks/task-01-server.md` | Сервер: Express + Socket.IO + UDP | task-00 |
| 2 | `tasks/task-02-teacher-electron.md` | Electron-оболочка учителя | task-01 |
| 3 | `tasks/task-03-teacher-ui.md` | HTML + CSS учителя | task-02 |
| 4 | `tasks/task-04-teacher-logic.md` | Логика: мониторинг, табы, доска | task-03 |
| 5 | `tasks/task-05-teacher-broadcast-chat.md` | Логика: демонстрация, чат | task-04 |
| 6 | `tasks/task-06-agent-core.md` | Агент: трей, автозапуск, LAN | task-01 |
| 7 | `tasks/task-07-agent-renderer.md` | Агент: скриншоты, чат, демо | task-06 |
| 8 | `tasks/task-08-online-participant.md` | Онлайн-участник (браузер) | task-01 |
| 9 | `tasks/task-09-recording.md` | Запись экрана учителя | task-05 |
| 10 | `tasks/task-10-build.md` | Сборка .exe (electron-builder) | все |

## Правила

1. **Читай ТЗ** (`TZ.md`) перед первой задачей — это источник истины.
2. **Одна задача за раз.** Не пропускай и не объединяй задачи.
3. **Проверяй.** В конце каждой задачи есть чеклист — пройди все пункты.
4. **Не ломай чужое.** Если задача говорит «не трогай agent/» — не трогай.
5. **Используй `cmd /c npm ...`** на Windows, чтобы обойти ограничения PowerShell.
