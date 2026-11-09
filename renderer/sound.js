/* 抽签音效 · WebAudio 合成（风铃 / 签筒摇动），无需音频素材 */
window.GkSound = (function () {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function unlock() {
    getCtx();
  }

  function tone(at, freq, vol, dur) {
    const c = getCtx();
    if (!c) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.06);
  }

  /* 风铃：几串金属短音 + 木牌轻碰 */
  function playChime() {
    const notes = [1318.5, 1568, 1760, 2093, 2637];
    notes.forEach((f, i) => {
      tone(i * 0.055 + Math.random() * 0.02, f, 0.11 - i * 0.012, 0.5 + Math.random() * 0.3);
    });
    tone(0.3, 523.25, 0.05, 0.18);
  }

  /* 签筒摇动：噪声断续 + 竹签碰撞 */
  function playShake() {
    const c = getCtx();
    if (!c) return;
    const dur = 0.92;
    const sr = c.sampleRate;
    const len = Math.floor(sr * dur);
    const buffer = c.createBuffer(1, len, sr);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const pulse = Math.pow(Math.max(0, Math.sin(Math.PI * ((t * 9) % 1))) , 4);
      data[i] = (Math.random() * 2 - 1) * (0.22 + 0.78 * pulse);
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1150;
    filter.Q.value = 0.8;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, c.currentTime + 0.07);
    gain.gain.setValueAtTime(0.3, c.currentTime + dur - 0.26);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    src.start();

    for (let i = 0; i < 6; i++) {
      tone(0.08 + i * 0.12 + Math.random() * 0.03, 700 + Math.random() * 500, 0.045, 0.12);
    }
  }

  function playDrawDone() {
    playChime();
    tone(0.35, 392, 0.045, 0.35);
  }

  return { unlock, playChime, playShake, playDrawDone };
})();
