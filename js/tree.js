import * as THREE from './vendor/three.module.js';

/**
 * 粒子圣诞树（融合版）
 * ------------------------------------------------------------
 * 参考了 123-qw-as/3D--2025 的「爆炸散开」思路：
 *   每颗粒子除了树的坐标，还预先算好一条「爆炸方向 × 距离」，
 *   张开手掌时把 uExplode 从 0 推到 1，粒子沿这条向量飞散，
 *   收拳时再回到 0 —— 全部在顶点着色器里做，CPU 不用循环。
 *
 * 树本身的形状沿用螺旋采样，保证有「一圈圈灯带」的感觉。
 */

const HEIGHT = 8.6;
const BASE_RADIUS = 2.75;
const STRANDS = 6;
const TURNS = 7.5;

const DUST_COUNT = 11000;
const LIGHT_COUNT = 460;

/* ---------------- 贴图 ---------------- */

function makeDotTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(255,255,255,0.82)');
  g.addColorStop(0.58, 'rgba(255,255,255,0.22)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGlowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,236,190,1)');
  g.addColorStop(0.18, 'rgba(255,214,130,0.55)');
  g.addColorStop(0.45, 'rgba(255,180,80,0.16)');
  g.addColorStop(1.0, 'rgba(255,160,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- 采样 ---------------- */

function samplePoint() {
  // 圆锥侧面积 ∝ (1-t)，这样底部密、顶部自然收尖
  const t = 1 - Math.sqrt(Math.random());
  const strand = Math.floor(Math.random() * STRANDS);
  const angle =
    t * TURNS * Math.PI * 2 +
    (strand / STRANDS) * Math.PI * 2 +
    (Math.random() - 0.5) * 0.26;

  let radius = BASE_RADIUS * Math.pow(1 - t, 0.92);

  if (Math.random() < 0.16) radius *= Math.pow(Math.random(), 0.4);
  else radius *= 0.9 + Math.random() * 0.1;

  return {
    x: Math.cos(angle) * radius,
    y: -HEIGHT / 2 + t * HEIGHT + (Math.random() - 0.5) * 0.16,
    z: Math.sin(angle) * radius,
  };
}

/** 爆炸向量：主要沿半径向外，再往上飘一点 */
function makeBurst(p) {
  const dir = new THREE.Vector3(p.x, 0, p.z);
  if (dir.lengthSq() < 1e-6) dir.set(Math.random() - 0.5, 1, Math.random() - 0.5);
  dir.normalize();
  dir.y = 0.3 + Math.random() * 0.9;
  dir.normalize();

  const dist = 1.5 + Math.random() * 3.5;
  return {
    x: dir.x * dist + (Math.random() - 0.5) * 1.2,
    y: dir.y * dist + (Math.random() - 0.5) * 1.2,
    z: dir.z * dist + (Math.random() - 0.5) * 1.2,
  };
}

/* ---------------- 着色器 ---------------- */

const VERT = /* glsl */ `
  attribute vec3 aBurst;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aPhase;
  attribute float aTwinkle;
  attribute float aDelay;

  uniform float uTime;
  uniform float uExplode;
  uniform float uAudio;
  uniform float uPixelRatio;

  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    // 每颗粒子有微小延迟，散开时像一串波浪
    float e = clamp((uExplode - aDelay * 0.25) / 0.75, 0.0, 1.0);
    e = e * e * (3.0 - 2.0 * e);

    vec3 pos = position + aBurst * e;

    // 散开后在原地轻微漂浮
    pos += vec3(
      sin(uTime * 0.8 + aPhase),
      cos(uTime * 0.6 + aPhase * 1.7),
      sin(uTime * 0.5 + aPhase * 0.9)
    ) * e * 0.45;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

    float twinkle = 0.55 + 0.45 * sin(uTime * 2.4 + aPhase);
    float audioBoost = 1.0 + uAudio * aTwinkle * 2.2;
    float scatterBoost = 1.0 + e * 0.9;

    gl_PointSize = aSize * audioBoost * scatterBoost * uPixelRatio * (300.0 / -mvPosition.z)
                 * (0.75 + twinkle * aTwinkle * 0.55);
    gl_Position = projectionMatrix * mvPosition;

    vColor = aColor;
    vTwinkle = twinkle;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;

    float alpha = smoothstep(0.5, 0.0, d);
    alpha = pow(alpha, 1.3);

    gl_FragColor = vec4(vColor * (0.75 + vTwinkle * 0.85), alpha);
  }
`;

/* ---------------- 粒子 ---------------- */

function createParticles() {
  const total = DUST_COUNT + LIGHT_COUNT;

  const positions = new Float32Array(total * 3);
  const bursts = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const sizes = new Float32Array(total);
  const phases = new Float32Array(total);
  const twinkles = new Float32Array(total);
  const delays = new Float32Array(total);

  const color = new THREE.Color();
  const palette = [
    new THREE.Color(0xffd27a),
    new THREE.Color(0xff5f6d),
    new THREE.Color(0x9fe8ff),
    new THREE.Color(0xffffff),
    new THREE.Color(0xa6ffcf),
  ];

  for (let i = 0; i < total; i++) {
    const p = samplePoint();
    const isLight = i >= DUST_COUNT;

    positions[i * 3 + 0] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;

    const b = makeBurst(p);
    bursts[i * 3 + 0] = b.x;
    bursts[i * 3 + 1] = b.y;
    bursts[i * 3 + 2] = b.z;

    if (isLight) {
      color.copy(palette[(Math.random() * palette.length) | 0]);
      sizes[i] = 0.07 + Math.random() * 0.11;
      twinkles[i] = 1.0;
    } else {
      const r = Math.random();
      if (r < 0.06) color.setHSL(0.12, 1.0, 0.64);
      else if (r < 0.09) color.setHSL(0.99, 0.9, 0.6);
      else color.setHSL(0.33 + Math.random() * 0.07, 0.9, 0.3 + Math.random() * 0.32);
      sizes[i] = 0.072;
      twinkles[i] = 0.45;
    }

    colors[i * 3 + 0] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    phases[i] = Math.random() * Math.PI * 2;
    delays[i] = Math.random();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aBurst', new THREE.BufferAttribute(bursts, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));
  geo.setAttribute('aDelay', new THREE.BufferAttribute(delays, 1));

  const uniforms = {
    uTime: { value: 0 },
    uExplode: { value: 0 },
    uAudio: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  return { points, uniforms };
}

/* ---------------- 顶星 ---------------- */

function starShape(outer = 0.95, inner = 0.42) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    // 从正上方开始，得到「尖朝上」的五角星
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function createStar() {
  const group = new THREE.Group();

  // 平面的星形：任何角度看都是一颗完整的星（挤出体从侧面看会变成一条线）
  const geo = new THREE.ShapeGeometry(starShape(0.95, 0.42), 8);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0xffe6a8,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
  );

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      opacity: 0.55,
    })
  );
  glow.scale.setScalar(2.8);

  group.add(mesh, glow);

  // 一个不可见的大球，专门用来接收「三连点星星」的射线
  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 16, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hit.name = 'starHit';
  group.add(hit);

  group.position.y = HEIGHT / 2 + 0.72;
  group.userData.glow = glow;
  return group;
}

