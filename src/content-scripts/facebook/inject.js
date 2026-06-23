const availableContextsFacebook = [
    new Context('facebook-user', injectFacebookUserSurvey, checkFacebookUserURL),
    new Context('facebook-post', enableFBPostObserver, checkFBPostURL)
];

let SEL_FB = {};
let _processedCount_FB = 0;
registerHealthCounter(function() { return _processedCount_FB; });

let _fbUserCtxActive = false;
let _fbInjected = '';
let _fbLastHref = '';

let _fbPostObserver = null;
let manipConfig_FB = {};
let manipMap_FB = {};
let manipMapId_FB = '';
let manipApplied_FB = {};
let manipConfig_FBU = {};
let manipApplied_FBU = {};
const _inFlight_FB = new Set();

// ── URL helpers ───────────────────────────────────────────────────────────────

const _FB_NON_PROFILE_PATHS = new Set([
    '', 'home', 'watch', 'marketplace', 'groups', 'gaming', 'live',
    'events', 'pages', 'messages', 'notifications', 'bookmarks',
    'friends', 'fundraisers', 'help', 'login', 'settings', 'videos',
    'saved', 'memories', 'news', 'reels', 'search'
]);

function checkFacebookUserURL() {
    if (window.location.protocol === 'file:') return true;
    let host = window.location.hostname;
    if (host === '127.0.0.1' || host === 'localhost') return true;
    let path = window.location.pathname;
    if (path === '/profile.php') return true;
    // Single-segment path like /TurkcellTV or /TurkcellTV/
    let m = path.match(/^\/([A-Za-z0-9._]+)\/?(?:about|posts|videos|photos|reels)?(?:\/?$)/);
    if (m && !_FB_NON_PROFILE_PATHS.has(m[1].toLowerCase())) return true;
    return false;
}

function checkFBPostURL() {
    if (window.location.protocol === 'file:') return true;
    let host = window.location.hostname;
    if (host === '127.0.0.1' || host === 'localhost') return true;
    return !checkFacebookUserURL();
}

function crawlFacebookHandle() {
    if (window.location.protocol === 'file:') return 'local-test-user';
    let path = window.location.pathname;
    // /profile.php?id=...
    if (path === '/profile.php') {
        let id = new URLSearchParams(window.location.search).get('id');
        if (id) return id;
    }
    // /{vanity}
    let m = path.match(/^\/([A-Za-z0-9._]+)/);
    if (m && !_FB_NON_PROFILE_PATHS.has(m[1].toLowerCase())) return m[1];
    // Fallback: extract from followers link href
    let followerLink = document.querySelector(SEL_FB.userFollowers);
    if (followerLink) {
        let fm = (followerLink.getAttribute('href') || '').match(/facebook\.com\/([^/]+)\/followers/);
        if (fm) return fm[1];
    }
    return 'unknown';
}

// ── Profile extraction ────────────────────────────────────────────────────────

function extractFacebookProfile() {
    let profile = {};

    try {
        let nameEl = document.querySelector(SEL_FB.userDisplayName);
        if (nameEl) profile.profile_name = (nameEl.innerText || nameEl.textContent || '').trim();
    } catch(e) {}

    try {
        let handle = crawlFacebookHandle();
        if (handle && handle !== 'unknown') profile.handle = handle;
    } catch(e) {}

    try {
        // Facebook renders the profile picture as an SVG <image xlink:href="..."> inside
        // a[href*="photo/?fbid="] — scoping to the photo link excludes the logged-in
        // user's navbar avatar and story thumbnails (which link to /stories/).
        let avatarEl = document.querySelector(SEL_FB.userAvatar);
        if (avatarEl) {
            let url = avatarEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
                   || avatarEl.getAttribute('href')
                   || (avatarEl.tagName === 'IMG' ? avatarEl.src : null);
            if (url && !url.startsWith('data:')) profile.profile_img_url = url;
        }
    } catch(e) {}

    try {
        let bannerEl = document.querySelector(SEL_FB.userBanner);
        if (bannerEl && bannerEl.src && !bannerEl.src.startsWith('data:')) {
            profile.bannerUrl = bannerEl.src;
        }
    } catch(e) {}

    try {
        let followersEl = document.querySelector(SEL_FB.userFollowers);
        if (followersEl) profile.followersText = (followersEl.innerText || followersEl.textContent || '').trim();
    } catch(e) {}

    try {
        let followingEl = document.querySelector(SEL_FB.userFollowing);
        if (followingEl) profile.followingText = (followingEl.innerText || followingEl.textContent || '').trim();
    } catch(e) {}

    try {
        let bioEl = document.querySelector(SEL_FB.userBio);
        if (bioEl) profile.bio = (bioEl.innerText || bioEl.textContent || '').trim();
    } catch(e) {}

    return profile;
}

