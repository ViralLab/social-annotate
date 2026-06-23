
// Context class is defined in shared.js
const availableContextsBluesky = [new Context('bluesky-user', injectBlueskyUserSurvey, checkUserURL),
new Context('bluesky-post', enablePostObserver, null)];

// Selectors loaded from storage (populated by initializeSurveys)
let SEL_BS = {};

// MutationObserver globals — initialized after selectors are loaded
let bskyRoot = null;
let obsConfigBS = {};
let observerBS = null;

// Cache of intercepted Bluesky video DIDs+CIDs from the MAIN world interceptor
// Map: cid -> { did, cid }
if (!window.__socialAnnotate__) window.__socialAnnotate__ = {};
if (!window.__socialAnnotate__.bskyInterceptedVideos) window.__socialAnnotate__.bskyInterceptedVideos = {};

// ── Manipulation state ────────────────────────────────────
let manipConfig_BS  = {};
let manipMap_BS     = {};
let manipMapId_BS   = '';
let manipApplied_BS     = {};
let _processedCount_BS     = 0;
const _inFlight_BS = new Set();

// ── User intervention state ───────────────────────────────
let manipConfig_BSU  = {};
let manipApplied_BSU = {};
registerHealthCounter(function () { return _processedCount_BS; });

document.addEventListener('mh:bsky-video-found', function(e) {
    if (e.detail && e.detail.cid && e.detail.did) {
        window.__socialAnnotate__.bskyInterceptedVideos[e.detail.cid] = e.detail;
    }
});

