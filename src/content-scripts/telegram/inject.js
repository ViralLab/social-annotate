// Context class is defined in shared.js
const availableContextsTelegram = [
    new Context('telegram-post', enableTelegramObserver, null)
];

let SEL_TG = {};
let tgMessagesRoot = null;
let tgObserver = null;
let tgObserverConfig = { attributes: false, childList: true, subtree: true };

// ── Manipulation state ────────────────────────────────────
let manipConfig_TG  = {};
let manipMap_TG     = {};
let manipMapId_TG   = '';
let manipApplied_TG     = {};
let _processedCount_TG     = 0;
registerHealthCounter(function () { return _processedCount_TG; });

// ---------------------------------------------------------------------------
// Video src capture bridge
// The MAIN-world inject-api.js populates window.__tgMediaSrcMap.
// We also listen for 'mh:tg-video-src' events and record per-message
// so we have the freshest URL at download time.
// Key: data-message-id string. Value: { src, timestamp }
// ---------------------------------------------------------------------------
const _tgMsgVideoSrcMap = new Map(); // messageId → { src, timestamp }

window.addEventListener('mh:tg-video-src', function (e) {
    const detail = e && e.detail;
    if (!detail || !detail.src) return;
    const src = detail.src;
    const msgId = detail.msgId || null;
    if (msgId) {
        _tgMsgVideoSrcMap.set(msgId, { src, timestamp: Date.now() });
    }
    // Also store as "latest" for messages we couldn't identify
    _tgMsgVideoSrcMap.set('__latest__', { src, timestamp: Date.now() });
});

// ---------------------------------------------------------------------------
// Chunked Range-fetch video downloader
// Strategy from: Neet-Nestor/Telegram-Media-Downloader and
//                SuperZombi/Telegram-Downloader
//
// Telegram serves video via its Service Worker using HTTP Range requests.
// The stream URLs are only accessible from the page's fetch context (same SW).
// chrome.downloads.download() cannot reach them from the background worker.
// ---------------------------------------------------------------------------
// Video Download Strategy:
// Telegram Web A's Service Worker intercepts /a/progressive/ streams.
// However, fetch() from isolated-world content scripts bypasses the SW entirely
// and hits the real backend, resulting in a 404 or 302 redirect.
// To bypass this, we delegate the fetch to inject-api.js (which runs in the MAIN
// world), allowing the SW to intercept it, convert it to a dataURL, and send it back.
// ---------------------------------------------------------------------------

function fetchVideoFromMainWorld(url) {
    return new Promise((resolve, reject) => {
        const reqId = Date.now().toString() + Math.random().toString().substring(2, 6);
        
        const listener = function(e) {
            if (e.detail && e.detail.reqId === reqId) {
                window.removeEventListener('mh:fetch-tg-video-result', listener);
                if (e.detail.error) reject(new Error(e.detail.error));
                else resolve(e.detail.dataUrl);
            }
        };
        
        window.addEventListener('mh:fetch-tg-video-result', listener);
        window.dispatchEvent(new CustomEvent('mh:fetch-tg-video', {
            detail: { url: url, reqId: reqId }
        }));
        
        // Timeout
        setTimeout(() => {
            window.removeEventListener('mh:fetch-tg-video-result', listener);
            reject(new Error('MAIN-world fetch timeout'));
        }, 30000);
    });
}

