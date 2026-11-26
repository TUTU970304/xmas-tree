import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/addons/controls/OrbitControls.js';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';

import { createTree } from './tree.js';
import { createSnow } from './snow.js';
import { Gallery } from './gallery.js';
import { AudioReactive } from './audio.js';

/* ---------------- 基础三件套 ---------------- */

const canvas = document.getElementById('scene');

// ?safe=1：上一次启动崩溃过，这次用最低画质跑（APK 里会自动带上）
const SAFE_MODE = new URLSearchParams(location.search).get('safe') === '1';

// 手机端降低画质：DPR 上限按像素预算算、关掉 MSAA、少一点雪。
// 否则 1080p 手机 + DPR2 + 4xMSAA + Bloom 光显存就要 200MB+，会直接闪退。
const isPhone = SAFE_MODE || (
  window.matchMedia
  && window.matchMedia('(pointer: coarse)').matches
  && Math.min(window.innerWidth, window.innerHeight) < 900
);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !isPhone,
  powerPreference: 'high-performance',
});

// 限制总像素数：Bloom 会按画布分辨率的 1.3 倍左右开多张显存纹理，
// 手机上 1080×2400 × DPR2 直接就是 200MB+，很容易被系统杀掉。
function targetPixelRatio() {
  const budget = SAFE_MODE ? 1100000 : isPhone ? 2200000 : 4200000;
  const byBudget = Math.sqrt(budget / (window.innerWidth * window.innerHeight));
  return Math.max(0.75, Math.min(window.devicePixelRatio || 1, byBudget));
}

renderer.setPixelRatio(targetPixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x04060f, 0.022);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 2.3, 16);

/* 背景：一个反面渲染的大球，做上下渐变 */
const skyGeo = new THREE.SphereGeometry(80, 32, 16);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    uTop: { value: new THREE.Color(0x122048) },
    uBottom: { value: new THREE.Color(0x02030a) },
  },
  vertexShader: /* glsl */ `
    varying vec3 vPos;
    void main() {
      vPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uTop;
    uniform vec3 uBottom;
    varying vec3 vPos;
    void main() {
      float h = clamp(normalize(vPos).y * 0.5 + 0.5, 0.0, 1.0);
      gl_FragColor = vec4(mix(uBottom, uTop, pow(h, 1.6)), 1.0);
    }
  `,
});
scene.add(new THREE.Mesh(skyGeo, skyMat));

/* ---------------- 内容 ---------------- */

const tree = createTree();
scene.add(tree.group);

const snow = createSnow(SAFE_MODE ? 400 : isPhone ? 900 : 1700);
scene.add(snow.points);

const gallery = new Gallery(scene, camera, 8);

// 灯光：给礼物盒 / 铃铛一点体积感
scene.add(new THREE.AmbientLight(0xffffff, 1.1));
const starLight = new THREE.PointLight(0xffd9a0, 60, 60, 2);
starLight.position.set(0, 5, 0);
tree.group.add(starLight);

// 手势光标：一个对着镜头的小圆环
const cursor = new THREE.Group();
const cursorRing = new THREE.Mesh(
  new THREE.RingGeometry(0.085, 0.11, 32),
  new THREE.MeshBasicMaterial({
    color: 0xffd98a,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
);
const cursorDot = new THREE.Mesh(
  new THREE.CircleGeometry(0.022, 16),
  new THREE.MeshBasicMaterial({
    color: 0xffd98a,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  })
);
cursor.add(cursorRing, cursorDot);
cursor.renderOrder = 30;
cursorRing.renderOrder = 30;
cursorDot.renderOrder = 31;
cursor.visible = false;
scene.add(cursor);

/* ---------------- 交互 ---------------- */

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 6.5;
controls.maxDistance = 26;
controls.minPolarAngle = 0.6;
controls.maxPolarAngle = Math.PI * 0.62;
controls.autoRotate = false;

/* ---------------- 布局：手机 / 平板 / 桌面 ---------------- */

let layoutMode = '';

function applyLayout() {
  const w = window.innerWidth;

  const mode = w < 700 ? 'phone' : w < 1000 ? 'tablet' : 'desktop';
  const changed = mode !== layoutMode;
  layoutMode = mode;

  // 手机竖屏：树基本居中，照片环绕缩小，镜头拉远一点
  const cfg = {
    phone: { offset: 0.3, radius: 0.58, cam: [0, 2.4, 18.5], target: [0, 0.9, 0] },
    tablet: { offset: 2.0, radius: 0.85, cam: [0, 2.4, 16.5], target: [0, 1.1, 0] },
    desktop: { offset: 3.6, radius: 1.0, cam: [0, 2.3, 16], target: [0, 1.1, 0] },
  }[mode];

  tree.group.position.x = cfg.offset;
  gallery.setOffsetX(cfg.offset);
  gallery.setRadiusScale(cfg.radius);

  // 只在「桌面 ↔ 手机」切换时重置镜头，避免每次拖窗口都被拉回去
  if (changed) {
    camera.position.set(cfg.cam[0], cfg.cam[1], cfg.cam[2]);
    controls.target.set(cfg.target[0], cfg.target[1], cfg.target[2]);
    controls.update();
  }
}

applyLayout();

/* ---------------- 后处理：辉光 ---------------- */

// iOS 的 WebGL 对半浮点渲染目标支持不稳定，Bloom 会让整帧变黑/什么都不画。
// 所以 iOS 直接跳过后期处理，用普通渲染（少一圈光晕，但至少能看到树）。
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const FORCE_NO_POST = new URLSearchParams(location.search).get('nopost') === '1';
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';

let composer = null;
let bloom = null;

if (!isIOS && !SAFE_MODE && !FORCE_NO_POST) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.55,  // strength
    0.35,  // radius
    0.5    // threshold
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

// 万一显卡吃不消（上下文丢失），自动降到低画质并提示，而不是直接白屏
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  if (bloom) bloom.enabled = false;
  renderer.setPixelRatio(0.8);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  toast('显卡压力过大，已自动降低画质', 5000);
});

