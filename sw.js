// Service Worker do Simplifica Projetos.
//
// Objetivo é só o essencial pra virar um PWA instalável de verdade e não
// quebrar com uma tela de erro do navegador quando a conexão cai: guarda em
// cache a "casca" do app (o HTML, o manifesto, os ícones) e serve isso se a
// rede falhar. Tudo que não é essa casca (Firebase, Cloud Functions, CDNs
// de libs) passa direto pela rede, sem cache — dados de verdade nunca podem
// vir de uma cópia velha guardada aqui.
const CACHE_NAME = 'simplifica-shell-v2';
const SHELL_FILES = [
  './',
  './index.html',
  './app.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(
        nomes.filter((nome) => nome !== CACHE_NAME).map((nome) => caches.delete(nome))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // só intercepta pedidos do próprio site (mesma origem); qualquer coisa de
  // fora (Firebase, Cloud Functions, CDN de fontes/libs) passa direto,
  // exatamente como se não houvesse Service Worker nenhum.
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  const ehArquivoDaCasca = SHELL_FILES.some((f) => url.pathname.endsWith(f.replace('./', '/')) || url.pathname === '/');

  if (!ehArquivoDaCasca) return; // deixa passar direto, sem cache

  // "network first": tenta a rede pra sempre pegar a versão mais nova;
  // só usa o cache se a rede falhar (offline) — assim uma atualização do
  // app aparece na hora pra quem está online, e quem está offline ainda
  // consegue abrir o app em vez de ver a tela de erro do navegador.
  event.respondWith(
    fetch(event.request)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return resposta;
      })
      .catch(() => caches.match(event.request))
  );
});
