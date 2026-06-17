// Runs in MAIN world to intercept XHR/Fetch and extract media URLs for Instagram
(function() {
    function processResponse(text) {
        try {
            const data = JSON.parse(text);
            const mediaMap = {};

            // satisfiedCodes: once a URL is stored for a code, mark it done so that
            // sibling/related objects (e.g. prev_reel data embedded in the same API response)
            // cannot add more URLs under the same code via inherited parentage.
            const satisfiedCodes = new Set();

            function findMedia(obj, currentCode) {
                if (!obj || typeof obj !== 'object') return;

                const ownCode = obj.shortcode || obj.code;
                // Use inherited code only if it hasn't been satisfied yet.
                const code = ownCode || (satisfiedCodes.has(currentCode) ? null : currentCode);

                let urls = [];
                if (code && !satisfiedCodes.has(code)) {
                    if (obj.video_url) {
                        urls.push(obj.video_url);
                    } else if (obj.video_versions && Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
                        urls.push(obj.video_versions[0].url);
                    }
                    if (urls.length > 0) {
                        if (!mediaMap[code]) mediaMap[code] = [];
                        mediaMap[code].push(...urls);
                        satisfiedCodes.add(code);
                    }
                }

                // Determine what code to pass to children:
                // - Own code: always propagate (video URL may be deeper in the tree).
                // - No own code + URL just stored: stop propagating (prevent sibling pollution).
                // - No own code + no URL: keep propagating inherited code if not yet satisfied.
                let passCode;
                if (ownCode) {
                    passCode = ownCode;
                } else if (urls.length > 0) {
                    passCode = null;
                } else {
                    passCode = satisfiedCodes.has(currentCode) ? null : currentCode;
                }

                if (Array.isArray(obj)) {
                    obj.forEach(child => findMedia(child, passCode));
                } else {
                    Object.values(obj).forEach(child => findMedia(child, passCode));
                }
            }

            findMedia(data, null);

            if (Object.keys(mediaMap).length > 0) {
                console.log('[SA-API-1] findMedia result:', JSON.parse(JSON.stringify(mediaMap)));
                const event = new CustomEvent('mh:media-response-ig', {
                    detail: mediaMap
                });
                document.dispatchEvent(event);
            } else {
                console.log('[SA-API-1] findMedia found nothing in this response');
            }
        } catch (e) {
            // ignore JSON parse errors
        }
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (url && typeof url === 'string' && (url.includes('/graphql/') || url.includes('/api/v1/'))) {
            console.log('[SA-API-0] XHR intercepted:', url.split('?')[0]);
            this.addEventListener('load', function() {
                if (this.status === 200) {
                    processResponse(this.responseText);
                }
            });
        }
        return originalOpen.apply(this, arguments);
    };

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        const url = args[0] && typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        if (url && typeof url === 'string' && (url.includes('/graphql/') || url.includes('/api/v1/'))) {
            console.log('[SA-API-0] fetch intercepted:', url.split('?')[0]);
            response.clone().text().then(processResponse).catch(() => {});
        }
        return response;
    };
})();