// ── SPA navigation ───────────────────────────────────────────────────────────

function onFBNavChange() {
    let newHref = window.location.href;
    console.log('[FB] onFBNavChange fired | newHref=', newHref, '| lastHref=', _fbLastHref, '| active=', _fbUserCtxActive);
    if (newHref === _fbLastHref) { console.log('[FB] onFBNavChange: same href, skipping'); return; }
    _fbLastHref = newHref;
    if (!_fbUserCtxActive) { console.log('[FB] onFBNavChange: context not active, skipping'); return; }
    if (!checkFacebookUserURL()) { console.log('[FB] onFBNavChange: not a profile URL, skipping'); return; }
    console.log('[FB] onFBNavChange: scheduling re-inject in 1500ms');
    setTimeout(function() {
        console.log('[FB] onFBNavChange: re-injecting | path=', window.location.pathname, '| injected=', _fbInjected);
        injectFacebookUserSurvey();
        let ctx = availableContextsFacebook.find(function(c) { return c.name === 'facebook-user'; });
        if (ctx) {
            let handle = crawlFacebookHandle();
            console.log('[FB] onFBNavChange: renderSurvey for handle=', handle);
            ctx.renderSurvey(handle, null, {
                user_profile: function() { return extractFacebookProfile(); }
            });
        } else {
            console.log('[FB] onFBNavChange: ctx not found!');
        }
    }, 1500);
}

// ── User intervention ─────────────────────────────────────────────────────────

function _fbuGetFieldEl(field) {
    switch (field) {
        case 'profile_name':
            return document.querySelector(SEL_FB.userDisplayName || 'h1.html-h1');
        case 'followers_count':
            return document.querySelector(SEL_FB.userFollowersCount || 'a[href*="/followers/"] strong');
        case 'following_count':
            return document.querySelector(SEL_FB.userFollowingCount || 'a[href*="/following/"] strong');
        case 'bio':
            return document.querySelector(SEL_FB.userBioText || 'span[dir="auto"]');
    }
    return null;
}

function _fbuToggleBtn(fieldEl, originalText, rewrittenText) {
    let isOriginal = false;
    let btn = document.createElement('button');
    btn.textContent = '👁 Show original';
    btn.setAttribute('data-sa-interv-toggle', '1');
    btn.style.cssText = [
        'display:inline-block','margin-left:6px','padding:1px 8px','font-size:11px',
        'line-height:1.6','cursor:pointer','border-radius:4px','vertical-align:middle',
        'background:rgba(24,119,242,0.08)','color:rgb(24,119,242)',
        'border:1px solid rgba(24,119,242,0.25)',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
    ].join(';');
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        isOriginal = !isOriginal;
        fieldEl.textContent = isOriginal ? originalText : rewrittenText;
        btn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
    });
    fieldEl.parentNode.insertBefore(btn, fieldEl.nextSibling);
}