/* ---------------- 尺寸自适应 ---------------- */

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(targetPixelRatio());
  renderer.setSize(w, h);
  if (composer) composer.setSize(w, h);
  applyLayout();
}
window.addEventListener('resize', onResize);

/* ---------------- UI ---------------- */

const btnCamera = document.getElementById('btn-camera');
const btnToggle = document.getElementById('btn-toggle');
const btnAudio = document.getElementById('btn-audio');
const fileInput = document.getElementById('file-input');
const toastEl = document.getElementById('toast');

let toastTimer = 0;
function toast(text, ms = 2200) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

let exploded = false;

function setExploded(value) {
  exploded = value;
  tree.setExploded(value);
  if (value) gallery.open();
  else gallery.close();
  btnToggle.textContent = value ? '收起照片' : '散开看看';
  document.body.classList.toggle('is-open', value);
}

btnToggle.addEventListener('click', () => {
  setExploded(!exploded);
});

fileInput.addEventListener('change', async (e) => {
  const res = await gallery.setImages(e.target.files);
  if (res.ok) {
    toast(res.failed ? `已替换 ${res.ok} 张，${res.failed} 张读不出来` : `已替换 ${res.ok} 张照片`);
    setExploded(true);
  } else if (res.failed) {
    toast(`${res.failed} 张照片读不出来，换 JPG / PNG 试试`, 4000);
  }
  fileInput.value = '';
});

/* 拖拽图片进来也能换 */
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  const res = await gallery.setImages(e.dataTransfer.files);
  if (res.ok) {
    toast(res.failed ? `已替换 ${res.ok} 张，${res.failed} 张读不出来` : `已替换 ${res.ok} 张照片`);
    setExploded(true);
  } else if (res.failed) {
    toast(`${res.failed} 张照片读不出来，换 JPG / PNG 试试`, 4000);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !document.body.classList.contains('editing')) {
    e.preventDefault();
    setExploded(!exploded);
  }
});

/* ---------------- 三连点星星：改祝福文字 ---------------- */

const WISH_KEY = 'xmas-wish-v1';
const DEFAULT_WISH = {
  label: '写给最重要的人',
  title: '愿你\n所求皆如愿',
  text: '愿你三冬暖，愿你春不寒；\n愿你天黑有灯，下雨有伞。',
};

const wishLabelEl = document.querySelector('.wish-label');
const wishTitleEl = document.querySelector('.wish-title');
const wishTextEl = document.querySelector('.wish-text');
const editorEl = document.getElementById('wish-editor');
const wishLabelInput = document.getElementById('wish-label-input');
const wishTitleInput = document.getElementById('wish-title-input');
const wishTextInput = document.getElementById('wish-text-input');

/** 把带换行的文案填进元素（用 <br> 分开，不解析 HTML） */
function fillLines(el, str) {
  el.textContent = '';
  String(str).split('\n').forEach((line, i) => {
    if (i) el.appendChild(document.createElement('br'));
    el.appendChild(document.createTextNode(line));
  });
}

function applyWish(wish) {
  wishLabelEl.textContent = wish.label;
  fillLines(wishTitleEl, wish.title);
  fillLines(wishTextEl, wish.text);
}

