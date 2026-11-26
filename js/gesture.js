/**
 * 手势识别（MediaPipe HandLandmarker）
 * ------------------------------------------------------------
 * 每帧拿到 21 个手部关键点，用「指尖到手腕的距离 > 指节到手腕的距离」
 * 判断手指是否伸直；再组合成 张开手掌 / 握拳 / 捏合。
 *
 * 融合了 3D--2025 的两点经验：
 *   1. 捏合用「滞回」（进入 0.42 / 退出 0.62），手指临界时不会来回抖
 *   2. 握拳优先级最高，握拳时拇指也会贴近食指，不能判成捏合
 *
 * 关键点编号：
 *   0 手腕  1-4 拇指  5-8 食指  9-12 中指  13-16 无名指  17-20 小指
 */

/* MediaPipe 资源：优先用本地 js/vendor/mediapipe，缺失时回退 CDN。
   这里用 document.baseURI 而不是 import.meta.url，方便打成单文件后也能运行 */
const LOCAL_BUNDLE = new URL('./js/vendor/mediapipe/vision_bundle.js', document.baseURI).href;
const LOCAL_WASM = new URL('./js/vendor/mediapipe/wasm', document.baseURI).href;
const LOCAL_MODEL = new URL('./js/vendor/mediapipe/hand_landmarker.task', document.baseURI).href;

const CDN_SOURCE = {
  bundle: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14',
  wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  model:
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
};

/** 依次尝试「本地 → CDN」，GPU 失败再退回 CPU */
async function loadLandmarker() {
  const sources = [
    { bundle: LOCAL_BUNDLE, wasm: LOCAL_WASM, model: LOCAL_MODEL },
    CDN_SOURCE,
  ];

  let lastError;

  for (const src of sources) {
    try {
      const { FilesetResolver, HandLandmarker } = await import(src.bundle);
      const fileset = await FilesetResolver.forVisionTasks(src.wasm);

      const options = (delegate) => ({
        baseOptions: { modelAssetPath: src.model, delegate },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      try {
        return await HandLandmarker.createFromOptions(fileset, options('GPU'));
      } catch (err) {
        console.warn('[gesture] GPU 初始化失败，改用 CPU', err);
        return await HandLandmarker.createFromOptions(fileset, options('CPU'));
      }
    } catch (err) {
      console.warn('[gesture] 手势模型源不可用：', src.bundle, err);
      lastError = err;
    }
  }

  throw lastError || new Error('手势模型加载失败');
}

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const GESTURE_COLOR = {
  open: '#ffd98a',
  fist: '#8fb8ff',
  pinch: '#8fffc4',
  none: '#7d8aa8',
};

const GESTURE_LABEL = {
  open: '张开手掌 · 打开',
  fist: '握拳 · 收起',
  pinch: '捏合 · 抓照片',
  none: '未识别到手势',
};

function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.6);
}

/** 判断当前手势（不含滞回，滞回在 process 里做） */
export function classify(lm) {
  const wrist = lm[0];
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];

  let extended = 0;
  for (let i = 0; i < 4; i++) {
    if (dist3(lm[tips[i]], wrist) > dist3(lm[pips[i]], wrist) * 1.15) extended++;
  }

  // 用「手腕 → 中指根」当手的大小，做尺度归一化
  const scale = dist3(lm[0], lm[9]) || 1;
  const pinchDist = dist3(lm[4], lm[8]) / scale;

  // 拇指：指尖离小指根越远 = 越张开
  const thumbExtended = dist3(lm[4], lm[17]) > dist3(lm[3], lm[17]);

  // 食指是否「伸在掌外」：捏合时食指虽然会弯，但指尖仍在手掌外面；
  // 握拳时指尖缩回掌根附近。用 MCP(5) 做参照，比用指节(6)宽松，捏合更容易识别
  const indexOut = dist3(lm[8], wrist) > dist3(lm[5], wrist) * 1.15;

  return { extended, pinchDist, thumbExtended, indexOut };
}

