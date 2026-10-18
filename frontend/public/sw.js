// Network-only: private chats, API responses and credentials never enter Cache Storage.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(() => new Response(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#141414"><title>AI Router · Offline</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#141414;color:#eee;font:16px system-ui}main{padding:28px;max-width:380px}p{color:#aaa;line-height:1.6}a{display:inline-block;background:#6567ed;color:white;padding:12px 20px;border-radius:12px;text-decoration:none}</style>
<main><h1>AI Router</h1><h2>Нет соединения</h2><p>Для чатов и задач нужен доступ к серверу. Проверьте подключение к интернету и попробуйте снова.</p><a href="/">Повторить</a></main></html>`, {
    status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })));
});
