// ============================================================================
// Lalitha Naturals - Branch Transfer app - Service Worker
// ============================================================================
// WHY THIS FILE EXISTS:
// Chrome on Android will only show a real "Install app" option (instead of a
// plain bookmark shortcut) if the site has BOTH a manifest.json AND a
// registered service worker. This file is that service worker.
//
// IMPORTANT: this is a "business tool", not a blog. All the real data
// (inventory, vendors, stock, etc.) comes live from Google Apps Script.
// Showing old/cached data there could cause real mistakes (wrong stock
// counts, wrong prices). So this service worker is deliberately NOT an
// "offline-first, cache everything" worker. It only helps the basic app
// shell (the HTML/CSS/JS/icons) install and open a bit faster - it never
// caches or replays Google Apps Script responses.
// ============================================================================

// Bump this version string any time you redeploy new shell files (index.html,
// icons, local library files, etc.) so old caches from previous versions get
// cleaned up automatically and everyone picks up the fresh files.
const CACHE_VERSION = 'lalitha-shell-v1';

// Only the genuinely static, rarely-changing "app shell" files go here.
// These are same-origin files that sit next to this service worker.
const SHELL_FILES = [
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './icon-192-maskable.png',
    './icon-512-maskable.png',
    './html2canvas.min.js',
    './jspdf.umd.min.js',
    './xlsx.full.min.js'
];

// ---------------------------------------------------------------------------
// INSTALL: try to pre-cache the app shell files. Wrapped so that one missing
// file (a 404) can never break the whole install - we add files one at a
// time instead of using cache.addAll() (which fails entirely if any single
// file fails).
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        try {
            const cache = await caches.open(CACHE_VERSION);
            await Promise.all(SHELL_FILES.map(async (file) => {
                try {
                    await cache.add(file);
                } catch (err) {
                    // Non-fatal: just skip this one file, don't break install.
                    console.warn('[sw] could not pre-cache', file, err);
                }
            }));
        } catch (err) {
            // Never let a caching problem stop the service worker from installing.
            console.warn('[sw] install caching step failed (non-fatal):', err);
        }
    })());

    // Activate this new service worker right away instead of waiting for all
    // open tabs to be closed first, so an update takes effect immediately.
    self.skipWaiting();
});

// ---------------------------------------------------------------------------
// ACTIVATE: clean up caches left over from older versions of this app, and
// take control of any already-open tabs right away.
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        try {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter((key) => key !== CACHE_VERSION)
                    .map((key) => caches.delete(key))
            );
        } catch (err) {
            console.warn('[sw] cache cleanup failed (non-fatal):', err);
        }
    })());

    self.clients.claim();
});

// ---------------------------------------------------------------------------
// FETCH: this is the important part.
//
// Rule #1 - anything going to Google Apps Script (script.google.com) is real
// business data (inventory, vendors, stock, etc.) and must ALWAYS go live to
// the network. It is never cached and never served from cache, full stop.
//
// Rule #2 - for the app's own static files (same origin), prefer the network
// first (so people always get the latest version when online), and only if
// the network genuinely fails (e.g. the phone is offline) fall back to
// whatever we have in the cache, so the app can still open to a "last known"
// screen instead of a blank error page.
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
    const request = event.request;

    let url;
    try {
        url = new URL(request.url);
    } catch (err) {
        // If the URL can't even be parsed, just let the browser handle it normally.
        return;
    }

    // Rule #1: Google Apps Script calls always go straight to the network.
    // No caching, no fallback - stale inventory/vendor data would be actively
    // harmful for this business, so we never touch the cache for these.
    if (url.hostname.includes('script.google.com') || url.hostname.includes('script.googleusercontent.com')) {
        event.respondWith(fetch(request));
        return;
    }

    // Only handle simple GET requests for the shell/network-first logic below.
    // (POST/PUT/etc. - like any form submissions - should just go straight
    // through untouched.)
    if (request.method !== 'GET') {
        return;
    }

    // Rule #2: network-first, cache as a last-resort fallback for same-origin
    // static app-shell files (index.html, icons, local JS libraries, etc.)
    event.respondWith((async () => {
        try {
            // Always try the real network first so users get fresh content.
            return await fetch(request);
        } catch (networkErr) {
            // Network truly failed (e.g. no internet at all) - try the cache
            // so the app can still open to a "last known" shell.
            try {
                const cached = await caches.match(request);
                if (cached) return cached;
            } catch (cacheErr) {
                console.warn('[sw] cache fallback failed (non-fatal):', cacheErr);
            }
            // Nothing we can do - let the browser show its normal offline error.
            throw networkErr;
        }
    })());
});