let savedWish = null;
try {
  const raw = localStorage.getItem(WISH_KEY);
  if (raw) savedWish = JSON.parse(raw);
} catch (err) {
  // 隐私模式 / 禁用 localStorage 时忽略，用默认文案
}

/** 合并默认值和已保存的值（旧数据可能没有 label） */
function currentWish() {
  const wish = { ...DEFAULT_WISH };
  if (savedWish) {
    for (const key of ['label', 'title', 'text']) {
      const v = savedWish[key];
      if (typeof v === 'string' && v.trim()) wish[key] = v;
    }
  }
  return wish;
}

/**
 * 只有存过自定义文案才覆盖页面上的文字。
 * 这样直接编辑 HTML 里的 <aside class="wish"> 也能生效（方便存成单文件发给别人）。
 */
if (savedWish) applyWish(currentWish());

function openWishEditor() {
  const cur = currentWish();
  wishLabelInput.value = cur.label;
  wishTitleInput.value = cur.title;
  wishTextInput.value = cur.text;
  editorEl.hidden = false;
  document.body.classList.add('editing');
  wishLabelInput.focus();
  wishLabelInput.select();
}

function closeWishEditor() {
  editorEl.hidden = true;
  document.body.classList.remove('editing');
}

document.getElementById('wish-cancel').addEventListener('click', closeWishEditor);

document.getElementById('wish-save').addEventListener('click', () => {
  const wish = {
    label: wishLabelInput.value.trim() || DEFAULT_WISH.label,
    title: wishTitleInput.value.trim() || DEFAULT_WISH.title,
    text: wishTextInput.value.trim() || DEFAULT_WISH.text,
  };
  savedWish = wish;
  try {
    localStorage.setItem(WISH_KEY, JSON.stringify(wish));
  } catch (err) { /* 存不了也不影响本次显示 */ }
  applyWish(wish);
  closeWishEditor();
  toast('祝福已更新');
});

// 点星星三次
const starHit = tree.star.getObjectByName('starHit');
const starRay = new THREE.Raycaster();
const starNdc = new THREE.Vector2();
let starClicks = 0;
let starClickAt = 0;
let downX = 0;
let downY = 0;

renderer.domElement.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (!editorEl.hidden) return;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // 拖动视角不算点击

  const rect = renderer.domElement.getBoundingClientRect();
  starNdc.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  starRay.setFromCamera(starNdc, camera);

  // 1）点在星星上：三连点改祝福
  if (starHit && starRay.intersectObject(starHit, false).length > 0) {
    const now = performance.now();
    if (now - starClickAt > 1500) starClicks = 0;
    starClickAt = now;
    starClicks += 1;

    if (starClicks === 1) {
      toast('再点两下星星，可以改祝福');
    } else if (starClicks >= 3) {
      starClicks = 0;
      openWishEditor();
    }
    return;
  }

  starClicks = 0;

  // 2）点在照片上：抓起来 / 放回去（手机上没有手势时也能玩）
  if (gallery.progress < 0.6) return;

  const hits = starRay.intersectObjects(gallery.hitMeshes, false);
  if (hits.length > 0) {
    const idx = hits[0].object.userData.index;
    if (idx === gallery.grabbed) {
      gallery.release();
    } else {
      gallery.grab(idx);
      toast('抓住了一张 · 拖动屏幕看看 · 点空白处放回');
    }
  } else if (gallery.grabbed >= 0) {
    gallery.release();
  }
});

/* ---------------- 单文件版：把祝福和照片一起打包 ---------------- */

// 读取「导出时」写进文件的祝福和照片
(function loadBaked() {
  const el = document.getElementById('baked');
  if (!el) return;

  let data;
  try {
    data = JSON.parse(el.textContent);
  } catch (err) {
    return;
  }

  if (data.wish) {
    savedWish = data.wish;
    applyWish(data.wish);
  }

  if (Array.isArray(data.photos)) {
    for (const entry of data.photos) {
      if (!entry || typeof entry.src !== 'string') continue;
      const item = gallery.items[entry.i];
      if (!item) continue;

      const img = new Image();
      img.onload = () => {
        const ctx = item.canvas.getContext('2d');
        ctx.clearRect(0, 0, item.canvas.width, item.canvas.height);
        ctx.drawImage(img, 0, 0, item.canvas.width, item.canvas.height);
        item.texture.needsUpdate = true;
        item.userImage = true;
      };
      img.src = entry.src;
    }
  }
})();

// 「导出这份」只在单文件版里出现：把当前祝福 + 照片写进一个新 HTML
const btnExport = document.getElementById('btn-export');

