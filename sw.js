const CACHE_NAME = 'jd-ventas-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network first, fallback to cache — SOLO para peticiones a nuestra
// propia página. Todo lo que vaya hacia otro dominio (Firebase, Firestore,
// gstatic.com, etc.) se deja pasar de largo sin tocar, para no arriesgarnos
// a interferir con esas conexiones (antes se interceptaba todo, sin excepción).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(r => r || caches.match('./index.html')))
  );
});

// ============== Firebase Cloud Messaging (notificaciones push) ==============
// Esto permite que lleguen notificaciones de pagos por vencer aunque la app
// esté cerrada. Usa los mismos datos de conexión que ya tiene index.html.
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyC69lkoZW-dfD_W55T54hMMJRwhXmCAjpo",
  authDomain: "jdventas-a6afa.firebaseapp.com",
  projectId: "jdventas-a6afa",
  storageBucket: "jdventas-a6afa.firebasestorage.app",
  messagingSenderId: "924830739264",
  appId: "1:924830739264:web:e1980ec2a8e2484075a8a5"
});

const messaging = firebase.messaging();

// Se dispara cuando llega una notificación y la app/pestaña NO está abierta
// (o está en segundo plano). Aquí es donde se muestra el aviso al usuario.
messaging.onBackgroundMessage((payload) => {
  const titulo = (payload.notification && payload.notification.title) || 'J.D Ventas';
  const opciones = {
    body: (payload.notification && payload.notification.body) || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: 'jd-ventas-pago'
  };
  self.registration.showNotification(titulo, opciones);
});

// Al tocar la notificación, abre la app (o la enfoca si ya está abierta).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
