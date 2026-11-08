const { _electron } = require('playwright');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const binary = (dir) => require(path.join(root, dir, 'node_modules/electron'));
(async () => {
  let t, a;
  const profile = fs.mkdtempSync(
    path.join(require('node:os').tmpdir(), 'classcontrol-qa-')
  );
  const errors = [];
  try {
    const env = {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ':99',
      XDG_CONFIG_HOME: profile,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || path.join(profile, 'cache')
    };
    fs.mkdirSync(path.join(profile, 'classcontrol-teacher'), {
      recursive: true
    });
    fs.writeFileSync(
      path.join(profile, 'classcontrol-teacher/teacher-settings.json'),
      JSON.stringify({ onboarded: true, roomName: 'QA' })
    );
    t = await _electron.launch({
      executablePath: binary('teacher'),
      args: ['--no-sandbox', root + '/teacher'],
      env: {
        ...env,
        CLASSCONTROL_PROFILE: path.join(profile, 'classcontrol-teacher')
      },
      timeout: 20000
    });
    const p = await t.firstWindow();
    p.on('pageerror', (e) => errors.push('Teacher: ' + e.message));
    const boot = await p.evaluate(() => window.teacherAPI.boot());
    assert.ok(boot.port);
    fs.mkdirSync(path.join(profile, 'classcontrol-agent'), { recursive: true });
    fs.writeFileSync(
      path.join(profile, 'classcontrol-agent/agent-settings.json'),
      JSON.stringify({
        serverMode: 'manual',
        serverAddress: 'http://127.0.0.1:' + boot.port,
        autoStart: false
      })
    );
    await p
      .getByPlaceholder('Например: Анна Петровна')
      .waitFor({ state: 'visible', timeout: 15000 });
    {
      await p.getByPlaceholder('Например: Анна Петровна').fill('QA');
      await p.getByRole('button', { name: 'Начать урок', exact: true }).click();
    }
    a = await _electron.launch({
      executablePath: binary('agent'),
      args: ['--no-sandbox', root + '/agent'],
      env: {
        ...env,
        CLASSCONTROL_PROFILE: path.join(profile, 'classcontrol-agent'),
        CLASSCONTROL_AGENT_LOCAL: '1'
      },
      timeout: 20000
    });
    const hidden = await a.firstWindow();
    hidden.on('pageerror', (e) => errors.push('Agent: ' + e.message));
    await hidden.waitForFunction(
      () => window.agentAPI.info().then((i) => i.connected),
      {},
      { timeout: 20000 }
    );
    await p.waitForSelector('#pc-grid .pc');
    await p.waitForFunction(() =>
      document.querySelector('#pc-grid img')?.src.startsWith('blob:')
    );
    console.log(
      'PASS: trusted agent connected; teacher receives monitoring screenshots'
    );
    for (let i = 0; i < 3; i++) {
      await p.locator('#pc-grid .pc__go').first().click();
      await p.waitForFunction(
        () => document.getElementById('viewer-video').videoWidth > 0,
        {},
        { timeout: 25000 }
      );
      await p.locator('#viewer-wait').waitFor({ state: 'hidden' });
      console.log('PASS: remote video attempt ' + (i + 1));
      await p.locator('#viewer-close').click();
      await p.locator('#viewer').waitFor({ state: 'hidden' });
    }

    const cardLock = p.locator('#pc-grid [data-lock]').first();
    await cardLock.click();
    await p.waitForFunction(
      () =>
        document.querySelector('#pc-grid [data-lock]').title ===
        'Разблокировать'
    );
    await cardLock.click();
    await p.waitForFunction(
      () =>
        document.querySelector('#pc-grid [data-lock]').title === 'Заблокировать'
    );
    console.log('PASS: lock/unlock round trip updates the card action');
    const material = path.join(profile, 'qa-material.txt');
    fs.writeFileSync(material, 'qa-material');
    const messageOpened = a.waitForEvent('window');
    await p.locator('#assign-file').setInputFiles(material);
    const message = await messageOpened;
    await message.locator('#folder').waitFor({ state: 'visible' });
    await message.locator('#open').waitFor({ state: 'visible' });
    await p.waitForFunction(() =>
      document
        .getElementById('interactive-extra')
        .textContent.includes('получил')
    );
    assert.equal(
      fs.readFileSync(
        path.join(
          profile,
          'classcontrol-agent/test-desktop/От учителя/qa-material.txt'
        ),
        'utf8'
      ),
      'qa-material'
    );
    console.log(
      'PASS: signed material downloaded, checksum verified, delivery acknowledged, file/folder actions visible'
    );
    await p.evaluate(() => {
      window.__rtc = [];
      const Original = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Original {
        constructor(...args) {
          super(...args);
          window.__rtc.push(this);
        }
      };
    });
    await p.locator('#studio-more').click();
    await p.locator('#opt-audio').uncheck();
    await p.locator('#quality').selectOption('1280x720');
    const observations = [];
    for (const fps of ['10', '30']) {
      await p.locator('#fps').selectOption(fps);
      const opened = a.waitForEvent('window');
      await p.locator('#broadcast-btn').click();
      const demo = await opened;
      await demo.waitForFunction(
        () => document.getElementById('video')?.videoWidth > 0,
        {},
        { timeout: 25000 }
      );
      const observation = await p.evaluate(() => {
        const sender = window.__rtc
          .flatMap((pc) => pc.getSenders())
          .find(
            (s) => s.track?.kind === 'video' && s.track.readyState === 'live'
          );
        return {
          settings: sender.track.getSettings(),
          hint: sender.track.contentHint,
          bitrate: sender.getParameters().encodings[0].maxBitrate
        };
      });
      observations.push(observation);
      await p.locator('#broadcast-btn').click();
      if (!demo.isClosed()) await demo.waitForEvent('close');
    }
    assert.equal(
      observations[0].settings.width,
      observations[1].settings.width
    );
    assert.equal(
      observations[0].settings.height,
      observations[1].settings.height
    );
    assert.equal(observations[0].hint, 'detail');
    assert.equal(observations[1].hint, 'detail');
    assert.ok(observations[1].bitrate >= observations[0].bitrate * 2.9);
    console.log(
      'PASS: 10 vs 30 FPS keep resolution/detail mode; sender bitrate scales threefold; agent receives both broadcasts'
    );
    assert.deepEqual(errors, []);
  } finally {
    if (a) await a.close();
    if (t) {
      await t.evaluate(({ app }) => {
        app.isQuitting = true;
      });
      await t.close();
    }
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e.message.replace(/token=[^\s&]+/g, 'token=[REDACTED]'));
  process.exitCode = 1;
});