if (window.__SHARE_BUILD && btnExport) {
  btnExport.style.display = '';

  btnExport.addEventListener('click', () => {
    const data = {
      wish: currentWish(),
      photos: gallery.items
        .map((item, i) => (item.userImage ? { i, src: item.canvas.toDataURL('image/jpeg', 0.86) } : null))
        .filter(Boolean),
    };

    // 用当前页面克隆一份，再把运行期状态擦干净
    const clone = document.documentElement.cloneNode(true);

    const body = clone.querySelector('body');
    if (body) {
      body.className = '';
      body.removeAttribute('style');
    }

    const scene = clone.querySelector('#scene');
    if (scene) {
      scene.removeAttribute('style');
      scene.removeAttribute('width');
      scene.removeAttribute('height');
    }

    const toggle = clone.querySelector('#btn-toggle');
    if (toggle) toggle.textContent = '散开看看';

    const editor = clone.querySelector('#wish-editor');
    if (editor) editor.setAttribute('hidden', '');

    const boot = clone.querySelector('#boot-error');
    if (boot) boot.setAttribute('hidden', '');

    const toastNode = clone.querySelector('#toast');
    if (toastNode) {
      toastNode.className = 'toast';
      toastNode.textContent = '';
    }

    clone.querySelectorAll('iframe').forEach((f) => f.remove());

    const baked = document.createElement('script');
    baked.type = 'application/json';
    baked.id = 'baked';
    baked.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
    if (body) body.insertBefore(baked, body.firstChild);

    const html = '<!doctype html>\n' + clone.outerHTML;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = '圣诞树.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    toast(`已导出（含 ${data.photos.length} 张照片）· 把这个文件发给对方就行`, 5000);
  });
}

/* ---------------- 麦克风律动 ---------------- */

const audio = new AudioReactive();

btnAudio.addEventListener('click', async () => {
  if (audio.running) {
    audio.stop();
    btnAudio.classList.remove('is-on');
    btnAudio.textContent = '音效律动';
    toast('已关闭麦克风');
    return;
  }

  if (!window.isSecureContext) {
    toast('麦克风需要 HTTPS（或 localhost）。手机上请用 start-phone.bat 打开 https 地址。', 6000);
    return;
  }

  try {
    await audio.start();
    btnAudio.classList.add('is-on');
    btnAudio.textContent = '律动中';
    toast('放点音乐，树会跟着闪');
  } catch (err) {
    toast('麦克风启动失败：' + (err && err.message ? err.message : err), 4000);
  }
});

/* ---------------- 手势 ---------------- */

const videoEl = document.getElementById('input-video');

// 摄像头画面不再显示在页面上（右下角的小窗去掉了），只给识别用
const camCanvas = document.createElement('canvas');
camCanvas.width = 240;
camCanvas.height = 180;

// 识别状态只走 Toast，不再有可视化面板
const cameraStatus = { textContent: '', classList: { toggle() {} } };

const hand = { present: false, x: 0.5, y: 0.5, gesture: 'none' };

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const cursorTarget = new THREE.Vector3();

let hovered = -1;
let gestureController = null;

function updateHandCursor() {
  if (!hand.present) {
    cursor.visible = false;
    if (hovered !== -1) {
      hovered = -1;
      gallery.setHovered(-1);
    }
    return;
  }

  pointer.set(hand.x * 2 - 1, -(hand.y * 2 - 1));

  raycaster.setFromCamera(pointer, camera);

  // 悬停检测：只有照片基本展开后才参与互动
  let hover = -1;
  if (gallery.progress > 0.6 && gallery.grabbed < 0) {
    const hits = raycaster.intersectObjects(gallery.hitMeshes, false);
    if (hits.length) hover = hits[0].object.userData.index;
  }
  if (hover !== hovered) {
    hovered = hover;
    gallery.setHovered(hover);
  }

  // 光标放在射线前方 6 个单位处
  cursorTarget.copy(camera.position).addScaledVector(raycaster.ray.direction, 6);
  cursor.position.lerp(cursorTarget, 0.35);
  cursor.quaternion.copy(camera.quaternion);
  cursor.visible = true;

  const active = hovered >= 0 || gallery.grabbed >= 0;
  const color = gallery.grabbed >= 0 ? 0x8fffc4 : active ? 0xfff0c0 : 0xffd98a;
  cursorRing.material.color.setHex(color);
  cursorDot.material.color.setHex(color);
  const s = gallery.grabbed >= 0 ? 0.75 : active ? 1.35 : 1;
  cursor.scale.lerp(new THREE.Vector3(s, s, s), 0.2);
}

