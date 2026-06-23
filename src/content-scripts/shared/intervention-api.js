// Shared intervention API client.
// Exposed as window.__sa_intervApi — must be loaded before platform inject.js.
// Handles batched POST to a researcher-defined endpoint, per-post loading overlays,
// in-memory result cache, and auto-retry on failure.

if (!window.__sa_intervApi) {
    (function () {
        var BATCH_DEBOUNCE_MS  = 300;
        var MAX_BATCH_SIZE     = 20;
        var REQUEST_TIMEOUT_MS = 10000;
        var MAX_RETRIES        = 2;
        var RETRY_DELAY_MS     = 800;

        var _config  = null;  // { endpoint, survey_type, platform, mode, logOriginal }
        var _cache   = new Map();   // postId → result object
        var _pending = new Map();   // postId → { resolve, reject }
        var _queue   = [];
        var _timer   = null;

        // ── Public: init ─────────────────────────────────────
        function init(config) {
            _config = config;
        }

        // ── Public: getMapId ──────────────────────────────────
        // Returns a short, stable ID derived from the endpoint URL.
        // Used as map_id in output when the server doesn't supply one.
        function getMapId() {
            if (!_config || !_config.endpoint) return '';
            var s = _config.endpoint;
            var h = 5381;
            for (var i = 0; i < s.length; i++) {
                h = ((h << 5) + h) ^ s.charCodeAt(i);
            }
            return 'api-' + (h >>> 0).toString(36);
        }

        // ── Public: queuePost ─────────────────────────────────
        // Returns a Promise that resolves with the API result for this post.
        // Resolves immediately from cache if already processed.
        function queuePost(postData) {
            if (_cache.has(postData.post_id)) {
                return Promise.resolve(_cache.get(postData.post_id));
            }
            return new Promise(function (resolve, reject) {
                _pending.set(postData.post_id, { resolve: resolve, reject: reject });
                _queue.push(postData);
                _schedule();
            });
        }

        function _schedule() {
            if (_timer) clearTimeout(_timer);
            if (_queue.length >= MAX_BATCH_SIZE) { _flush(); return; }
            _timer = setTimeout(_flush, BATCH_DEBOUNCE_MS);
        }

        async function _flush() {
            if (!_config || !_config.endpoint || _queue.length === 0) return;
            var batch = _queue.splice(0, MAX_BATCH_SIZE);
            var body = {
                survey_type: _config.survey_type,
                platform:    _config.platform,
                posts:       batch
            };

            var attempt = 0;
            while (attempt <= MAX_RETRIES) {
                try {
                    var data = await _post(_config.endpoint, body);
                    // Server returns { results: { post_id: { rewritten_text, ... } } }
                    var rawResults = (data && data.results && typeof data.results === 'object' && !Array.isArray(data.results))
                        ? data.results : {};
                    var resolved = new Set();
                    for (var postId of Object.keys(rawResults)) {
                        var r = Object.assign({}, rawResults[postId], { post_id: postId });
                        _cache.set(postId, r);
                        var p = _pending.get(postId);
                        if (p) { p.resolve(r); _pending.delete(postId); }
                        resolved.add(postId);
                    }
                    // Reject posts absent from the response
                    for (var post of batch) {
                        if (!resolved.has(post.post_id) && _pending.has(post.post_id)) {
                            _pending.get(post.post_id).reject(new Error('Post not returned by API'));
                            _pending.delete(post.post_id);
                        }
                    }
                    return;
                } catch (err) {
                    attempt++;
                    if (attempt <= MAX_RETRIES) {
                        await new Promise(function (r) { setTimeout(r, RETRY_DELAY_MS * attempt); });
                    } else {
                        for (var post of batch) {
                            var p = _pending.get(post.post_id);
                            if (p) { p.reject(err); _pending.delete(post.post_id); }
                        }
                    }
                }
            }
        }

        async function _post(url, body) {
            var controller = new AbortController();
            var timeout = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
            try {
                var resp = await fetch(url, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(body),
                    signal:  controller.signal
                });
                clearTimeout(timeout);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return await resp.json();
            } finally {
                clearTimeout(timeout);
            }
        }

        // ── Overlay background detection ──────────────────────
        // Walks up the DOM from postNode to find the nearest non-transparent
        // background — used to match the platform's own background color.
        function _resolveBackground(postNode) {
            var el = postNode;
            while (el && el !== document.documentElement) {
                var bg = window.getComputedStyle(el).backgroundColor;
                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
                el = el.parentElement;
            }
            return 'rgb(255,255,255)';
        }

        // ── Public: createOverlay ─────────────────────────────
        // Injects a loading overlay synchronously into postNode.
        // Call this BEFORE any await so content is hidden before paint.
        //
        // Returns an overlay element extended with:
        //   .showError(retryFn)  — switches to error state with retry button
        //
        // The caller removes it with overlay.remove() on success.
        function createOverlay(postNode, mode) {
            if (!postNode) return _nullOverlay();
            // Guard: don't double-overlay
            if (postNode.querySelector('[data-sa-overlay]')) return _nullOverlay();

            var bg = _resolveBackground(postNode);

            var currentPos = window.getComputedStyle(postNode).position;
            if (currentPos === 'static') postNode.style.position = 'relative';

            // Inject spinner keyframes once per page
            if (!document.getElementById('sa-interv-styles')) {
                var style = document.createElement('style');
                style.id = 'sa-interv-styles';
                style.textContent = [
                    '@keyframes sa-spin{to{transform:rotate(360deg)}}',
                    '.sa-interv-spinner{width:24px;height:24px;border-radius:50%;',
                    'border:3px solid rgba(29,155,240,0.2);border-top-color:rgb(29,155,240);',
                    'animation:sa-spin 0.75s linear infinite}'
                ].join('');
                (document.head || document.documentElement).appendChild(style);
            }

            var overlay = document.createElement('div');
            overlay.setAttribute('data-sa-overlay', '1');
            overlay.style.cssText = [
                'position:absolute', 'inset:0', 'z-index:9998',
                'background:' + (mode === 'blind' ? bg : 'rgba(128,128,128,0.12)'),
                'display:flex', 'align-items:center', 'justify-content:center',
                'border-radius:inherit', 'pointer-events:all'
            ].join(';');

            if (mode === 'blind') {
                var spinner = document.createElement('div');
                spinner.className = 'sa-interv-spinner';
                overlay.appendChild(spinner);
            }

            postNode.insertAdjacentElement('afterbegin', overlay);

            overlay.showError = function (retryFn) {
                overlay.innerHTML = '';
                overlay.style.background = bg;
                overlay.style.pointerEvents = 'all';

                var wrap = document.createElement('div');
                wrap.style.cssText = [
                    'display:flex', 'flex-direction:column', 'align-items:center', 'gap:6px',
                    'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
                    'font-size:13px', 'color:#536471'
                ].join(';');

                var icon = document.createElement('span');
                icon.textContent = '🚫';
                icon.style.fontSize = '18px';

                var label = document.createElement('span');
                label.textContent = 'Failed to process';

                var btn = document.createElement('button');
                btn.textContent = '↺ Retry';
                btn.style.cssText = [
                    'margin-top:2px', 'padding:3px 12px', 'font-size:12px',
                    'border-radius:999px', 'cursor:pointer',
                    'background:rgba(29,155,240,0.1)', 'color:rgb(29,155,240)',
                    'border:1px solid rgba(29,155,240,0.3)'
                ].join(';');
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (retryFn) retryFn();
                });

                wrap.appendChild(icon);
                wrap.appendChild(label);
                wrap.appendChild(btn);
                overlay.appendChild(wrap);
            };

            return overlay;
        }

        // Returns a no-op overlay object when we can't inject (guards against null refs).
        function _nullOverlay() {
            return {
                remove:    function () {},
                showError: function () {},
                parentNode: null
            };
        }

        function getCached(postId) {
            return _cache.has(postId) ? _cache.get(postId) : null;
        }

        window.__sa_intervApi = {
            init:          init,
            queuePost:     queuePost,
            getCached:     getCached,
            getMapId:      getMapId,
            createOverlay: createOverlay
        };
    })();
}