/* ---------------- 礼物盒 / 铃铛 ---------------- */

const BOX_COLORS = [0xd92b2b, 0xf0b429, 0x2f9e6e, 0xe8e2d0];

function createOrnaments() {
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const items = [];

  const boxCount = 14;
  const boxMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1, emissive: 0x0d0804 }),
    boxCount
  );

  const bellCount = 30;
  const bellMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xffc85c,
      roughness: 0.25,
      metalness: 0.5,
      emissive: 0x2a1a00,
    }),
    bellCount
  );

  function place(mesh, count, isBox) {
    for (let i = 0; i < count; i++) {
      const p = samplePoint();
      const scaleBase = isBox ? 0.11 + Math.random() * 0.1 : 0.05 + Math.random() * 0.045;

      const base = new THREE.Vector3(p.x * 0.97, p.y, p.z * 0.97);
      const burst = new THREE.Vector3(
        (Math.random() - 0.5),
        0.2 + Math.random() * 0.8,
        (Math.random() - 0.5)
      ).normalize().multiplyScalar(4 + Math.random() * 5);

      items.push({
        mesh,
        index: i,
        base,
        burst,
        scaleBase,
        rot: new THREE.Euler(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI
        ),
        spin: (Math.random() - 0.5) * 1.2,
        phase: Math.random() * Math.PI * 2,
        isBox,
      });

      if (isBox) {
        color.setHex(BOX_COLORS[(Math.random() * BOX_COLORS.length) | 0]);
        mesh.setColorAt(i, color);
      }
    }
    if (boxMesh.instanceColor) boxMesh.instanceColor.needsUpdate = true;
  }

  place(boxMesh, boxCount, true);
  place(bellMesh, bellCount, false);

  group.add(boxMesh, bellMesh);

  function update(dt, explode, time) {
    for (const it of items) {
      const e = explode;
      const bob = Math.sin(time * 1.2 + it.phase) * 0.05;

      dummy.position.set(
        it.base.x + it.burst.x * e,
        it.base.y + it.burst.y * e + bob,
        it.base.z + it.burst.z * e
      );
      dummy.rotation.set(
        it.rot.x + time * it.spin,
        it.rot.y + time * it.spin * 0.7,
        it.rot.z
      );
      const s = it.scaleBase * (1 - e * 0.25);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      it.mesh.setMatrixAt(it.index, dummy.matrix);
    }
    boxMesh.instanceMatrix.needsUpdate = true;
    bellMesh.instanceMatrix.needsUpdate = true;
  }

  // 先摆一次，避免第一帧出现在原点
  update(0, 0, 0);

  return { group, update };
}