// ---------------------------------------------------------------------------
// Resolve the best *live* video src for a message node.
// Priority (freshest → most reliable first):
//   1. Live <video> element's currentSrc in the DOM     — most reliable
//   2. _tgMsgVideoSrcMap[messageId] from interceptor events
//   3. window.__tgMediaSrcMap (MAIN-world map, only readable in MAIN)
//   4. <source> children of <video>
//   5. __latest__ fallback (last seen src from any message)
// ---------------------------------------------------------------------------
function resolveVideoSrcForMessage(messageNode) {
    const videoSelector = SEL_TG.postVideo || 'video.full-media, video';

    // 1. Live DOM video element — freshest possible source
    for (const vid of messageNode.querySelectorAll(videoSelector)) {
        const src = vid.currentSrc || vid.src || '';
        if (src && !src.startsWith('data:') && src.length > 10) {
            console.log('[Social Annotate] TG: resolved video src from live DOM element');
            return src;
        }
        const sourceEl = vid.querySelector('source');
        if (sourceEl && sourceEl.src && sourceEl.src.length > 10) {
            return sourceEl.src;
        }
    }

    // 2. Per-message interceptor cache
    const msgId = messageNode.getAttribute('data-message-id') ||
                  messageNode.getAttribute('data-mid') ||
                  messageNode.id || null;
    if (msgId) {
        const cached = _tgMsgVideoSrcMap.get(msgId);
        if (cached && cached.src) {
            // Reject if stale (> 30 minutes old)
            if (Date.now() - cached.timestamp < 30 * 60 * 1000) {
                console.log('[Social Annotate] TG: resolved video src from msg-specific cache');
                return cached.src;
            }
        }
    }

    // 3. __latest__ fallback — ONLY if this message node actually contains a video element.
    // Without this guard, scrolling past other posts loads their video into __latest__ and
    // it gets wrongly attached to a non-video post when the user submits.
    const hasVideoInNode = messageNode.querySelectorAll(videoSelector).length > 0;
    if (hasVideoInNode) {
        const latest = _tgMsgVideoSrcMap.get('__latest__');
        if (latest && latest.src && (Date.now() - latest.timestamp < 5 * 60 * 1000)) {
            console.log('[Social Annotate] TG: resolved video src from __latest__ cache (best-effort)');
            return latest.src;
        }
    }

    return null;
}

