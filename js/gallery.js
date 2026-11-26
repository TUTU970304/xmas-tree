import * as THREE from './vendor/three.module.js';

/**
 * 照片环（旋转木马）
 * ------------------------------------------------------------
 * 8 张拍立得围绕圣诞树缓慢转动，像旋转木马：
 *   - 整体绕树逆时针转，速度很慢（约 45 秒一圈）
 *   - 每张上下轻轻起伏，相位不同
 *   - 照片大小固定，不会自己变大
 *
 * 交互：
 *   - 手掌位置投射成射线，悬停在照片上会稍微放大
 *   - 捏合时把照片「抓」到镜头前，跟着手移动并翻转，松手放回去
 */

const PHOTO_W = 512;
const PHOTO_H = 640;

// 照片大小固定
const BASE_SCALE = 0.55;
const HOVER_SCALE = 1.08;

// 抓在手里的尺寸和距离
const GRAB_SCALE = 2.2;
const GRAB_DISTANCE = 5.8;
// 抓起来的照片占屏很大，辉光会把白边糊成一片，压暗一点
const GRAB_DIM = 0.6;

// 旋转木马
const SPIN_SPEED = 0.14;   // 弧度/秒，约 45 秒一圈
const BOB_HEIGHT = 0.3;    // 上下起伏幅度

const CAPTIONS = [
  'Merry Christmas',
  '初 雪',
  '平 安 夜',
  '许 个 愿',
  '冬日暖阳',
  '新 年 好',
  '一起看雪',
  '2026',
];

const HUES = [205, 218, 190, 275, 12, 340, 168, 228];

/* ---------------- 绘制 ---------------- */

