// Runs in MAIN world — intercepts Bluesky video fetch/XHR calls to extract DID + CID,
// then dispatches them so the isolated-world content script can build blob download URLs.
(function() {
    // Map: cid -> { did, cid }
    const bskyVideoMap = {};

    function extractAndDispatch(url) {
        // Pattern: video.bsky.app/watch/<did>/<cid>/...
        const m = url.match(/video\.bsky\.app\/watch\/([^/]+)\/([^/?]+)/);
        if (m) {
            const did = decodeURIComponent(m[1]);
            const cid = m[2];
            if (!bskyVideoMap[cid]) {
                bskyVideoMap[cid] = { did, cid };

                // Tag the video element(s) currently loading this blob in the DOM
                // so the isolated-world content script can match them to the correct post.
                // We tag untagged blob-src videos since only one video loads at a time while scrolling.
                const videos = document.querySelectorAll('video[src^="blob:"]');
                videos.forEach(v => {
                    if (!v.dataset.bskyCid) {
                        v.dataset.bskyCid = cid;
                        v.dataset.bskyDid = did;
                    }
                });

                document.dispatchEvent(new CustomEvent('mh:bsky-video-found', {
                    detail: { did, cid }
                }));
            }
        }
    }

    // Intercept XHR
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (url && typeof url === 'string') extractAndDispatch(url);
        return origOpen.apply(this, arguments);
    };

    // Intercept fetch
    const origFetch = window.fetch;
    window.fetch = function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        if (url) extractAndDispatch(url);
        return origFetch.apply(this, args);
    };
})();
