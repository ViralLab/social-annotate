/**
 * Telegram MAIN-world API interceptor (runs in page context).
 *
 * Strategy adopted from open-source Telegram downloader extensions:
 *   - SuperZombi/Telegram-Downloader (tg_downloader_a_attachments.js)
 *   - Neet-Nestor/Telegram-Media-Downloader (tel_download.js)
 *
 * Telegram Web creates <video> elements off-DOM and assigns their .src via
 * the HTMLMediaElement prototype setter. A simple DOM query on video[src]
 * returns empty because src is set imperatively, not as an attribute.
 *
 * This script intercepts that setter so every src assignment is captured in
 * window.__tgMediaSrcMap = Map<messageId, { videoSrc, audioSrc }>.
 * The isolated-world inject.js reads this map when extracting media.
 */

(function () {
    if (window.__tgApiInterceptorInstalled) return;
    window.__tgApiInterceptorInstalled = true;

    // messageId → { videoSrc: string|null, audioSrc: string|null }
    window.__tgMediaSrcMap = new Map();

    // The .Message element currently being interacted with (set by click tracker)
    let _pendingMsgEl = null;
    let _lastVideoEl = null;

    // ---------------------------------------------------------------------------
    // Step 1 — Track which .Message is active when the user clicks play/opens media
    // ---------------------------------------------------------------------------
    document.addEventListener('click', function (e) {
        const msgEl = e.target.closest('.Message, .message');
        if (msgEl) _pendingMsgEl = msgEl;
    }, true);

    // ---------------------------------------------------------------------------
    // Step 2 — Intercept HTMLMediaElement.prototype.src setter
    // ---------------------------------------------------------------------------
    const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (srcDescriptor && srcDescriptor.set) {
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
            get() { return srcDescriptor.get.call(this); },
            set(value) {
                if (value && value.length > 10) {
                    const msgEl = _pendingMsgEl || _findNearestMessage(this);
                    let msgId = null;
                    if (msgEl) {
                        msgId = msgEl.getAttribute('data-message-id') ||
                                msgEl.getAttribute('data-mid') ||
                                msgEl.id || null;
                        if (msgId) {
                            const entry = window.__tgMediaSrcMap.get(msgId) || { videoSrc: null, audioSrc: null };
                            if (this instanceof HTMLVideoElement) {
                                entry.videoSrc = value;
                                _lastVideoEl = this;
                            } else if (this instanceof HTMLAudioElement) {
                                entry.audioSrc = value;
                            }
                            window.__tgMediaSrcMap.set(msgId, entry);
                        }
                    }

                    // Also broadcast so the isolated-world script can cache per-message
                    if (this instanceof HTMLVideoElement) {
                        try {
                            window.dispatchEvent(new CustomEvent('mh:tg-video-src', {
                                detail: { src: value, msgId }
                            }));
                        } catch (_) {}
                    }
                }
                return srcDescriptor.set.call(this, value);
            },
            configurable: true,
            enumerable: true,
        });
    }

    // ---------------------------------------------------------------------------
    // Step 3 — Intercept video.currentSrc via play() to capture stream URLs
    // ---------------------------------------------------------------------------
    const origVideoPlay = HTMLVideoElement.prototype.play;
    HTMLVideoElement.prototype.play = function () {
        _lastVideoEl = this;
        const self = this;
        Promise.resolve().then(() => {
            const src = self.currentSrc || self.src || '';
            if (src && src.length > 10) {
                // Try to associate with the nearest .Message
                const msgEl = _findNearestMessage(self);
                const msgId = msgEl ? (
                    msgEl.getAttribute('data-message-id') ||
                    msgEl.getAttribute('data-mid') ||
                    msgEl.id || null
                ) : null;
                try {
                    window.dispatchEvent(new CustomEvent('mh:tg-video-src', {
                        detail: { src, msgId }
                    }));
                } catch (_) {}
            }
        });
        return origVideoPlay.call(this);
    };

    // ---------------------------------------------------------------------------
    // Helper: walk up the DOM to find the nearest .Message ancestor
    // ---------------------------------------------------------------------------
    function _findNearestMessage(el) {
        if (!el || typeof el.closest !== 'function') return null;
        return el.closest('.Message, .message, [data-message-id], [data-mid]');
    }

    // ---------------------------------------------------------------------------
    // MAIN-world Fetcher
    // Isolated-world fetches bypass the Service Worker. We must fetch here.
    // ---------------------------------------------------------------------------
    window.addEventListener('mh:fetch-tg-video', async function(e) {
        const detail = e.detail;
        if (!detail || !detail.url || !detail.reqId) return;

        const url = detail.url;
        const reqId = detail.reqId;

        try {
            console.log('[Social Annotate MAIN] Fetching video through SW with Range chunks:', url.substring(0, 80));
            const blobs = [];
            let offset = 0;
            let totalSize = null;
            let mimeType = 'video/mp4';
            const contentRangeRegex = /^bytes (\d+)-(\d+)\/(\d+)$/;
            
            while (totalSize === null || offset < totalSize) {
                const res = await fetch(url, {
                    method: 'GET',
                    headers: { Range: `bytes=${offset}-` }
                });

                if (!res.ok && res.status !== 206) {
                    throw new Error('SW chunk fetch failed with status ' + res.status);
                }

                const cr = res.headers.get('Content-Range');
                if (cr) {
                    const m = cr.match(contentRangeRegex);
                    if (m) {
                        const startOffset = parseInt(m[1], 10);
                        const endOffset = parseInt(m[2], 10);
                        totalSize = parseInt(m[3], 10);
                        if (startOffset !== offset) throw new Error('Range gap detected');
                        offset = endOffset + 1;
                    } else {
                        blobs.push(await res.blob());
                        break;
                    }
                } else {
                    blobs.push(await res.blob());
                    break;
                }
                blobs.push(await res.blob());
            }

            const fullBlob = new Blob(blobs, { type: mimeType });
            console.log('[Social Annotate MAIN] Fetch complete, Blob size:', fullBlob.size);

            const reader = new FileReader();
            reader.onloadend = () => {
                window.dispatchEvent(new CustomEvent('mh:fetch-tg-video-result', {
                    detail: { reqId: reqId, dataUrl: reader.result }
                }));
            };
            reader.onerror = (err) => {
                window.dispatchEvent(new CustomEvent('mh:fetch-tg-video-result', {
                    detail: { reqId: reqId, error: 'FileReader error' }
                }));
            };
            reader.readAsDataURL(fullBlob);

        } catch (err) {
            console.error('[Social Annotate MAIN] Fetch error:', err);
            window.dispatchEvent(new CustomEvent('mh:fetch-tg-video-result', {
                detail: { reqId: reqId, error: err.message }
            }));
        }
    });

    console.log('[Social Annotate] Telegram MAIN-world interceptor installed.');
})();