btnCamera.addEventListener('click', async () => {
  if (!gestureController) {
    const { GestureController } = await import('./gesture.js');
    gestureController = new GestureController({
      video: videoEl,
      canvas: camCanvas,
      onStatus(text, ok) {
        cameraStatus.textContent = text;
        cameraStatus.classList.toggle('on', !!ok);
      },
      onGesture(name) {
        if (name === 'open') {
          setExploded(true);
          toast('张开手掌 · 树散开了');
        } else if (name === 'fist') {
          setExploded(false);
          toast('握拳 · 收起来了');
        }
      },
      onHand(data) {
        hand.present = data.present;
        if (data.present) {
          hand.x = data.x;
          hand.y = data.y;
          hand.gesture = data.gesture;
          // 抓在手里时，照片跟着手掌走
          if (gallery.grabbed >= 0) gallery.setHand(data.x, data.y);
        } else {
          hand.gesture = 'none';
        }
      },
      onPinchStart() {
        // 手指没精确对准照片时，抓「离视线最近」的那张
        const target = hovered >= 0 ? hovered : gallery.pickByRay(raycaster.ray);
        if (target >= 0) {
          gallery.grab(target);
          toast('抓住了 · 移动手可以转 · 松手放回');
        }
      },
      onPinchEnd() {
        if (gallery.grabbed >= 0) gallery.release();
      },
    });
  }

  if (gestureController.running) {
    gestureController.stop();
    btnCamera.classList.remove('is-on');
    btnCamera.textContent = '开启手势摄像头';
    cursor.visible = false;
    return;
  }

  // 手机通过 http://192.168.x.x 打开时，浏览器会禁用摄像头
  if (!window.isSecureContext) {
    toast('摄像头只能在 HTTPS（或 localhost）下使用。手机上请用 start-phone.bat 的 https 地址打开。', 6000);
    return;
  }

  try {
    btnCamera.textContent = '正在启动…';
    await gestureController.start();
    btnCamera.textContent = '关闭手势摄像头';
    btnCamera.classList.add('is-on');
    toast('对着摄像头张开手掌试试');
  } catch (err) {
    console.error(err);
    btnCamera.textContent = '开启手势摄像头';
    btnCamera.classList.remove('is-on');
    toast('摄像头启动失败：' + (err && err.message ? err.message : err), 4200);
  }
});

/* ---------------- 主循环 ---------------- */

const clock = new THREE.Clock();

function renderFrame() {
  if (composer) {
    try {
      composer.render();
      return;
    } catch (err) {
      // 半浮点渲染目标不被支持时，直接退化成普通渲染
      console.warn('[render] 后处理不可用，改用直接渲染', err);
      composer = null;
      bloom = null;
    }
  }
  renderer.render(scene, camera);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  const audioLevel = audio.update(dt);

  tree.update(dt, t, audioLevel);
  snow.update(dt, t);
  gallery.update(dt);
  updateHandCursor();
  controls.update();

  renderFrame();
  requestAnimationFrame(animate);
}

animate();
setExploded(false);

// 低画质模式提示一下
if (SAFE_MODE) {
  setTimeout(() => toast('已用低画质模式启动（上次可能因显存不足退出）', 5000), 1200);
}

/* 页面隐藏时不做额外处理，树的自转由 rAF 自动暂停 */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) clock.getDelta(); // 回到前台时丢掉积压的时间差
});

/* 调试用：控制台里可以直接访问场景对象，例如 __xmas.gallery.open() */
window.__xmas = { scene, camera, renderer, composer, controls, tree, gallery, audio, setExploded };

// ?debug=1 时在左下角显示一行环境信息，方便排查手机上的问题
if (DEBUG) {
  const info = document.createElement('div');
  info.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:9999;padding:6px 10px;border-radius:8px;'
    + 'background:rgba(0,0,0,.72);color:#9fe8ff;font:11px/1.6 monospace;'
    + 'white-space:pre;pointer-events:none';
  info.textContent = [
    'WebGL: ' + (renderer.capabilities.isWebGL2 ? '2' : '1'),
    'canvas: ' + renderer.domElement.width + 'x' + renderer.domElement.height,
    'dpr: ' + renderer.getPixelRatio().toFixed(2),
    'post: ' + (composer ? 'on' : 'off'),
    'iOS: ' + (isIOS ? 'yes' : 'no'),
    'safe: ' + (SAFE_MODE ? 'yes' : 'no'),
  ].join('\n');
  document.body.appendChild(info);
}

// 启动成功，清掉可能出现的错误提示
const bootBox = document.getElementById('boot-error');
if (bootBox) bootBox.hidden = true;
