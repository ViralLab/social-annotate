// Context class is defined in shared.js
const availableContextsTelegram = [
    new Context('telegram-post', enableTelegramObserver, null)
];

let SEL_TG = {};
let tgMessagesRoot = null;
let tgObserver = null;
let tgObserverConfig = { attributes: false, childList: true, subtree: true };

// ── Intervention state ────────────────────────────────────
let manipConfig_TG      = {};
let manipMap_TG         = {};
let manipMapId_TG       = '';
let manipApplied_TG     = {};
let _processedCount_TG  = 0;
const _inFlight_TG      = new Set();
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
    const src   = detail.src;
    const msgId = detail.msgId || null;
    if (msgId) {
        _tgMsgVideoSrcMap.set(msgId, { src, timestamp: Date.now() });
    }
    _tgMsgVideoSrcMap.set('__latest__', { src, timestamp: Date.now() });
});

// ---------------------------------------------------------------------------
// Chunked Range-fetch video downloader
// Telegram serves video via its Service Worker using HTTP Range requests.
// We delegate the fetch to inject-api.js (MAIN world) so the SW intercepts it.
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
        window.dispatchEvent(new CustomEvent('mh:fetch-tg-video', { detail: { url: url, reqId: reqId } }));
        setTimeout(() => {
            window.removeEventListener('mh:fetch-tg-video-result', listener);
            reject(new Error('MAIN-world fetch timeout'));
        }, 30000);
    });
}

// ---------------------------------------------------------------------------
// Resolve the best *live* video src for a message node.
// ---------------------------------------------------------------------------
function resolveVideoSrcForMessage(messageNode) {
    const videoSelector = SEL_TG.postVideo || 'video.full-media, video';

    for (const vid of messageNode.querySelectorAll(videoSelector)) {
        const src = vid.currentSrc || vid.src || '';
        if (src && !src.startsWith('data:') && src.length > 10) return src;
        const sourceEl = vid.querySelector('source');
        if (sourceEl && sourceEl.src && sourceEl.src.length > 10) return sourceEl.src;
    }

    const msgId = messageNode.getAttribute('data-message-id') ||
                  messageNode.getAttribute('data-mid') ||
                  messageNode.id || null;
    if (msgId) {
        const cached = _tgMsgVideoSrcMap.get(msgId);
        if (cached && cached.src && Date.now() - cached.timestamp < 30 * 60 * 1000) return cached.src;
    }

    const hasVideoInNode = messageNode.querySelectorAll(videoSelector).length > 0;
    if (hasVideoInNode) {
        const latest = _tgMsgVideoSrcMap.get('__latest__');
        if (latest && latest.src && (Date.now() - latest.timestamp < 5 * 60 * 1000)) return latest.src;
    }

    return null;
}