// ---------------------------------------------------------------------------
// Download handler — fires when survey user clicks "download media"
// ---------------------------------------------------------------------------
window.addEventListener('mh:download-request', async function (e) {
    const detail = e.detail;
    if (!detail || !detail.postID) return;

    const postID     = detail.postID;
    const userID     = detail.userID;
    const surveyType = detail.surveyType || 'telegram-post';

    const containerName   = 'surveyFormContainer-' + postID;
    const surveyContainer = document.getElementById(containerName);
    const messageNode     = surveyContainer ? surveyContainer.nextElementSibling : null;

    if (!messageNode) {
        console.warn('[Social Annotate] TG: cannot find message node for postID:', postID);
        return;
    }

    // ---- Images ----
    const imageUrls = extractMessageImages(messageNode);

    // ---- Video ----
    const videoSrc = resolveVideoSrcForMessage(messageNode);
    let videoPayload = null; // will be dataURL string or null

    if (videoSrc) {
        console.log('[Social Annotate] TG video src to download:', videoSrc.substring(0, 100));

        if (videoSrc.startsWith('data:')) {
            // Already a dataURL — accept only if it's actually media (not an HTML error page)
            if (!videoSrc.startsWith('data:text/') && !videoSrc.startsWith('data:application/xhtml')) {
                videoPayload = videoSrc;
            }
        } else if (videoSrc.match(/^https?:\/\//) && !videoSrc.includes('web.telegram.org')) {
            // External CDN HTTPS URL (e.g., cdn4.telegram.org) — background can download directly
            videoPayload = videoSrc;
        } else {
            // web.telegram.org/a/progressive/, blob:, etc.
            // Send request to MAIN world to fetch via Service Worker
            try {
                console.log('[Social Annotate] TG: Delegating fetch to MAIN world...');
                videoPayload = await fetchVideoFromMainWorld(videoSrc);
                
                if (videoPayload && (videoPayload.startsWith('data:text/') || videoPayload.startsWith('data:application/xhtml'))) {
                    console.error('[Social Annotate] TG: MAIN fetch returned HTML, discarding.');
                    videoPayload = null;
                }
            } catch (err) {
                console.error('[Social Annotate] TG MAIN fetch failed:', err);
                videoPayload = null;
            }
        }
    }

    // ---- Assemble and send ----
    const allUrls = [...imageUrls];
    if (videoPayload) allUrls.push(videoPayload);

    if (allUrls.length > 0) {
        try {
            chrome.runtime.sendMessage({
                action:     'downloadMedia',
                urls:       allUrls,
                userId:     userID || 'user',
                postId:     postID,
                surveyType: surveyType
            });
            console.log('[Social Annotate] TG: dispatched', allUrls.length, 'media item(s) for download.');
        } catch (err) {
            if (err.message.includes('Extension context invalidated')) {
                console.warn('[Social Annotate] Extension context invalidated. Auto-reloading tab...');
                window.location.reload();
            } else {
                console.error('[Social Annotate] Error sending download message:', err);
            }
        }
    } else {
        console.log('[Social Annotate] TG: no downloadable media found for postID:', postID);
    }
});

// ---------------------------------------------------------------------------
// Extract image URLs from a message node (canvas + <img>)
// ---------------------------------------------------------------------------
function extractMessageImages(messageNode) {
    const urls = [];
    const imageSelector = SEL_TG.postImage || 'img.media-photo, img.full-media, canvas.thumbnail.shown';

    messageNode.querySelectorAll(imageSelector).forEach(el => {
        if (el.tagName.toLowerCase() === 'canvas') {
            try {
                const dataUrl = el.toDataURL('image/png');
                if (dataUrl && dataUrl.length > 1000 && !dataUrl.startsWith('data:text/')) {
                    urls.push(dataUrl);
                }
            } catch (err) {
                console.error('[Social Annotate] TG canvas toDataURL error:', err);
            }
        } else {
            const src = el.getAttribute('src') || '';
            if (!src || src.startsWith('data:')) return;
            urls.push(src);
        }
    });

    return Array.from(new Set(urls));
}

// ---------------------------------------------------------------------------
// Synchronous snapshot of media for the renderSurvey mediaUrls callback.
// Videos are not fetched here — just collected for display/count purposes.
// ---------------------------------------------------------------------------
function extractMessageMedia(messageNode) {
    const images = extractMessageImages(messageNode);
    const videoSrc = resolveVideoSrcForMessage(messageNode);
    const all = [...images];
    // Only include the raw src in the survey payload (not fetched here)
    if (videoSrc && !videoSrc.startsWith('data:')) all.push(videoSrc);
    return Array.from(new Set(all));
}

function extractMessageText(messageNode) {
    const textNodes = messageNode.querySelectorAll(SEL_TG.postText || '.text-content');
    const chunks = [];
    textNodes.forEach(node => {
        const text = (node.textContent || '').trim();
        if (text) chunks.push(text);
    });
    return chunks.join('\n');
}

function extractTelegramMetrics(messageNode) {
    let metrics = { like_count: null, share_count: null, comment_count: null, bookmark_count: null, view_count: null, quote_count: null };
    if (!messageNode) return metrics;

    const parseShortNumber = (str) => {
        if (!str) return 0;
        str = str.trim().replace(/,/g, '');
        if (str.match(/K/i)) return parseFloat(str) * 1000;
        if (str.match(/M/i)) return parseFloat(str) * 1000000;
        return parseInt(str, 10) || 0;
    };

    if (SEL_TG.metricsViews) {
        let el = messageNode.querySelector(SEL_TG.metricsViews);
        if (el) metrics.view_count = parseShortNumber(el.innerText || el.textContent);
    }
    if (SEL_TG.metricsRepost) {
        let el = messageNode.querySelector(SEL_TG.metricsRepost);
        if (el) metrics.share_count = parseShortNumber(el.innerText || el.textContent);
    }
    if (SEL_TG.metricsLike) {
        let el = messageNode.querySelector(SEL_TG.metricsLike);
        if (el) metrics.like_count = parseShortNumber(el.innerText || el.textContent);
    }

    return metrics;
}

function extractMessageDetails(messageNode) {
    if (!messageNode) return null;

    const postID = messageNode.getAttribute('data-message-id') || null;
    if (!postID) return null;

    let userID = 'unknown';
    const nameNode = messageNode.querySelector(SEL_TG.userDisplayName || '.fullName');
    if (nameNode) {
        userID = nameNode.textContent.trim();
    } else {
        const headerName = document.querySelector(SEL_TG.userDisplayName || '.fullName');
        if (headerName) {
            userID = headerName.textContent.trim();
        } else {
            userID = 'User';
        }
    }

    let timestamp = '';
    const timeNode = messageNode.querySelector(SEL_TG.postTimestamp || '.message-time');
    if (timeNode) {
        timestamp = timeNode.innerText || timeNode.textContent || '';
    }

    return { postID, userID, postAuthorTime: timestamp };
}

function injectTelegramPostSurvey(messageNode, postID) {
    const containerId = 'surveyFormContainer-' + postID;
    if (document.getElementById(containerId)) return null;

    const surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-post';
    surveyContainer.setAttribute('id', containerId);

    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });
    let cssUrl, iframeSrc;
    try {
        cssUrl = chrome.runtime.getURL('content-scripts/bluesky/inject.css');
        iframeSrc = chrome.runtime.getURL('sandbox/survey.html');
    } catch (err) {
        if (err.message.includes('Extension context invalidated')) {
            console.warn('[Social Annotate] Extension context invalidated. Auto-reloading tab...');
            window.location.reload();
            return null;
        }
        throw err;
    }

    shadowRoot.innerHTML = `
        <iframe class="surveyIframe" src="${iframeSrc}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>
    `;

    messageNode.insertAdjacentElement('beforebegin', surveyContainer);
    return surveyContainer;
}

