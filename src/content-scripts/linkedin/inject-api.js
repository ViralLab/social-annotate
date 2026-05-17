/**
 * LinkedIn MAIN-world API interceptor.
 *
 * LinkedIn videos are HLS streams from dms.licdn.com. The URLs are
 * token-signed (e=, t= params) and served with ACAO:* — meaning:
 *   • No session cookies needed (credentials: 'omit')
 *   • Wildcard CORS header means credentials:'include' FAILS (CORS error)
 *
 * Strategy:
 *  1. PerformanceObserver — catches every segment request including those
 *     made by Service Workers or the native player. Groups segments by videoId.
 *  2. fetch() + XHR interceptors — redundant capture for safety.
 *  3. On 'mh:fetch-li-video': fetch all collected segments for the video
 *     WITHOUT credentials, concatenate blobs → data URL.
 */

(function () {
    if (window.__liApiInterceptorInstalled) return;
    window.__liApiInterceptorInstalled = true;

    // videoId → sorted array of segment URLs
    window.__liVideoSegments = {};
    // last seen videoId (used by inject.js as the download target)
    window.__liLastVideoId = null;
    window.__liLastCdnVideoUrl = null; // backward-compat

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    function _isLinkedInCDN(url) {
        return url && (
            url.includes('dms.licdn.com') ||
            url.includes('media.licdn.com') ||
            url.includes('video.licdn.com')
        );
    }

    function _looksLikeVideoSegment(url) {
        const path = url.split('?')[0].toLowerCase();
        // ── Explicit exclusions ──────────────────────────────────────────────
        if (path.endsWith('.vtt') || path.endsWith('.webvtt')) return false;  // subtitles
        if (path.endsWith('.m3u8') || path.endsWith('.mpd'))   return false;  // manifests
        if (path.includes('caption') || path.includes('subtitle')) return false;
        if (path.includes('hls-audio'))  return false;  // audio-only tracks
        if (path.includes('/thumbnail')) return false;  // poster images
        // ── Must look like a video segment ───────────────────────────────────
        // LinkedIn video quality paths: hls-2Mbps-..., hls-720p-..., etc.
        const hasVideoQuality = /hls-[0-9]/.test(path) ||
                                /hls-\d/.test(path) ||
                                path.includes('premium-quality') ||
                                path.includes('hls-video');
        return hasVideoQuality ||
               path.endsWith('.ts') ||
               path.endsWith('.m4s') ||
               (path.includes('/vid/') && !path.endsWith('.m3u8'));
    }

    // Extract the video ID from: /playlist/vid/v2/{videoId}/hls-...
    function _getVideoId(url) {
        try {
            const m = url.match(/\/vid\/v[12]\/([^/]+)/);
            return m ? m[1] : 'unknown';
        } catch (_) { return 'unknown'; }
    }

    // Extract segment index from: .../hls-quality/{hash}/{index}/{timestamp}
    // index is a small integer (< 10000); timestamp is 13 digits
    function _getSegmentIndex(url) {
        try {
            const path = new URL(url).pathname;
            const parts = path.split('/').filter(Boolean);
            for (let i = parts.length - 1; i >= 0; i--) {
                if (/^\d+$/.test(parts[i])) {
                    const n = parseInt(parts[i], 10);
                    if (n < 100000) return n;  // segment index, not timestamp
                }
            }
        } catch (_) {}
        return 0;
    }

    function _captureUrl(url) {
        if (!url || !_isLinkedInCDN(url) || !_looksLikeVideoSegment(url)) return;

        const videoId = _getVideoId(url);
        if (!window.__liVideoSegments[videoId]) {
            window.__liVideoSegments[videoId] = [];
        }
        const arr = window.__liVideoSegments[videoId];
        if (!arr.includes(url)) {
            arr.push(url);
            console.log('[SA/LI] Segment #' + arr.length + ' captured for video', videoId.substring(0, 20));
        }
        window.__liLastVideoId = videoId;
        window.__liLastCdnVideoUrl = url;

        try {
            window.dispatchEvent(new CustomEvent('mh:li-cdn-video-url', {
                detail: { url, videoId }
            }));
        } catch (_) {}
    }

    // -------------------------------------------------------------------------
    // Strategy 1: PerformanceObserver (catches Service Worker requests too)
    // -------------------------------------------------------------------------
    if (typeof PerformanceObserver !== 'undefined') {
        try {
            const obs = new PerformanceObserver(function(list) {
                for (const entry of list.getEntries()) {
                    _captureUrl(entry.name);
                }
            });
            obs.observe({ type: 'resource', buffered: true });
        } catch (e) {
            console.warn('[SA/LI] PerformanceObserver failed:', e);
        }
    }

    // -------------------------------------------------------------------------
    // Strategy 2: fetch() interceptor
    // -------------------------------------------------------------------------
    const _origFetch = window.fetch;
    window.fetch = function(input, init) {
        const url = typeof input === 'string' ? input :
                    (input && input.url) ? input.url : String(input);
        if (_isLinkedInCDN(url)) {
            return _origFetch.call(this, input, init).then(function(res) {
                _captureUrl(url);
                return res;
            }).catch(function(err) { throw err; });
        }
        return _origFetch.call(this, input, init);
    };

    // -------------------------------------------------------------------------
    // Strategy 3: XMLHttpRequest interceptor
    // -------------------------------------------------------------------------
    const _origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (_isLinkedInCDN(url)) {
            this.addEventListener('load', function() {
                _captureUrl(url);
            });
        }
        return _origOpen.apply(this, arguments);
    };

    // -------------------------------------------------------------------------
    // MAIN-world fetcher: download all segments → concatenate → data URL
    // Uses credentials:'omit' — LinkedIn CDN has ACAO:* (wildcard), which is
    // incompatible with credentials:'include' and causes a CORS error.
    // Token-signed URLs don't need session cookies anyway.
    // -------------------------------------------------------------------------
    window.addEventListener('mh:fetch-li-video', async function(e) {
        const detail = e.detail;
        if (!detail || !detail.reqId) return;

        const reqId = detail.reqId;
        const videoId = detail.videoId || window.__liLastVideoId;

        function _dispatch(payload) {
            window.dispatchEvent(new CustomEvent('mh:fetch-li-video-result', { detail: payload }));
        }

        // Collect all segments for this video, sorted by index
        let segments = [];
        if (videoId && window.__liVideoSegments[videoId]) {
            segments = [...window.__liVideoSegments[videoId]];
        } else if (detail.url) {
            segments = [detail.url];
        }

        if (segments.length === 0) {
            _dispatch({ reqId, error: 'No segments captured. Play the video fully before downloading.' });
            return;
        }

        // Sort by segment index
        segments.sort((a, b) => _getSegmentIndex(a) - _getSegmentIndex(b));
        console.log('[SA/LI MAIN] Downloading', segments.length, 'segments for video', videoId);

        try {
            const blobs = [];
            let mimeType = 'video/mp4';

            for (let i = 0; i < segments.length; i++) {
                const segUrl = segments[i];
                console.log('[SA/LI MAIN] Fetching segment', i + 1, '/', segments.length);
                const res = await _origFetch(segUrl, {
                    credentials: 'omit'   // MUST be omit — ACAO:* + credentials:include = CORS error
                });
                if (!res.ok && res.status !== 206) {
                    console.warn('[SA/LI MAIN] Segment', i + 1, 'failed: HTTP', res.status, '— skipping');
                    continue;
                }
                const ct = res.headers.get('Content-Type') || '';
                if (ct && (ct.startsWith('video/') || ct.startsWith('audio/'))) {
                    mimeType = ct.split(';')[0].trim();
                }
                blobs.push(await res.blob());
            }

            if (blobs.length === 0) {
                throw new Error('All segment fetches failed (URLs may have expired — try playing the video again)');
            }

            const fullBlob = new Blob(blobs, { type: 'video/mp4' });
            console.log('[SA/LI MAIN] Done. Total size:', fullBlob.size, 'bytes from', blobs.length, 'segments');

            const reader = new FileReader();
            reader.onloadend = () => _dispatch({ reqId, dataUrl: reader.result });
            reader.onerror = () => _dispatch({ reqId, error: 'FileReader error' });
            reader.readAsDataURL(fullBlob);

        } catch (err) {
            console.error('[SA/LI MAIN] Error:', err.message);
            _dispatch({ reqId, error: err.message });
        }
    });

    console.log('[Social Annotate] LinkedIn MAIN-world interceptor installed.');
})();
