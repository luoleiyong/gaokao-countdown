'use strict';
/* 测试版命令执行器：控制面板在独立窗口 testpanel.html，
   通过主进程转发 test:action 到这里执行。 */
(function () {
  const $ = (id) => document.getElementById(id);
  let started = false;

  function isTestBuild() {
    const label = $('versionLabel');
    return (label && /-test/i.test(label.textContent)) ||
      /[?&]test=1/.test(location.search) ||
      (function () { try { return localStorage.getItem('gk-test') === '1'; } catch (e) { return false; } })();
  }

  function ok(msg) {
    try { toast(msg); } catch (e) { console.log('[test]', msg); }
  }

  function ensurePet(cb) {
    if (document.body.getAttribute('data-mode') === 'pet') { cb(); return; }
    Promise.resolve(bridge.setPetMode(true)).then(() => setTimeout(cb, 900)).catch(() => ok('进入宠物模式失败'));
  }

  function waitFor(cond, timeout, cb) {
    const start = Date.now();
    const timer = setInterval(() => {
      if (cond()) { clearInterval(timer); cb(true); return; }
      if (Date.now() - start > timeout) { clearInterval(timer); cb(false); }
    }, 150);
  }

  function runAction(key) {
    ensurePet(() => {
      const wrap = $('petFish');
      if (!wrap) return;
      fishStopAction(false);
      fishStopHwFrames();
      wrap.dataset.mode = 'homework';
      wrap.dataset.action = 'off';
      if (!fishState.hwReady) fishLoadHwFrames();
      waitFor(() => fishState.hwReady, 12000, (ready) => {
        if (!ready) { ok('写作业帧仍在加载，请稍后再试'); return; }
        fishStartHwFrames();
        const meta = (typeof HOMEWORK_ACTIONS !== 'undefined') ? HOMEWORK_ACTIONS.find((a) => a.key === key) : null;
        const line = meta && meta.lines && meta.lines[0];
        if (line) fishSay(line);
        setTimeout(() => {
          if (!fishState.hwAction && !fishState.hwActionLoading) fishLoadHomeworkAction(key);
          ok('触发动作：' + key);
        }, 1200);
      });
    });
  }

  function playIdleClip(id) {
    ensurePet(() => {
      const video = $(id);
      if (!video) { ok('待机素材未加载'); return; }
      fishStopAction(false);
      const played = fishPlayClip(video, 'idle');
      if (played) {
        fishSay(fishPickLine(FISH_IDLE_LINES));
        ok('触发待机动作');
      } else {
        ok('动作正在播放，请稍后');
      }
    });
  }

  function touch(part) {
    ensurePet(() => {
      const el = document.querySelector('.pet-fish__hit--' + part);
      if (el) el.click();
    });
  }

  function fakeUpdateInfo() {
    state.updateInfo = {
      ok: true,
      hasUpdate: true,
      current: '2.0.7',
      latest: '2.1.0-test',
      url: 'https://github.com/luoleiyong/gaokao-countdown/releases/latest',
      notes: ['新增测试面板，一键触发全部功能与彩蛋', '桌宠支持更多互动动作', '修复了一些已知问题']
    };
  }

  function run(action) {
    if (!action) return;
    if (action.startsWith('act:')) { runAction(action.slice(4)); return; }
    if (action.startsWith('clip:')) { playIdleClip(action.slice(5)); return; }
    if (action.startsWith('touch:')) { touch(action.slice(6)); return; }
    if (action.startsWith('freq:')) {
      const btn = document.querySelector('#petFreqGrid [data-freq="' + action.slice(5) + '"]');
      if (btn) btn.click(); else ok('频率按钮未找到');
      return;
    }
    if (action.startsWith('skin:')) {
      const id = action.slice(5);
      state.skin = id;
      applySkin(id);
      renderSkinGrid();
      bridge.saveSettings({ skin: id }).then(() => ok('已切换皮肤')).catch(() => {});
      return;
    }
    if (action.startsWith('ms:')) {
      const days = Number(action.slice(3));
      showMilestoneEgg(days, true);
      ok('已触发倒计时 ' + days + ' 天彩蛋');
      return;
    }
    switch (action) {
      case 'draw':
        startDrawFlow(true);
        setTimeout(() => shakeDraw(), 320);
        break;
      case 'firstdraw':
        state.debugPreview = false;
        showFirstDraw(true);
        break;
      case 'debugdraw':
        state.debugPreview = true;
        showFirstDraw(true);
        break;
      case 'term':
        openTermModal(true);
        break;
      case 'weather':
        openWeatherDetail();
        if ($('weatherModal').hidden) ok('天气数据未加载');
        break;
      case 'events':
        openEventsModal();
        break;
      case 'savecard': {
        const entry = todayEntry() || state.currentEntry || {
          date: state.today, daysLeft: calc().days, no: 153, level: '上上签',
          poem: '云开见月，水到渠成。', wish: '把今天这一页认真写完。', tag: '学业', ts: Date.now()
        };
        exportSignCard(entry);
        break;
      }
      case 'history':
        state.historyExpanded = true;
        renderHistory();
        ok('已展开签运簿');
        break;
      case 'egg':
        try {
          Object.keys(localStorage).filter((k) => k.indexOf('gk-all-signs-') === 0).forEach((k) => localStorage.removeItem(k));
        } catch (e) { /* 忽略 */ }
        maybeAllSignsEgg(0);
        ok('已触发高考当天全签彩蛋');
        break;
      case 'pet':
        bridge.setPetMode(true);
        break;
      case 'panel':
        bridge.setPetMode(false);
        break;
      case 'petmenu':
        ensurePet(() => openPetMenu(Math.max(10, window.innerWidth - 260), 80));
        break;
      case 'timetable':
        bridge.openTimetable();
        break;
      case 'classroom':
        bridge.openClassroom();
        break;
      case 'knowledge':
        bridge.openKnowledge();
        break;
      case 'admin':
        bridge.openClassroomAdmin();
        ok('首次进入需设置管理员密码（至少 4 位）');
        break;
      case 'debugtrigger':
        Promise.resolve(bridge.adminTriggerDraw()).then((r) => {
          ok(r && r.ok ? '已触发课堂调试抽签，请查看主界面' : ((r && r.error) || '请先进入管理员模式'));
        }).catch(() => ok('触发失败'));
        break;
      case 'settings':
        openSettings();
        break;
      case 'updatenotes':
        fakeUpdateInfo();
        showUpdateNotes();
        break;
      case 'updateready':
        state.updateDownload = { phase: 'ready', percent: 100, filePath: 'C:\\Temp\\GaokaoCountdown-Setup-2.1.0-test.exe', version: '2.1.0-test' };
        showUpdateReadyDialog();
        break;
      case 'checkupdate':
        ok('正在检查更新…');
        Promise.resolve(checkUpdates(false)).then(() => ok('检查完成')).catch(() => ok('检查失败'));
        break;
      case 'closeall':
        ['drawModal', 'firstDraw', 'egg', 'msEgg', 'termModal', 'weatherModal', 'eventsModal', 'updateNotesModal', 'updateReadyModal', 'settings', 'agreementModal'].forEach((id) => {
          const el = $(id);
          if (!el) return;
          el.hidden = true;
          el.classList.remove('show');
        });
        msEggStopFx();
        msEggStage = 'idle';
        (function () {
          const v = $('msEggVideo');
          if (v) { try { v.pause(); } catch (e) { /* 忽略 */ } }
          const egg = $('msEgg');
          if (egg) egg.removeAttribute('data-video');
        })();
        closePetMenu();
        ok('已关闭所有弹窗');
        break;
      case 'resetegg':
        try {
          Object.keys(localStorage).filter((k) => k.indexOf('gk-all-signs-') === 0 || k.indexOf('gk-milestone-') === 0).forEach((k) => localStorage.removeItem(k));
          ok('彩蛋记录已重置');
        } catch (e) { ok('重置失败'); }
        break;
      case 'openfolder':
        ok('数据目录：' + '%APPDATA%\\GaokaoCountdown');
        break;
      case 'showmain':
        bridge.testRun('showmain');
        break;
      default:
        break;
    }
  }

  const KEY_ACTIONS = {
    '1': 'stretch', '2': 'water', '3': 'eyes', '4': 'think', '5': 'ponder',
    '6': 'snack', '7': 'hungry', '8': 'crave', '9': 'tidy', '0': 'window', '-': 'cheer'
  };

  function start() {
    if (started) return;
    started = true;
    if (bridge.onTestAction) bridge.onTestAction((action) => run(action));

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        Promise.resolve(bridge.openTestPanel()).catch(() => {});
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target.tagName || '').toUpperCase())) return;
      if (document.body.getAttribute('data-mode') !== 'pet') return;
      const key = e.key.toLowerCase();
      if (KEY_ACTIONS[key]) {
        e.preventDefault();
        runAction(KEY_ACTIONS[key]);
      } else if (key === 'i') {
        e.preventDefault();
        playIdleClip('petFishStretch');
      } else if (key === 'h') {
        e.preventDefault(); touch('head');
      } else if (key === 'b') {
        e.preventDefault(); touch('body');
      } else if (key === 't') {
        e.preventDefault(); touch('tail');
      } else if (key === 'p') {
        e.preventDefault(); bridge.setPetMode(false);
      } else if (key === 'm') {
        e.preventDefault(); ensurePet(() => openPetMenu(Math.max(10, window.innerWidth - 260), 80));
      }
    });
    ok('测试面板已启用：Ctrl+Shift+T 打开独立面板');
  }

  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (isTestBuild()) { clearInterval(timer); start(); }
    else if (tries > 30) clearInterval(timer);
  }, 300);
})();