function processMessageNode(messageNode) {
    _processedCount_TG++;
    if (!messageNode || !messageNode.querySelector) return;

    const details = extractMessageDetails(messageNode);
    if (!details) return;

    const existingContainer = document.getElementById('surveyFormContainer-' + details.postID);
    if (!existingContainer) {
        // ── Manipulation DOM patch ────────────────────────────
        if (manipConfig_TG.enabled && manipMap_TG[details.postID]) {
            let entry   = manipMap_TG[details.postID];
            let textEl  = messageNode.querySelector(SEL_TG.postText || '.text-content');
            if (textEl) {
                let rewrittenText = entry.rewritten_text;
                let originalText  = entry.original_text || '';
                textEl.textContent = rewrittenText;
                if (manipConfig_TG.mode === 'aware') {
                    let isOriginal = false;
                    let toggleBtn  = document.createElement('button');
                    toggleBtn.textContent = '👁 Show original';
                    toggleBtn.setAttribute('data-sa-manip-toggle', '1');
                    toggleBtn.style.cssText = [
                        'display:block','margin-left:auto','margin-bottom:4px',
                        'padding:2px 10px','font-size:11px','line-height:1.6',
                        'cursor:pointer','border-radius:4px',
                        'background:rgba(29,155,240,0.08)','color:rgb(29,155,240)',
                        'border:1px solid rgba(29,155,240,0.25)',
                        'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
                    ].join(';');
                    toggleBtn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        isOriginal = !isOriginal;
                        textEl.textContent = isOriginal ? originalText : rewrittenText;
                        toggleBtn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
                    });
                    textEl.parentNode.insertBefore(toggleBtn, textEl);
                }
                let meta = { applied: true, label: entry.prompt_label || '', map_id: manipMapId_TG };
                if (manipConfig_TG.logOriginal) meta.original_text = originalText;
                manipApplied_TG[details.postID] = meta;
            }
        }
        // ─────────────────────────────────────────────────────
        injectTelegramPostSurvey(messageNode, details.postID);
    }

    availableContextsTelegram[0].renderSurvey(
        details.userID,
        details.postID,
        {
            body: () => extractMessageText(messageNode),
            media_urls: () => extractMessageMedia(messageNode),
            created_at: details.postAuthorTime,
            post_metrics: () => extractTelegramMetrics(messageNode)
        }
    );
}

function createTelegramObserver() {
    return new MutationObserver((mutationsList) => {
        for (let mutation of mutationsList) {
            if (mutation.type !== 'childList') continue;
            mutation.addedNodes.forEach(node => {
                if (!node || node.nodeType !== 1) return;

                const postSelector = SEL_TG.postContainer || '.Message';
                if (node.matches && node.matches(postSelector)) {
                    processMessageNode(node);
                }

                const nestedMessages = node.querySelectorAll ? node.querySelectorAll(postSelector) : [];
                nestedMessages.forEach(processMessageNode);
            });
        }
    });
}

