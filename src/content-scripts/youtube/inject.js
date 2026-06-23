const availableContextsYouTube = [
    new Context('youtube-video',   enableVideoSurvey,       checkVideoURL),
    new Context('youtube-user',    injectYouTubeChannelSurvey, checkChannelURL),
    new Context('youtube-comment', enableYTCommentObserver, checkVideoURL)
];

let SEL_YT = {};
let _processedCount_YT = 0;
registerHealthCounter(function() { return _processedCount_YT; });

let _ytVideoCtxActive   = false;
let _ytUserCtxActive    = false;
let _ytCommentCtxActive = false;

let _injectedVideoIds   = new Set();
let _injectedCommentIds = new Set();
let _channelInjected    = '';
let _ytCommentObserver  = null;

let manipConfig_YT_comment = {};
let manipApplied_YT_comment = {};
const _inFlight_YT_comment = new Set();

function _ctxAlive() {
    try { return !!chrome.runtime.id; } catch(e) { return false; }
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function getVideoID() {
    return new URLSearchParams(window.location.search).get('v') || '';
}

function checkVideoURL() {
    if (window.location.protocol === 'file:') return true;
    return window.location.pathname === '/watch' && !!getVideoID();
}

function checkChannelURL() {
    if (window.location.protocol === 'file:') return true;
    let path = window.location.pathname;
    return /^\/@[^/]+\/?$/.test(path) || /^\/channel\/[^/]+\/?$/.test(path);
}

function crawlUserName() {
    if (window.location.protocol === 'file:') return 'local-test-user';
    let path = window.location.pathname;
    let m = path.match(/^\/@([^/?#]+)/);
    if (m) return m[1];
    m = path.match(/\/channel\/([^/?#]+)/);
    if (m) return m[1];
    return '';
}

// ── Video (watch page) ────────────────────────────────────────────────────────

function extractVideoOwner() {
    let ownerLink = document.querySelector(SEL_YT.postAuthorLink);
    if (!ownerLink) return '';
    let href = ownerLink.getAttribute('href') || '';
    let m = href.match(/\/@([^/?#]+)/);
    if (m) return m[1];
    m = href.match(/\/channel\/([^/?#]+)/);
    return m ? m[1] : '';
}

function extractVideoTextContent() {
    let el = document.querySelector(SEL_YT.postText);
    return el ? (el.innerText || el.textContent || '').trim() : '';
}

function extractVideoMetrics() {
    let metrics = { like_count: null, view_count: null, comment_count: null, share_count: null, bookmark_count: null, quote_count: null };

    let viewEl = document.querySelector(SEL_YT.metricsViews);
    if (viewEl) {
        let n = parseInt((viewEl.innerText || viewEl.textContent || '').replace(/[^0-9]/g, ''), 10);
        if (!isNaN(n)) metrics.view_count = n;
    }

    // Like count lives only in aria-label, not a text node.
    let likeBtn = document.querySelector(SEL_YT.metricsLike);
    if (likeBtn) {
        let label = likeBtn.getAttribute('aria-label') || '';
        let m = label.match(/([\d,]+)/);
        if (m) metrics.like_count = parseInt(m[1].replace(/,/g, ''), 10);
    }

    return metrics;
}

function extractVideoTimestamp() {
    let schemaEl = document.querySelector('script[type="application/ld+json"]');
    if (schemaEl) {
        try {
            let schema = JSON.parse(schemaEl.textContent);
            if (schema && schema.uploadDate) return schema.uploadDate;
        } catch(e) {}
    }
    let el = document.querySelector(SEL_YT.postTimestamp);
    return el ? (el.innerText || el.textContent || '').trim() : null;
}

function extractVideoMedia() {
    // YouTube streams via MediaSource — currentSrc is a blob: URL that can't be fetched externally
    return [];
}

function injectVideoSurveyContainer(videoID) {
    if (!_ctxAlive()) return;
    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-post';
    surveyContainer.setAttribute('id', 'surveyFormContainer-' + videoID);
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });
    let cssUrl = chrome.runtime.getURL('content-scripts/youtube/inject.css');
    shadowRoot.innerHTML = '<iframe class="surveyIframe" src="' + chrome.runtime.getURL('sandbox/survey.html') + '" data-css="' + cssUrl + '" style="border:none; width:100%; height:100%; background:transparent;"></iframe>';

    let anchor = document.querySelector('#primary') || document.querySelector('ytd-watch-flexy') || document.body;
    anchor.insertAdjacentElement('beforebegin', surveyContainer);
}

function processVideoPage() {
    if (!checkVideoURL()) return;
    let videoID = getVideoID();
    if (!videoID || _injectedVideoIds.has(videoID)) return;

    _injectedVideoIds.add(videoID);
    _processedCount_YT++;

    injectVideoSurveyContainer(videoID);

    let videoCtx = availableContextsYouTube.find(function(c) { return c.name === 'youtube-video'; });
    videoCtx.renderSurvey(
        extractVideoOwner(),
        videoID,
        {
            body: function() { return extractVideoTextContent(); },
            media_urls: function() { return extractVideoMedia(); },
            post_metrics: function() { return extractVideoMetrics(); },
            created_at: function() { return extractVideoTimestamp(); }
        }
    );
}

function enableVideoSurvey() {
    [0, 1500, 4000].forEach(function(d) { setTimeout(processVideoPage, d); });
}

// ── Comments (watch page) ──────────────────────────────────────────────────────

function extractYTCommentId(commentEl) {
    let link = commentEl.querySelector(SEL_YT.commentIdLinkSel);
    if (!link) return '';
    let href = link.getAttribute('href') || '';
    let m = href.match(/[?&]lc=([^&]+)/);
    return m ? m[1] : '';
}

function extractYTCommentAuthor(commentEl) {
    let el = commentEl.querySelector(SEL_YT.commentAuthorSel);
    return el ? (el.innerText || el.textContent || '').trim() : '';
}

function extractYTCommentText(commentEl) {
    let el = commentEl.querySelector(SEL_YT.commentContentSel);
    return el ? (el.innerText || el.textContent || '').trim() : '';
}

function extractYTCommentTimestamp(commentEl) {
    let el = commentEl.querySelector(SEL_YT.commentTimestampSel);
    return el ? (el.innerText || el.textContent || '').trim() : null;
}

function extractYTCommentMetrics(commentEl) {
    let metrics = { like_count: null, comment_count: null, share_count: null, view_count: null, bookmark_count: null, quote_count: null };
    let likeEl = SEL_YT.commentLikeSel ? commentEl.querySelector(SEL_YT.commentLikeSel) : null;
    if (likeEl) {
        let raw = (likeEl.innerText || likeEl.textContent || '').trim().replace(/,/g, '');
        let n = parseInt(raw, 10);
        if (!isNaN(n)) metrics.like_count = n;
    }
    return metrics;
}

function _ytCommentToggleBtn(textEl, originalNodes, rewrittenText, mode) {
    if (mode !== 'aware') return;
    let isOriginal = false;
    let toggleBtn = document.createElement('button');
    toggleBtn.textContent = '👁 Show original';
    toggleBtn.setAttribute('data-sa-interv-toggle', '1');
    toggleBtn.style.cssText = [
        'display:block','margin-left:auto','margin-bottom:4px',
        'padding:2px 10px','font-size:11px','line-height:1.6',
        'cursor:pointer','border-radius:4px',
        'background:rgba(255,0,0,0.08)','color:rgb(200,0,0)',
        'border:1px solid rgba(255,0,0,0.25)',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
    ].join(';');
    toggleBtn.addEventListener('click', function(e) {
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

function _ytCommentApplyResult(result, commentEl, mode) {
    let textEl = SEL_YT.commentContentSel ? commentEl.querySelector(SEL_YT.commentContentSel) : null;
    if (textEl && result.rewritten_text) {
        let originalNodes = Array.from(textEl.childNodes).map(function(n) { return n.cloneNode(true); });
        textEl.textContent = result.rewritten_text;
        _ytCommentToggleBtn(textEl, originalNodes, result.rewritten_text, mode);
    }
}

function _injectYTCommentSurvey(commentEl, commentId) {
    if (!_ctxAlive()) return;
    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-comment';
    surveyContainer.setAttribute('id', 'surveyFormContainer-' + commentId);
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });
    let cssUrl = chrome.runtime.getURL('content-scripts/youtube/inject.css');
    shadowRoot.innerHTML = '<iframe class="surveyIframe" src="' + chrome.runtime.getURL('sandbox/survey.html') + '" data-css="' + cssUrl + '" style="border:none; width:100%; height:100%; background:transparent;"></iframe>';
    let injectionEl = SEL_YT.commentInjectionSel ? commentEl.querySelector(SEL_YT.commentInjectionSel) : null;
    if (injectionEl) {
        injectionEl.insertAdjacentElement('afterbegin', surveyContainer);
    } else {
        commentEl.insertAdjacentElement('beforebegin', surveyContainer);
    }
}

function _renderYTCommentSurvey(commentEl, commentId) {
    let commentCtx = availableContextsYouTube.find(function(c) { return c.name === 'youtube-comment'; });
    if (!commentCtx) return;
    commentCtx.renderSurvey(
        extractYTCommentAuthor(commentEl),
        commentId,
        {
            body:         function() { return extractYTCommentText(commentEl); },
            media_urls:   function() { return []; },
            post_metrics: function() { return extractYTCommentMetrics(commentEl); },
            created_at:   function() { return extractYTCommentTimestamp(commentEl); },
            video_id:     function() { return getVideoID(); }
        }
    );
}

async function processYTCommentNode(commentEl) {
    if (!_ctxAlive()) return;
    let commentId = extractYTCommentId(commentEl);
    if (!commentId || _injectedCommentIds.has(commentId)) return;

    // ── API path ──────────────────────────────────────────────────────────────
    if (manipConfig_YT_comment.enabled && manipConfig_YT_comment.source === 'api' && manipConfig_YT_comment.endpoint && window.__sa_intervApi) {
        if (_inFlight_YT_comment.has(commentId)) return;
        _inFlight_YT_comment.add(commentId);
        _injectedCommentIds.add(commentId);
        _processedCount_YT++;

        const cached = window.__sa_intervApi.getCached(commentId);
        if (cached) {
            _ytCommentApplyResult(cached, commentEl, manipConfig_YT_comment.mode);
            _inFlight_YT_comment.delete(commentId);
            _injectYTCommentSurvey(commentEl, commentId);
            _renderYTCommentSurvey(commentEl, commentId);
            return;
        }

        const overlay = window.__sa_intervApi.createOverlay(commentEl, manipConfig_YT_comment.mode);
        const doRetry = function() {
            _inFlight_YT_comment.delete(commentId);
            _injectedCommentIds.delete(commentId);
            overlay.remove();
            processYTCommentNode(commentEl);
        };
        try {
            const body = extractYTCommentText(commentEl);
            const postData = {
                post_id:      commentId,
                account_id:   extractYTCommentAuthor(commentEl),
                body,
                post_metrics: extractYTCommentMetrics(commentEl),
                created_at:   extractYTCommentTimestamp(commentEl),
                video_id:     getVideoID()
            };
            const result = await window.__sa_intervApi.queuePost(postData);

            const meta = { applied: true, label: result.prompt_label || '', map_id: result.map_id || window.__sa_intervApi.getMapId() };
            if (manipConfig_YT_comment.logOriginal) meta.original_text = body;
            const extras = {};
            for (const k in result) {
                if (!['post_id', 'rewritten_text', 'map_id', 'prompt_label'].includes(k)) extras[k] = result[k];
            }
            if (Object.keys(extras).length > 0) meta.extras = extras;
            manipApplied_YT_comment[commentId] = meta;

            overlay.parentNode && overlay.parentNode.removeChild(overlay);
            _inFlight_YT_comment.delete(commentId);

            _ytCommentApplyResult(result, commentEl, manipConfig_YT_comment.mode);
            _injectYTCommentSurvey(commentEl, commentId);
            _renderYTCommentSurvey(commentEl, commentId);
        } catch(err) {
            overlay.showError(doRetry);
        }
        return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    _injectedCommentIds.add(commentId);
    _processedCount_YT++;
    _injectYTCommentSurvey(commentEl, commentId);
    _renderYTCommentSurvey(commentEl, commentId);
}

function enableYTCommentObserver() {
    let commentSel = SEL_YT.commentContainer;
    let commentTag = commentSel ? commentSel.toUpperCase() : '';

    [2000, 5000, 10000].forEach(function(d) {
        setTimeout(function() {
            document.querySelectorAll(commentSel).forEach(processYTCommentNode);
        }, d);
    });

    if (_ytCommentObserver) return;
    _ytCommentObserver = new MutationObserver(function(mutations) {
        if (!_ctxAlive()) { _ytCommentObserver.disconnect(); return; }
        for (let mutation of mutations) {
            mutation.addedNodes.forEach(function(node) {
                if (node.nodeType !== 1) return;
                if (node.tagName === commentTag) {
                    processYTCommentNode(node);
                } else {
                    node.querySelectorAll(commentSel).forEach(processYTCommentNode);
                }
            });
        }
    });
    _ytCommentObserver.observe(document.body, { childList: true, subtree: true });
}

// ── Channel page ──────────────────────────────────────────────────────────────

function extractChannelProfile() {
    let profile = {};

    try {
        let nameEl = document.querySelector(SEL_YT.userDisplayName);
        if (nameEl) {
            let ariaLabel = nameEl.getAttribute('aria-label') || '';
            if (ariaLabel) {
                profile.profile_name = ariaLabel.replace(/,\s*(verified|Verified)$/, '').trim();
            } else {
                profile.profile_name = (nameEl.innerText || nameEl.textContent || '').trim();
            }
        }
    } catch(e) {}

    try {
        let m = window.location.pathname.match(/^\/@([^/?#]+)/);
        if (m) profile.handle = '@' + m[1];
    } catch(e) {}

    try {
        let avatarEl = document.querySelector(SEL_YT.userAvatar);
        if (avatarEl && avatarEl.src) {
            profile.profile_img_url = avatarEl.src;
        } else {
            // og:image is always in <head> (never in shadow DOM); YouTube sets it to the channel avatar.
            let ogImg = document.querySelector('meta[property="og:image"]');
            if (ogImg) profile.profile_img_url = ogImg.getAttribute('content') || null;
        }
    } catch(e) {}

    try {
        let bannerEl = document.querySelector(SEL_YT.userBanner);
        if (bannerEl) profile.bannerUrl = bannerEl.src || null;
    } catch(e) {}

    try {
        let subEl = document.querySelector(SEL_YT.userFollowers);
        if (subEl) {
            profile.followersCount = (subEl.innerText || subEl.textContent || '').trim();
        } else {
            let metaEl = document.querySelector('yt-content-metadata-view-model');
            if (metaEl) {
                let spans = Array.from(metaEl.querySelectorAll('span'));
                let subSpan = spans.find(function(s) {
                    return (s.innerText || s.textContent || '').toLowerCase().includes('subscriber');
                });
                if (subSpan) profile.followersCount = (subSpan.innerText || subSpan.textContent || '').trim();
            }
        }
    } catch(e) {}

    return profile;
}

function injectYouTubeChannelSurvey() {
    if (!_ctxAlive()) return;
    let channelPath = window.location.pathname;
    if (_channelInjected === channelPath) return;

    let old = document.getElementById('surveyFormContainer');
    if (old) old.remove();

    _channelInjected = channelPath;

    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-user';
    surveyContainer.setAttribute('id', 'surveyFormContainer');
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });
    let cssUrl = chrome.runtime.getURL('content-scripts/youtube/inject.css');
    shadowRoot.innerHTML = '<iframe class="surveyIframe" src="' + chrome.runtime.getURL('sandbox/survey.html') + '" data-css="' + cssUrl + '" style="border:none; width:100%; height:100%; background:transparent;"></iframe>';

    let appRoot = document.querySelector('ytd-app') || document.body;
    appRoot.insertAdjacentElement('beforebegin', surveyContainer);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'isGuided', 'selectors', 'manipulationMaps'], function(result) {
        const _rawYT = (result.selectors && result.selectors.youtube) ? result.selectors.youtube : {};
        SEL_YT = Object.assign({}, _rawYT.shared || {}, _rawYT.account || {}, _rawYT.post || {}, _rawYT.comment || {});
        watchPostCounter('youtube', function() { return _processedCount_YT; });

        const _commentConfYT = result.config && result.config.surveys && result.config.surveys['youtube-comment'];
        manipConfig_YT_comment = (_commentConfYT && _commentConfYT.manipulation) || {};
        if (manipConfig_YT_comment.enabled && manipConfig_YT_comment.source === 'api' && manipConfig_YT_comment.endpoint && window.__sa_intervApi) {
            window.__sa_intervApi.init({ endpoint: manipConfig_YT_comment.endpoint, survey_type: 'youtube-comment', platform: 'youtube', mode: manipConfig_YT_comment.mode, logOriginal: manipConfig_YT_comment.logOriginal });
        }

        const currentPlatform = 'youtube';
        for (let index = 0; index < availableContextsYouTube.length; ++index) {
            let currentContext = availableContextsYouTube[index];
            if (!currentContext.name.includes(currentPlatform)) continue;

            let contextFlag = result.config.activeSurveys.includes(currentContext.name);
            let auxFlag = currentContext.auxiliaryCheck();

            console.log('[YT] initializeSurveys context:', currentContext.name, '| isEnabled=', result.isEnabled, '| contextFlag=', contextFlag, '| auxFlag=', auxFlag);
            if (result.isEnabled === true && contextFlag === true && auxFlag === true) {
                console.log('[YT] activating context:', currentContext.name);
                let activeSurvey = currentContext.name;
                let config = result.config['surveys'][activeSurvey];
                let studyID = config.studyID;

                function submitAction(errors, values) {
                    if (!errors) {
                        values.surveyType = currentContext.name;
                        values.studyID = studyID;

                        let isUserSurvey = currentContext.name.endsWith('-user');
                        if (currentContext.name === 'youtube-comment') {
                            let _ma = manipApplied_YT_comment[values.post_id];
                            if (_ma) {
                                values.intervention_applied = true;
                                values.intervention_label   = _ma.label;
                                values.intervention_map_id  = _ma.map_id;
                                if (_ma.original_text !== undefined) values.original_text = _ma.original_text;
                                if (_ma.extras) values.intervention_extras = _ma.extras;
                            } else {
                                values.intervention_applied = false;
                            }
                        }
                        if (isUserSurvey) {
                            let profile = extractChannelProfile();
                            let capturedAvatarUrl = profile.profile_img_url || null;
                            let capturedBannerUrl = profile.bannerUrl || null;
                            let capturedUserID = values.account_id;
                            let capturedSurveyType = currentContext.name;

                            chrome.storage.local.get(['isProfileDownloadEnabled', 'isBannerDownloadEnabled'], function(res) {
                                if (res.isProfileDownloadEnabled && capturedAvatarUrl) {
                                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [capturedAvatarUrl], userId: capturedUserID || 'user', postId: 'profile', surveyType: capturedSurveyType });
                                }
                                if (res.isBannerDownloadEnabled && capturedBannerUrl) {
                                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [capturedBannerUrl], userId: capturedUserID || 'user', postId: 'banner', surveyType: capturedSurveyType });
                                }
                            });
                        } else {
                            chrome.storage.local.get(['isMediaDownloadEnabled'], function(res) {
                                if (res.isMediaDownloadEnabled) {
                                    let evt = new CustomEvent('mh:download-request', { detail: { postID: values.post_id, userID: values.account_id, surveyType: currentContext.name } });
                                    window.dispatchEvent(evt);
                                }
                            });
                        }

                        storeResults(values, currentPlatform);
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.theme = config.theme || 'light';
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);

                if (currentContext.name === 'youtube-video') {
                    _ytVideoCtxActive = true;
                } else if (currentContext.name === 'youtube-user') {
                    _ytUserCtxActive = true;
                    _processedCount_YT++;
                    let surveyID = crawlUserName();
                    currentContext.renderSurvey(surveyID, null, {
                        user_profile: function() { return extractChannelProfile(); }
                    });
                } else if (currentContext.name === 'youtube-comment') {
                    _ytCommentCtxActive = true;
                }
            }
        }

        document.addEventListener('yt-navigate-finish', function() {
            if (!_ctxAlive()) return;
            if (_ytVideoCtxActive && checkVideoURL()) {
                setTimeout(processVideoPage, 500);
            }
            if (_ytUserCtxActive && checkChannelURL()) {
                let channelPath = window.location.pathname;
                if (_channelInjected !== channelPath) {
                    injectYouTubeChannelSurvey();
                    let channelCtx = availableContextsYouTube.find(function(c) { return c.name === 'youtube-user'; });
                    let surveyID = crawlUserName();
                    setTimeout(function() {
                        channelCtx.renderSurvey(surveyID, null, {
                            user_profile: function() { return extractChannelProfile(); }
                        });
                    }, 1000);
                }
            }
            if (_ytCommentCtxActive && checkVideoURL()) {
                _injectedCommentIds.clear();
                let commentSel = SEL_YT.commentContainer;
                [2000, 5000, 10000].forEach(function(d) {
                    setTimeout(function() {
                        document.querySelectorAll(commentSel).forEach(processYTCommentNode);
                    }, d);
                });
            }
        });
    });
}

window.__socialAnnotate__.platformDebugCapture = function(selectors, stored) {
    let raw = selectors.youtube || {};
    let SEL_D = Object.assign({}, raw.shared || {}, raw.account || {}, raw.post || {}, raw.comment || {});
    let activeSurvey = stored && stored.config && stored.config.activeSurveys && stored.config.activeSurveys[0];

    function probe(field) {
        let selector = SEL_D[field];
        if (!selector) return { field: field, selector: null, matched: false, value: null, note: 'not in selectors.json' };
        try {
            let el = document.querySelector(selector);
            return { field: field, selector: selector, matched: !!el, value: el ? (el.src || el.href || el.textContent.trim().slice(0, 200) || null) : null };
        } catch(e) {
            return { field: field, selector: selector, matched: false, value: null, note: 'invalid selector' };
        }
    }

    let isUser    = activeSurvey ? activeSurvey.endsWith('-user')    : checkChannelURL();
    let isComment = activeSurvey ? activeSurvey === 'youtube-comment' : false;
    let section = isUser ? (raw.account || {}) : isComment ? (raw.comment || {}) : (raw.post || {});
    return {
        platform: 'youtube',
        surveyType: activeSurvey || (isUser ? 'youtube-user' : 'youtube-video'),
        injectionStatus: {
            userSurveyInjected:    !!document.getElementById('surveyFormContainer'),
            postSurveysInjected:   document.querySelectorAll('.survey-container-post').length,
            commentSurveysInjected: _injectedCommentIds.size
        },
        extractedData: { userID: crawlUserName(), videoID: getVideoID(), profile: isUser ? extractChannelProfile() : {} },
        selectorDiagnostics: Object.keys(section).map(probe)
    };
};

initializeSurveys();