async function _applyFBUserIntervention(userID, profile, existingOverlay) {
    if (!manipConfig_FBU.enabled || !manipConfig_FBU.endpoint) return;
    let fields = manipConfig_FBU.fields || {};
    let fieldsToIntervene = Object.keys(fields).filter(function(f) { return fields[f]; });
    if (fieldsToIntervene.length === 0) { if (existingOverlay) existingOverlay(); return; }

    let removeOverlay = existingOverlay || _createUserInterventionOverlay();

    let domValues = {};
    fieldsToIntervene.forEach(function(f) {
        let el = _fbuGetFieldEl(f);
        if (el) domValues[f] = (el.innerText || el.textContent || '').trim();
    });

    let payload = {
        survey_type: 'facebook-user',
        platform: 'facebook',
        account_id: userID,
        profile_name: domValues.profile_name || profile.profile_name || null,
        followers_count: domValues.followers_count || null,
        following_count: domValues.following_count || null,
        bio: domValues.bio || profile.bio || null,
        fields_to_intervene: fieldsToIntervene
    };

    let result;
    try {
        let response = await fetch(manipConfig_FBU.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) { removeOverlay(); return; }
        result = await response.json();
    } catch(e) { removeOverlay(); return; }

    let originalValues = {};
    let profileSnapshot = null;

    function applyFields() {
        let appliedAny = false;
        for (let field of fieldsToIntervene) {
            if (!result[field]) continue;
            let el = _fbuGetFieldEl(field);
            if (!el) continue;
            if (originalValues[field] === undefined) originalValues[field] = (el.innerText || el.textContent || '').trim();
            if ((el.innerText || el.textContent || '').trim() === result[field]) { appliedAny = true; continue; }
            if (!profileSnapshot) {
                try { profileSnapshot = extractFacebookProfile(); } catch(e) {}
            }
            el.textContent = result[field];
            appliedAny = true;
            if (manipConfig_FBU.mode === 'aware') {
                let next = el.nextSibling;
                let hasToggle = next && next.nodeType === 1 && next.getAttribute && next.getAttribute('data-sa-interv-toggle');
                if (!hasToggle) _fbuToggleBtn(el, originalValues[field], result[field]);
            }
        }
        if (appliedAny) removeOverlay();

        // Patch snapshot: profile_name and bio use selectors that can match unrelated nav elements.
        // originalValues are captured directly from the target elements, so they're always correct.
        if (profileSnapshot) {
            if (originalValues.profile_name !== undefined) profileSnapshot.profile_name = originalValues.profile_name;
            if (originalValues.bio !== undefined) profileSnapshot.bio = originalValues.bio;
        }

        let appliedFields = {};
        for (let field of fieldsToIntervene) {
            if (result[field]) appliedFields[field] = { original: originalValues[field] || '', rewritten: result[field] };
        }
        manipApplied_FBU[userID] = { applied: true, fields: appliedFields, profileSnapshot: profileSnapshot };
    }

    applyFields();
    [200, 600, 1500].forEach(function(delay) { setTimeout(applyFields, delay); });
}

// ── Survey injection ──────────────────────────────────────────────────────────

function injectFacebookUserSurvey() {
    let currentHandle = crawlFacebookHandle();
    console.log('[FB] injectFacebookUserSurvey | handle=', currentHandle, '| _fbInjected=', _fbInjected);
    // Deduplicate by handle, not by pathname — all profile.php?id=... profiles share the same path.
    if (currentHandle !== 'unknown' && _fbInjected === currentHandle) {
        console.log('[FB] injectFacebookUserSurvey: already injected for this handle, skipping');
        return;
    }

    let existing = document.getElementById('surveyFormContainer');
    if (existing) { console.log('[FB] injectFacebookUserSurvey: removing existing container'); existing.remove(); }

    _fbInjected = currentHandle;
    _processedCount_FB++;

    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-user';
    surveyContainer.id = 'surveyFormContainer';
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });
    let cssUrl = chrome.runtime.getURL('content-scripts/facebook/inject.css');
    shadowRoot.innerHTML = '<iframe class="surveyIframe" src="' + chrome.runtime.getURL('sandbox/survey.html') + '" data-css="' + cssUrl + '" style="border:none; width:100%; height:100%; background:transparent;"></iframe>';

    // Insert before the React mount root to survive SPA re-renders
    let mountEl = document.querySelector('[id^=mount]') || document.body;
    mountEl.insertAdjacentElement('beforebegin', surveyContainer);
}

// ── Post helpers ──────────────────────────────────────────────────────────────

