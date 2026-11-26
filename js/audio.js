/**
 * 麦克风律动
 * ------------------------------------------------------------
 * 取自 3D--2025 的 AudioHandler 思路：
 * 用 AnalyserNode 取频谱，算一个 0~1 的平均能量，
 * 喂给粒子着色器的 uAudio，让灯变亮变大，跟着节拍闪。
 */

export class AudioReactive {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.data = null;
    this.level = 0;
    this.smooth = 0;
    this.running = false;
  }

  async start() {
    if (this.running) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.75;
    source.connect(this.analyser);

    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    this.running = true;
  }

  stop() {
    this.running = false;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.level = 0;
    this.smooth = 0;
  }

  update(dt) {
    if (!this.running || !this.analyser) {
      this.smooth += (0 - this.smooth) * Math.min(1, dt * 4);
      return this.smooth;
    }

    this.analyser.getByteFrequencyData(this.data);

    let sum = 0;
    // 只看人声/音乐的主要频段，跳过最低频的直流噪声
    const from = 4;
    for (let i = from; i < this.data.length; i++) sum += this.data[i];

    this.level = sum / (this.data.length - from) / 255;

    // 提升灵敏度，再做一点平滑
    const target = Math.min(1, Math.pow(this.level, 0.7) * 1.6);
    this.smooth += (target - this.smooth) * Math.min(1, dt * 12);

    return this.smooth;
  }
}
