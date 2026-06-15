// Runs in MAIN world at document_start.
// Intercepts Facebook GraphQL API responses to extract video playable_url values,
// then downloads the video when inject.js dispatches sa:facebook-download-video.
(function () {
    'use strict';

    // postId (string) → CDN video URL
    var fbVideoUrls = new Map();

    // ─── Recursive response walker ────────────────────────────────────────────
    // Walks any nested JSON object. When it finds an object with `playable_url`,
    // it stores url keyed by every `id`-like field found on that object AND its
    // parent, so we can match against whichever ID our inject.js extracts from DOM.

    function walk(obj, parentId) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
            if (Array.isArray(obj)) {
                obj.forEach(function (item) { walk(item, parentId); });
            }
            return;
        }

        var selfId = String(obj.id || obj.story_id || obj.legacy_story_id || obj.node_id || parentId || '');

        var url = obj.playable_url_quality_hd || obj.playable_url ||
                  obj.browser_native_hd_url   || obj.browser_native_sd_url || '';
        if (url && url.startsWith('http')) {
            // Unescape FB's unicode escaping (& → &)
            url = url.replace(/\\u([\dA-Fa-f]{4})/g, function(_, h) { return String.fromCharCode(parseInt(h, 16)); });
            if (selfId) {
                fbVideoUrls.set(selfId, url);
                console.log('[SA fb-api] cached video:', selfId, '→', url.slice(0, 80));
            } else {
                // Store under a timestamp key as last-resort fallback
                var ts = 't' + Date.now();
                fbVideoUrls.set(ts, url);
            }
            if (fbVideoUrls.size > 300) fbVideoUrls.delete(fbVideoUrls.keys().next().value);
        }

        Object.keys(obj).forEach(function (k) {
            var v = obj[k];
            if (v && typeof v === 'object') walk(v, selfId || parentId);
        });
    }

    function processFBResponse(data) {
        if (!data || typeof data !== 'object') return;
        walk(data, null);
    }

    // ─── fetch interception ───────────────────────────────────────────────────

    function isFBGraphQL(url) {
        return url && url.includes('facebook.com') &&
               (url.includes('/api/graphql') || url.includes('/ajax/') || url.includes('/video/'));
    }

    var origFetch = window.fetch;
    window.fetch = function (resource, options) {
        var url = typeof resource === 'string' ? resource : (resource && resource.url) || '';
        if (url && url.includes('facebook.com')) {
            console.log('[SA fb-api] fetch:', url.slice(0, 120));
        }
        var promise = origFetch.apply(this, arguments);
        if (isFBGraphQL(url)) {
            promise = promise.then(function (resp) {
                resp.clone().json().then(processFBResponse).catch(function () {});
                return resp;
            });
        }
        return promise;
    };

    // ─── XHR interception ────────────────────────────────────────────────────

    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
        this._saFbUrl = typeof url === 'string' ? url : '';
        if (this._saFbUrl && this._saFbUrl.includes('facebook.com')) {
            console.log('[SA fb-api] XHR:', this._saFbUrl.slice(0, 120));
        }
        return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        if (isFBGraphQL(xhr._saFbUrl)) {
            xhr.addEventListener('load', function () {
                try { processFBResponse(JSON.parse(xhr.responseText)); } catch (_) {}
            });
        }
        return origSend.apply(this, arguments);
    };

    // ─── Download handler ─────────────────────────────────────────────────────

    function doDownload(cdnUrl, filename) {
        console.log('[SA fb-api] downloading:', cdnUrl.slice(0, 100));
        origFetch(cdnUrl, { credentials: 'include' })
            .then(function (resp) {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.blob();
            })
            .then(function (blob) {
                var blobUrl = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(function () {
                    if (a.parentNode) a.parentNode.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                }, 15000);
            })
            .catch(function (err) { console.error('[SA fb-api] download error:', err); });
    }

    document.addEventListener('sa:facebook-download-video', function (ev) {
        if (!ev.detail) return;
        var postId   = String(ev.detail.postId || '');
        var filename = ev.detail.filename || 'facebook_video.mp4';

        console.log('[SA fb-api] download request | postId:', postId, '| cache size:', fbVideoUrls.size);

        // Direct hit by postId
        var url = fbVideoUrls.get(postId);
        if (url) { doDownload(url, filename); return; }

        console.warn('[SA fb-api] no video URL found in cache for postId:', postId,
                     '| known keys:', [...fbVideoUrls.keys()].slice(-5));
    });

    // Probe window for any FB state that might contain video URLs
    setTimeout(function() {
        var fbKeys = Object.keys(window).filter(function(k) {
            return /relay|preload|initial|__bbox|bigpipe|bootload|resource|__data/i.test(k);
        });
        console.log('[SA fb-api] FB window keys:', fbKeys);

        // Check PerformanceResourceTiming for any fbcdn.net video requests
        var perf = window.performance.getEntriesByType('resource').filter(function(e) {
            return e.name.includes('fbcdn.net');
        });
        console.log('[SA fb-api] fbcdn.net resource entries (' + perf.length + '):');
        // Sort by size descending — largest are most likely video segments
        perf.sort(function(a,b) { return (b.transferSize||0) - (a.transferSize||0); });
        perf.slice(0, 15).forEach(function(e) {
            console.log('  initiator=' + e.initiatorType + ' size=' + e.transferSize + ' url=' + e.name.slice(0, 150));
        });
    }, 3000);

    console.log('[SA fb-api] MAIN WORLD LOADED');
})();
