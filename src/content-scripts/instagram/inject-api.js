// Runs in MAIN world to intercept XHR/Fetch and extract media URLs for Instagram
(function() {
    // Returns the best available URL for a single media item (video preferred over image).
    function extractItemUrl(item) {
        if (item.video_url) return item.video_url;
        if (item.video_versions && Array.isArray(item.video_versions) && item.video_versions.length > 0) return item.video_versions[0].url;
        if (item.image_versions2 && Array.isArray(item.image_versions2.candidates) && item.image_versions2.candidates.length > 0) return item.image_versions2.candidates[0].url;
        if (item.display_url) return item.display_url;
        return null;
    }

    function processResponse(text) {
        try {
            const data = JSON.parse(text);
            const mediaMap = {};

            // satisfiedCodes: once URLs are stored for a code, mark it done so that
            // sibling/related objects (e.g. prev_reel data embedded in the same API response)
            // cannot add more URLs under the same code via inherited parentage.
            const satisfiedCodes = new Set();

            function addUrl(code, url) {
                if (!mediaMap[code]) mediaMap[code] = [];
                if (!mediaMap[code].includes(url)) mediaMap[code].push(url);
            }

            function findMedia(obj, currentCode) {
                if (!obj || typeof obj !== 'object') return;

                const ownCode = obj.shortcode || obj.code;
                // Use inherited code only if it hasn't been satisfied yet.
                const code = ownCode || (satisfiedCodes.has(currentCode) ? null : currentCode);

                if (code && !satisfiedCodes.has(code)) {
                    // v1 API carousel: collect all carousel_media items under the parent code
                    if (Array.isArray(obj.carousel_media) && obj.carousel_media.length > 0) {
                        obj.carousel_media.forEach(function(item) {
                            var url = extractItemUrl(item);
                            if (url) addUrl(code, url);
                        });
                        satisfiedCodes.add(code);
                    // GraphQL sidecar: collect all sidecar children under the parent code
                    } else if (obj.edge_sidecar_to_children && Array.isArray(obj.edge_sidecar_to_children.edges)) {
                        obj.edge_sidecar_to_children.edges.forEach(function(edge) {
                            if (edge && edge.node) {
                                var url = extractItemUrl(edge.node);
                                if (url) addUrl(code, url);
                            }
                        });
                        satisfiedCodes.add(code);
                    } else {
                        // Single item — extract video or image URL
                        var url = extractItemUrl(obj);
                        if (url) {
                            addUrl(code, url);
                            satisfiedCodes.add(code);
                        }
                    }
                }

                // Determine what code to pass to children.
                var passCode;
                if (ownCode) {
                    passCode = ownCode;
                } else if (code && mediaMap[code] && mediaMap[code].length > 0) {
                    passCode = null; // stored something for inherited code — stop propagating
                } else {
                    passCode = satisfiedCodes.has(currentCode) ? null : currentCode;
                }

                if (Array.isArray(obj)) {
                    obj.forEach(function(child) { findMedia(child, passCode); });
                } else {
                    Object.values(obj).forEach(function(child) { findMedia(child, passCode); });
                }
            }

            findMedia(data, null);

            if (Object.keys(mediaMap).length > 0) {
                console.log('[SA-API-1] findMedia result:', JSON.parse(JSON.stringify(mediaMap)));
                document.dispatchEvent(new CustomEvent('mh:media-response-ig', { detail: mediaMap }));
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