function enableTelegramObserver() {
    const postSelector = SEL_TG.postContainer || '.Message';
    document.querySelectorAll(postSelector).forEach(processMessageNode);

    if (tgMessagesRoot && tgObserver) {
        tgObserver.observe(tgMessagesRoot, tgObserverConfig);
    }
    setTimeout(() => {
        document.querySelectorAll(postSelector).forEach(processMessageNode);
    }, 1500);
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'selectors', 'manipulationMaps'], function (result) {
        const _rawTG = (result.selectors && result.selectors.telegram) ? result.selectors.telegram : {};
        SEL_TG = { ...(_rawTG.shared || {}), ...(_rawTG.account || {}), ...(_rawTG.post || {}) };
        watchPostCounter('telegram', function () { return _processedCount_TG; });

        // Load manipulation map for telegram-post
        const _postConfTG = result.config && result.config.surveys && result.config.surveys['telegram-post'];
        manipConfig_TG = (_postConfTG && _postConfTG.manipulation) || {};
        if (manipConfig_TG.enabled && result.manipulationMaps && result.manipulationMaps['telegram-post']) {
            let fullMap = result.manipulationMaps['telegram-post'];
            manipMapId_TG = (fullMap._meta && fullMap._meta.map_id) || '';
            for (let k in fullMap) { if (k !== '_meta') manipMap_TG[k] = fullMap[k]; }
        }

        tgMessagesRoot = document.querySelector(
            SEL_TG.conversationMessages || '.MessageList .messages-container'
        ) || document.body;
        tgObserverConfig = SEL_TG.observerFilter || { attributes: false, childList: true, subtree: true };
        tgObserver = createTelegramObserver();

        const currentPlatform = 'telegram';

        for (let i = 0; i < availableContextsTelegram.length; ++i) {
            const currentContext = availableContextsTelegram[i];
            if (!currentContext.name.includes(currentPlatform)) continue;

            const contextFlag = result.config.activeSurveys.includes(currentContext.name);
            const auxFlag     = currentContext.auxiliaryCheck();

            if (result.isEnabled === true && contextFlag === true && auxFlag === true) {
                const activeSurvey = currentContext.name;
                const config       = result.config.surveys[activeSurvey];
                const studyID      = config.studyID;

                function submitAction(errors, values) {
                    if (!errors) {
                        values.surveyType = currentContext.name;
                        values.studyID    = studyID;

                        chrome.storage.local.get(['isMediaDownloadEnabled'], function (res) {
                            if (res.isMediaDownloadEnabled) {
                                const evt = new CustomEvent('mh:download-request', {
                                    detail: {
                                        postID:     values.post_id,
                                        userID:     values.account_id,
                                        surveyType: currentContext.name
                                    }
                                });
                                window.dispatchEvent(evt);
                            }
                        });

                        // Attach manipulation metadata
                        let _ma = manipApplied_TG[values.post_id];
                        if (_ma) {
                            values.manipulation_applied = true;
                            values.manipulation_label   = _ma.label;
                            values.manipulation_map_id  = _ma.map_id;
                            if (_ma.original_text !== undefined) values.original_text = _ma.original_text;
                        } else {
                            values.manipulation_applied = false;
                        }

                        storeResults(values, currentPlatform);
                    }
                }

                currentContext.formTemplate  = config.surveyFormSchema;
                currentContext.theme         = config.theme || 'light';
                currentContext.submitAction  = submitAction;
                currentContext.injectSurvey(config.injectElement);
            }
        }
    });
}

window.__socialAnnotate__.platformDebugCapture = function(selectors, stored) {
    let raw = selectors.telegram || {};
    let SEL_D = Object.assign({}, raw.shared || {}, raw.account || {}, raw.post || {});

    function probe(field) {
        let selector = SEL_D[field];
        if (!selector) return { field, selector: null, matched: false, value: null, note: 'not in selectors.json' };
        try {
            let el = document.querySelector(selector);
            return { field, selector, matched: !!el, value: el ? (el.src || el.currentSrc || el.textContent.trim().slice(0, 200) || null) : null };
        } catch(e) {
            return { field, selector, matched: false, value: null, note: 'invalid selector' };
        }
    }

    const SKIP = ['postVideo','postImage','userBanner'];
    let accountFields = Object.keys(raw.account || {}).filter(f => !SKIP.includes(f)).map(probe);
    let postFields = Object.keys(raw.post || {}).filter(f => !SKIP.includes(f)).map(probe);
    return {
        platform: 'telegram',
        surveyType: 'telegram-post',
        injectionStatus: {
            userSurveyInjected: !!document.getElementById('surveyFormContainer'),
            postSurveysInjected: document.querySelectorAll('.survey-container-post').length
        },
        extractedData: {},
        selectorDiagnostics: [...accountFields, ...postFields]
    };
};

initializeSurveys();