function extractFBPostDetails(postNode) {
    let postID = null;
    let postOwner = null;

    // Scan every anchor in the post for any recognisable post ID pattern
    let anchors = postNode.querySelectorAll('a[href]');
    for (let a of anchors) {
        let href = a.getAttribute('href') || '';
        let m;
        // /groups/GID/posts/PID/ or /groups/GID/permalink/PID/
        m = href.match(/\/groups\/[^/]+\/(?:posts|permalink)\/([0-9]+)/);
        if (m) { postID = m[1]; break; }
        // multi-image album: set=pcb.POSTID or single group photo: set=gm.POSTID
        m = href.match(/[?&]set=(?:pcb|gm)\.([0-9]+)/);
        if (m) { postID = m[1]; break; }
        // /posts/ID or /videos/ID or /photos/ID or /reel/ID
        m = href.match(/\/(?:posts|videos|photos|reel)\/([0-9]+)/);
        if (m) { postID = m[1]; break; }
        // story_fbid=ID or pfbid=...
        m = href.match(/[?&](?:story_fbid|pfbid)=([^&]+)/);
        if (m) { postID = m[1]; break; }
        // /permalink/ID/
        m = href.match(/\/permalink\/([0-9]+)/);
        if (m) { postID = m[1]; break; }
    }

    // Fallback: check data-ft attribute on the node or its ancestors (old FB layout)
    if (!postID) {
        let el = postNode;
        for (let i = 0; i < 5 && el; i++) {
            let ft = el.getAttribute && el.getAttribute('data-ft');
            if (ft) {
                try {
                    let parsed = JSON.parse(ft);
                    let id = parsed.top_level_post_id || parsed.tl_objid || parsed.content_owner_id_new;
                    if (id) { postID = String(id); break; }
                } catch(e) {}
            }
            el = el.parentElement;
        }
    }

    if (!postID) return null;

    // Author: prefer the h2 display name, then any named profile link, then page handle
    let nameEl = SEL_FB.postAuthorName ? postNode.querySelector(SEL_FB.postAuthorName) : null;
    if (nameEl) {
        postOwner = (nameEl.innerText || nameEl.textContent || '').trim().replace(/\s+/g, ' ');
    }
    if (!postOwner) {
        // Group posts: /groups/GID/user/UID/ — extract UID as owner
        for (let a of anchors) {
            let m = (a.getAttribute('href') || '').match(/\/groups\/[^/]+\/user\/([0-9]+)/);
            if (m) { postOwner = m[1]; break; }
        }
    }
    if (!postOwner) postOwner = crawlFacebookHandle() || 'unknown';

    return { postID, postOwner };
}

function extractFBPostText(postNode) {
    if (!SEL_FB.postText) return '';
    let el = postNode.querySelector(SEL_FB.postText);
    return el ? (el.innerText || el.textContent || '').trim() : '';
}

function extractFBPostMedia(postNode) {
    let urls = [];
    let videoEls = postNode.querySelectorAll(SEL_FB.postVideo || 'video');
    let hasVideo = videoEls.length > 0;
    if (hasVideo) {
        videoEls.forEach(function(video) {
            let resolved = video.currentSrc || video.src || '';
            if (!resolved) { let s = video.querySelector('source'); if (s) resolved = s.src || s.getAttribute('src') || ''; }
            if (resolved && !resolved.startsWith('blob:') && !resolved.startsWith('data:')) urls.push(resolved);
        });
    } else {
        let imgs = postNode.querySelectorAll(SEL_FB.postImage || 'img[src]');
        imgs.forEach(function(img) {
            let src = img.src || img.getAttribute('src') || '';
            // /t39.30808-1/ = profile/avatar CDN path; skip those, keep post content images
            if (src && !src.startsWith('data:') && !src.includes('emoji') && !src.includes('icon')
                && !src.includes('/t39.30808-1/')) urls.push(src);
        });
    }
    return [...new Set(urls)];
}

function extractFBPostMetrics(postNode) {
    let metrics = { like_count: null, comment_count: null, share_count: null };
    const parse = function(str) {
        if (!str) return null;
        str = str.trim().replace(/,/g, '');
        if (/K/i.test(str)) return Math.round(parseFloat(str) * 1000);
        if (/M/i.test(str)) return Math.round(parseFloat(str) * 1000000);
        let n = parseInt(str, 10);
        return isNaN(n) ? null : n;
    };
    if (SEL_FB.metricsLike) { let el = postNode.querySelector(SEL_FB.metricsLike); if (el) metrics.like_count = parse(el.innerText || el.textContent); }
    if (SEL_FB.metricsReply) { let el = postNode.querySelector(SEL_FB.metricsReply); if (el) metrics.comment_count = parse(el.innerText || el.textContent); }
    if (SEL_FB.metricsRepost) { let el = postNode.querySelector(SEL_FB.metricsRepost); if (el) metrics.share_count = parse(el.innerText || el.textContent); }
    return metrics;
}

function injectFBPostSurvey(postNode, postID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-post';
    surveyContainer.id = 'surveyFormContainer-' + postID;
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });
    let cssUrl = chrome.runtime.getURL('content-scripts/facebook/inject.css');
    shadowRoot.innerHTML = '<iframe class="surveyIframe" src="' + chrome.runtime.getURL('sandbox/survey.html') + '" data-css="' + cssUrl + '" style="border:none; width:100%; height:100%; background:transparent;"></iframe>';
    postNode.insertAdjacentElement('afterbegin', surveyContainer);
}

