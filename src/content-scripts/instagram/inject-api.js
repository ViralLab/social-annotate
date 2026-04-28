// Runs in MAIN world to intercept XHR/Fetch and extract media URLs for Instagram
(function() {
    function processResponse(text) {
        try {
            const data = JSON.parse(text);
            const mediaMap = {};

            function findMedia(obj, currentCode) {
                if (!obj || typeof obj !== 'object') return;

                let code = obj.shortcode || obj.code || currentCode;

                if (code) {
                    let urls = [];
                    // Check for video_url directly
                    if (obj.video_url) {
                        urls.push(obj.video_url);
                    } else if (obj.video_versions && Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
                        urls.push(obj.video_versions[0].url);
                    }
                    
                    if (urls.length > 0) {
                        if (!mediaMap[code]) mediaMap[code] = [];
                        mediaMap[code].push(...urls);
                    }
                }

                if (Array.isArray(obj)) {
                    obj.forEach(child => findMedia(child, code));
                } else {
                    Object.values(obj).forEach(child => findMedia(child, code));
                }
            }

            findMedia(data, null);

            if (Object.keys(mediaMap).length > 0) {
                const event = new CustomEvent('mh:media-response-ig', {
                    detail: mediaMap
                });
                document.dispatchEvent(event);
            }
        } catch (e) {
            // ignore JSON parse errors
        }
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (url && typeof url === 'string' && (url.includes('/graphql/') || url.includes('/api/v1/'))) {
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
            response.clone().text().then(processResponse).catch(() => {});
        }
        return response;
    };
})();
