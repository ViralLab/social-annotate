// Runs in MAIN world at document_start.
// Intercepts YouTube's player API responses to cache streaming URLs,
// deciphers the signature and n-parameter using YouTube's own player.js,
// then downloads via postMessage → inject.js → chrome.runtime → background.
(function () {
    'use strict';
    console.log('[SA yt-api] MAIN WORLD LOADED');

    var videoUrlCache = new Map();
    var origFetch = window.fetch;
    var origJsonParse = JSON.parse;

    // ─── URL filter ───────────────────────────────────────────────────────────

    function isPlayerUrl(url) {
        return url && /youtube\.com\/youtubei\/v1\/(player|shorts_sequence)/.test(url);
    }

    // ─── Extract video URL from player response ───────────────────────────────

    function extractFromPlayerResponse(data) {
        if (!data || typeof data !== 'object') return;
        var videoId = data.videoDetails && data.videoDetails.videoId;
        if (!videoId) return;
        var formats = (data.streamingData && data.streamingData.formats) || [];
        var url = null;
        [22, 18].forEach(function (itag) {
            if (!url) {
                var f = formats.find(function (f) { return f.itag === itag && f.url; });
                if (f) url = f.url;
            }
        });
        if (!url) { var any = formats.find(function (f) { return !!f.url; }); if (any) url = any.url; }
        if (url) {
            videoUrlCache.set(videoId, url);
            if (videoUrlCache.size > 50) videoUrlCache.delete(videoUrlCache.keys().next().value);
            console.log('[SA yt-api] cached:', videoId, '→', url.slice(0, 80));
        }
    }

    // ─── <video>.src interception — captures deciphered URL if YouTube sets it directly ──

    var origSrcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (origSrcDesc && origSrcDesc.set) {
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
            set: function (val) {
                if (val && typeof val === 'string' && val.includes('googlevideo.com') && !val.startsWith('blob:')) {
                    var m = val.match(/[?&]id=([a-zA-Z0-9_-]{11})/);
                    var vid = (m && m[1]) ||
                              (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.videoDetails &&
                               window.ytInitialPlayerResponse.videoDetails.videoId);
                    if (vid) {
                        videoUrlCache.set(vid, val);
                        if (videoUrlCache.size > 50) videoUrlCache.delete(videoUrlCache.keys().next().value);
                        console.log('[SA yt-api] video.src → cached for', vid);
                    }
                }
                return origSrcDesc.set.call(this, val);
            },
            get: function () { return origSrcDesc.get.call(this); },
            configurable: true, enumerable: true
        });
    }

    // ─── JSON.parse interception ──────────────────────────────────────────────

    JSON.parse = function (text) {
        var result = origJsonParse.apply(this, arguments);
        if (text && text.length > 200 && result && typeof result === 'object') {
            if (result.streamingData || result.videoDetails) extractFromPlayerResponse(result);
        }
        return result;
    };

    function parseInitialResponse() {
        if (window.ytInitialPlayerResponse) extractFromPlayerResponse(window.ytInitialPlayerResponse);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', parseInitialResponse);
    } else { parseInitialResponse(); }

    // ─── fetch interception ───────────────────────────────────────────────────
    // Also intercept actual googlevideo.com requests: YouTube's player has already
    // deciphered the n-parameter before making these calls, so capturing them gives
    // us working download URLs without needing to re-implement the n-decipher.

    function _stripRange(url) {
        return url
            .replace(/([?&])range=[^&]*/g, function (m, sep) { return sep === '?' ? '?' : ''; })
            .replace(/\?&/, '?').replace(/&&/g, '&').replace(/[?&]$/, '');
    }

    window.fetch = function (resource, options) {
        var url = typeof resource === 'string' ? resource : (resource && resource.url) || '';
        var promise = origFetch.apply(this, arguments);

        if (isPlayerUrl(url)) {
            promise = promise.then(function (resp) {
                resp.clone().json().then(extractFromPlayerResponse).catch(function () {});
                return resp;
            });
        }

        // Capture deciphered streaming URLs from YouTube's own player.
        // All itags accepted — YouTube's player deciphers n BEFORE calling fetch, so
        // these URLs work without us needing to run the n-transform ourselves.
        // Score: muxed (18/22) > known video/audio itag > itag=0 (unknown type).
        if (url.includes('googlevideo.com') && url.includes('videoplayback')) {
            var curM = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
            if (curM) {
                var curId = curM[1];
                var itagM = url.match(/[?&]itag=(\d+)/);
                var itag = itagM ? parseInt(itagM[1]) : 0;
                var baseUrl = _stripRange(url);
                var existingItag = videoUrlCache.get('live:' + curId + ':itag');
                var MUXED = [17, 18, 22];
                var score = MUXED.includes(itag) ? 100 : (itag > 0 ? 50 : 1);
                var existingScore = existingItag === undefined ? 0
                    : (MUXED.includes(existingItag) ? 100 : (existingItag > 0 ? 50 : 1));
                if (score > existingScore) {
                    videoUrlCache.set('live:' + curId, baseUrl);
                    videoUrlCache.set('live:' + curId + ':itag', itag);
                    console.log('[SA yt-api] captured live url for', curId, 'itag=' + itag, 'score=' + score);
                }
            }
        }

        return promise;
    };

    // ─── XHR interception ────────────────────────────────────────────────────

    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        this._saUrl = typeof url === 'string' ? url : '';
        return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        if (isPlayerUrl(xhr._saUrl)) {
            xhr.addEventListener('load', function () {
                try { extractFromPlayerResponse(origJsonParse(xhr.responseText)); } catch (_) {}
            });
        }
        return origSend.apply(this, arguments);
    };

    // ─── Player.js cipher infrastructure ─────────────────────────────────────
    // We fetch YouTube's player.js (same origin — no CORS) and extract two functions:
    //   1. Signature cipher (for signatureCipher format URLs)
    //   2. n-transform (for the n= throttling parameter in ALL URLs)
    // Both are cached together so player.js is only fetched once per session.

    var _playerJsCache = { url: null, cipherFn: null, nFn: null };

    function _getPlayerJsUrl() {
        try {
            var u = (window.ytcfg && window.ytcfg.get && window.ytcfg.get('PLAYER_JS_URL')) ||
                    (window.yt && window.yt.config_ && window.yt.config_.PLAYER_JS_URL);
            if (u) return u.startsWith('http') ? u : 'https://www.youtube.com' + u;
        } catch (e) {}
        var s = document.querySelector('script[src*="base.js"]');
        return s ? s.src : null;
    }

    // Signature cipher: splits sig, applies helper object transforms, joins
    function _extractCipherFn(js) {
        var m = js.match(/\b(\w+)=function\((\w+)\)\{\2=\2\.split\(""\);([\s\S]{20,3000}?)return \2\.join\(""\)\}/);
        if (!m) return null;
        var argName = m[2], bodyCode = m[3];
        var hm = bodyCode.match(/^(\w+)\.|;(\w+)\./);
        var helperName = hm && (hm[1] || hm[2]);
        if (!helperName) return null;
        var hs = js.indexOf('var ' + helperName + '={');
        if (hs < 0) return null;
        var bi = js.indexOf('{', hs), depth = 0, he = bi;
        for (var i = bi; i < Math.min(js.length, bi + 10000); i++) {
            if (js[i] === '{') depth++;
            else if (js[i] === '}') { depth--; if (depth === 0) { he = i; break; } }
        }
        var helperCode = js.slice(hs, he + 1) + ';';
        try {
            return eval('(function(){\n' + helperCode + '\nreturn function(' + argName + '){\n' +
                        argName + '=' + argName + '.split("");\n' + bodyCode +
                        'return ' + argName + '.join("");\n};\n})()');
        } catch (e) { console.error('[SA yt-api] cipherFn eval failed:', e.message); return null; }
    }

    // n-transform: deciphers the n= throttling parameter in streaming URLs
    function _extractNFn(js) {
        // Find where YouTube transforms n: .get("n"))&&(b=FUNC(b) or FUNC[IDX](b)
        var direct = js.match(/\.get\("n"\)\)&&\([a-zA-Z0-9$]+=([a-zA-Z0-9$]{1,4})\([a-zA-Z0-9$]\)/);
        var arrRef  = js.match(/\.get\("n"\)\)&&\([a-zA-Z0-9$]+=([a-zA-Z0-9$]{1,4})\[(\d+)\]\([a-zA-Z0-9$]\)/);

        if (arrRef) {
            // Array pattern: find the array, extract function at given index
            var arrName = arrRef[1], idx = parseInt(arrRef[2]);
            var arrStart = js.indexOf('var ' + arrName + '=[');
            if (arrStart < 0) { console.warn('[SA yt-api] n-fn array not found:', arrName); return null; }
            var bp = js.indexOf('[', arrStart) + 1;
            var depth2 = 0, fnCount = 0, collecting = false, fnStart = -1;
            for (var j = bp; j < bp + 200000 && j < js.length; j++) {
                if (!collecting && js.slice(j, j + 8) === 'function') {
                    if (fnCount === idx) { fnStart = j; collecting = true; depth2 = 0; }
                    else fnCount++;
                }
                if (collecting) {
                    if (js[j] === '{') depth2++;
                    else if (js[j] === '}') {
                        depth2--;
                        if (depth2 === 0) {
                            try { return eval('(' + js.slice(fnStart, j + 1) + ')'); }
                            catch (e) { console.error('[SA yt-api] n-fn array eval failed:', e.message); return null; }
                        }
                    }
                }
            }
            console.warn('[SA yt-api] n-fn not found at idx', idx, 'in', arrName);
            return null;
        }

        if (direct) {
            // Direct function reference
            var fn = direct[1];
            var dfm = js.match(new RegExp(
                '(?:^|[^a-zA-Z0-9$])' + fn.replace(/[$]/g, '\\$') +
                '=function\\(([a-zA-Z0-9$])\\)\\{([\\s\\S]{20,20000}?)\\}(?=[;,])'
            ));
            if (!dfm) { console.warn('[SA yt-api] n-fn direct def not found:', fn); return null; }
            try { return eval('(function(' + dfm[1] + '){' + dfm[2] + '})'); }
            catch (e) { console.error('[SA yt-api] n-fn direct eval failed:', e.message); return null; }
        }

        // Log surrounding context to help diagnose the actual pattern
        var idx = js.indexOf('.get("n")');
        if (idx > 0) {
            console.log('[SA yt-api] n-fn debug — snippet around .get("n"):', js.slice(Math.max(0, idx - 30), idx + 120));
        }
        console.warn('[SA yt-api] n-fn pattern not found in player.js');
        return null;
    }

    function _loadPlayerJs(jsUrl, callback) {
        if (_playerJsCache.url === jsUrl) { callback(_playerJsCache); return; }
        console.log('[SA yt-api] loading player.js:', jsUrl.slice(-50));
        origFetch(jsUrl).then(function (r) { return r.text(); }).then(function (js) {
            _playerJsCache = { url: jsUrl, cipherFn: _extractCipherFn(js), nFn: _extractNFn(js) };
            console.log('[SA yt-api] player.js loaded | cipherFn:', !!_playerJsCache.cipherFn, '| nFn:', !!_playerJsCache.nFn);
            callback(_playerJsCache);
        }).catch(function (e) {
            console.error('[SA yt-api] player.js load failed:', e);
            callback({ url: null, cipherFn: null, nFn: null });
        });
    }

    function _decipherN(url, nFn) {
        if (!nFn) return url;
        var m = url.match(/[?&]n=([^&]+)/);
        if (!m) return url;
        var n = decodeURIComponent(m[1]);
        try {
            var dec = nFn(n);
            return url.replace(/([?&]n=)[^&]+/, '$1' + encodeURIComponent(dec));
        } catch (e) {
            console.error('[SA yt-api] n-decipher failed:', e.message);
            return url;
        }
    }

    function _parseSignatureCipher(sigStr) {
        var p = {};
        sigStr.split('&').forEach(function (part) {
            var i = part.indexOf('=');
            if (i > 0) p[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1));
        });
        return p;
    }

    function _decipherSignatureCipher(sigStr, pjs, callback) {
        var p = _parseSignatureCipher(sigStr);
        var s = p.s, sp = p.sp || 'sig', baseUrl = p.url;
        if (!s || !baseUrl || !pjs.cipherFn) { callback(null); return; }
        try {
            var signed = baseUrl + '&' + sp + '=' + encodeURIComponent(pjs.cipherFn(s));
            callback(_decipherN(signed, pjs.nFn));
        } catch (e) {
            console.error('[SA yt-api] sig decipher apply failed:', e.message);
            callback(null);
        }
    }

    // ─── Fresh player API call ────────────────────────────────────────────────
    // Same-origin to www.youtube.com → cookies included, no CORS.

    function fetchPlayerUrl(videoId, callback) {
        var apiKey = (window.ytcfg && window.ytcfg.get && window.ytcfg.get('INNERTUBE_API_KEY')) ||
                     'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
        var context = (window.ytcfg && window.ytcfg.get && window.ytcfg.get('INNERTUBE_CONTEXT')) ||
                      { client: { clientName: 'WEB', clientVersion: '2.20231121.08.00' } };
        console.log('[SA yt-api] fetching fresh player data for', videoId);
        origFetch('https://www.youtube.com/youtubei/v1/player?key=' + apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoId: videoId, context: context })
        }).then(function (r) { return r.json(); }).then(function (data) {
            var formats  = (data.streamingData && data.streamingData.formats) || [];
            var adaptive = (data.streamingData && data.streamingData.adaptiveFormats) || [];

            // 1) Direct URL (muxed preferred)
            var url = null;
            [22, 18].forEach(function (itag) {
                if (!url) { var f = formats.find(function (f) { return f.itag === itag && f.url; }); if (f) url = f.url; }
            });
            if (!url) { var any = formats.find(function (f) { return !!f.url; }); if (any) url = any.url; }
            if (!url) {
                var vMp4 = adaptive.filter(function (f) { return f.url && f.mimeType && f.mimeType.startsWith('video/mp4'); });
                vMp4.sort(function (a, b) { return (b.width || 0) - (a.width || 0); });
                if (vMp4.length) url = vMp4[0].url;
            }

            if (url) {
                var jsUrl = _getPlayerJsUrl();
                if (!jsUrl) { callback(url); return; }
                _loadPlayerJs(jsUrl, function (pjs) { callback(_decipherN(url, pjs.nFn)); });
                return;
            }

            // 2) signatureCipher (needs decipher)
            var cf = null;
            [22, 18].forEach(function (itag) {
                if (!cf) { var f = formats.find(function (f) { return f.itag === itag && (f.signatureCipher || f.cipher); }); if (f) cf = f; }
            });
            if (!cf) cf = formats.find(function (f) { return f.signatureCipher || f.cipher; });
            if (!cf) {
                var vMp4c = adaptive.filter(function (f) {
                    return (f.signatureCipher || f.cipher) && f.mimeType && f.mimeType.startsWith('video/mp4');
                });
                vMp4c.sort(function (a, b) { return (b.width || 0) - (a.width || 0); });
                if (vMp4c.length) cf = vMp4c[0];
            }

            if (cf) {
                var sc = cf.signatureCipher || cf.cipher;
                console.log('[SA yt-api] deciphering signatureCipher, itag:', cf.itag);
                var jsUrl2 = _getPlayerJsUrl();
                if (!jsUrl2) { callback(null); return; }
                _loadPlayerJs(jsUrl2, function (pjs) { _decipherSignatureCipher(sc, pjs, callback); });
                return;
            }

            console.warn('[SA yt-api] no format found for', videoId);
            callback(null);
        }).catch(function (err) {
            console.error('[SA yt-api] fresh player fetch failed:', err);
            callback(null);
        });
    }

    // ─── Download request handler ─────────────────────────────────────────────

    document.addEventListener('sa:youtube-download-video', function (ev) {
        if (!ev.detail) return;
        var videoId = ev.detail.videoId;
        var filename = ev.detail.filename || ('youtube_' + videoId + '.mp4');

        // Send a data URL to the isolated world — avoids blob cross-context issue
        // and avoids Referer issue (fetch is made from www.youtube.com MAIN world).
        function sendDataUrl(dataUrl) {
            console.log('[SA yt-api] sending data URL', Math.round(dataUrl.length / 1024) + 'KB');
            window.postMessage({ type: 'SA_YT_VIDEO_URL_READY', videoId: videoId, url: dataUrl, filename: filename }, '*');
        }

        // Last-resort: relay raw URL (background must handle Referer via DNR rule).
        function postRelay(url) {
            console.log('[SA yt-api] relaying raw url:', url.slice(0, 100));
            window.postMessage({ type: 'SA_YT_VIDEO_URL_READY', videoId: videoId, url: url, filename: filename }, '*');
        }

        // Fetch video from MAIN world context (www.youtube.com origin → proper cookies/Referer),
        // convert to base64 data URL, then send to isolated world → background.
        // Falls back to postRelay if the fetch fails or the file is too large.
        function mainWorldFetch(url, fallback) {
            console.log('[SA yt-api] MAIN world fetch itag:', videoUrlCache.get('live:' + videoId + ':itag') || '?', url.slice(0, 80));
            origFetch(url).then(function (r) {
                var ct = r.headers.get('content-type') || '';
                var cl = parseInt(r.headers.get('content-length') || '0', 10);
                console.log('[SA yt-api] response:', r.status, ct, 'len:', cl);
                if (!r.ok) throw new Error('HTTP ' + r.status);
                if (ct && /vnd\.yt-ump/.test(ct)) throw new Error('yt-ump (use direct download)');
                if (ct && !/video|audio|octet-stream/.test(ct)) throw new Error('not media: ' + ct);
                if (cl > 100 * 1024 * 1024) throw new Error('too large: ' + cl + 'B');
                return r.blob();
            }).then(function (blob) {
                if (blob.size > 100 * 1024 * 1024) throw new Error('blob too large: ' + blob.size + 'B');
                console.log('[SA yt-api] blob size:', blob.size, 'type:', blob.type);
                var reader = new FileReader();
                reader.onload = function () { sendDataUrl(reader.result); };
                reader.onerror = function () { console.error('[SA yt-api] FileReader error'); if (fallback) fallback(); };
                reader.readAsDataURL(blob);
            }).catch(function (e) {
                console.warn('[SA yt-api] MAIN world fetch failed:', e.message, '— falling back');
                if (fallback) fallback();
            });
        }

        function relay(url) {
            if (!url) { console.warn('[SA yt-api] no url for videoId:', videoId); return; }
            var jsUrl = _getPlayerJsUrl();
            if (!jsUrl) { mainWorldFetch(url, function () { postRelay(url); }); return; }
            _loadPlayerJs(jsUrl, function (pjs) {
                var ready = pjs.nFn ? _decipherN(url, pjs.nFn) : url;
                mainWorldFetch(ready, function () { postRelay(ready); });
            });
        }

        // 1) Live-captured URL (n already deciphered by YouTube's player)
        var liveUrl = videoUrlCache.get('live:' + videoId);
        if (liveUrl) {
            console.log('[SA yt-api] using live url, itag:', videoUrlCache.get('live:' + videoId + ':itag'));
            mainWorldFetch(liveUrl, function () { postRelay(liveUrl); });
            return;
        }

        // 2) Live <video> element src (direct googlevideo, not MSE blob)
        var videos = document.querySelectorAll('video');
        for (var i = 0; i < videos.length; i++) {
            var s = videos[i].src || videos[i].currentSrc;
            if (s && s.includes('googlevideo.com') && !s.startsWith('blob:')) {
                console.log('[SA yt-api] using live video.src');
                relay(s);
                return;
            }
        }

        // 3) Cached URL from player API interception (may need n-decipher)
        var cached = videoUrlCache.get(videoId);
        if (cached) {
            console.log('[SA yt-api] using cached url');
            relay(cached);
            return;
        }

        // 4) Cache miss — fresh player API call
        fetchPlayerUrl(videoId, function (url) {
            if (url) relay(url);
            else console.warn('[SA yt-api] no url found for', videoId);
        });
    });
})();