export class GestureController {
  constructor({ video, canvas, onGesture, onHand, onPinchStart, onPinchEnd, onStatus }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.onGesture = onGesture || (() => {});
    this.onHand = onHand || (() => {});
    this.onPinchStart = onPinchStart || (() => {});
    this.onPinchEnd = onPinchEnd || (() => {});
    this.onStatus = onStatus || (() => {});

    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.lastVideoTime = -1;
    this.rafId = 0;

    this.hand = null;
    this.rawGesture = 'none';
    this.stableGesture = 'none';
    this.streak = 0;
    this.lastEmit = 0;
    this.pinchActive = false;
    this.pinchNotified = false;
    this.tip = '按提示做手势';
  }

  async start() {
    if (this.running) return;

    this.onStatus('正在加载手势模型…');

    if (!this.landmarker) {
      this.landmarker = await loadLandmarker();
    }

    this.onStatus('正在请求摄像头权限…');

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });

    this.video.srcObject = this.stream;
    await this.video.play();

    this.running = true;
    this.lastVideoTime = -1;
    this.onStatus('摄像头已开启 · 举起手试试', true);
    this.loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.hand = null;
    this.pinchActive = false;
    this.pinchNotified = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.onHand({ present: false });
    this.onStatus('摄像头已关闭', false);
  }

  loop = () => {
    if (!this.running) return;

    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      try {
        const result = this.landmarker.detectForVideo(v, performance.now());
        this.process(result, performance.now());
      } catch (err) {
        // 偶发的 WASM 报错不打断循环
      }
    }

    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  process(result, now) {
    const hands = result && result.landmarks;

    if (!hands || hands.length === 0) {
      this.hand = null;
      this.rawGesture = 'none';
      this.streak = 0;
      if (this.pinchActive) {
        this.pinchActive = false;
        this.onPinchEnd();
      }
      this.onHand({ present: false });
      this.tip = '把手举到画面里';
      return;
    }

    const lm = hands[0];
    this.hand = lm;

    const info = classify(lm);

    // 捏合滞回：避免在阈值附近反复触发
    if (this.pinchActive) {
      if (info.pinchDist > 0.62 || !info.indexOut) this.pinchActive = false;
    } else if (info.pinchDist < 0.42 && info.indexOut) {
      this.pinchActive = true;
    }

    // 捏合优先：捏合时其余手指多半是蜷着的，不能先判成握拳
    let gesture = 'none';
    if (this.pinchActive) gesture = 'pinch';
    else if (info.extended === 0) gesture = 'fist';
    else if (info.extended >= 4) gesture = 'open';

    if (gesture !== this.rawGesture) {
      this.rawGesture = gesture;
      this.streak = 1;
    } else {
      this.streak++;
    }

    // 开 / 合：连续 4 帧确认 + 1 秒冷却
    if (
      (gesture === 'open' || gesture === 'fist') &&
      this.streak >= 4 &&
      now - this.lastEmit > 1000 &&
      gesture !== this.stableGesture
    ) {
      this.stableGesture = gesture;
      this.lastEmit = now;
      this.onGesture(gesture);
    }
    if (gesture === 'none' && this.streak > 20) this.stableGesture = 'none';

    // 捏合：只在状态切换时通知
    if (gesture === 'pinch' && !this.pinchNotified) {
      this.pinchNotified = true;
      this.onPinchStart();
    } else if (gesture !== 'pinch' && this.pinchNotified) {
      this.pinchNotified = false;
      this.onPinchEnd();
    }

    this.tip = GESTURE_LABEL[gesture];

    // 手掌位置（镜像后）→ 屏幕坐标 0~1，给 3D 光标用
    this.onHand({
      present: true,
      x: 1 - lm[9].x,
      y: lm[9].y,
      gesture,
    });
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (this.video.readyState >= 2) {
      // 镜像绘制，符合照镜子的直觉
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.video, 0, 0, w, h);
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(4, 7, 18, 0.28)';
    ctx.fillRect(0, 0, w, h);

    if (!this.hand) return;

    const color = GESTURE_COLOR[this.rawGesture] || GESTURE_COLOR.none;
    const px = (lm) => (1 - lm.x) * w;
    const py = (lm) => lm.y * h;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;

    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      ctx.moveTo(px(this.hand[a]), py(this.hand[a]));
      ctx.lineTo(px(this.hand[b]), py(this.hand[b]));
    }
    ctx.stroke();

    ctx.fillStyle = color;
    for (const p of this.hand) {
      ctx.beginPath();
      ctx.arc(px(p), py(p), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}
