import * as THREE from './vendor/three.module.js';

/** 飘雪：一个盒子里循环下落的粒子，落到底就回到顶部 */

function makeSnowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(226,240,255,0.55)');
  g.addColorStop(1, 'rgba(200,225,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSnow(count = 1600) {
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);

  const W = 26;
  const H = 22;
  const D = 26;

  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * W;
    positions[i * 3 + 1] = (Math.random() - 0.5) * H;
    positions[i * 3 + 2] = (Math.random() - 0.5) * D;
    speeds[i] = 0.25 + Math.random() * 0.9;
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.085,
    map: makeSnowTexture(),
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  return {
    points,
    update(dt, time) {
      const pos = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        pos[i3 + 1] -= speeds[i] * dt;
        pos[i3 + 0] += Math.sin(time * 0.6 + phases[i]) * dt * 0.35;
        pos[i3 + 2] += Math.cos(time * 0.5 + phases[i]) * dt * 0.25;

        if (pos[i3 + 1] < -H / 2) {
          pos[i3 + 1] = H / 2;
          pos[i3 + 0] = (Math.random() - 0.5) * W;
          pos[i3 + 2] = (Math.random() - 0.5) * D;
        }
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