// ---------------------------------------------------------------------------
// Download handler
// ---------------------------------------------------------------------------
window.addEventListener('mh:download-request', async function (e) {
    const detail = e.detail;
    if (!detail || !detail.postID) return;

    const postID      = detail.postID;
    const userID      = detail.userID;
    const surveyType  = detail.surveyType || 'telegram-post';

    const containerName   = 'surveyFormContainer-' + postID;
    const surveyContainer = document.getElementById(containerName);
    const messageNode     = surveyContainer ? surveyContainer.nextElementSibling : null;

    if (!messageNode) return;

    const imageUrls  = extractMessageImages(messageNode);
    const videoSrc   = resolveVideoSrcForMessage(messageNode);
    let   videoPayload = null;

    if (videoSrc) {
        if (videoSrc.startsWith('data:')) {
            if (!videoSrc.startsWith('data:text/') && !videoSrc.startsWith('data:application/xhtml')) {
                videoPayload = videoSrc;
            }
        } else if (videoSrc.match(/^https?:\/\//) && !videoSrc.includes('web.telegram.org')) {
            videoPayload = videoSrc;
        } else {
            try {
                videoPayload = await fetchVideoFromMainWorld(videoSrc);
                if (videoPayload && (videoPayload.startsWith('data:text/') || videoPayload.startsWith('data:application/xhtml'))) {
                    videoPayload = null;
                }
            } catch (err) {
                console.error('[Social Annotate] TG MAIN fetch failed:', err);
                videoPayload = null;
            }
        }
    }

    const allUrls = [...imageUrls];
    if (videoPayload) allUrls.push(videoPayload);

    if (allUrls.length > 0) {
        try {
            chrome.runtime.sendMessage({ action: 'downloadMedia', urls: allUrls, userId: userID || 'user', postId: postID, surveyType: surveyType });
        } catch (err) {
            if (err.message.includes('Extension context invalidated')) {
                if (tgObserver) { tgObserver.disconnect(); tgObserver = null; }
                showExtensionReloadBanner();
            }
        }
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

function extractMessageMedia(messageNode) {
    const images   = extractMessageImages(messageNode);
    const videoSrc = resolveVideoSrcForMessage(messageNode);
    const all      = [...images];
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
    const sigNode = messageNode.querySelector(SEL_TG.messageSignature || '.message-signature');
    if (sigNode && sigNode.textContent.trim()) {
        userID = sigNode.textContent.trim();
    } else {
        const headerName = document.querySelector(SEL_TG.userDisplayName || '.ChatInfo .fullName');
        if (headerName && headerName.textContent.trim()) {
            userID = headerName.textContent.trim();
        }
    }

    let timestamp = '';
    const timeNode = messageNode.querySelector(SEL_TG.postTimestamp || '.message-time');
    if (timeNode) timestamp = timeNode.innerText || timeNode.textContent || '';

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
        cssUrl    = chrome.runtime.getURL('content-scripts/telegram/inject.css');
        iframeSrc = chrome.runtime.getURL('sandbox/survey.html');
    } catch (err) {
        if (err.message.includes('Extension context invalidated')) {
            if (tgObserver) { tgObserver.disconnect(); tgObserver = null; }
            showExtensionReloadBanner();
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

// ── API intervention helpers ──────────────────────────────────────────────────

function _tgToggleBtn(textEl, originalNodes, rewrittenText, mode) {
    if (mode !== 'aware') return;
    let isOriginal = false;
    let toggleBtn  = document.createElement('button');
    toggleBtn.textContent = '👁 Show original';
    toggleBtn.setAttribute('data-sa-interv-toggle', '1');
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
        if (isOriginal) {
            textEl.textContent = '';
            originalNodes.forEach(function(n) { textEl.appendChild(n.cloneNode(true)); });
        } else {
            textEl.textContent = rewrittenText;
        }
        toggleBtn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
    });
    textEl.parentNode.insertBefore(toggleBtn, textEl);
}

function _tgApplyResult(result, messageNode, mode) {
    let textEl = messageNode.querySelector(SEL_TG.postText || '.text-content');
    if (textEl && result.rewritten_text) {
        let originalNodes = Array.from(textEl.childNodes).map(function(n) { return n.cloneNode(true); });
        textEl.textContent = result.rewritten_text;
        _tgToggleBtn(textEl, originalNodes, result.rewritten_text, mode);
    }
}

// ─────────────────────────────────────────────────────────────────────────────

async function processMessageNode(messageNode) {
    _processedCount_TG++;
    if (!messageNode || !messageNode.querySelector) return;

    const details = extractMessageDetails(messageNode);
    if (!details) return;

    const _renderSurvey = function() {
        availableContextsTelegram[0].renderSurvey(details.userID, details.postID, {
            body:         () => extractMessageText(messageNode),
            media_urls:   () => extractMessageMedia(messageNode),
            created_at:   details.postAuthorTime,
            post_metrics: () => extractTelegramMetrics(messageNode)
        });
    };

    // ── API path ──────────────────────────────────────────────────────────────
    if (manipConfig_TG.enabled && manipConfig_TG.source === 'api' && manipConfig_TG.endpoint && window.__sa_intervApi) {
        if (document.getElementById('surveyFormContainer-' + details.postID)) {
            _renderSurvey();
            return;
        }
        if (_inFlight_TG.has(details.postID)) return;
        _inFlight_TG.add(details.postID);

        const cached = window.__sa_intervApi.getCached(details.postID);
        if (cached) {
            _tgApplyResult(cached, messageNode, manipConfig_TG.mode);
            _inFlight_TG.delete(details.postID);
            injectTelegramPostSurvey(messageNode, details.postID);
            _renderSurvey();
            return;
        }

        const overlay = window.__sa_intervApi.createOverlay(messageNode, manipConfig_TG.mode);
        const doRetry = function() { _inFlight_TG.delete(details.postID); overlay.remove(); processMessageNode(messageNode); };
        try {
            const body = extractMessageText(messageNode);
            const postData = {
                post_id:      details.postID,
                account_id:   details.userID,
                body,
                created_at:   details.postAuthorTime || null,
                media_urls:   extractMessageMedia(messageNode),
                post_metrics: extractTelegramMetrics(messageNode)
            };
            const result = await window.__sa_intervApi.queuePost(postData);

            const meta = { applied: true, label: result.prompt_label || '', map_id: result.map_id || window.__sa_intervApi.getMapId() };
            if (manipConfig_TG.logOriginal) meta.original_text = body;
            const extras = {};
            for (const k in result) {
                if (!['post_id', 'rewritten_text', 'map_id', 'prompt_label'].includes(k)) extras[k] = result[k];
            }
            if (Object.keys(extras).length > 0) meta.extras = extras;
            manipApplied_TG[details.postID] = meta;

            overlay.parentNode && overlay.parentNode.removeChild(overlay);
            _inFlight_TG.delete(details.postID);

            _tgApplyResult(result, messageNode, manipConfig_TG.mode);
            injectTelegramPostSurvey(messageNode, details.postID);
            _renderSurvey();
        } catch(err) {
            overlay.showError(doRetry);
        }
        return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const existingContainer = document.getElementById('surveyFormContainer-' + details.postID);
    if (!existingContainer) {
        // ── Map path ──────────────────────────────────────────────────────────
        if (manipConfig_TG.enabled && manipMap_TG[details.postID]) {
            let entry  = manipMap_TG[details.postID];
            let textEl = messageNode.querySelector(SEL_TG.postText || '.text-content');
            if (textEl) {
                let rewrittenText = entry.rewritten_text;
                let originalText  = entry.original_text || '';
                textEl.textContent = rewrittenText;
                if (manipConfig_TG.mode === 'aware') {
                    let isOriginal = false;
                    let toggleBtn  = document.createElement('button');
                    toggleBtn.textContent = '👁 Show original';
                    toggleBtn.setAttribute('data-sa-interv-toggle', '1');
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
        // ─────────────────────────────────────────────────────────────────────
        injectTelegramPostSurvey(messageNode, details.postID);
    }

    _renderSurvey();
}

function createTelegramObserver() {
    return new MutationObserver((mutationsList) => {
        for (let mutation of mutationsList) {
            if (mutation.type !== 'childList') continue;
            mutation.addedNodes.forEach(node => {
                if (!node || node.nodeType !== 1) return;
                const postSelector = SEL_TG.postContainer || '.Message';
                if (node.matches && node.matches(postSelector)) processMessageNode(node);
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

        const _postConfTG = result.config && result.config.surveys && result.config.surveys['telegram-post'];
        manipConfig_TG = (_postConfTG && _postConfTG.manipulation) || {};
        if (manipConfig_TG.enabled && manipConfig_TG.source !== 'api' && result.manipulationMaps && result.manipulationMaps['telegram-post']) {
            let fullMap = result.manipulationMaps['telegram-post'];
            manipMapId_TG = (fullMap._meta && fullMap._meta.map_id) || '';
            for (let k in fullMap) { if (k !== '_meta') manipMap_TG[k] = fullMap[k]; }
        }

        if (manipConfig_TG.enabled && manipConfig_TG.source === 'api' && manipConfig_TG.endpoint && window.__sa_intervApi) {
            window.__sa_intervApi.init({ endpoint: manipConfig_TG.endpoint, survey_type: 'telegram-post', platform: 'telegram', mode: manipConfig_TG.mode, logOriginal: manipConfig_TG.logOriginal });
        }

        tgMessagesRoot = document.querySelector(SEL_TG.conversationMessages || '.MessageList .messages-container') || document.body;
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
                        if (!isExtensionContextValid()) { showExtensionReloadBanner(); return; }

                        values.surveyType = currentContext.name;
                        values.studyID    = studyID;

                        chrome.storage.local.get(['isMediaDownloadEnabled'], function (res) {
                            if (res.isMediaDownloadEnabled) {
                                const evt = new CustomEvent('mh:download-request', {
                                    detail: { postID: values.post_id, userID: values.account_id, surveyType: currentContext.name }
                                });
                                window.dispatchEvent(evt);
                            }
                        });

                        let _ma = manipApplied_TG[values.post_id];
                        if (_ma) {
                            values.intervention_applied = true;
                            values.intervention_label   = _ma.label;
                            values.intervention_map_id  = _ma.map_id;
                            if (_ma.original_text !== undefined) values.original_text = _ma.original_text;
                            if (_ma.extras) values.intervention_extras = _ma.extras;
                        } else {
                            values.intervention_applied = false;
                        }

                        storeResults(values, currentPlatform);
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.theme        = config.theme || 'light';
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);
            }
        }
    });
}

window.__socialAnnotate__.platformDebugCapture = function(selectors, stored) {
    let raw   = selectors.telegram || {};
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
    return {
        platform:  'telegram',
        surveyType: 'telegram-post',
        injectionStatus: {
            userSurveyInjected:  !!document.getElementById('surveyFormContainer'),
            postSurveysInjected: document.querySelectorAll('.survey-container-post').length
        },
        extractedData: {},
        selectorDiagnostics: [
            ...Object.keys(raw.account || {}).filter(f => !SKIP.includes(f)).map(probe),
            ...Object.keys(raw.post    || {}).filter(f => !SKIP.includes(f)).map(probe)
        ]
    };
};

initializeSurveys();