window.addEventListener('mh:download-request', function(e) {
    let detail = e.detail;
    if (!detail) return;
    
    let initialSurveyType = detail.surveyType || 'bluesky-post';

    if (initialSurveyType === 'bluesky-user') {
        let userID = detail.userID;
        chrome.storage.local.get(['isProfileDownloadEnabled', 'isBannerDownloadEnabled'], function(res) {
            if (res.isProfileDownloadEnabled) {
                let avatarEl = document.querySelector(SEL_BS.userAvatar || 'div[aria-label*="\'s avatar"] img');
                if (avatarEl && avatarEl.src) {
                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [avatarEl.src], userId: userID || 'user', postId: 'profile', surveyType: initialSurveyType });
                }
            }
            if (res.isBannerDownloadEnabled) {
                let bannerEl = document.querySelector(SEL_BS.userBanner || 'div[aria-label="View profile banner"] img');
                if (bannerEl && bannerEl.src) {
                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [bannerEl.src], userId: userID || 'user', postId: 'banner', surveyType: initialSurveyType });
                }
            }
        });
        return;
    }

    if (!detail.postID) return;
    
    let postID = detail.postID;
    let postOwner = detail.userID;
    let postSurveyType = detail.surveyType || 'bluesky-post';
    
    let containerName = 'surveyFormContainer-' + postID;
    let surveyContainer = document.getElementById(containerName);
    let injectNode = surveyContainer ? (surveyContainer.closest(SEL_BS.postContainer || '[data-testid*="feedItem"], [data-testid*="postThreadItem"]') || surveyContainer.parentNode) : null;
    
    let urlsToDownload = [];
    if (injectNode) {
        urlsToDownload = extractPostMedia(injectNode);
    }
    
    if (urlsToDownload && urlsToDownload.length > 0) {
        let validUrls = urlsToDownload.filter(u => !u.startsWith('[Blob Stream]') && !u.startsWith('[Video Thumbnail]'));
        let blobs = urlsToDownload.filter(u => u.startsWith('[Blob Stream]'));
        let thumbnails = urlsToDownload.filter(u => u.startsWith('[Video Thumbnail]'));

        if (validUrls.length > 0) {
            chrome.runtime.sendMessage({ action: 'downloadMedia', urls: validUrls, userId: postOwner || 'user', postId: postID, surveyType: postSurveyType });
        } else if (blobs.length > 0) {
            // Find only the video element(s) inside THIS specific post that were tagged by inject-api.js
            let taggedVideos = injectNode ? injectNode.querySelectorAll('video[data-bsky-cid]') : [];
            
            if (taggedVideos.length > 0) {
                let blobUrls = [];
                taggedVideos.forEach(v => {
                    let url = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(v.dataset.bskyDid)}&cid=${encodeURIComponent(v.dataset.bskyCid)}`;
                    if (!blobUrls.includes(url)) blobUrls.push(url);
                });
                chrome.runtime.sendMessage({ action: 'downloadMedia', urls: blobUrls, userId: postOwner || 'user', postId: postID, surveyType: postSurveyType });
            } else {
                console.warn("Video not yet loaded. Please scroll the video into view and let it start playing, then try again.");
            }
        } else if (thumbnails.length > 0) {
            console.log("No original media URLs found. Only thumbnails available.");
        } else {
            console.log("No supported media found.");
        }
    } else {
        console.log("No media found on this post.");
    }
});

function _bsToggleBtn(textEl, originalNodes, rewrittenText) {
    let isOriginal = false;
    let btn = document.createElement('button');
    btn.textContent = '👁 Show original';
    btn.setAttribute('data-sa-interv-toggle', '1');
    btn.style.cssText = [
        'display:block','margin-left:auto','margin-bottom:4px',
        'padding:2px 10px','font-size:11px','line-height:1.6',
        'cursor:pointer','border-radius:4px',
        'background:rgba(29,155,240,0.08)','color:rgb(29,155,240)',
        'border:1px solid rgba(29,155,240,0.25)',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
    ].join(';');
    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        isOriginal = !isOriginal;
        if (isOriginal) {
            textEl.textContent = '';
            originalNodes.forEach(function (n) { textEl.appendChild(n.cloneNode(true)); });
        } else {
            textEl.textContent = rewrittenText;
        }
        btn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
    });
    textEl.parentNode.insertBefore(btn, textEl);
}

function _bsGetTimestamp(postNode) {
    let tsEl = postNode.querySelector(SEL_BS.postTimestamp || 'time[datetime]');
    if (!tsEl) return null;
    return tsEl.getAttribute(SEL_BS.postTimestampAttr || 'datetime') || null;
}

async function processPostNode(postNode) {
    let insertElement = postNode.parentNode;
    if (!insertElement || insertElement.getElementsByClassName('survey-container-post').length > 0) return;

    let postDetails = extractPostDetails(postNode);
    if (!postDetails) return;
    if (_inFlight_BS.has(postDetails.postID)) return;

    _processedCount_BS++;

    // ── Live API intervention path ────────────────────────
    if (manipConfig_BS.enabled && manipConfig_BS.source === 'api' && manipConfig_BS.endpoint && window.__sa_intervApi) {
        _inFlight_BS.add(postDetails.postID);

        function _bsApplyResult(result, targetNode) {
            let textEl = targetNode.querySelector(SEL_BS.postText || '[data-testid="postText"]')
                         || targetNode.querySelector('[data-word-wrap="1"]');
            if (textEl) {
                let originalNodes = Array.from(textEl.childNodes).map(function (n) { return n.cloneNode(true); });
                textEl.textContent = result.rewritten_text;
                if (manipConfig_BS.mode === 'aware') _bsToggleBtn(textEl, originalNodes, result.rewritten_text);
            }
        }

        // If already cached (e.g. navigated from feed to detail page), apply synchronously
        let cached = window.__sa_intervApi.getCached(postDetails.postID);
        if (cached) {
            _bsApplyResult(cached, postNode);
            _inFlight_BS.delete(postDetails.postID);
            injectBlueskyPostSurvey(insertElement, postDetails.postID);
            availableContextsBluesky[1].renderSurvey(
                postDetails.postOwner, postDetails.postID,
                { body: () => cached.rewritten_text, media_urls: () => extractPostMedia(postNode), post_metrics: () => extractPostMetrics(postNode), created_at: () => _bsGetTimestamp(postNode) }
            );
            return;
        }

        let overlay = window.__sa_intervApi.createOverlay(postNode, manipConfig_BS.mode);

        let postData = {
            post_id:      postDetails.postID,
            account_id:   postDetails.postOwner,
            body:         extractPostTextContent(postNode),
            created_at:   _bsGetTimestamp(postNode),
            media_urls:   extractPostMedia(postNode),
            post_metrics: extractPostMetrics(postNode)
        };

        let doRetry = function () {
            _inFlight_BS.delete(postDetails.postID);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            processPostNode(postNode);
        };

        try {
            let result = await window.__sa_intervApi.queuePost(postData);

            let meta = { applied: true, label: result.prompt_label || '', map_id: result.map_id || window.__sa_intervApi.getMapId() };
            if (manipConfig_BS.logOriginal) meta.original_text = postData.body;
            let extras = {};
            for (let k in result) {
                if (!['post_id', 'rewritten_text', 'map_id', 'prompt_label'].includes(k)) extras[k] = result[k];
            }
            if (Object.keys(extras).length > 0) meta.extras = extras;
            manipApplied_BS[postDetails.postID] = meta;

            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            _inFlight_BS.delete(postDetails.postID);

            // Re-query after overlay removal — React may have re-rendered during the await
            let livePost_BS = document.querySelector(`a[href*="/post/${postDetails.postID}"]`)
                ?.closest(SEL_BS.postContainer || '[data-testid*="feedItem"], [data-testid*="postThreadItem"]') || postNode;
            _bsApplyResult(result, livePost_BS);

            injectBlueskyPostSurvey(insertElement, postDetails.postID);
            availableContextsBluesky[1].renderSurvey(
                postDetails.postOwner, postDetails.postID,
                { body: () => result.rewritten_text, media_urls: () => extractPostMedia(postNode), post_metrics: () => extractPostMetrics(postNode), created_at: () => _bsGetTimestamp(postNode) }
            );
        } catch (err) {
            overlay.showError(doRetry);
        }
        return;
    }
    // ─────────────────────────────────────────────────────

    // ── Static map manipulation path ─────────────────────
    if (manipConfig_BS.enabled && manipConfig_BS.source !== 'api' && manipMap_BS[postDetails.postID]) {
        let entry  = manipMap_BS[postDetails.postID];
        let textEl = postNode.querySelector(SEL_BS.postText || '[data-testid="postText"]')
                     || postNode.querySelector('[data-word-wrap="1"]');
        if (textEl) {
            let rewrittenText = entry.rewritten_text;
            let originalNodes = Array.from(textEl.childNodes).map(function (n) { return n.cloneNode(true); });
            textEl.textContent = rewrittenText;
            if (manipConfig_BS.mode === 'aware') _bsToggleBtn(textEl, originalNodes, rewrittenText);
            let meta = { applied: true, label: entry.prompt_label || '', map_id: manipMapId_BS };
            if (manipConfig_BS.logOriginal) meta.original_text = originalText;
            manipApplied_BS[postDetails.postID] = meta;
        }
        if (entry.replacement_image) {
            let avatarImg = postNode.querySelector(SEL_BS.postAuthorAvatar || 'img[src*="avatar"]');
            if (avatarImg) { avatarImg.src = entry.replacement_image; avatarImg.srcset = ''; }
        }
    }
    // ─────────────────────────────────────────────────────

    injectBlueskyPostSurvey(insertElement, postDetails.postID);
    availableContextsBluesky[1].renderSurvey(
        postDetails.postOwner,
        postDetails.postID,
        {
            body:         () => extractPostTextContent(postNode),
            media_urls:   () => extractPostMedia(postNode),
            post_metrics: () => extractPostMetrics(postNode),
            created_at:   () => _bsGetTimestamp(postNode)
        }
    );
}

function createObserver() {
    const observerCallback = function (mutationsList, obs) {
        for (let mutation of mutationsList) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // ELEMENT_NODE
                        // Bluesky posts are rendered as links with data-testid attributes
                        // or as divs containing post content
                        let posts = node.querySelectorAll(SEL_BS.postContainer || '[data-testid*="feedItem"], [data-testid*="postThreadItem"]');
                        posts.forEach(processPostNode);

                        // Also check if the node itself is a post
                        if (node.matches && node.matches(SEL_BS.postContainer || '[data-testid*="feedItem"], [data-testid*="postThreadItem"]')) {
                            processPostNode(node);
                        }

                    }
                });
            }
        }
    };
    return new MutationObserver(observerCallback);
}


function crawlUserName() {
    if (window.location.protocol === 'file:' || window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
        let handleEl = document.querySelector(SEL_BS.userHandle || 'div:has(> [data-testid="profileHeaderDisplayName"]) + div > div[dir="auto"]');
        if (handleEl) {
            let text = handleEl.textContent.trim().replace(/^@/, '');
            if (text) return text;
        }
        return 'local-test-user';
    }
    let currentURL = window.location.href;
    let match = currentURL.match(/bsky\.app\/profile\/([^/?#]+)/);
    if (match) return match[1];
    return '';
}

function extractUserProfile() {
    let profile = {};

    // Display name
    try {
        let nameEl = document.querySelector(SEL_BS.userDisplayName || '[data-testid="profileHeaderDisplayName"]');
        if (nameEl) {
            profile.profile_name = nameEl.textContent.trim();
        }
    } catch (e) { /* skip */ }

    // Handle
    try {
        let handleEl = document.querySelector(SEL_BS.userHandle || 'div:has(> [data-testid="profileHeaderDisplayName"]) + div > div[dir="auto"]');
        if (handleEl) {
            profile.handle = handleEl.textContent.trim();
        } else {
            profile.handle = crawlUserName();
        }
    } catch (e) { /* skip */ }

    // Profile picture URL
    try {
        let avatarEl = document.querySelector(SEL_BS.userAvatar || 'div[aria-label*="\'s avatar"] img');
        if (avatarEl) {
            profile.profile_img_url = avatarEl.src;
        }
    } catch (e) { /* skip */ }

    // Bio / description
    try {
        let bioEl = document.querySelector(SEL_BS.userBio || '[data-testid="profileHeaderDescription"]');
        if (bioEl) {
            profile.bio = bioEl.textContent.trim();
        }
    } catch (e) { /* skip */ }

    // Followers count
    try {
        let followersEl = document.querySelector(SEL_BS.userFollowers || '[data-testid="profileHeaderFollowersButton"]');
        if (followersEl) {
            let text = followersEl.textContent.trim();
            profile.followersText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/);
            if (numMatch) profile.followersCount = numMatch[1];
        }
    } catch (e) { /* skip */ }

    // Following count
    try {
        let followingEl = document.querySelector(SEL_BS.userFollowing || '[data-testid="profileHeaderFollowsButton"]');
        if (followingEl) {
            let text = followingEl.textContent.trim();
            profile.followingText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/);
            if (numMatch) profile.followingCount = numMatch[1];
        }
    } catch (e) { /* skip */ }

    // Posts count
    try {
        let postsEl = document.querySelector(SEL_BS.user_post_count || '[data-testid="profileHeaderFollowsButton"] + div[dir="auto"]');
        if (postsEl) {
            let text = postsEl.textContent.trim();
            profile.postsText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/);
            if (numMatch) profile.postsCount = numMatch[1];
        }
    } catch (e) { /* skip */ }

    return profile;
}


function injectBlueskyUserSurvey(injectElement, userID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-user";
    surveyContainer.setAttribute("id", "surveyFormContainer");
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/bluesky/inject.css");
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    // Inject the survey before the main app root.
    let appRoot = document.getElementById('root') || document.querySelector(SEL_BS.appRoot || '#root');
    if (appRoot) {
        appRoot.insertAdjacentElement('beforebegin', surveyContainer);
    } else if (document.body) {
        document.body.insertAdjacentElement('afterbegin', surveyContainer);
    }
}

// ── User intervention helpers ─────────────────────────────

function _bsuGetFieldEl(field) {
    switch (field) {
        case 'profile_name':
            return document.querySelector(SEL_BS.userDisplayName || '[data-testid="profileHeaderDisplayName"]');
        case 'handle':
            return document.querySelector(SEL_BS.userHandle || 'div:has(> [data-testid="profileHeaderDisplayName"]) + div > div[dir="auto"]');
        case 'followers_count': {
            let btn = document.querySelector(SEL_BS.userFollowers || '[data-testid="profileHeaderFollowersButton"]');
            if (!btn) return null;
            let children = btn.querySelectorAll('span, div');
            for (let s of children) {
                if (s.childElementCount === 0 && /^[\d,.KMBkmb]+$/.test(s.textContent.trim())) return s;
            }
            return btn;
        }
        case 'following_count': {
            let btn = document.querySelector(SEL_BS.userFollowing || '[data-testid="profileHeaderFollowsButton"]');
            if (!btn) return null;
            let children = btn.querySelectorAll('span, div');
            for (let s of children) {
                if (s.childElementCount === 0 && /^[\d,.KMBkmb]+$/.test(s.textContent.trim())) return s;
            }
            return btn;
        }
        case 'bio':
            return document.querySelector(SEL_BS.userBio || '[data-testid="profileHeaderDescription"]');
        case 'posts_count': {
            let el = SEL_BS.user_post_count ? document.querySelector(SEL_BS.user_post_count) : null;
            // Structural fallback: the posts div is a sibling of the follows button, but `+`/`~` selectors
            // can fail across React renders. Walk the follows button's parent and find the div whose text
            // matches the "N posts" pattern.
            if (!el) {
                let follows = document.querySelector('[data-testid="profileHeaderFollowsButton"]');
                if (follows && follows.parentElement) {
                    for (let c of follows.parentElement.querySelectorAll('div')) {
                        if (/^[\d,.][\d,.KMBkmb\s]*posts?$/i.test(c.textContent.trim())) { el = c; break; }
                    }
                }
            }
            if (!el) return null;
            // Numeric leaf span (in case the structure ever shifts to span-based)
            for (let s of el.querySelectorAll('span, div')) {
                if (s.childElementCount === 0 && /^[\d,.KMBkmb]+$/.test(s.textContent.trim())) return s;
            }
            // Idempotent wrap of the raw text node so mutation doesn't wipe the "posts" sibling span
            let wrapped = el.querySelector('span[data-sa-postcount]');
            if (wrapped) return wrapped;
            for (let node of Array.from(el.childNodes)) {
                if (node.nodeType === 3 && /\S/.test(node.textContent)) {
                    let wrap = document.createElement('span');
                    wrap.setAttribute('data-sa-postcount', '1');
                    wrap.textContent = node.textContent.replace(/\s+$/, '');
                    node.parentNode.replaceChild(wrap, node);
                    return wrap;
                }
            }
            return null;
        }
    }
    return null;
}

function _bsuToggleBtn(fieldEl, originalText, rewrittenText) {
    let isOriginal = false;
    let btn = document.createElement('button');
    btn.textContent = '👁 Show original';
    btn.setAttribute('data-sa-interv-toggle', '1');
    btn.style.cssText = [
        'display:inline-block','margin-left:6px','padding:1px 8px','font-size:11px',
        'line-height:1.6','cursor:pointer','border-radius:4px','vertical-align:middle',
        'background:rgba(29,155,240,0.08)','color:rgb(29,155,240)',
        'border:1px solid rgba(29,155,240,0.25)',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
    ].join(';');
    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        isOriginal = !isOriginal;
        fieldEl.textContent = isOriginal ? originalText : rewrittenText;
        btn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
    });
    // Insert after the enclosing button/link (for count fields) rather than inside it
    let container = fieldEl.closest('a') || fieldEl.closest('button');
    let insertAfter = container || fieldEl;
    insertAfter.parentNode.insertBefore(btn, insertAfter.nextSibling);
}

async function _applyBSUserIntervention(userID, profile) {
    if (!manipConfig_BSU.enabled || !manipConfig_BSU.endpoint) return;
    let fields = manipConfig_BSU.fields || {};
    let fieldsToIntervene = Object.keys(fields).filter(function(f) { return fields[f]; });
    if (fieldsToIntervene.length === 0) return;

    let removeOverlay = _createUserInterventionOverlay();

    let payload = {
        survey_type: 'bluesky-user',
        platform: 'bluesky',
        account_id: userID,
        profile_name: profile.profile_name || null,
        handle: profile.handle || null,
        followers_count: profile.followersCount || null,
        following_count: profile.followingCount || null,
        posts_count: profile.postsCount || null,
        bio: profile.bio || null,
        fields_to_intervene: fieldsToIntervene
    };

    let result;
    try {
        let response = await fetch(manipConfig_BSU.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) { removeOverlay(); return; }
        result = await response.json();
    } catch (e) { removeOverlay(); return; }

    let originalValues = {};
    // Snapshot the full profile right before the first DOM mutation
    let profileSnapshot = null;

    function applyFields() {
        let appliedAny = false;
        for (let field of fieldsToIntervene) {
            if (!result[field]) continue;
            let el = _bsuGetFieldEl(field);
            if (!el) continue;
            if (originalValues[field] === undefined) originalValues[field] = el.textContent;
            if (el.textContent === result[field]) { appliedAny = true; continue; }
            if (!profileSnapshot) {
                try { profileSnapshot = extractUserProfile(); } catch (e) {}
            }
            el.textContent = result[field];
            appliedAny = true;
            if (manipConfig_BSU.mode === 'aware') {
                let container = el.closest('a') || el.closest('button');
                let checkAfter = container || el;
                let next = checkAfter.nextSibling;
                let hasToggle = next && next.nodeType === 1 && next.getAttribute && next.getAttribute('data-sa-interv-toggle');
                if (!hasToggle) _bsuToggleBtn(el, originalValues[field], result[field]);
            }
        }
        if (appliedAny) removeOverlay();

        // Refresh manipApplied each pass — originals may have been captured
        // on a later retry once React rendered the profile elements.
        let appliedFields = {};
        for (let field of fieldsToIntervene) {
            if (result[field]) appliedFields[field] = { original: originalValues[field] || '', rewritten: result[field] };
        }
        manipApplied_BSU[userID] = { applied: true, fields: appliedFields, profileSnapshot: profileSnapshot };
    }

    applyFields();
    [200, 600, 1500].forEach(function(delay) { setTimeout(applyFields, delay); });
}

// ─────────────────────────────────────────────────────────

function enablePostObserver(injectElement) {
    // Process existing posts on the page
    document.querySelectorAll(SEL_BS.postContainer || '[data-testid*="feedItem"], [data-testid*="postThreadItem"]').forEach(processPostNode);
    if (bskyRoot && observerBS) {
        observerBS.observe(bskyRoot, obsConfigBS);
    }
    setTimeout(() => {
        document.querySelectorAll(SEL_BS.postContainer || '[data-testid*="feedItem"], [data-testid*="postThreadItem"]').forEach(processPostNode);
    }, 1500);
}

function extractPostMedia(postNode) {
    if (!postNode) return "";
    let mediaUrls = [];

    // Extract images
    let photos = postNode.querySelectorAll(SEL_BS.postImage || 'img[data-testid*="image"], img[src*="feed_thumbnail"], img[src*="cdn.bsky.app"]');
    photos.forEach(img => {
        if (img.src && !img.src.includes('avatar') && !img.src.includes('banner')) {
            mediaUrls.push(img.src);
        }
    });

    // Extract videos
    let videos = postNode.querySelectorAll(SEL_BS.postVideo || 'video');
    videos.forEach(video => {
        let src = null;
        let mp4Source = video.querySelector('source');
        if (mp4Source) src = mp4Source.getAttribute('src') || mp4Source.src;
        if (!src) src = video.getAttribute('src') || video.src || video.currentSrc;
        
        if (src && src.startsWith('blob:')) {
            mediaUrls.push("[Blob Stream] " + src);
        } else if (src && !src.startsWith('blob:')) {
            mediaUrls.push(src);
        } else if (video.poster) {
            mediaUrls.push("[Video Thumbnail] " + video.poster);
        }
    });

    return mediaUrls;
}

function extractPostTextContent(postNode) {
    let textParts = [];

    // Grab all post text blocks
    let textNodes = postNode.querySelectorAll(SEL_BS.postText || '[data-testid="postText"]');
    textNodes.forEach(node => {
        if (node.innerText) textParts.push(node.innerText.trim());
    });

    return textParts.join('\n\n');
}

function extractPostMetrics(postNode) {
    let metrics = {
        like_count: null,
        share_count: null,
        comment_count: null,
        bookmark_count: null,
        view_count: null,
        quote_count: null
    };

    if (!postNode) return metrics;

    const parseShortNumber = (str) => {
        if (!str) return 0;
        str = str.trim().replace(/,/g, '');
        if (str.match(/K/i)) return parseFloat(str) * 1000;
        if (str.match(/M/i)) return parseFloat(str) * 1000000;
        return parseInt(str, 10) || 0;
    };

    // Try extracting from aria-labels or specific data-testid elements
    const extractMetric = (selector) => {
        let el = postNode.querySelector(selector);
        if (el) {
            let aria = el.getAttribute('aria-label') || '';
            let match = aria.match(/^([\d,\.]+[kmKM]?)/i);
            if (match) return parseShortNumber(match[1]);
            let text = el.textContent.trim();
            return parseShortNumber(text);
        }
        return null;
    };

    metrics.comment_count = extractMetric(SEL_BS.metricsReply || '[data-testid="replyBtn"]');
    metrics.share_count = extractMetric(SEL_BS.metricsRepost || '[data-testid="repostBtn"]');
    metrics.like_count = extractMetric(SEL_BS.metricsLike || '[data-testid="likeBtn"], [data-testid="unlikeBtn"]');
    if (SEL_BS.metricsQuote) metrics.quote_count = extractMetric(SEL_BS.metricsQuote);

    return metrics;
}

function extractPostDetails(postNode) {
    // Tier 1: explicit timestamp/post anchor
    let postLink = postNode.querySelector(SEL_BS.postTimestamp || 'a[href*="/post/"]');
    if (postLink && postLink.href) {
        let match = postLink.href.match(/\/profile\/([^/]+)\/post\/([^/?#]+)/);
        if (match) return { postOwner: match[1], postID: match[2] };
    }

    // Tier 2: anchor-scan — any link matching /profile/.../post/...
    let anchors = postNode.querySelectorAll('a[href]');
    for (let a of anchors) {
        let match = (a.href || '').match(/\/profile\/([^/]+)\/post\/([^/?#]+)/);
        if (match) return { postOwner: match[1], postID: match[2] };
    }

    return null;
}

function injectBlueskyPostSurvey(injectNode, postID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-post";
    let containerName = "surveyFormContainer-" + postID;
    surveyContainer.setAttribute("id", containerName);
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/bluesky/inject.css");
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    injectNode.insertAdjacentElement('afterbegin', surveyContainer);
}

function checkUserURL() {
    if (window.location.protocol === 'file:') return true;
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') return true;
    let currentURL = window.location.href;
    let match = currentURL.match(/bsky\.app\/profile\/([^/?#]+)\/?$/);
    return !!match;
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'isGuided', 'selectors', 'manipulationMaps'], function (result) {

        // Load selectors into the module-level variable
        const _rawBS = (result.selectors && result.selectors.bluesky) ? result.selectors.bluesky : {};
        SEL_BS = { ...(_rawBS.shared || {}), ...(_rawBS.account || {}), ...(_rawBS.post || {}) };
        watchPostCounter('bluesky', function () { return _processedCount_BS; });

        // Load manipulation config for bluesky-user
        const _userConfBS = result.config && result.config.surveys && result.config.surveys['bluesky-user'];
        manipConfig_BSU = (_userConfBS && _userConfBS.manipulation) || {};

        // Load manipulation map for bluesky-post
        const _postConfBS = result.config && result.config.surveys && result.config.surveys['bluesky-post'];
        manipConfig_BS = (_postConfBS && _postConfBS.manipulation) || {};
        if (manipConfig_BS.enabled) {
            if (manipConfig_BS.source !== 'api' && result.manipulationMaps && result.manipulationMaps['bluesky-post']) {
                let fullMap = result.manipulationMaps['bluesky-post'];
                manipMapId_BS = (fullMap._meta && fullMap._meta.map_id) || '';
                for (let k in fullMap) { if (k !== '_meta') manipMap_BS[k] = fullMap[k]; }
            } else if (manipConfig_BS.source === 'api' && manipConfig_BS.endpoint && window.__sa_intervApi) {
                window.__sa_intervApi.init({ endpoint: manipConfig_BS.endpoint, survey_type: 'bluesky-post', platform: 'bluesky', mode: manipConfig_BS.mode, logOriginal: manipConfig_BS.logOriginal });
            }
        }

        // Initialize observer infrastructure now that selectors are available
        bskyRoot = document.getElementById('root') || document.querySelector(SEL_BS.appRoot || '#root') || document.body;
        obsConfigBS = SEL_BS.observerFilter || { attributes: false, childList: true, subtree: true };
        observerBS = createObserver();

        // Auto-Start Guided Mode
        let isBasePlatform = window.location.pathname === '/' || window.location.pathname === '';
        if (result.isEnabled && result.isGuided && result.activeTargetList && result.activeTargetList.length > 0 && isBasePlatform) {
            let firstTarget = result.activeTargetList[0];
            let platformURL = "https://bsky.app/";
            let activeSurvey = result.config.activeSurveys && result.config.activeSurveys.length > 0 ? result.config.activeSurveys[0] : null;

            if (activeSurvey === 'bluesky-post') {
                // Post URLs: /profile/OWNER/post/POST_ID — but in guided mode we only have the post URI/ID
                // For now, navigate to the post by AT URI or rkey
                window.location.href = platformURL + 'profile/' + firstTarget;
                return;
            } else if (activeSurvey === 'bluesky-user') {
                window.location.href = platformURL + 'profile/' + firstTarget;
                return;
            }
        }

        const currentPlatform = 'bluesky';
        for (let index = 0; index < availableContextsBluesky.length; ++index) {
            let currentContext = availableContextsBluesky[index];
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

                        // Attach intervention metadata
                        let _ma = manipApplied_BS[values.post_id];
                        let _maU = manipApplied_BSU[values.account_id];
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
                            values.intervention_fields  = _maU.fields;
                            if (_maU.profileSnapshot) values.user_profile = _maU.profileSnapshot;
                        } else {
                            values.intervention_applied = false;
                        }

                        storeResults(values, currentPlatform);

                        let isUserSurvey = currentContext.name.endsWith('-user');
                        if (isUserSurvey) {
                            chrome.storage.local.get(['isProfileDownloadEnabled', 'isBannerDownloadEnabled'], function(res) {
                                if (res.isProfileDownloadEnabled || res.isBannerDownloadEnabled) {
                                    let evt = new CustomEvent('mh:download-request', { detail: { userID: values.account_id, surveyType: currentContext.name } });
                                    window.dispatchEvent(evt);
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
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.theme = config.theme || "light";
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);

                if (currentContext.name === 'bluesky-user') {
                    _processedCount_BS++;
                    let surveyID = crawlUserName();
                    currentContext.renderSurvey(surveyID, null, {
                        user_profile: () => extractUserProfile()
                    });
                    if (manipConfig_BSU.enabled) {
                        let profile = extractUserProfile();
                        _applyBSUserIntervention(surveyID, profile);
                    }
                }
            }
        }
    });
}

// Fire the survey initializer on script load
window.__socialAnnotate__.platformDebugCapture = function(selectors, stored) {
    let raw = selectors.bluesky || {};
    let SEL_D = Object.assign({}, raw.shared || {}, raw.account || {}, raw.post || {});
    let activeSurvey = stored && stored.config && stored.config.activeSurveys && stored.config.activeSurveys[0];

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

    let isUser = activeSurvey ? activeSurvey.endsWith('-user') : checkUserURL();
    let section = isUser ? (raw.account || {}) : (raw.post || {});
    return {
        platform: 'bluesky',
        surveyType: activeSurvey || (isUser ? 'bluesky-user' : 'bluesky-post'),
        injectionStatus: {
            userSurveyInjected: !!document.getElementById('surveyFormContainer'),
            postSurveysInjected: document.querySelectorAll('.survey-container-post').length
        },
        extractedData: { userID: crawlUserName(), profile: isUser ? extractUserProfile() : {} },
        selectorDiagnostics: Object.keys(section).filter(f => !['postVideo','postImage','userBanner'].includes(f)).map(probe)
    };
};

initializeSurveys();
