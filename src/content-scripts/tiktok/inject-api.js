// Runs in MAIN world at document_start.
// Builds a map of aweme_id → CDN video URL by:
//   1. Parsing TikTok's embedded SSR state (SIGI_STATE / __UNIVERSAL_DATA_FOR_REHYDRATION__)
//   2. Intercepting fetch/XHR for scroll-loaded feed API responses
// On download, uses React fiber to find the real aweme_id of the visible article (because
// inject.js's postID extraction falls back to a timestamp when no /video/ link exists in DOM).
(function () {
    'use strict';
    console.log('[SA inject-api] MAIN WORLD LOADED');

    // aweme_id (string) → CDN video URL
    var apiVideoUrls = new Map();

    // ─── URL-based aweme_id tracking ─────────────────────────────────────────
    // TikTok updates the URL to /@user/video/AWEME_ID via pushState/replaceState
    // as the user scrolls through the For You feed. This is the most reliable
    // way to know which video is currently displayed.

    function extractAwemeIdFromUrl(url) {
        var m = String(url || '').match(/\/video\/(\d{10,})/);
        return m ? m[1] : null;
    }

    var currentUrlAwemeId = extractAwemeIdFromUrl(window.location.href);

    var origPushState = history.pushState;
    history.pushState = function (state, title, url) {
        var result = origPushState.apply(this, arguments);
        if (url) currentUrlAwemeId = extractAwemeIdFromUrl(url) || currentUrlAwemeId;
        console.log('[SA inject-api] pushState → aweme_id:', currentUrlAwemeId);
        return result;
    };

    var origReplaceState = history.replaceState;
    history.replaceState = function (state, title, url) {
        var result = origReplaceState.apply(this, arguments);
        if (url) currentUrlAwemeId = extractAwemeIdFromUrl(url) || currentUrlAwemeId;
        return result;
    };

    window.addEventListener('popstate', function () {
        currentUrlAwemeId = extractAwemeIdFromUrl(window.location.href) || currentUrlAwemeId;
    });

    // ─── URL helpers ─────────────────────────────────────────────────────────

    function isVideoUrl(url) {
        if (!url || !/^https?:\/\//.test(url)) return false;
        if (!/tiktokcdn|tiktokv|ibytedtos|tiktok\.com/i.test(url)) return false;
        if (!/(mime_type=video|video_mp4|bytevc|hev1|hvc1|\.mp4|\.m3u8)/i.test(url)) return false;
        if (/ttwstatic\.com/.test(url)) return false;
        return true;
    }

    // Pick the best URL from a video object, preferring *.tiktok.com (same cookie domain).
    function pickBestUrl(video) {
        if (!video) return null;

        function fromList(list) {
            if (!Array.isArray(list) || !list.length) return null;
            return list.find(function (u) { return isVideoUrl(u) && /tiktok\.com/.test(u); })
                || list.find(function (u) { return isVideoUrl(u); })
                || null;
        }

        function resolveAddr(addr) {
            if (!addr) return null;
            if (typeof addr === 'string') return isVideoUrl(addr) ? addr : null;
            return fromList(addr.urlList || addr.url_list || addr.UrlList || []);
        }

        var url = resolveAddr(video.playAddr || video.play_addr)
               || resolveAddr(video.downloadAddr || video.download_addr);
        if (url) return url;

        // bitrateInfo fallback
        var bitrates = video.bitrateInfo || video.bitrate_info || [];
        for (var i = 0; i < bitrates.length; i++) {
            var pa = bitrates[i].PlayAddr || bitrates[i].play_addr;
            url = resolveAddr(pa);
            if (url) return url;
        }
        return null;
    }

    // ─── Page-state parsing (SSR data, runs synchronously or at DOMContentLoaded) ──

    function extractFromObj(data) {
        if (!data || typeof data !== 'object') return;

        // Pattern A: SIGI_STATE → ItemModule → { aweme_id: { video: {...} } }
        var itemModule = data.ItemModule;
        if (itemModule && typeof itemModule === 'object') {
            Object.keys(itemModule).forEach(function (id) {
                var item = itemModule[id];
                var url = item && pickBestUrl(item.video);
                if (url) {
                    apiVideoUrls.set(String(id), url);
                    console.log('[SA inject-api] SIGI_STATE cached:', id, '→', url.slice(0, 80));
                }
            });
        }

        // Pattern B: __UNIVERSAL_DATA_FOR_REHYDRATION__ → __DEFAULT_SCOPE__ → webapp.* → itemInfo.itemStruct
        var scope = data.__DEFAULT_SCOPE__;
        if (scope && typeof scope === 'object') {
            Object.keys(scope).forEach(function (k) {
                var s = scope[k];
                if (!s || typeof s !== 'object') return;
                // Single-item detail page
                var itemStruct = s.itemInfo && s.itemInfo.itemStruct;
                if (itemStruct && itemStruct.id) {
                    var url = pickBestUrl(itemStruct.video);
                    if (url) apiVideoUrls.set(String(itemStruct.id), url);
                }
                // Lists
                var items = s.itemList || s.aweme_list || [];
                items.forEach(function (item) {
                    var id = String(item.id || item.aweme_id || '');
                    var url = id && pickBestUrl(item.video);
                    if (url) apiVideoUrls.set(id, url);
                });
            });
        }
    }

    function parseEmbeddedState() {
        ['SIGI_STATE', 'sigi-persisted-data', '__UNIVERSAL_DATA_FOR_REHYDRATION__'].forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            try { extractFromObj(JSON.parse(el.textContent || el.innerText)); } catch (_) {}
        });
        // Also try window variables
        ['SIGI_STATE', '__UNIVERSAL_DATA_FOR_REHYDRATION__'].forEach(function (k) {
            if (window[k]) { try { extractFromObj(window[k]); } catch (_) {} }
        });
        console.log('[SA inject-api] page state parsed — cache size:', apiVideoUrls.size);
    }

    function debugPageState() {
        // Print every <script> tag with an id or type=application/json so we know what exists
        var scriptIds = [];
        document.querySelectorAll('script[id], script[type="application/json"]').forEach(function(s) {
            scriptIds.push(s.id || ('(no-id type=' + s.type + ')'));
        });
        console.log('[SA inject-api] script tags on page:', scriptIds);

        // Print window keys that might be TikTok state
        var winKeys = Object.keys(window).filter(function(k) {
            return /sigi|tiktok|next_data|universal|state|app_context/i.test(k);
        });
        console.log('[SA inject-api] window state keys:', winKeys);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { parseEmbeddedState(); debugPageState(); });
    } else {
        parseEmbeddedState();
        debugPageState();
    }

    // ─── JSON.parse interception ──────────────────────────────────────────────
    // TikTok calls JSON.parse to hydrate its SSR state regardless of script tag ID.
    // Intercept here so we catch state data no matter what the tag is named.
    var origJsonParse = JSON.parse;
    JSON.parse = function (text) {
        var result = origJsonParse.apply(this, arguments);
        if (text && text.length > 500 && result && typeof result === 'object') {
            if (result.ItemModule || result.__DEFAULT_SCOPE__ ||
                result.itemList || result.item_list || result.aweme_list) {
                extractFromObj(result);
            }
        }
        return result;
    };

    // ─── fetch / XHR interception (scroll-loaded feed pages) ─────────────────

    function isFeedApi(url) {
        return url && /tiktok\.com.*(\/api\/|\/aweme\/)/.test(url);
    }

    function processApiData(data) {
        if (!data || typeof data !== 'object') return;
        var items = data.itemList || data.item_list || data.aweme_list ||
                    (data.data && (data.data.itemList || data.data.aweme_list)) || [];
        items.forEach(function (item) {
            var id = String(item.id || item.aweme_id || '');
            var url = id && pickBestUrl(item.video);
            if (url) {
                apiVideoUrls.set(id, url);
                if (apiVideoUrls.size > 200) apiVideoUrls.delete(apiVideoUrls.keys().next().value);
            }
        });
    }

    var origFetch = window.fetch;
    window.fetch = function (resource, options) {
        var url = typeof resource === 'string' ? resource : (resource && resource.url) || '';
        var promise = origFetch.apply(this, arguments);
        if (isFeedApi(url)) {
            promise = promise.then(function (resp) {
                resp.clone().json().then(processApiData).catch(function () {});
                return resp;
            });
        }
        return promise;
    };

    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        this._saUrl = typeof url === 'string' ? url : '';
        return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        if (isFeedApi(xhr._saUrl)) {
            xhr.addEventListener('load', function () {
                try { processApiData(JSON.parse(xhr.responseText)); } catch (_) {}
            });
        }
        return origSend.apply(this, arguments);
    };

    // ─── React fiber aweme_id extraction ─────────────────────────────────────
    // TikTok's code is minified so we can't rely on prop field names.
    // Instead, scan ALL prop values recursively for a 19-digit number starting with 7
    // that is ALREADY IN the API cache — this eliminates false positives like user IDs.

    function findCachedVideoId(val, depth) {
        if (val === null || val === undefined) return null;
        var str = (typeof val === 'string') ? val : (typeof val === 'number') ? String(val) : null;
        // Must match TikTok video ID format AND already be in our cache
        if (str && /^7\d{18}$/.test(str) && apiVideoUrls.has(str)) return str;
        if (depth >= 3 || typeof val !== 'object' || Array.isArray(val)) return null;
        var keys = Object.keys(val);
        for (var i = 0; i < Math.min(keys.length, 50); i++) {
            try {
                var found = findCachedVideoId(val[keys[i]], depth + 1);
                if (found) return found;
            } catch (_) {}
        }
        return null;
    }

    // Walk fiber tree downward (child + sibling). Catches non-DOM React components that
    // hold awemeId in memoizedProps but don't render a DOM element with __reactProps$.
    function walkFiberDown(fiber, counter) {
        if (!fiber || counter[0] > 500) return null;
        counter[0]++;
        try {
            var id = findCachedVideoId(fiber.memoizedProps || fiber.pendingProps, 0);
            if (id) return id;
        } catch (_) {}
        var fromChild = walkFiberDown(fiber.child, counter);
        if (fromChild) return fromChild;
        return walkFiberDown(fiber.sibling, counter);
    }

    function getAwemeIdFromElement(el) {
        // Strategy 1: check __reactProps$ on the article and all child DOM elements
        var nodes = [el];
        try {
            var ch = el.querySelectorAll('*');
            for (var c = 0; c < Math.min(ch.length, 80); c++) nodes.push(ch[c]);
        } catch (_) {}

        for (var ni = 0; ni < nodes.length; ni++) {
            var propsKey = null;
            try { propsKey = Object.keys(nodes[ni]).find(function (k) { return k.startsWith('__reactProps$'); }); } catch (_) {}
            if (!propsKey) continue;
            try {
                var id = findCachedVideoId(nodes[ni][propsKey], 0);
                if (id) return id;
            } catch (_) {}
        }

        var fiberKey = null;
        try { fiberKey = Object.keys(el).find(function (k) { return k.startsWith('__reactFiber$'); }); } catch (_) {}
        if (fiberKey) {
            // Strategy 2: walk fiber.return chain upward (finds ancestor component context)
            var fiber = el[fiberKey];
            for (var fl = 0; fiber && fl < 40; fl++) {
                try {
                    var id = findCachedVideoId(fiber.memoizedProps || fiber.pendingProps, 0);
                    if (id) return id;
                } catch (_) {}
                fiber = fiber.return;
            }
            // Strategy 3: walk fiber tree downward (finds non-DOM child components)
            var found = walkFiberDown(el[fiberKey], [0]);
            if (found) return found;
        }
        return null;
    }

    // ─── Fetch + anchor download ──────────────────────────────────────────────

    function doDownload(cdnUrl, filename) {
        console.log('[SA inject-api] fetching:', cdnUrl.slice(0, 100));
        origFetch(cdnUrl, { credentials: 'include' })
            .then(function (resp) {
                var ct = resp.headers.get('content-type') || '';
                console.log('[SA inject-api] status:', resp.status, '| content-type:', ct);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.blob();
            })
            .then(function (blob) {
                console.log('[SA inject-api] blob:', blob.size, 'bytes | type:', blob.type);
                var blobUrl = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                console.log('[SA inject-api] anchor clicked');
                setTimeout(function () {
                    if (a.parentNode) a.parentNode.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                }, 15000);
            })
            .catch(function (err) { console.error('[SA inject-api] error:', err); });
    }

    // ─── Download request handler ─────────────────────────────────────────────

    document.addEventListener('sa:tiktok-download-video', function (ev) {
        if (!ev.detail) return;
        var postId   = ev.detail.postId;
        var filename = ev.detail.filename || 'tiktok_video.mp4';

        console.log('[SA inject-api] download | postId:', postId,
                    '| currentUrlAwemeId:', currentUrlAwemeId,
                    '| api cache size:', apiVideoUrls.size);

        // 1. URL-tracked aweme_id — most reliable: TikTok pushState → /@user/video/AWEME_ID
        if (currentUrlAwemeId) {
            var url = apiVideoUrls.get(currentUrlAwemeId);
            if (url) { console.log('[SA inject-api] hit url-tracked aweme_id'); doDownload(url, filename); return; }
            console.log('[SA inject-api] url aweme_id', currentUrlAwemeId, 'not in cache yet');
        }

        // 2. Direct lookup with postId (works on detail page where extract gets real ID)
        var url = apiVideoUrls.get(String(postId));
        if (url) { console.log('[SA inject-api] hit direct cache'); doDownload(url, filename); return; }

        // 3. React fiber: walk the visible article to get the real aweme_id
        var postSel = 'article[data-e2e="recommend-list-item-container"], article';
        var articles = document.querySelectorAll(postSel);
        var awemeId  = null;
        for (var i = 0; i < articles.length; i++) {
            var rect = articles[i].getBoundingClientRect();
            var inView = rect.top < window.innerHeight * 0.8 && rect.bottom > window.innerHeight * 0.2;
            if (inView) {
                awemeId = getAwemeIdFromElement(articles[i]);
                console.log('[SA inject-api] fiber aweme_id from article', i, ':', awemeId);
                if (awemeId) break;
            }
        }

        if (awemeId) {
            url = apiVideoUrls.get(awemeId);
            if (url) { console.log('[SA inject-api] hit fiber+cache'); doDownload(url, filename); return; }
            console.warn('[SA inject-api] fiber id', awemeId, 'not in cache — known ids:', [...apiVideoUrls.keys()].slice(-5));
        } else {
            // Print what React keys actually exist on the first visible article to help diagnose
            var firstArticle = articles[0];
            if (firstArticle) {
                var allKeys = [];
                try { allKeys = Object.keys(firstArticle).filter(function(k) { return k.startsWith('__'); }); } catch(_) {}
                console.warn('[SA inject-api] React fiber found no aweme_id | article __ keys:', allKeys,
                             '| known ids:', [...apiVideoUrls.keys()].slice(-5));
            } else {
                console.warn('[SA inject-api] no articles found in DOM');
            }
        }
    });
})();
