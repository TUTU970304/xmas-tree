/**
 * Service Worker
 *
 * 目标：
 *   1. MediaPipe 的 wasm / 模型（约 18MB）第一次下完就长期缓存，不再因为
 *      GitHub Pages 的 max-age=600 反复重新下载
 *   2. 页面本身：网络优先（保证能看到新版本），断网时回退缓存
 *   3. build.txt 不缓存，它负责「自动跳到最新版本」
 */

// 改了缓存策略就改一下版本号，旧的缓存会在 activate 时被清掉
const VERSION = 'v2';
const CACHE = 'xmas-' + VERSION;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 只处理本站资源
  if (url.origin !== self.location.origin) return;

  // build.txt 必须走网络（版本探测），不能缓存
  if (url.pathname.endsWith('/build.txt')) return;

  // 1) 页面：网络优先，断网用缓存（按各自的 URL 分开存，避免多个页面互相覆盖）
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());

          // 目录首页额外存一份固定键，断网时可以直接回退
          if (new URL(req.url).pathname.endsWith('/')) {
            cache.put('./index.html', res.clone());
          }
          return res;
        } catch (err) {
          const cache = await caches.open(CACHE);
          const hit = (await cache.match(req)) || (await cache.match('./index.html'));
          return hit || Response.error();
        }
      })()
    );
    return;
  }

  // 2) 手势模型 / three.js / 音乐：缓存优先，一次下载长期复用
  if (url.pathname.includes('/js/vendor/') || url.pathname.endsWith('/music.wav')) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // 3) 其它：先给缓存，同时后台更新
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);

      return hit || network;
    })
  );
});
