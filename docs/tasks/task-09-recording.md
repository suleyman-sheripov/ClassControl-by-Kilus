# Задача 9: Запись экрана учителя

> **Контекст:** Читай `TZ.md` (раздел 7.6). Учительское приложение работает (task-02…05).
> **Рабочие файлы:** `teacher/renderer/script.js` (дописываем), `teacher/main.js` (IPC)

## Цель
Реализовать кнопку «🔴 Запись» в заголовке учительского приложения. Запись захватывает окно самого приложения ClassControl (не весь экран), включая микрофон.

## Принцип работы
1. Через Electron `desktopCapturer` получить источник — окно приложения «ClassControl — Учитель».
2. Через `getUserMedia` с constraintom `chromeMediaSourceId` получить видео+аудио поток.
3. `MediaRecorder` записывает поток в `.webm`.
4. При остановке — сохранить файл через download или IPC.

## Добавить в `teacher/renderer/script.js`:

```javascript
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordTimer = null;
let recordSeconds = 0;

const recordBtn = document.getElementById('recordBtn');
const recordTimerEl = document.getElementById('record-timer');

recordBtn.addEventListener('click', async () => {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
});

async function startRecording() {
  try {
    // Получить список окон через preload
    const sources = await window.electronAPI.getSources();
    // Найти окно приложения учителя
    const appSource = sources.find(s => s.name.includes('ClassControl'));
    if (!appSource) {
      alert('Не удалось найти окно приложения для записи');
      return;
    }

    // Захватить видео окна приложения
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop'
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: appSource.id,
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: 30
        }
      }
    });

    // Добавить микрофон
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      // Системный звук
      if (stream.getAudioTracks().length > 0) {
        audioCtx.createMediaStreamSource(stream).connect(dest);
      }
      // Микрофон
      audioCtx.createMediaStreamSource(micStream).connect(dest);
      // Заменить аудио-трек
      const combinedStream = new MediaStream([
        ...stream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);
      stream = combinedStream;
    } catch (micErr) {
      console.warn('Микрофон недоступен, записываем без него:', micErr);
    }

    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      // Автоматически скачать файл
      const a = document.createElement('a');
      const now = new Date();
      const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `запись_${dateStr}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    };

    mediaRecorder.start(1000); // chunk каждую секунду
    isRecording = true;

    // UI
    recordBtn.textContent = '⏹ Стоп';
    recordBtn.style.color = '#ef4444';
    recordTimerEl.classList.remove('hidden');
    recordSeconds = 0;
    recordTimer = setInterval(() => {
      recordSeconds++;
      const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
      const s = String(recordSeconds % 60).padStart(2, '0');
      recordTimerEl.textContent = `${m}:${s}`;
    }, 1000);

  } catch (err) {
    console.error('Ошибка начала записи:', err);
    alert('Не удалось начать запись: ' + err.message);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    // Остановить все треки
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  isRecording = false;
  recordBtn.textContent = '🔴 Запись';
  recordBtn.style.color = '';
  recordTimerEl.classList.add('hidden');
  clearInterval(recordTimer);
}
```

## Обновить `teacher/main.js`:

Убедись, что в `BrowserWindow` включён доступ к `desktopCapturer`. В Electron 28+ нужно:
```javascript
// В webPreferences главного окна:
{
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false
}
```
`desktopCapturer` уже доступен через IPC handler `get-sources` (сделан в task-02).

## ✅ Проверка завершения
- [ ] Кнопка «🔴 Запись» нажимается, начинается запись.
- [ ] Рядом с кнопкой появляется таймер (00:00 → 00:01 → ...).
- [ ] При повторном нажатии запись останавливается.
- [ ] Файл `.webm` автоматически скачивается.
- [ ] При воспроизведении файла видно содержимое окна приложения.
- [ ] Переключение вкладок (Мониторинг ↔ Доска) видно в записи.