function _fbToggleBtn(textEl, originalNodes, rewrittenText, mode) {
    if (mode !== 'aware') return;
    let isOriginal = false;
    let toggleBtn = document.createElement('button');
    toggleBtn.textContent = '👁 Show original';
    toggleBtn.setAttribute('data-sa-interv-toggle', '1');
    toggleBtn.style.cssText = [
        'display:block','margin-left:auto','margin-bottom:4px',
        'padding:2px 10px','font-size:11px','line-height:1.6',
        'cursor:pointer','border-radius:4px',
        'background:rgba(24,119,242,0.08)','color:rgb(24,119,242)',
        'border:1px solid rgba(24,119,242,0.25)',
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

function _fbApplyResult(result, postNode, mode) {
    let textEl = SEL_FB.postText ? postNode.querySelector(SEL_FB.postText) : null;
    if (textEl && result.rewritten_text) {
        let originalNodes = Array.from(textEl.childNodes).map(function(n) { return n.cloneNode(true); });
        textEl.textContent = result.rewritten_text;
        _fbToggleBtn(textEl, originalNodes, result.rewritten_text, mode);
    }
}

async function processFBPostNode(postNode) {
    if (postNode.getElementsByClassName('survey-container-post').length > 0) return;
    let postCtx = availableContextsFacebook.find(function(c) { return c.name === 'facebook-post'; });
    if (!postCtx || !postCtx.formTemplate) return;

    // Skip feed widgets (Reels carousels, Suggested Groups, etc.) — real posts always have an author element
    let authorSel = SEL_FB.postAuthorName || '[data-ad-rendering-role="profile_name"] a, h2 a[role="link"]';
    if (!postNode.querySelector(authorSel)) return;

    let details = extractFBPostDetails(postNode);
    if (!details) return;

    _processedCount_FB++;

    const _renderSurvey = function() {
        postCtx.renderSurvey(details.postOwner, details.postID, {
            body: function() { return extractFBPostText(postNode); },
            media_urls: function() { return extractFBPostMedia(postNode); },
            post_metrics: function() { return extractFBPostMetrics(postNode); },
            created_at: function() {
                if (!SEL_FB.postTimestamp) return null;
                let el = postNode.querySelector(SEL_FB.postTimestamp);
                if (!el) return null;
                let val = el.getAttribute(SEL_FB.postTimestampAttr) || el.getAttribute('title');
                if (val) return val;
                let labelSpan = el.querySelector('[aria-labelledby]');
                if (labelSpan) {
                    let labelEl = document.getElementById(labelSpan.getAttribute('aria-labelledby'));
                    if (labelEl) return (labelEl.textContent || '').trim() || null;
                }
                return null;
            }
        });
    };

    // ── API path ──────────────────────────────────────────────────────────────
    if (manipConfig_FB.enabled && manipConfig_FB.source === 'api' && manipConfig_FB.endpoint && window.__sa_intervApi) {
        if (document.getElementById('surveyFormContainer-' + details.postID)) {
            _renderSurvey();
            return;
        }
        if (_inFlight_FB.has(details.postID)) return;
        _inFlight_FB.add(details.postID);

        const cached = window.__sa_intervApi.getCached(details.postID);
        if (cached) {
            _fbApplyResult(cached, postNode, manipConfig_FB.mode);
            _inFlight_FB.delete(details.postID);
            injectFBPostSurvey(postNode, details.postID);
            _renderSurvey();
            return;
        }

        const overlay = window.__sa_intervApi.createOverlay(postNode, manipConfig_FB.mode);
        const doRetry = function() { _inFlight_FB.delete(details.postID); overlay.remove(); processFBPostNode(postNode); };
        try {
            const body = extractFBPostText(postNode);
            const postData = {
                post_id:      details.postID,
                account_id:   details.postOwner,
                body,
                media_urls:   extractFBPostMedia(postNode),
                post_metrics: extractFBPostMetrics(postNode)
            };
            const result = await window.__sa_intervApi.queuePost(postData);

            const meta = { applied: true, label: result.prompt_label || '', map_id: result.map_id || window.__sa_intervApi.getMapId() };
            if (manipConfig_FB.logOriginal) meta.original_text = body;
            const extras = {};
            for (const k in result) {
                if (!['post_id', 'rewritten_text', 'map_id', 'prompt_label'].includes(k)) extras[k] = result[k];
            }
            if (Object.keys(extras).length > 0) meta.extras = extras;
            manipApplied_FB[details.postID] = meta;

            overlay.parentNode && overlay.parentNode.removeChild(overlay);
            _inFlight_FB.delete(details.postID);

            _fbApplyResult(result, postNode, manipConfig_FB.mode);
            injectFBPostSurvey(postNode, details.postID);
            _renderSurvey();
        } catch(err) {
            overlay.showError(doRetry);
        }
        return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Map path ──────────────────────────────────────────────────────────────
    if (manipConfig_FB.enabled && manipMap_FB[details.postID]) {
        let entry = manipMap_FB[details.postID];
        let textEl = SEL_FB.postText ? postNode.querySelector(SEL_FB.postText) : null;
        if (textEl) {
            let rewrittenText = entry.rewritten_text;
            let originalText = entry.original_text || '';
            textEl.textContent = rewrittenText;
            if (manipConfig_FB.mode === 'aware') {
                let isOriginal = false;
                let toggleBtn = document.createElement('button');
                toggleBtn.textContent = '👁 Show original';
                toggleBtn.setAttribute('data-sa-interv-toggle', '1');
                toggleBtn.style.cssText = [
                    'display:block','margin-left:auto','margin-bottom:4px',
                    'padding:2px 10px','font-size:11px','line-height:1.6',
                    'cursor:pointer','border-radius:4px',
                    'background:rgba(24,119,242,0.08)','color:rgb(24,119,242)',
                    'border:1px solid rgba(24,119,242,0.25)',
                    'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
                ].join(';');
                toggleBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    isOriginal = !isOriginal;
                    textEl.textContent = isOriginal ? originalText : rewrittenText;
                    toggleBtn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
                });
                textEl.parentNode.insertBefore(toggleBtn, textEl);
            }
            let meta = { applied: true, label: entry.prompt_label || '', map_id: manipMapId_FB };
            if (manipConfig_FB.logOriginal) meta.original_text = originalText;
            manipApplied_FB[details.postID] = meta;
        }
    }
    // ─────────────────────────────────────────────────────────────────────────

    injectFBPostSurvey(postNode, details.postID);
    _renderSurvey();
}

function createFBPostObserver() {
    return new MutationObserver(function(mutations) {
        let sel = SEL_FB.postContainer || 'div[data-virtualized="false"]';
        for (let mutation of mutations) {
            if (mutation.type === 'attributes') {
                let node = mutation.target;
                if (node.matches && node.matches(sel)) processFBPostNode(node);
            } else if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType !== 1) return;
                    if (node.matches && node.matches(sel)) {
                        processFBPostNode(node);
                    } else {
                        node.querySelectorAll(sel).forEach(processFBPostNode);
                    }
                });
            }
        }
    });
}

