(function () {
    if (window.__waApiInterceptorInstalled) return;
    window.__waApiInterceptorInstalled = true;

    // ---------------------------------------------------------------------------
    // Intercept URL.createObjectURL to catch all video blobs WhatsApp generates.
    // WhatsApp creates blob URLs in memory (e.g. after auto-download or decryption),
    // but doesn't always put them in a <video> tag immediately.
    // ---------------------------------------------------------------------------
    window.__waVideoBlobs = new Set();
    const origCreateObjectURL = window.URL.createObjectURL;
    window.URL.createObjectURL = function(obj) {
        const url = origCreateObjectURL.apply(this, arguments);
        if (obj instanceof Blob && obj.type.startsWith('video/')) {
            window.__waVideoBlobs.add(url);
            try {
                window.dispatchEvent(new CustomEvent('mh:wa-video-blob-created', { detail: { url } }));
            } catch(e) {}
        }
        return url;
    };

    // Allow isolated world to query known video blobs
    window.addEventListener('mh:get-wa-video-blobs', function(e) {
        if (e.detail && e.detail.reqId) {
            window.dispatchEvent(new CustomEvent('mh:get-wa-video-blobs-result', {
                detail: { reqId: e.detail.reqId, urls: Array.from(window.__waVideoBlobs) }
            }));
        }
    });

    // ---------------------------------------------------------------------------
    // MAIN-world Fetcher for blob: URLs
    // Isolated-world fetches of MAIN-world blob: URLs fail in Chrome. We must fetch them here.
    // ---------------------------------------------------------------------------
    window.addEventListener('mh:fetch-wa-blob', async function(e) {
        const detail = e.detail;
        if (!detail || !detail.url || !detail.reqId) return;

        const url = detail.url;
        const reqId = detail.reqId;

        try {
            console.log('[Social Annotate WA MAIN] Fetching blob URL:', url.substring(0, 80));
            const res = await fetch(url);
            if (!res.ok) throw new Error('Blob fetch failed with status ' + res.status);
            
            const blob = await res.blob();
            
            const reader = new FileReader();
            reader.onloadend = () => {
                window.dispatchEvent(new CustomEvent('mh:fetch-wa-blob-result', {
                    detail: { reqId: reqId, dataUrl: reader.result }
                }));
            };
            reader.onerror = (err) => {
                window.dispatchEvent(new CustomEvent('mh:fetch-wa-blob-result', {
                    detail: { reqId: reqId, error: 'FileReader error' }
                }));
            };
            reader.readAsDataURL(blob);

        } catch (err) {
            console.error('[Social Annotate WA MAIN] Fetch error:', err);
            window.dispatchEvent(new CustomEvent('mh:fetch-wa-blob-result', {
                detail: { reqId: reqId, error: err.message }
            }));
        }
    });

    console.log('[Social Annotate] WhatsApp MAIN-world interceptor installed.');
})();