/* ---------------- 导出 ---------------- */

export function createTree() {
  const group = new THREE.Group();

  const { points, uniforms } = createParticles();
  const star = createStar();
  const ornaments = createOrnaments();

  // 地面光晕，让树不像是浮在空中
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(7.5, 64),
    new THREE.MeshBasicMaterial({
      map: makeGlowTexture(),
      color: 0x5fd3a0,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -HEIGHT / 2 - 0.06;

  group.add(points, star, ornaments.group, ground);

  const groundMaterial = ground.material;

  let explode = 0;
  let target = 0;
  let spin = 0;

  return {
    group,
    points,
    star,
    setExploded(value) {
      target = value ? 1 : 0;
    },
    get explode() {
      return explode;
    },
    update(dt, time, audioLevel = 0) {
      // 散开快一点，收回来慢一点，手感更好
      const speed = target > explode ? 3.2 : 1.6;
      explode += (target - explode) * Math.min(1, dt * speed);
      if (Math.abs(target - explode) < 0.001) explode = target;

      uniforms.uExplode.value = explode;
      uniforms.uTime.value = time;
      uniforms.uAudio.value = audioLevel;

      // 缓慢自转（树在右侧固定位置，靠自身旋转带出层次）
      spin += dt * (0.16 + explode * 0.5);
      group.rotation.y = spin;

      // 顶星是平面图形，抵消掉树的整体自转，避免转到侧面变成一条线
      star.rotation.y = -spin + Math.sin(time * 0.55) * 0.18;
      star.rotation.z = Math.sin(time * 0.8) * 0.07;
      const glow = star.userData.glow;
      glow.scale.setScalar(2.7 + Math.sin(time * 2.0) * 0.25);
      glow.material.opacity = 0.48 + Math.sin(time * 2.0) * 0.1;

      groundMaterial.opacity = 0.22 * (1 - explode * 0.85);

      ornaments.update(dt, explode, time);
    },
  };
}