function enableFBPostObserver() {
    let sel = SEL_FB.postContainer || 'div[data-virtualized="false"]';
    document.querySelectorAll(sel).forEach(processFBPostNode);
    let obsConf = SEL_FB.observerFilter || { attributes: false, childList: true, subtree: true };
    _fbPostObserver = createFBPostObserver();
    _fbPostObserver.observe(document.body, obsConf);
    setTimeout(function() { document.querySelectorAll(sel).forEach(processFBPostNode); }, 1500);
}

function _fbRecordVideo(video, postId, userID) {
    let stream;
    try { stream = video.captureStream(); } catch(e) {
        console.warn('[FB] captureStream failed:', e); return;
    }
    let mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
    let recorder = new MediaRecorder(stream, { mimeType: mimeType, videoBitsPerSecond: 3000000 });
    let chunks = [];
    recorder.ondataavailable = function(ev) { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };
    recorder.onstop = function() {
        let blob = new Blob(chunks, { type: mimeType });
        let blobUrl = URL.createObjectURL(blob);
        let safeUser = (userID || 'user').replace(/[^a-zA-Z0-9._-]/g, '_');
        let safePost = String(postId).replace(/[^a-zA-Z0-9._-]/g, '_');
        let key = Math.random().toString(36).substr(2, 9);
        let a = document.createElement('a');
        a.href = blobUrl;
        a.download = 'facebook__' + key + '__.webm';
        a.style.display = 'none';
        document.body.appendChild(a);
        chrome.runtime.sendMessage({ action: 'registerFBVideoDownload', key: key, userId: safeUser, postId: safePost }, function() {
            a.click();
            setTimeout(function() { if (a.parentNode) a.parentNode.removeChild(a); URL.revokeObjectURL(blobUrl); }, 15000);
        });
        console.log('[FB] Video recorded:', blob.size, 'bytes');
    };
    // Record for the video's duration (capped at 90s for long videos)
    let dur = (video.duration && isFinite(video.duration)) ? Math.min(video.duration, 90) : 30;
    recorder.start(200);
    console.log('[FB] Recording video for', dur, 's...');
    setTimeout(function() { if (recorder.state !== 'inactive') recorder.stop(); }, dur * 1000);
}

