const availableContextsMastodon = [
    new Context('mastodon-post', enablePostObserver, null),
    new Context('mastodon-user', injectMastodonUserSurvey, checkUserURL)
];

let SEL_MD = {};
let mdRoot = null;
let obsConfigMD = {};
let observerMD = null;

let manipConfig_MD  = {};
let manipMap_MD     = {};
let manipMapId_MD   = '';
let manipApplied_MD = {};
let _processedCount_MD = 0;
const _inFlight_MD = new Set();

// ── User intervention state ───────────────────────────────
let manipConfig_MDU  = {};
let manipApplied_MDU = {};
registerHealthCounter(function () { return _processedCount_MD; });

// Mastodon exposes a public REST API at /api/v1/statuses/:id on every instance.
// Using a relative URL works regardless of which instance we're on.
const _mdApiCache = {};

async function fetchMastodonPostData(postID) {
    if (_mdApiCache[postID]) return _mdApiCache[postID];
    try {
        const resp = await fetch('/api/v1/statuses/' + postID, { credentials: 'include' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        _mdApiCache[postID] = data;
        return data;
    } catch (e) {
        console.warn('[SocialAnnotate] MD API fetch failed for', postID, e.message);
        return null;
    }
}

function _mdStripHtml(html) {
    if (!html) return '';
    const d = document.createElement('div');
    d.innerHTML = html;
    return (d.textContent || d.innerText || '').trim();
}

function _mdMediaUrlsFromApi(data) {
    if (!data || !data.media_attachments) return [];
    return data.media_attachments
        .map(function(att) { return att.url || att.preview_url; })
        .filter(Boolean);
}

function _mdMetricsFromApi(data) {
    let metrics = { like_count: null, share_count: null, comment_count: null, bookmark_count: null, view_count: null, quote_count: null };
    if (!data) return metrics;
    if (data.favourites_count != null) metrics.like_count = data.favourites_count;
    if (data.reblogs_count != null) metrics.share_count = data.reblogs_count;
    if (data.replies_count != null) metrics.comment_count = data.replies_count;
    return metrics;
}

window.addEventListener('mh:download-request', async function(e) {
    let detail = e.detail;
    if (!detail) return;
    if ((detail.surveyType || '').includes('mastodon-user')) return;
    if (!detail.postID) return;

    let postID = detail.postID;
    let postOwner = detail.userID;
    let postSurveyType = detail.surveyType || 'mastodon-post';

    let containerName = 'surveyFormContainer-' + postID;
    let surveyContainer = document.getElementById(containerName);
    let injectNode = surveyContainer ? (surveyContainer.closest(SEL_MD.postContainer || 'article.status') || surveyContainer.parentNode) : null;

    if (!_mdApiCache[postID]) {
        await fetchMastodonPostData(postID);
    }

    const apiData = _mdApiCache[postID];
    let urlsToDownload = _mdMediaUrlsFromApi(apiData);

    if (urlsToDownload.length === 0 && injectNode) {
        urlsToDownload = extractMDPostMedia(injectNode);
    }

    if (urlsToDownload && urlsToDownload.length > 0) {
        chrome.runtime.sendMessage({ action: 'downloadMedia', urls: urlsToDownload, userId: postOwner || 'user', postId: postID, surveyType: postSurveyType });
    }
});

function extractMDPostMedia(postNode) {
    if (!postNode) return [];
    let mediaUrls = [];

    // media-gallery anchor hrefs point to original CDN files
    postNode.querySelectorAll('.media-gallery__item a[href]').forEach(function(a) {
        let href = a.getAttribute('href') || '';
        if (href && href.startsWith('http') && !href.includes('avatar')) {
            mediaUrls.push(href);
        }
    });

    let photos = postNode.querySelectorAll(SEL_MD.postImage || '.media-gallery img, .attachment-thumbnail__image');
    photos.forEach(function(img) {
        if (img.src && !img.src.includes('avatar') && !img.src.includes('missing.png')) {
            mediaUrls.push(img.src);
        }
    });

    let videos = postNode.querySelectorAll(SEL_MD.postVideo || '.video-player video, video');
    videos.forEach(function(video) {
        let src = null;
        let srcEl = video.querySelector('source');
        if (srcEl) src = srcEl.getAttribute('src') || srcEl.src;
        if (!src) src = video.getAttribute('src') || video.src || video.currentSrc;
        if (src) mediaUrls.push(src);
    });

    return [...new Set(mediaUrls)];
}

function extractMDPostTextContent(postNode) {
    let textEl = postNode.querySelector(SEL_MD.postText || '.status__content');
    if (!textEl) return '';
    return (textEl.innerText || textEl.textContent || '').trim();
}

function extractMDPostMetrics(postNode) {
    let metrics = { like_count: null, share_count: null, comment_count: null, bookmark_count: null, view_count: null, quote_count: null };

    const parseCount = function(btn) {
        if (!btn) return null;
        // aria-label format: "Reply, 3 replies" or just counter span text
        let counter = btn.querySelector('.icon-button__counter, .status__action-bar-counter__value');
        if (counter) {
            let n = parseInt(counter.textContent.replace(/,/g, ''), 10);
            return isNaN(n) ? null : n;
        }
        let label = btn.getAttribute('aria-label') || '';
        let m = label.match(/,\s*([\d,]+)/);
        return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
    };

    let replyBtn = postNode.querySelector(SEL_MD.metricsReply || '.status__action-bar .icon-button[title="Reply"], .status__action-bar button[aria-label*="Repl"]');
    metrics.comment_count = parseCount(replyBtn);

    let boostBtn = postNode.querySelector(SEL_MD.metricsRepost || '.status__action-bar .icon-button[title="Boost"], .status__action-bar button[aria-label*="Boost"]');
    metrics.share_count = parseCount(boostBtn);

    let favBtn = postNode.querySelector(SEL_MD.metricsLike || '.status__action-bar .icon-button[title="Favourite"], .status__action-bar button[aria-label*="Favour"]');
    metrics.like_count = parseCount(favBtn);

    return metrics;
}

function extractMDPostDetails(postNode) {
    // Primary: timestamp anchor href contains /@username/POSTID
    let timestampAnchor = postNode.querySelector(SEL_MD.postTimestamp || 'a.status__relative-time, a.detailed-status__datetime');
    let href = (timestampAnchor && (timestampAnchor.href || timestampAnchor.getAttribute('href'))) || '';

    let postID = '';
    let postOwner = '';

    if (href) {
        // Mastodon post URLs: /@user/NUMERIC_ID or /@user@instance/NUMERIC_ID
        let m = href.match(/\/@([^/]+)\/(\d+)/);
        if (m) {
            postOwner = m[1];
            postID = m[2];
        }
    }

    // Tier 2: scan all anchors
    if (!postID) {
        let anchors = postNode.querySelectorAll('a[href]');
        for (let a of anchors) {
            let m = (a.href || a.getAttribute('href') || '').match(/\/@([^/]+)\/(\d+)/);
            if (m) { postOwner = m[1]; postID = m[2]; break; }
        }
    }

    if (!postID) return null;

    // Strip federated suffix from owner: "@user@instance" → "user@instance" for storage
    // but keep the raw form so we can show it in the UI
    if (!postOwner) {
        let displayNameAnchor = postNode.querySelector(SEL_MD.postAuthorLink || 'a.status__display-name');
        if (displayNameAnchor) {
            let ownerHref = displayNameAnchor.href || displayNameAnchor.getAttribute('href') || '';
            let om = ownerHref.match(/\/@([^/?#]+)/);
            if (om) postOwner = om[1];
        }
    }

    return { postOwner: postOwner, postID: postID };
}

function _mdToggleBtn(textEl, originalNodes, rewrittenText) {
    if (manipConfig_MD.mode !== 'aware') return;
    let isOriginal = false;
    let toggleBtn = document.createElement('button');
    toggleBtn.textContent = '👁 Show original';
    toggleBtn.setAttribute('data-sa-interv-toggle', '1');
    toggleBtn.style.cssText = [
        'display:block','margin-left:auto','margin-bottom:4px',
        'padding:2px 10px','font-size:11px','line-height:1.6',
        'cursor:pointer','border-radius:4px',
        'background:rgba(99,100,255,0.08)','color:rgb(99,100,255)',
        'border:1px solid rgba(99,100,255,0.25)',
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

async function processPostNode(postNode) {
    _processedCount_MD++;
    if (!postNode) return;

    let postDetails = extractMDPostDetails(postNode);
    if (!postDetails || !postDetails.postID) return;

    // Deduplication: use ID-based check so it works whether survey is inside or adjacent
    if (document.getElementById('surveyFormContainer-' + postDetails.postID)) return;
    if (_inFlight_MD.has(postDetails.postID)) return;

    fetchMastodonPostData(postDetails.postID);

    function _mdSurveyGetters() {
        return {
            body: function() {
                const api = _mdApiCache[postDetails.postID];
                if (api && api.content) return _mdStripHtml(api.content);
                return extractMDPostTextContent(postNode);
            },
            media_urls: function() {
                const api = _mdApiCache[postDetails.postID];
                const apiUrls = _mdMediaUrlsFromApi(api);
                if (apiUrls.length > 0) return apiUrls;
                return extractMDPostMedia(postNode);
            },
            post_metrics: function() {
                const api = _mdApiCache[postDetails.postID];
                if (api) return _mdMetricsFromApi(api);
                return extractMDPostMetrics(postNode);
            },
            created_at: function() {
                const api = _mdApiCache[postDetails.postID];
                if (api && api.created_at) return api.created_at;
                let t = postNode.querySelector(SEL_MD.postTimestamp || 'a.status__relative-time time') || postNode.querySelector('time[datetime]');
                return t ? (t.getAttribute('datetime') || null) : null;
            }
        };
    }

    function _mdApplyResult(result, targetNode) {
        let textEl = targetNode.querySelector(SEL_MD.postText || '.status__content');
        if (textEl && result.rewritten_text) {
            let originalNodes = Array.from(textEl.childNodes).map(function(n) { return n.cloneNode(true); });
            textEl.textContent = result.rewritten_text;
            _mdToggleBtn(textEl, originalNodes, result.rewritten_text);
        }
    }

    // ── Live API path ─────────────────────────────────────────
    if (manipConfig_MD.enabled && manipConfig_MD.source === 'api' && manipConfig_MD.endpoint && window.__sa_intervApi) {
        _inFlight_MD.add(postDetails.postID);

        let cached = window.__sa_intervApi.getCached(postDetails.postID);
        if (cached) {
            _mdApplyResult(cached, postNode);
            _inFlight_MD.delete(postDetails.postID);
            injectMastodonPostSurvey(postNode, postDetails.postID);
            availableContextsMastodon[0].renderSurvey(postDetails.postOwner, postDetails.postID,
                Object.assign(_mdSurveyGetters(), { body: () => cached.rewritten_text }));
            return;
        }

        let overlay = window.__sa_intervApi.createOverlay(postNode, manipConfig_MD.mode);
        let doRetry = function() { _inFlight_MD.delete(postDetails.postID); overlay.remove(); processPostNode(postNode); };
        try {
            let apiData = _mdApiCache[postDetails.postID];
            let body = apiData && apiData.content ? _mdStripHtml(apiData.content) : extractMDPostTextContent(postNode);
            let postData = {
                post_id:      postDetails.postID,
                account_id:   postDetails.postOwner,
                body,
                created_at:   apiData ? apiData.created_at : null,
                media_urls:   apiData ? _mdMediaUrlsFromApi(apiData) : extractMDPostMedia(postNode),
                post_metrics: apiData ? _mdMetricsFromApi(apiData) : extractMDPostMetrics(postNode)
            };

            let result = await window.__sa_intervApi.queuePost(postData);

            let meta = { applied: true, label: result.prompt_label || '', map_id: result.map_id || window.__sa_intervApi.getMapId() };
            if (manipConfig_MD.logOriginal) meta.original_text = body;
            let extras = {};
            for (let k in result) {
                if (!['post_id', 'rewritten_text', 'map_id', 'prompt_label'].includes(k)) extras[k] = result[k];
            }
            if (Object.keys(extras).length > 0) meta.extras = extras;
            manipApplied_MD[postDetails.postID] = meta;

            overlay.parentNode && overlay.parentNode.removeChild(overlay);
            _inFlight_MD.delete(postDetails.postID);

            _mdApplyResult(result, postNode);

            injectMastodonPostSurvey(postNode, postDetails.postID);
            availableContextsMastodon[0].renderSurvey(postDetails.postOwner, postDetails.postID,
                Object.assign(_mdSurveyGetters(), { body: () => result.rewritten_text }));
        } catch(err) {
            overlay.showError(doRetry);
        }
        return;
    }
    // ─────────────────────────────────────────────────────────

    // ── Map path ──────────────────────────────────────────────
    if (manipConfig_MD.enabled && manipConfig_MD.source !== 'api' && manipMap_MD[postDetails.postID]) {
        let entry  = manipMap_MD[postDetails.postID];
        let textEl = postNode.querySelector(SEL_MD.postText || '.status__content');
        if (textEl) {
            let originalNodes = Array.from(textEl.childNodes).map(function(n) { return n.cloneNode(true); });
            textEl.textContent = entry.rewritten_text;
            _mdToggleBtn(textEl, originalNodes, entry.rewritten_text);
            let meta = { applied: true, label: entry.prompt_label || '', map_id: manipMapId_MD };
            if (manipConfig_MD.logOriginal) meta.original_text = entry.original_text || '';
            manipApplied_MD[postDetails.postID] = meta;
        }
    }
    // ─────────────────────────────────────────────────────────

    injectMastodonPostSurvey(postNode, postDetails.postID);
    availableContextsMastodon[0].renderSurvey(postDetails.postOwner, postDetails.postID, _mdSurveyGetters());
}

function scanForPosts() {
    const DEFAULTS = '.status__wrapper, article.status, .detailed-status__wrapper';
    let sel = SEL_MD.postContainer ? SEL_MD.postContainer + ', .detailed-status__wrapper' : DEFAULTS;
    let found = document.querySelectorAll(sel);
    found.forEach(processPostNode);
}

let _mdObserverDebounce = null;
function createObserver() {
    return new MutationObserver(function(mutationsList) {
        let hasChildList = mutationsList.some(function(m) { return m.type === 'childList' && m.addedNodes.length > 0; });
        if (!hasChildList) return;
        // Debounced full-document scan so we catch posts regardless of nesting depth
        clearTimeout(_mdObserverDebounce);
        _mdObserverDebounce = setTimeout(scanForPosts, 100);
    });
}

function enablePostObserver() {
    scanForPosts();
    if (mdRoot && observerMD) {
        observerMD.observe(mdRoot, obsConfigMD);
    }
    // Retry at multiple intervals in case posts load slowly
    [1500, 4000, 8000].forEach(function(delay) {
        setTimeout(scanForPosts, delay);
    });
}

function crawlUserName() {
    if (window.location.protocol === 'file:') {
        let handle = document.querySelector(SEL_MD.userHandle || '.account__header__display-name .u-url, .account__header__display-name .display-name__account');
        if (handle) return handle.textContent.trim().replace(/^@/, '');
        return 'local-test-user';
    }
    let m = window.location.pathname.match(/^\/@([^/?#]+)/);
    return m ? m[1] : '';
}

function checkUserURL() {
    if (window.location.protocol === 'file:') return true;
    let name = crawlUserName();
    // Must be on a profile path, not a post detail path
    return name !== '' && !/\/\d+/.test(window.location.pathname);
}

function extractUserProfile() {
    let profile = {};


    try {
        let nameEl = document.querySelector(SEL_MD.userDisplayName || 'h1');
        if (nameEl) profile.profile_name = nameEl.textContent.trim();
    } catch(e) {}

    // Handle from URL — no reliable DOM element without account__header classes
    try {
        let m = window.location.pathname.match(/^\/@([^/?#]+)/);
        if (m) profile.handle = '@' + m[1];
    } catch(e) {}

    try {
        // The profile header wraps the avatar in <a href="CDN_URL"> — use that href directly
        // to avoid matching lazy-loaded placeholder avatars from timeline posts below.
        let avatarAnchor = document.querySelector(SEL_MD.userAvatar || 'a[href*="/avatars/"][target="_blank"]');
        if (avatarAnchor) profile.profile_img_url = avatarAnchor.href;
    } catch(e) {}

    try {
        let bannerEl = document.querySelector(SEL_MD.userBanner || 'img.parallax, img[src*="/headers/"]');
        if (bannerEl) profile.bannerUrl = bannerEl.src;
    } catch(e) {}

    try {
        let bioEl = document.querySelector(SEL_MD.userBio || '.account__header__content');
        if (bioEl) profile.bio = bioEl.textContent.trim();
    } catch(e) {}

    try {
        let followersEl = document.querySelector(SEL_MD.userFollowers || 'a[href$="/followers"]');
        if (followersEl) profile.followersCount = followersEl.textContent.trim();
    } catch(e) {}

    try {
        let followingEl = document.querySelector(SEL_MD.userFollowing || 'a[href$="/following"]');
        if (followingEl) profile.followingCount = followingEl.textContent.trim();
    } catch(e) {}

    return profile;
}

// ── User intervention helpers ─────────────────────────────

function _mduGetFieldEl(field) {
    switch (field) {
        case 'profile_name':
            return document.querySelector(SEL_MD.userDisplayName || 'h1');
        case 'handle':
            return document.querySelector(SEL_MD.userHandle || '.display-name__account');
        case 'followers_count': {
            let a = document.querySelector(SEL_MD.userFollowers || 'a[href$="/followers"]');
            if (!a) return null;
            // Try abbr first (short format), then leaf span/div with digits
            let abbr = a.querySelector('abbr');
            if (abbr) return abbr;
            let children = a.querySelectorAll('span, strong');
            for (let s of children) {
                if (s.childElementCount === 0 && /^[\d,.KMBkmb]+$/.test(s.textContent.trim())) return s;
            }
            return a;
        }
        case 'following_count': {
            let a = document.querySelector(SEL_MD.userFollowing || 'a[href$="/following"]');
            if (!a) return null;
            let abbr = a.querySelector('abbr');
            if (abbr) return abbr;
            let children = a.querySelectorAll('span, strong');
            for (let s of children) {
                if (s.childElementCount === 0 && /^[\d,.KMBkmb]+$/.test(s.textContent.trim())) return s;
            }
            return a;
        }
        case 'bio':
            return document.querySelector(SEL_MD.userBio || '.account__header__content');
    }
    return null;
}

function _mduToggleBtn(fieldEl, originalText, rewrittenText) {
    let isOriginal = false;
    let btn = document.createElement('button');
    btn.textContent = '👁 Show original';
    btn.setAttribute('data-sa-interv-toggle', '1');
    btn.style.cssText = [
        'display:inline-block','margin-left:6px','padding:1px 8px','font-size:11px',
        'line-height:1.6','cursor:pointer','border-radius:4px','vertical-align:middle',
        'background:rgba(99,100,255,0.08)','color:rgb(99,100,255)',
        'border:1px solid rgba(99,100,255,0.25)',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
    ].join(';');
    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        isOriginal = !isOriginal;
        fieldEl.textContent = isOriginal ? originalText : rewrittenText;
        btn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
    });
    let container = fieldEl.closest('a') || fieldEl.closest('button');
    let insertAfter = container || fieldEl;
    insertAfter.parentNode.insertBefore(btn, insertAfter.nextSibling);
}

async function _applyMDUserIntervention(userID, profile) {
    if (!manipConfig_MDU.enabled || !manipConfig_MDU.endpoint) return;
    let fields = manipConfig_MDU.fields || {};
    let fieldsToIntervene = Object.keys(fields).filter(function(f) { return fields[f]; });
    if (fieldsToIntervene.length === 0) return;

    let removeOverlay = _createUserInterventionOverlay();

    let payload = {
        survey_type: 'mastodon-user',
        platform: 'mastodon',
        account_id: userID,
        profile_name: profile.profile_name || null,
        handle: profile.handle || null,
        followers_count: profile.followersCount || null,
        following_count: profile.followingCount || null,
        bio: profile.bio || null,
        fields_to_intervene: fieldsToIntervene
    };

    let result;
    try {
        let response = await fetch(manipConfig_MDU.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) { removeOverlay(); return; }
        result = await response.json();
    } catch (e) { removeOverlay(); return; }

    let originalValues = {};

    function applyFields() {
        let appliedAny = false;
        for (let field of fieldsToIntervene) {
            if (!result[field]) continue;
            let el = _mduGetFieldEl(field);
            if (!el) continue;
            if (originalValues[field] === undefined) originalValues[field] = el.textContent;
            if (el.textContent === result[field]) { appliedAny = true; continue; }
            el.textContent = result[field];
            appliedAny = true;
            if (manipConfig_MDU.mode === 'aware') {
                let container = el.closest('a') || el.closest('button');
                let checkAfter = container || el;
                let next = checkAfter.nextSibling;
                let hasToggle = next && next.nodeType === 1 && next.getAttribute && next.getAttribute('data-sa-interv-toggle');
                if (!hasToggle) _mduToggleBtn(el, originalValues[field], result[field]);
            }
        }
        if (appliedAny) removeOverlay();
    }

    applyFields();
    [200, 600, 1500].forEach(function(delay) { setTimeout(applyFields, delay); });

    let appliedFields = {};
    for (let field of fieldsToIntervene) {
        if (result[field]) appliedFields[field] = { original: originalValues[field] || '', rewritten: result[field] };
    }
    manipApplied_MDU[userID] = { applied: true, fields: appliedFields };
}

// ─────────────────────────────────────────────────────────

function injectMastodonUserSurvey() {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-user';
    surveyContainer.setAttribute('id', 'surveyFormContainer');
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL('content-scripts/mastodon/inject.css');
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL('sandbox/survey.html')}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    // Insert before the main Mastodon UI wrapper
    let appRoot = document.querySelector(SEL_MD.appRoot || '#mastodon, .ui') || document.body;
    appRoot.insertAdjacentElement('beforebegin', surveyContainer);
}

function injectMastodonPostSurvey(injectNode, postID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-post';
    surveyContainer.setAttribute('id', 'surveyFormContainer-' + postID);
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL('content-scripts/mastodon/inject.css');
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL('sandbox/survey.html')}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    // For the detail page focal post, insert after the wrapper (outside React's managed element)
    // to prevent Mastodon from stripping our injected node on reconciliation.
    if (injectNode.classList.contains('detailed-status__wrapper')) {
        injectNode.insertAdjacentElement('beforebegin', surveyContainer);
    } else {
        injectNode.insertAdjacentElement('afterbegin', surveyContainer);
    }
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'isGuided', 'selectors', 'manipulationMaps'], function(result) {
        const _rawMD = (result.selectors && result.selectors.mastodon) ? result.selectors.mastodon : {};
        SEL_MD = Object.assign({}, _rawMD.shared || {}, _rawMD.account || {}, _rawMD.post || {});
        watchPostCounter('mastodon', function() { return _processedCount_MD; });

        const _userConfMD = result.config && result.config.surveys && result.config.surveys['mastodon-user'];
        manipConfig_MDU = (_userConfMD && _userConfMD.manipulation) || {};

        const _postConfMD = result.config && result.config.surveys && result.config.surveys['mastodon-post'];
        manipConfig_MD = (_postConfMD && _postConfMD.manipulation) || {};
        if (manipConfig_MD.enabled) {
            if (manipConfig_MD.source !== 'api' && result.manipulationMaps && result.manipulationMaps['mastodon-post']) {
                let fullMap = result.manipulationMaps['mastodon-post'];
                manipMapId_MD = (fullMap._meta && fullMap._meta.map_id) || '';
                for (let k in fullMap) { if (k !== '_meta') manipMap_MD[k] = fullMap[k]; }
            } else if (manipConfig_MD.source === 'api' && manipConfig_MD.endpoint && window.__sa_intervApi) {
                window.__sa_intervApi.init({ endpoint: manipConfig_MD.endpoint, survey_type: 'mastodon-post', platform: 'mastodon', mode: manipConfig_MD.mode, logOriginal: manipConfig_MD.logOriginal });
            }
        }

        mdRoot = document.getElementById('mastodon') || document.querySelector(SEL_MD.appRoot || '.ui, #mastodon') || document.body;
        obsConfigMD = SEL_MD.observerFilter || { attributes: false, childList: true, subtree: true };
        observerMD = createObserver();

        const currentPlatform = 'mastodon';
        for (let index = 0; index < availableContextsMastodon.length; ++index) {
            let currentContext = availableContextsMastodon[index];
            if (!currentContext.name.includes(currentPlatform)) continue;

            let contextFlag = result.config.activeSurveys.includes(currentContext.name);
            let auxFlag = currentContext.auxiliaryCheck();

            if (result.isEnabled === true && contextFlag === true && auxFlag === true) {
                let activeSurvey = currentContext.name;
                let config = result.config['surveys'][activeSurvey];
                let studyID = config.studyID;

                function submitAction(errors, values) {
                    if (!errors) {
                        values.surveyType = currentContext.name;
                        values.studyID = studyID;

                        let isUserSurvey = currentContext.name.endsWith('-user');
                        if (isUserSurvey) {
                            let capturedUserID = values.account_id;
                            let capturedSurveyType = currentContext.name;
                            let profile = extractUserProfile();
                            let capturedAvatarUrl = profile.profile_img_url || null;
                            let capturedBannerUrl = profile.bannerUrl || null;

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

                        let _ma = manipApplied_MD[values.post_id];
                        let _maU = manipApplied_MDU[values.account_id];
                        if (_ma) {
                            values.intervention_applied = true;
                            values.intervention_label   = _ma.label;
                            values.intervention_map_id  = _ma.map_id;
                            if (_ma.original_text !== undefined) values.original_text = _ma.original_text;
                            if (_ma.extras) values.intervention_extras = _ma.extras;
                        } else if (_maU) {
                            values.intervention_applied = true;
                            values.intervention_label   = 'user-intervention';
                            values.intervention_map_id  = '';
                            values.intervention_extras  = _maU.fields;
                        } else {
                            values.intervention_applied = false;
                        }

                        storeResults(values, currentPlatform);
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.theme = config.theme || 'light';
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);

                if (currentContext.name !== 'mastodon-post') {
                    _processedCount_MD++;
                    let surveyID = crawlUserName();
                    currentContext.renderSurvey(surveyID, null, {
                        user_profile: function() { return extractUserProfile(); }
                    });
                    if (currentContext.name === 'mastodon-user' && manipConfig_MDU.enabled) {
                        let profile = extractUserProfile();
                        _applyMDUserIntervention(surveyID, profile);
                    }
                }
            }
        }
    });
}

window.__socialAnnotate__.platformDebugCapture = function(selectors, stored) {
    let raw = selectors.mastodon || {};
    let SEL_D = Object.assign({}, raw.shared || {}, raw.account || {}, raw.post || {});
    let activeSurvey = stored && stored.config && stored.config.activeSurveys && stored.config.activeSurveys[0];

    function probe(field) {
        let selector = SEL_D[field];
        if (!selector) return { field, selector: null, matched: false, value: null, note: 'not in selectors.json' };
        try {
            let el = document.querySelector(selector);
            return { field, selector, matched: !!el, value: el ? (el.src || el.href || el.textContent.trim().slice(0, 200) || null) : null };
        } catch(e) {
            return { field, selector, matched: false, value: null, note: 'invalid selector' };
        }
    }

    let isUser = activeSurvey ? activeSurvey.endsWith('-user') : checkUserURL();
    let section = isUser ? (raw.account || {}) : (raw.post || {});
    return {
        platform: 'mastodon',
        surveyType: activeSurvey || (isUser ? 'mastodon-user' : 'mastodon-post'),
        injectionStatus: {
            userSurveyInjected: !!document.getElementById('surveyFormContainer'),
            postSurveysInjected: document.querySelectorAll('.survey-container-post').length
        },
        extractedData: { userID: crawlUserName(), profile: isUser ? extractUserProfile() : {} },
        selectorDiagnostics: Object.keys(section).map(probe)
    };
};

initializeSurveys();
