const CACHE_NAME = 'devnotes-v1';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

// 1. Install Event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 2. Activate Event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// 3. Fetch Event (ChatGPT + Gemini Optimized Stale-While-Revalidate)
self.addEventListener('fetch', event => {
  // নন-ইন্টারসেপ্টেড রিকোয়েস্ট (যেমন: POST/PUT) গার্ড
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(cachedResponse => {

        const fetchPromise = fetch(event.request)
          .then(networkResponse => {
            // ক্রস-অরিজিন এবং সাকসেসফুল স্ট্যাটাস চেক
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => cachedResponse); // অফলাইন এরর গার্ড

        return cachedResponse || fetchPromise;
      });
    })
  );
});