window.addEventListener('mh:download-request', function(e) {
    let detail = e.detail;
    if (!detail || !detail.postID || (detail.surveyType && detail.surveyType !== 'facebook-post')) return;
    let containerName = 'surveyFormContainer-' + detail.postID;
    let surveyContainer = document.getElementById(containerName);
    let postNode = surveyContainer ? surveyContainer.parentElement : null;
    let urls = postNode ? extractFBPostMedia(postNode) : [];

    let validUrls = urls.filter(function(u) { return !u.startsWith('[Blob Stream]'); });
    if (validUrls.length > 0) {
        // Image post — direct CDN download via background
        chrome.runtime.sendMessage({ action: 'downloadMedia', urls: validUrls, userId: detail.userID || 'user', postId: detail.postID, surveyType: 'facebook-post' });
    } else {
        // Video post — capture the playing stream via MediaRecorder
        let videoEl = postNode ? postNode.querySelector('video') : null;
        if (videoEl && videoEl.readyState >= 2) {
            _fbRecordVideo(videoEl, detail.postID, detail.userID);
        } else {
            console.warn('[FB] No playable video found for post', detail.postID);
        }
    }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

function initializeSurveys() {
    let _earlyOverlayRemove = checkFacebookUserURL() ? _createUserInterventionOverlay(4000) : null;

    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'isGuided', 'selectors', 'manipulationMaps'], function(result) {
        const _rawFB = (result.selectors && result.selectors.facebook) ? result.selectors.facebook : {};
        SEL_FB = Object.assign({}, _rawFB.shared || {}, _rawFB.account || {}, _rawFB.post || {});
        watchPostCounter('facebook', function() { return _processedCount_FB; });

        const _postConfFB = result.config && result.config.surveys && result.config.surveys['facebook-post'];
        manipConfig_FB = (_postConfFB && _postConfFB.manipulation) || {};
        const _userConfFBU = result.config && result.config.surveys && result.config.surveys['facebook-user'];
        manipConfig_FBU = (_userConfFBU && _userConfFBU.manipulation) || {};
        if (manipConfig_FB.enabled && manipConfig_FB.source !== 'api' && result.manipulationMaps && result.manipulationMaps['facebook-post']) {
            let fullMap = result.manipulationMaps['facebook-post'];
            manipMapId_FB = (fullMap._meta && fullMap._meta.map_id) || '';
            for (let k in fullMap) { if (k !== '_meta') manipMap_FB[k] = fullMap[k]; }
        }

        if (manipConfig_FB.enabled && manipConfig_FB.source === 'api' && manipConfig_FB.endpoint && window.__sa_intervApi) {
            window.__sa_intervApi.init({ endpoint: manipConfig_FB.endpoint, survey_type: 'facebook-post', platform: 'facebook', mode: manipConfig_FB.mode, logOriginal: manipConfig_FB.logOriginal });
        }

        const currentPlatform = 'facebook';
        for (let index = 0; index < availableContextsFacebook.length; ++index) {
            let currentContext = availableContextsFacebook[index];

            let contextFlag = result.config.activeSurveys.includes(currentContext.name);
            let auxFlag = currentContext.auxiliaryCheck();

            console.log('[FB] initializeSurveys context:', currentContext.name, '| isEnabled=', result.isEnabled, '| contextFlag=', contextFlag, '| auxFlag=', auxFlag);
            if (result.isEnabled === true && contextFlag === true && auxFlag === true) {
                console.log('[FB] activating context:', currentContext.name);
                let activeSurvey = currentContext.name;
                let config = result.config['surveys'][activeSurvey];
                let studyID = config.studyID;

                function submitAction(errors, values) {
                    console.log('[FB] submitAction fired | errors=', errors, '| values=', JSON.stringify(values));
                    if (!errors) {
                        values.surveyType = currentContext.name;
                        values.studyID = studyID;

                        if (currentContext.name === 'facebook-user') {
                            let profile = extractFacebookProfile();
                            console.log('[FB] submitAction: extracted profile=', JSON.stringify(profile));
                            chrome.storage.local.get(['isProfileDownloadEnabled', 'isBannerDownloadEnabled'], function(res) {
                                if (res.isProfileDownloadEnabled && profile.profile_img_url) {
                                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [profile.profile_img_url], userId: values.account_id || 'user', postId: 'profile', surveyType: activeSurvey });
                                }
                                if (res.isBannerDownloadEnabled && profile.bannerUrl) {
                                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [profile.bannerUrl], userId: values.account_id || 'user', postId: 'banner', surveyType: activeSurvey });
                                }
                            });
                            let _maU = manipApplied_FBU[values.account_id];
                            if (_maU) {
                                values.intervention_applied = true;
                                values.intervention_label   = 'user-intervention';
                                values.intervention_map_id  = '';
                                values.intervention_fields  = _maU.fields;
                                if (_maU.profileSnapshot) values.user_profile = _maU.profileSnapshot;
                            } else {
                                values.intervention_applied = false;
                            }
                        } else {
                            let _ma = manipApplied_FB[values.post_id];
                            if (_ma) {
                                values.intervention_applied = true;
                                values.intervention_label = _ma.label;
                                values.intervention_map_id = _ma.map_id;
                                if (_ma.original_text !== undefined) values.original_text = _ma.original_text;
                                if (_ma.extras) values.intervention_extras = _ma.extras;
                            } else {
                                values.intervention_applied = false;
                            }
                            chrome.storage.local.get(['isMediaDownloadEnabled'], function(res) {
                                if (res.isMediaDownloadEnabled) {
                                    let evt = new CustomEvent('mh:download-request', { detail: { postID: values.post_id, userID: values.account_id, surveyType: currentContext.name } });
                                    window.dispatchEvent(evt);
                                }
                            });
                        }

                        storeResults(values, currentPlatform);
                    } else {
                        console.log('[FB] submitAction: skipped due to errors=', errors);
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.theme = config.theme || 'light';
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);

                if (currentContext.name === 'facebook-user') {
                    _fbUserCtxActive = true;
                    _fbLastHref = window.location.href;
                    let surveyID = crawlFacebookHandle();
                    currentContext.renderSurvey(surveyID, null, {
                        user_profile: function() { return extractFacebookProfile(); }
                    });
                    if (manipConfig_FBU.enabled) {
                        let profile = extractFacebookProfile();
                        _applyFBUserIntervention(surveyID, profile, _earlyOverlayRemove);
                        _earlyOverlayRemove = null;
                    } else if (_earlyOverlayRemove) {
                        _earlyOverlayRemove();
                        _earlyOverlayRemove = null;
                    }
                }
            }
        }

        if (_earlyOverlayRemove) { _earlyOverlayRemove(); _earlyOverlayRemove = null; }

        // Facebook updates <title> via React internals — MutationObserver can't catch it.
        // Poll the URL directly instead; 500ms is imperceptible and catches all pushState navs.
        window.addEventListener('popstate', onFBNavChange);
        setInterval(function() {
            if (window.location.href !== _fbLastHref) {
                onFBNavChange();
            }
        }, 500);
        console.log('[FB] SPA nav polling started');
    });
}

window.__socialAnnotate__.platformDebugCapture = function(selectors, stored) {
    let raw = selectors.facebook || {};
    let SEL_D = Object.assign({}, raw.shared || {}, raw.account || {}, raw.post || {});
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

    let isUser = activeSurvey ? activeSurvey.endsWith('-user') : checkFacebookUserURL();
    let section = isUser ? (raw.account || {}) : (raw.post || {});
    return {
        platform: 'facebook',
        surveyType: activeSurvey || (isUser ? 'facebook-user' : 'facebook-post'),
        injectionStatus: {
            userSurveyInjected: !!document.getElementById('surveyFormContainer'),
            postSurveysInjected: document.querySelectorAll('.survey-container-post').length
        },
        extractedData: { userID: crawlFacebookHandle(), profile: isUser ? extractFacebookProfile() : {} },
        selectorDiagnostics: Object.keys(section).map(probe)
    };
};

initializeSurveys();