function drawCover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height;
  const br = w / h;
  let dw, dh;
  if (ir > br) {
    dh = h;
    dw = h * ir;
  } else {
    dw = w;
    dh = w / ir;
  }
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** 没有照片时，用 canvas 画一张「冬夜雪景」占位图 */
function paintPlaceholder(ctx, x, y, w, h, i) {
  const hue = HUES[i % HUES.length];

  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0.0, `hsl(${hue}, 62%, 10%)`);
  sky.addColorStop(0.5, `hsl(${hue}, 58%, 26%)`);
  sky.addColorStop(1.0, `hsl(${(hue + 35) % 360}, 68%, 62%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);

  // 星星
  for (let s = 0; s < 110; s++) {
    const sx = x + Math.random() * w;
    const sy = y + Math.random() * h * 0.62;
    ctx.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.7})`;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.random() * 1.5 + 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 月亮
  const mx = x + w * 0.72;
  const my = y + h * 0.2;
  const mr = w * 0.085;
  const moonGlow = ctx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 4);
  moonGlow.addColorStop(0, 'rgba(255,246,214,0.55)');
  moonGlow.addColorStop(1, 'rgba(255,246,214,0)');
  ctx.fillStyle = moonGlow;
  ctx.beginPath();
  ctx.arc(mx, my, mr * 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,248,220,0.95)';
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();

  // 雪丘
  for (let k = 0; k < 3; k++) {
    const baseY = y + h * (0.6 + k * 0.13);
    ctx.fillStyle = `hsla(${(hue + 20) % 360}, 42%, ${72 + k * 8}%, ${0.9 - k * 0.22})`;
    ctx.beginPath();
    ctx.moveTo(x - 20, y + h);
    ctx.quadraticCurveTo(x + w * 0.28, baseY - h * 0.14, x + w * 0.52, baseY + h * 0.02);
    ctx.quadraticCurveTo(x + w * 0.78, baseY + h * 0.1, x + w + 20, baseY - h * 0.06);
    ctx.lineTo(x + w + 20, y + h);
    ctx.closePath();
    ctx.fill();
  }

  // 前景雪花
  for (let s = 0; s < 40; s++) {
    const sx = x + Math.random() * w;
    const sy = y + Math.random() * h;
    ctx.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.5})`;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.random() * 2.4 + 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // 暗角
  const vignette = ctx.createRadialGradient(
    x + w / 2, y + h / 2, Math.min(w, h) * 0.3,
    x + w / 2, y + h / 2, Math.max(w, h) * 0.75
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, w, h);
}

/** 把一张照片（或占位图）画进拍立得相框 */
function drawPolaroid(canvas, index, img) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, PHOTO_W, PHOTO_H);

  // 相纸
  ctx.fillStyle = '#e9e2d4';
  ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);

  const px = 26;
  const py = 26;
  const pw = PHOTO_W - px * 2;
  const ph = PHOTO_H - py - 96;

  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();
  if (img) drawCover(ctx, img, px, py, pw, ph);
  else paintPlaceholder(ctx, px, py, pw, ph, index);
  ctx.restore();

  // 相纸内阴影
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);

  // 手写体标题
  ctx.fillStyle = '#3a3a44';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 27px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(CAPTIONS[index % CAPTIONS.length], PHOTO_W / 2, PHOTO_H - 50);
}

/* ---------------- 动画曲线 ---------------- */

function easeOutBack(p) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}

/* ---------------- 读取用户选的照片 ---------------- */

/**
 * 把 File 解成 Image。
 * 手机上有些文件 type 是空的、或者 objectURL 解码不出来（比如 HEIC），
 * 所以这里不按 MIME 过滤，失败再用 dataURL 兜一次。
 */
function loadPhotoFile(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => resolve({ img, url });

    img.onerror = () => {
      URL.revokeObjectURL(url);

      const reader = new FileReader();
      reader.onload = () => {
        const retry = new Image();
        retry.onload = () => resolve({ img: retry, url: null });
        retry.onerror = () => resolve(null);
        retry.src = reader.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };

    img.src = url;
  });
}

/* ---------------- Gallery ---------------- */

export class Gallery {
  constructor(scene, camera, count = 8) {
    this.scene = scene;
    this.camera = camera;
    this.count = count;

    this.group = new THREE.Group();
    scene.add(this.group);

    this.items = [];
    this.hitMeshes = [];

    this.progress = 0;   // 0 = 收起，1 = 完全展开
    this.target = 0;
    this.time = 0;
    this.spin = 0;       // 整体旋转角

    this.hovered = -1;
    this.grabbed = -1;

    this.handX = 0.5;    // 抓手时手掌位置，跟着手移动/翻转照片
    this.handY = 0.5;

    this.offsetX = 0;    // 照片环绕的中心跟着圣诞树右移
    this.radiusScale = 1; // 手机竖屏时把整个环缩小，免得跑出屏幕
    this.nextSlot = 0;   // 下次换照片从第几张开始填

    this.build();
  }

  build() {
    const geometry = new THREE.PlaneGeometry(1.5, 1.875);

    for (let i = 0; i < this.count; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = PHOTO_W;
      canvas.height = PHOTO_H;
      drawPolaroid(canvas, i, null);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.index = i;

      const holder = new THREE.Group();
      holder.add(mesh);

      // 位置由「角度 + 半径 + 高度」决定，每帧重算，方便转起来
      const baseAngle = i * 2.399963 + 0.2;
      const radius0 = 3.8 + (i % 3) * 0.55;
      const baseY = 0.4 + Math.sin(i * 1.7) * 1.35;

      holder.position.set(
        Math.cos(baseAngle) * radius0,
        baseY,
        Math.sin(baseAngle) * radius0
      );
      holder.scale.setScalar(0.0001);
      holder.visible = false;

      this.group.add(holder);
      this.hitMeshes.push(mesh);

      this.items.push({
        holder,
        mesh,
        material,
        texture,
        canvas,
        baseAngle,
        radius0,
        baseY,
        phase: Math.random() * Math.PI * 2,
        objectURL: null,
        userImage: false,
        scale: 0.0001,
      });
    }
  }

  open() { this.target = 1; }
  close() {
    this.target = 0;
    this.release();
  }
  toggle() { this.target = this.target > 0.5 ? 0 : 1; }
  get isOpen() { return this.target > 0.5; }

  /** 树被挪到画面右侧时，照片环的中心跟着一起平移 */
  setOffsetX(x) {
    this.offsetX = x;
  }

  /** 手机竖屏时把照片环整体缩小 */
  setRadiusScale(k) {
    this.radiusScale = k;
  }

  /** 手掌射线悬停到第 i 张（-1 = 没有） */
  setHovered(index) {
    if (this.hovered === index) return;
    this.hovered = index;
    for (let i = 0; i < this.items.length; i++) {
      const m = this.items[i].material;
      m.depthTest = i !== this.grabbed;
    }
  }

  grab(index) {
    if (index < 0 || index >= this.items.length) return;
    this.grabbed = index;
    const item = this.items[index];
    item.mesh.renderOrder = 10;
    item.material.depthTest = false;
    // 从手掌中间开始，避免照片先跳到一边
    this.handX = 0.5;
    this.handY = 0.5;
  }

  /** 捏合抓取时，手掌坐标持续传入（0~1，已镜像） */
  setHand(x, y) {
    this.handX = x;
    this.handY = y;
  }

  release() {
    if (this.grabbed < 0) return;
    const item = this.items[this.grabbed];
    item.mesh.renderOrder = 0;
    item.material.depthTest = true;
    this.grabbed = -1;
  }

  /**
   * 没精确对准照片时也能抓：取「离视线最近」的那张。
   * 相机没有手势时用不到，但捏合前手抖一下也抓得到，体验好很多。
   */
  pickByRay(ray) {
    if (this.progress < 0.6) return -1;

    let best = -1;
    let bestAngle = 0.25;   // 约 14°，超出就不抓
    const v = new THREE.Vector3();

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (!item.holder.visible) continue;
      item.holder.getWorldPosition(v).sub(ray.origin);
      const angle = v.angleTo(ray.direction);
      if (angle < bestAngle) {
        bestAngle = angle;
        best = i;
      }
    }

    return best;
  }

  /**
   * 用用户自己的照片替换相框内容。
   * 每次都从「上次填到的那一格」往后填，所以一次选 3 张、再选 4 张，
   * 8 个相框都会被填满，而不是反复覆盖前三张。
   *
   * @returns {Promise<{ok:number, failed:number}>}
   */
  async setImages(files) {
    const picked = Array.from(files).slice(0, this.count);
    if (!picked.length) return { ok: 0, failed: 0 };

    // 先把所有文件解码，成功几张算几张（不按 MIME 过滤，手机上有些文件 type 是空的）
    const loaded = await Promise.all(picked.map(loadPhotoFile));
    const good = loaded.filter(Boolean);

    if (!good.length) return { ok: 0, failed: picked.length };

    const start = this.nextSlot % this.count;

    good.forEach((entry, k) => {
      const index = (start + k) % this.count;
      const item = this.items[index];

      if (item.objectURL) URL.revokeObjectURL(item.objectURL);
      item.objectURL = entry.url;
      item.userImage = true;

      drawPolaroid(item.canvas, index, entry.img);
      item.texture.needsUpdate = true;
    });

    this.nextSlot = (start + good.length) % this.count;

    return { ok: good.length, failed: picked.length - good.length };
  }

  update(dt) {
    this.time += dt;

    const k = Math.min(1, dt * 5);
    this.progress += (this.target - this.progress) * k;
    if (Math.abs(this.target - this.progress) < 0.001) this.progress = this.target;

    // 逆时针缓慢转（负号 = 从正面看，照片从右往左划过）
    this.spin -= dt * SPIN_SPEED;

    const camera = this.camera;
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const targetPos = new THREE.Vector3();
    const dimColor = new THREE.Color();

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const delay = i * 0.045;
      const p = Math.min(1, Math.max(0, (this.progress - delay) / 0.55));
      const pop = Math.max(0.0001, easeOutBack(p));

      item.holder.visible = p > 0.002;
      if (!item.holder.visible) {
        item.scale = pop * BASE_SCALE;
        continue;
      }

      // 抓起来的那张压暗一点，避免辉光把整张照片糊白
      dimColor.setScalar(i === this.grabbed ? GRAB_DIM : 1);
      item.material.color.lerp(dimColor, Math.min(1, dt * 8));

      if (i === this.grabbed) {
        // 抓在手里：跟着手掌移动，并且随手势轻微翻转
        camera.getWorldDirection(forward);
        right.crossVectors(forward, camera.up).normalize();
        up.crossVectors(right, forward).normalize();

        const nx = (this.handX - 0.5) * 2;   // -1 左 … 1 右
        const ny = (this.handY - 0.5) * 2;   // -1 上 … 1 下

        targetPos
          .copy(camera.position)
          .addScaledVector(forward, GRAB_DISTANCE)
          .addScaledVector(right, nx * 1.5)
          .addScaledVector(up, -ny * 1.0);

        item.holder.position.lerp(targetPos, Math.min(1, dt * 9));
        item.scale += (GRAB_SCALE - item.scale) * Math.min(1, dt * 8);
        item.holder.scale.setScalar(item.scale);

        item.holder.lookAt(camera.position);
        // 像拿在手里翻看：左右移动 = 转向，上下移动 = 俯仰
        item.holder.rotateY(-nx * 0.55);
        item.holder.rotateX(ny * 0.3);
      } else {        // 旋转木马：绕树转 + 上下起伏
        const angle = item.baseAngle + this.spin;
        const bob = Math.sin(this.time * 0.9 + item.phase) * BOB_HEIGHT;
        const radius = item.radius0 * this.radiusScale;

        targetPos.set(
          Math.cos(angle) * radius + this.offsetX,
          item.baseY + bob,
          Math.sin(angle) * radius
        );

        item.holder.position.lerp(targetPos, Math.min(1, dt * 6));

        const hover = i === this.hovered && this.progress > 0.6 ? HOVER_SCALE : 1;
        const wanted = pop * BASE_SCALE * hover;

        item.scale += (wanted - item.scale) * Math.min(1, dt * 7);
        item.holder.scale.setScalar(Math.max(0.0001, item.scale));
        item.holder.lookAt(camera.position);
        item.holder.rotateZ(Math.sin(this.time * 0.7 + item.phase) * 0.03);
      }
    }
  }
}
