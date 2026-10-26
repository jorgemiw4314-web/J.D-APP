const CACHE_NAME = 'jd-ventas-v5';
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

// Fetch: red primero, pero con límite de espera — SOLO para peticiones a
// nuestra propia página. Todo lo que vaya hacia otro dominio (Firebase,
// Firestore, gstatic.com, etc.) se deja pasar de largo sin tocar.
// Antes, si los datos móviles estaban conectados pero lentos o trabados, la
// app se quedaba en blanco esperando la red, porque la copia guardada solo se
// usaba cuando la red FALLABA, no cuando tardaba. Ahora, si la red no responde
// en 3 segundos y hay copia guardada, se abre la copia al instante y la red
// sigue en segundo plano actualizando la copia para la próxima vez.
// cache: 'no-cache' obliga a preguntarle al servidor si hay versión nueva,
// en vez de usar la copia que el navegador guarda hasta 10 min.
const ESPERA_RED_MS = 3000;
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const red = fetch(event.request, { cache: 'no-cache' }).then((response) => {
      // Solo guardar en caché respuestas buenas (no errores 404/500)
      if (response && response.ok) cache.put(event.request, response.clone());
      return response;
    });
    const copia = (await cache.match(event.request)) ||
      (event.request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (!copia) return red; // primera vez sin copia: no queda más que esperar la red
    event.waitUntil(red.catch(() => {})); // deja terminar la actualización en segundo plano
    try {
      const espera = new Promise((resolve) => setTimeout(() => resolve(null), ESPERA_RED_MS));
      const respuesta = await Promise.race([red, espera]);
      if (respuesta) return respuesta;
    } catch (e) { /* sin red: usamos la copia */ }
    return copia;
  })());
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
