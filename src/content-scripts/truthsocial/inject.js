const availableContextsTruthSocial = [
    new Context('truthsocial-post', enablePostObserver, null),
    new Context('truthsocial-user', injectTruthSocialUserSurvey, checkUserURL)
];

let SEL_TS = {};
let tsRoot = null;
let obsConfigTS = {};
let observerTS = null;

// ── Manipulation state ────────────────────────────────────
let manipConfig_TS  = {};
let manipMap_TS     = {};
let manipMapId_TS   = '';
let manipApplied_TS     = {};
let _processedCount_TS     = 0;
const _inFlight_TS = new Set();

// ── User intervention state ───────────────────────────────
let manipConfig_TSU  = {};
let manipApplied_TSU = {};
registerHealthCounter(function () { return _processedCount_TS; });

// ---------------------------------------------------------------------------
// TruthSocial Mastodon API cache
// TruthSocial runs on Mastodon. Public statuses are readable without auth via
// GET https://truthsocial.com/api/v1/statuses/{id}
// We fire a fetch as soon as the post ID is known, so results are ready well
// before the user submits the survey form.
// ---------------------------------------------------------------------------
const _tsApiCache = {};

async function fetchTruthSocialPostData(postID) {
    if (_tsApiCache[postID]) return _tsApiCache[postID];
    try {
        // credentials:'include' sends the user's session cookies — required even for public posts
        const resp = await fetch(`https://truthsocial.com/api/v1/statuses/${postID}`, { credentials: 'include' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        _tsApiCache[postID] = data;
        return data;
    } catch (e) {
        console.warn('[SocialAnnotate] TS API fetch failed for', postID, e.message);
        return null;
    }
}

function _tsStripHtml(html) {
    if (!html) return '';
    const d = document.createElement('div');
    d.innerHTML = html;
    return (d.textContent || d.innerText || '').trim();
}

function _tsMediaUrlsFromApi(data) {
    if (!data || !data.media_attachments) return [];
    return data.media_attachments
        .map(att => att.url || att.preview_url)
        .filter(Boolean);
}

function _tsMetricsFromApi(data) {
    let metrics = { like_count: null, share_count: null, comment_count: null, bookmark_count: null, view_count: null, quote_count: null };
    if (!data) return metrics;
    if (data.favourites_count != null) metrics.like_count = data.favourites_count;
    if (data.reblogs_count != null) metrics.share_count = data.reblogs_count;
    if (data.replies_count != null) metrics.comment_count = data.replies_count;
    return metrics;
}

function _tsToggleBtn(textEl, originalNodes, rewrittenText) {
    if (manipConfig_TS.mode !== 'aware') return;
    let isOriginal = false;
    let toggleBtn = document.createElement('button');
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
            originalNodes.forEach(function (n) { textEl.appendChild(n.cloneNode(true)); });
        } else {
            textEl.textContent = rewrittenText;
        }
        toggleBtn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
    });
    textEl.parentNode.insertBefore(toggleBtn, textEl);
}

window.addEventListener('mh:download-request', async function(e) {
    let detail = e.detail;
    if (!detail) return;

    let initialSurveyType = detail.surveyType || 'truthsocial-post';
    if (initialSurveyType === 'truthsocial-user') return;

    if (!detail.postID) return;

    let postID = detail.postID;
    let postOwner = detail.userID;
    let postSurveyType = detail.surveyType || 'truthsocial-post';

    let containerName = 'surveyFormContainer-' + postID;
    let surveyContainer = document.getElementById(containerName);
    let injectNode = surveyContainer ? (surveyContainer.closest(SEL_TS.postContainer || '[data-testid="status"]') || surveyContainer.parentNode) : null;

    // If API data isn't cached yet (fire-and-forget from processPostNode may have
    // failed or not completed), retry now before falling through to DOM scraping
    if (!_tsApiCache[postID]) {
        await fetchTruthSocialPostData(postID);
    }

    // Prefer API media URLs — direct CDN URLs, immune to DOM changes
    const apiData = _tsApiCache[postID];
    let urlsToDownload = _tsMediaUrlsFromApi(apiData);
    console.log('[SocialAnnotate] TS download: API urls:', urlsToDownload.length, '| injectNode:', !!injectNode);

    // Fall back to DOM scraping if API data isn't available
    if (urlsToDownload.length === 0 && injectNode) {
        urlsToDownload = extractPostMedia(injectNode);
        console.log('[SocialAnnotate] TS download: DOM fallback urls:', urlsToDownload.length);
    }

    if (urlsToDownload && urlsToDownload.length > 0) {
        chrome.runtime.sendMessage({ action: 'downloadMedia', urls: urlsToDownload, userId: postOwner || 'user', postId: postID, surveyType: postSurveyType });
    } else {
        console.log('[SocialAnnotate] TS: No media found for postID:', postID);
    }
});

async function processPostNode(postNode) {
    _processedCount_TS++;
    let insertElement = postNode;
    if (!insertElement || insertElement.getElementsByClassName('survey-container-post').length > 0) return;

    let postDetails = extractPostDetails(postNode);
    if (!postDetails || !postDetails.postID) return;
    if (_inFlight_TS.has(postDetails.postID)) return;

    // Kick off API fetch early — data will be ready before form submit
    fetchTruthSocialPostData(postDetails.postID);

    // ── Live API path ────────────────────────────────────────
    if (manipConfig_TS.enabled && manipConfig_TS.source === 'api' && manipConfig_TS.endpoint && window.__sa_intervApi) {
        _inFlight_TS.add(postDetails.postID);

        function _tsApplyResult(result, targetNode) {
            let textEl = targetNode.querySelector(SEL_TS.postText || '[data-testid="status-content"] [data-testid="markup"]');
            if (textEl && result.rewritten_text) {
                let originalNodes = Array.from(textEl.childNodes).map(function (n) { return n.cloneNode(true); });
                textEl.textContent = result.rewritten_text;
                _tsToggleBtn(textEl, originalNodes, result.rewritten_text);
            }
        }

        // If already cached (e.g. navigated from feed to post detail), apply synchronously
        let cached = window.__sa_intervApi.getCached(postDetails.postID);
        if (cached) {
            _tsApplyResult(cached, postNode);
            _inFlight_TS.delete(postDetails.postID);
            injectTruthSocialPostSurvey(insertElement, postDetails.postID);
            availableContextsTruthSocial[0].renderSurvey(postDetails.postOwner, postDetails.postID, {
                body: () => cached.rewritten_text,
                media_urls: () => extractPostMedia(postNode),
                post_metrics: () => extractPostMetrics(postNode),
                created_at: () => { let t = postNode.querySelector(SEL_TS.postTimestamp || 'a[href*="/posts/"] time') || postNode.querySelector('time[datetime]'); return t ? t.getAttribute('datetime') : null; }
            });
            return;
        }

        let overlay = window.__sa_intervApi.createOverlay(postNode, manipConfig_TS.mode);
        let doRetry = function () { _inFlight_TS.delete(postDetails.postID); overlay.remove(); processPostNode(postNode); };
        try {
            let apiData = _tsApiCache[postDetails.postID];
            let body = apiData && apiData.content ? _tsStripHtml(apiData.content) : extractPostTextContent(postNode);
            let media_urls = apiData ? _tsMediaUrlsFromApi(apiData) : extractPostMedia(postNode);
            let post_metrics = apiData ? _tsMetricsFromApi(apiData) : extractPostMetrics(postNode);
            let tsTime = postNode.querySelector(SEL_TS.postTimestamp || 'a[href*="/posts/"] time') || postNode.querySelector('time[datetime]');
            let created_at = (apiData && apiData.created_at) ? apiData.created_at : (tsTime ? (tsTime.getAttribute(SEL_TS.postTimestampAttr || 'datetime') || null) : null);
            let postData = { post_id: postDetails.postID, account_id: postDetails.postOwner, body, created_at, media_urls, post_metrics };

            let result = await window.__sa_intervApi.queuePost(postData);

            let meta = { applied: true, label: result.prompt_label || '', map_id: result.map_id || window.__sa_intervApi.getMapId() };
            if (manipConfig_TS.logOriginal) meta.original_text = body;
            if (result.extras) meta.extras = result.extras;
            manipApplied_TS[postDetails.postID] = meta;

            overlay.parentNode && overlay.parentNode.removeChild(overlay);
            _inFlight_TS.delete(postDetails.postID);

            // Re-query after overlay removal — framework may have re-rendered during the await
            _tsApplyResult(result, postNode);

            injectTruthSocialPostSurvey(insertElement, postDetails.postID);
            availableContextsTruthSocial[0].renderSurvey(postDetails.postOwner, postDetails.postID, {
                body: () => result.rewritten_text || body,
                media_urls: () => media_urls,
                post_metrics: () => post_metrics,
                created_at: () => created_at
            });
        } catch (err) {
            overlay.showError(doRetry);
        }
        return;
    }

    // ── Map path ─────────────────────────────────────────────
    if (manipConfig_TS.enabled && manipConfig_TS.source !== 'api' && manipMap_TS[postDetails.postID]) {
        let entry  = manipMap_TS[postDetails.postID];
        let textEl = postNode.querySelector(SEL_TS.postText || '[data-testid="status-content"] [data-testid="markup"]');
        if (textEl) {
            let originalNodes = Array.from(textEl.childNodes).map(function (n) { return n.cloneNode(true); });
            textEl.textContent = entry.rewritten_text;
            _tsToggleBtn(textEl, originalNodes, entry.rewritten_text);
            let meta = { applied: true, label: entry.prompt_label || '', map_id: manipMapId_TS };
            if (manipConfig_TS.logOriginal) meta.original_text = entry.original_text || '';
            manipApplied_TS[postDetails.postID] = meta;
        }
        if (entry.replacement_image) {
            let avatarImg = postNode.querySelector(SEL_TS.postAuthorAvatar || '.status__avatar img, img[src*="avatar"]');
            if (avatarImg) { avatarImg.src = entry.replacement_image; avatarImg.srcset = ''; }
        }
    }

    // ── Normal path (also reached after map manipulation) ────
    injectTruthSocialPostSurvey(insertElement, postDetails.postID);
    availableContextsTruthSocial[0].renderSurvey(postDetails.postOwner, postDetails.postID, {
        body: () => {
            const api = _tsApiCache[postDetails.postID];
            if (api && api.content) return _tsStripHtml(api.content);
            return extractPostTextContent(postNode);
        },
        media_urls: () => {
            const api = _tsApiCache[postDetails.postID];
            const apiUrls = _tsMediaUrlsFromApi(api);
            if (apiUrls.length > 0) return apiUrls;
            return extractPostMedia(postNode);
        },
        post_metrics: () => {
            const api = _tsApiCache[postDetails.postID];
            if (api) return _tsMetricsFromApi(api);
            return extractPostMetrics(postNode);
        },
        created_at: () => {
            const api = _tsApiCache[postDetails.postID];
            if (api && api.created_at) return api.created_at;
            let t = postNode.querySelector(SEL_TS.postTimestamp || 'a[href*="/posts/"] time') || postNode.querySelector('time[datetime]');
            if (!t) return null;
            return t.getAttribute(SEL_TS.postTimestampAttr || 'datetime') || null;
        }
    });
}

// On the thread/detail page the focal post uses a "detailed status" component that is
// NOT wrapped in [data-testid="status"]. Find it by locating a [data-testid="status-content"]
// that has no [data-testid="status"] ancestor — that's always the focal/expanded post.
function applyManipToFocalPost() {
    // API mode handles posts via processPostNode; focal post manipulation only applies to map source
    if (!manipConfig_TS.enabled || manipConfig_TS.source === 'api') return;
    let m = window.location.pathname.match(/\/@[^/]+\/posts\/([^/?#]+)/);
    if (!m) return;
    let focalId = m[1];
    if (!manipMap_TS[focalId] || manipApplied_TS[focalId]) return;

    // Strategy 1: id="status-FOCALID" (feed-style render on detail page)
    let textEl = null;
    let byId = document.getElementById('status-' + focalId);
    if (byId) {
        textEl = byId.querySelector(SEL_TS.postText || '[data-testid="status-content"] [data-testid="markup"]')
                 || byId.querySelector('[data-testid="markup"]');
    }

    // Strategy 2: first [data-testid="status-content"] NOT inside [data-testid="status"]
    if (!textEl) {
        let allContents = document.querySelectorAll(SEL_TS.postTextContainer || '[data-testid="status-content"]');
        for (let el of allContents) {
            if (!el.closest(SEL_TS.postContainer || '[data-testid="status"]')) {
                textEl = el.querySelector('[data-testid="markup"]') || el;
                break;
            }
        }
    }

    if (!textEl) return;

    let entry = manipMap_TS[focalId];
    let originalNodes = Array.from(textEl.childNodes).map(function (n) { return n.cloneNode(true); });
    textEl.textContent = entry.rewritten_text;
    _tsToggleBtn(textEl, originalNodes, entry.rewritten_text);

    let meta = { applied: true, label: entry.prompt_label || '', map_id: manipMapId_TS };
    if (manipConfig_TS.logOriginal) meta.original_text = entry.original_text || '';
    manipApplied_TS[focalId] = meta;
}

function createObserver() {
    const observerCallback = function (mutationsList, obs) {
        for (let mutation of mutationsList) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        let posts = node.querySelectorAll(SEL_TS.postContainer || '[data-testid="status"]');
                        posts.forEach(processPostNode);

                        if (node.matches && node.matches(SEL_TS.postContainer || '[data-testid="status"]')) {
                            processPostNode(node);
                        }

                        // Focal post on detail page (different component, found by id)
                        applyManipToFocalPost();
                    }
                });
            }
        }
    };
    return new MutationObserver(observerCallback);
}

function enablePostObserver(injectElement) {
    document.querySelectorAll(SEL_TS.postContainer || '[data-testid="status"]').forEach(processPostNode);
    applyManipToFocalPost();
    if (tsRoot && observerTS) {
        observerTS.observe(tsRoot, obsConfigTS);
    }
    setTimeout(() => {
        document.querySelectorAll(SEL_TS.postContainer || '[data-testid="status"]').forEach(processPostNode);
        applyManipToFocalPost();
    }, 1500);
}

function extractPostMedia(postNode) {
    if (!postNode) return [];
    let mediaUrls = [];

    // Primary: anchor href on media gallery thumbnails — always present, even when
    // the <img> src is lazy-not-yet-loaded. The href points to the original CDN file.
    postNode.querySelectorAll('a[href*="media_attachments"], a[id*="media-gallery"]').forEach(a => {
        let href = a.getAttribute('href') || '';
        if (href && href.startsWith('http') && !href.includes('avatar')) {
            mediaUrls.push(href);
        }
    });

    // Fallback: img src (will be populated when the image has entered the viewport)
    let photos = postNode.querySelectorAll(SEL_TS.postImage || 'img');
    photos.forEach(img => {
        if (img.src && !img.src.includes('avatar') && !img.src.includes('icon') && !img.src.includes('missing.png')) {
            mediaUrls.push(img.src);
        }
    });

    let videos = postNode.querySelectorAll(SEL_TS.postVideo || 'video');
    videos.forEach(video => {
        let src = null;
        let mp4Source = video.querySelector('source');
        if (mp4Source) src = mp4Source.getAttribute('src') || mp4Source.src;
        if (!src) src = video.getAttribute('src') || video.src || video.currentSrc;
        if (src) mediaUrls.push(src);
    });

    return [...new Set(mediaUrls)];
}

function extractPostTextContent(postNode) {
    let textParts = [];
    let textNodes = postNode.querySelectorAll(SEL_TS.postText || '[data-testid="status-content"] [data-testid="markup"]');
    textNodes.forEach(node => {
        if (node.innerText) textParts.push(node.innerText.trim());
    });
    return textParts.join('\n\n');
}

function extractPostMetrics(postNode) {
    let metrics = { like_count: null, share_count: null, comment_count: null, bookmark_count: null, view_count: null, quote_count: null };

    const parseShortNumber = (str) => {
        if (!str) return 0;
        str = str.trim().replace(/,/g, '');
        if (str.match(/k/i)) return Math.round(parseFloat(str) * 1000);
        if (str.match(/m/i)) return Math.round(parseFloat(str) * 1000000);
        return parseInt(str, 10) || 0;
    };

    let replyBtn = postNode.querySelector(SEL_TS.metricsReply || 'button[aria-label="Reply"], button[aria-label="Replies"]');
    if (replyBtn && replyBtn.innerText) metrics.comment_count = parseShortNumber(replyBtn.innerText);

    let retruthBtn = postNode.querySelector(SEL_TS.metricsRepost || 'button[aria-label="ReTruth"], button[aria-label="ReTruths"]');
    if (retruthBtn && retruthBtn.innerText) metrics.share_count = parseShortNumber(retruthBtn.innerText);

    let likeBtn = postNode.querySelector(SEL_TS.metricsLike || 'button[aria-label="Like"], button[aria-label="Likes"]');
    if (likeBtn && likeBtn.innerText) metrics.like_count = parseShortNumber(likeBtn.innerText);

    if (SEL_TS.metricsQuote) {
        let quoteBtn = postNode.querySelector(SEL_TS.metricsQuote);
        if (quoteBtn && quoteBtn.innerText) metrics.quote_count = parseShortNumber(quoteBtn.innerText);
    }

    return metrics;
}

function extractPostDetails(postNode) {
    let postLink = postNode.querySelector(SEL_TS.postTimestamp || 'a[href*="/posts/"] time');
    if (!postLink) {
        postLink = postNode.querySelector('a[href*="/posts/"]');
    }

    let href = "";
    if (postLink && postLink.href) {
        href = postLink.href;
    } else if (postLink && postLink.closest('a')) {
        href = postLink.closest('a').href;
    }

    let postID = "";
    let postOwner = "";
    if (href) {
        let match = href.match(/\/@([^/]+)\/posts\/([^/?#]+)/);
        if (match) {
            postOwner = match[1];
            postID = match[2];
        }
    }

    // Tier 2: anchor-scan if specific selectors produced nothing
    if (!postID) {
        let anchors = postNode.querySelectorAll('a[href]');
        for (let a of anchors) {
            let match = (a.href || '').match(/\/@([^/]+)\/posts\/([^/?#]+)/);
            if (match) { postOwner = match[1]; postID = match[2]; break; }
        }
    }

    if (!postID && postNode.id && postNode.id.startsWith("status-")) {
        postID = postNode.id.replace("status-", "");
    }
    
    if (!postOwner) {
        let ownerEl = postNode.querySelector(SEL_TS.userHandle || '[data-testid="account"] a[href^="/@"]');
        if (ownerEl && ownerEl.href) {
            let ownerMatch = ownerEl.href.match(/\/@([^/?#]+)/);
            if (ownerMatch) postOwner = ownerMatch[1];
        }
    }

    if (!postID) return null;

    return {
        postOwner: postOwner,
        postID: postID
    };
}

function crawlUserName() {
    let currentURL = window.location.href;
    if (window.location.protocol === 'file:') {
        let handle = document.querySelector(SEL_TS.userHandle || 'main p.text-muted-foreground[style="direction: ltr;"]');
        if (handle) {
            let text = handle.textContent.trim().replace(/^@/, '');
            if (text) return text;
        }
        return 'local-test-user';
    }
    let match = currentURL.match(/\/@([^/?#]+)/);
    if (match) return match[1];
    return '';
}

function extractUserProfile() {
    let profile = {};

    try {
        let nameEl = document.querySelector(SEL_TS.userDisplayName || 'h1.text-xl, div.px-4 p.text-lg');
        if (nameEl) profile.profile_name = nameEl.textContent.trim();
    } catch (e) {}

    try {
        let handleEl = document.querySelector(SEL_TS.userHandle || 'main p.text-muted-foreground[style="direction: ltr;"]');
        if (handleEl) profile.handle = handleEl.textContent.trim();
    } catch (e) {}

    try {
        let avatarEl = document.querySelector(SEL_TS.userAvatar || 'img[src*="accounts/avatars"]');
        if (avatarEl) profile.profile_img_url = avatarEl.src;
    } catch (e) {}

    try {
        let bannerEl = document.querySelector(SEL_TS.userBanner || 'img[src*="accounts/headers"]');
        if (bannerEl) profile.bannerUrl = bannerEl.src;
    } catch (e) {}

    try {
        let bioEl = document.querySelector(SEL_TS.userBio || 'div.mt-6.space-y-3 > p[data-markup="true"]');
        if (bioEl) profile.bio = bioEl.textContent.trim();
    } catch (e) {}

    try {
        let followersEl = document.querySelector(SEL_TS.userFollowers || '[data-testid="followers-button"]');
        if (followersEl) {
            let text = followersEl.textContent.trim();
            profile.followersText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/i);
            if (numMatch) profile.followersCount = numMatch[1];
        }
    } catch (e) {}

    try {
        let followingEl = document.querySelector(SEL_TS.userFollowing || '[data-testid="following-button"]');
        if (followingEl) {
            let text = followingEl.textContent.trim();
            profile.followingText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/i);
            if (numMatch) profile.followingCount = numMatch[1];
        }
    } catch (e) {}

    try {
        let postsEl = SEL_TS.user_post_count ? document.querySelector(SEL_TS.user_post_count) : null;
        if (postsEl) {
            let text = postsEl.textContent.trim();
            profile.postsText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/i);
            if (numMatch) profile.postsCount = numMatch[1];
        }
    } catch (e) {}

    try {
        let urlEl = document.querySelector(SEL_TS.userUrl || '.max-w-\\[300px\\] a');
        if (urlEl) profile.websiteUrl = urlEl.href;
    } catch(e) {}

    try {
        let joinEl = document.querySelector(SEL_TS.userJoinDate || '[data-testid="icon"]:has(path[d*="M4 11h16"]) + p');
        if (joinEl) profile.created_at = joinEl.textContent.trim();
    } catch (e) {}

    return profile;
}

// ── User intervention helpers ─────────────────────────────

function _tsuGetFieldEl(field) {
    switch (field) {
        case 'profile_name':
            return document.querySelector(SEL_TS.userDisplayName || 'h1.text-xl, div.px-4 p.text-lg');
        case 'handle':
            return document.querySelector(SEL_TS.userHandle || 'main p.text-muted-foreground[style="direction: ltr;"]');
        case 'followers_count': {
            let btn = document.querySelector(SEL_TS.userFollowers || '[data-testid="followers-button"]');
            if (!btn) return null;
            let children = btn.querySelectorAll('span, div, p');
            for (let s of children) {
                if (s.childElementCount === 0 && /^[\d,.KMBkmb]+$/.test(s.textContent.trim())) return s;
            }
            return btn;
        }
        case 'following_count': {
            let btn = document.querySelector(SEL_TS.userFollowing || '[data-testid="following-button"]');
            if (!btn) return null;
            let children = btn.querySelectorAll('span, div, p');
            for (let s of children) {
                if (s.childElementCount === 0 && /^[\d,.KMBkmb]+$/.test(s.textContent.trim())) return s;
            }
            return btn;
        }
        case 'bio':
            return document.querySelector(SEL_TS.userBio || 'div.mt-6.space-y-3 > p[data-markup="true"]');
        case 'posts_count': {
            if (!SEL_TS.user_post_count) return null;
            let btn = document.querySelector(SEL_TS.user_post_count);
            if (!btn) return null;
            let children = btn.querySelectorAll('span, div, p');
            for (let s of children) {
                if (s.childElementCount === 0 && /^[\d,.KMBkmb]+$/.test(s.textContent.trim())) return s;
            }
            return btn;
        }
    }
    return null;
}

function _tsuToggleBtn(fieldEl, originalText, rewrittenText) {
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
    let container = fieldEl.closest('a') || fieldEl.closest('button');
    let insertAfter = container || fieldEl;
    insertAfter.parentNode.insertBefore(btn, insertAfter.nextSibling);
}

async function _applyTSUserIntervention(userID, profile) {
    if (!manipConfig_TSU.enabled || !manipConfig_TSU.endpoint) return;
    let fields = manipConfig_TSU.fields || {};
    let fieldsToIntervene = Object.keys(fields).filter(function(f) { return fields[f]; });
    if (fieldsToIntervene.length === 0) return;

    let removeOverlay = _createUserInterventionOverlay();

    let payload = {
        survey_type: 'truthsocial-user',
        platform: 'truthsocial',
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
        let response = await fetch(manipConfig_TSU.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) { removeOverlay(); return; }
        result = await response.json();
    } catch (e) { removeOverlay(); return; }

    let originalValues = {};
    let profileSnapshot = null;

    function applyFields() {
        let appliedAny = false;
        for (let field of fieldsToIntervene) {
            if (!result[field]) continue;
            let el = _tsuGetFieldEl(field);
            if (!el) continue;
            if (originalValues[field] === undefined) originalValues[field] = el.textContent;
            if (el.textContent === result[field]) { appliedAny = true; continue; }
            if (!profileSnapshot) {
                try { profileSnapshot = extractUserProfile(); } catch (e) {}
            }
            el.textContent = result[field];
            appliedAny = true;
            if (manipConfig_TSU.mode === 'aware') {
                let container = el.closest('a') || el.closest('button');
                let checkAfter = container || el;
                let next = checkAfter.nextSibling;
                let hasToggle = next && next.nodeType === 1 && next.getAttribute && next.getAttribute('data-sa-interv-toggle');
                if (!hasToggle) _tsuToggleBtn(el, originalValues[field], result[field]);
            }
        }
        if (appliedAny) removeOverlay();

        // Refresh manipApplied each pass — originals may have been captured
        // on a later retry once React rendered the profile elements.
        let appliedFields = {};
        for (let field of fieldsToIntervene) {
            if (result[field]) appliedFields[field] = { original: originalValues[field] || '', rewritten: result[field] };
        }
        manipApplied_TSU[userID] = { applied: true, fields: appliedFields, profileSnapshot: profileSnapshot };
    }

    applyFields();
    [200, 600, 1500].forEach(function(delay) { setTimeout(applyFields, delay); });
}

// ─────────────────────────────────────────────────────────

function injectTruthSocialUserSurvey(injectElement, userID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-user";
    surveyContainer.setAttribute("id", "surveyFormContainer");
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/truthsocial/inject.css");
    shadowRoot.innerHTML = `\\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\\
`;

    let fixedBar = document.querySelector(SEL_TS.appRoot || '#root');
    if (fixedBar) {
        fixedBar.insertAdjacentElement('beforebegin', surveyContainer);
    }
}

function checkUserURL() {
    if (window.location.protocol === 'file:') return true;
    let uname = crawlUserName();
    return uname !== '' && !window.location.pathname.startsWith('/posts/');
}

function injectTruthSocialPostSurvey(injectNode, postID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-post";
    let containerName = "surveyFormContainer-" + postID;
    surveyContainer.setAttribute("id", containerName);
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/truthsocial/inject.css");
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    // Append survey to the top of the post
    injectNode.insertAdjacentElement('afterbegin', surveyContainer);
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'isGuided', 'selectors', 'manipulationMaps'], function (result) {
        const _rawTS = (result.selectors && result.selectors.truthsocial) ? result.selectors.truthsocial : {};
        SEL_TS = { ...(_rawTS.shared || {}), ...(_rawTS.account || {}), ...(_rawTS.post || {}) };
        watchPostCounter('truthsocial', function () { return _processedCount_TS; });

        // Load manipulation config for truthsocial-user
        const _userConfTS = result.config && result.config.surveys && result.config.surveys['truthsocial-user'];
        manipConfig_TSU = (_userConfTS && _userConfTS.manipulation) || {};

        // Load manipulation map for truthsocial-post
        const _postConfTS = result.config && result.config.surveys && result.config.surveys['truthsocial-post'];
        manipConfig_TS = (_postConfTS && _postConfTS.manipulation) || {};
        if (manipConfig_TS.enabled) {
            if (manipConfig_TS.source !== 'api' && result.manipulationMaps && result.manipulationMaps['truthsocial-post']) {
                let fullMap = result.manipulationMaps['truthsocial-post'];
                manipMapId_TS = (fullMap._meta && fullMap._meta.map_id) || '';
                for (let k in fullMap) { if (k !== '_meta') manipMap_TS[k] = fullMap[k]; }
            } else if (manipConfig_TS.source === 'api' && manipConfig_TS.endpoint && window.__sa_intervApi) {
                window.__sa_intervApi.init({ endpoint: manipConfig_TS.endpoint, survey_type: 'truthsocial-post', platform: 'truthsocial', mode: manipConfig_TS.mode, logOriginal: manipConfig_TS.logOriginal });
            }
        }

        tsRoot = document.getElementById('root') || document.querySelector(SEL_TS.appRoot || '#root') || document.body;
        obsConfigTS = SEL_TS.observerFilter || { attributes: false, childList: true, subtree: true };
        observerTS = createObserver();

        let isBasePlatform = window.location.pathname === '/' || window.location.pathname === '';
        if (result.isEnabled && result.isGuided && result.activeTargetList && result.activeTargetList.length > 0 && isBasePlatform) {
            let firstTarget = result.activeTargetList[0];
            let platformURL = "https://truthsocial.com/";
            let activeSurvey = result.config.activeSurveys && result.config.activeSurveys.length > 0 ? result.config.activeSurveys[0] : null;

            if (activeSurvey === 'truthsocial-post') {
                window.location.href = platformURL + firstTarget;
                return;
            } else if (activeSurvey === 'truthsocial-user') {
                window.location.href = platformURL + firstTarget;
                return;
            }
        }

        const currentPlatform = 'truthsocial';
        for (let index = 0; index < availableContextsTruthSocial.length; ++index) {
            let currentContext = availableContextsTruthSocial[index];
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
                            let capturedAvatarUrl = null;
                            let capturedBannerUrl = null;
                            let profile = extractUserProfile();
                            if (profile.profile_img_url) capturedAvatarUrl = profile.profile_img_url;
                            if (profile.bannerUrl) capturedBannerUrl = profile.bannerUrl;
                            
                            let capturedUserID = values.account_id;
                            let capturedSurveyType = currentContext.name;

                            chrome.storage.local.get(['isProfileDownloadEnabled', 'isBannerDownloadEnabled'], function (res) {
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

                        // Attach intervention metadata
                        let _ma = manipApplied_TS[values.post_id];
                        let _maU = manipApplied_TSU[values.account_id];
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
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.theme = config.theme || "light";
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);

                if (currentContext.name !== 'truthsocial-post') {
                    _processedCount_TS++;
                    let surveyID = crawlUserName();
                    currentContext.renderSurvey(surveyID, null, {
                        user_profile: () => extractUserProfile()
                    });
                    if (currentContext.name === 'truthsocial-user' && manipConfig_TSU.enabled) {
                        let profile = extractUserProfile();
                        _applyTSUserIntervention(surveyID, profile);
                    }
                }
            }
        }
    });
}

window.__socialAnnotate__.platformDebugCapture = function(selectors, stored) {
    let raw = selectors.truthsocial || {};
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
        platform: 'truthsocial',
        surveyType: activeSurvey || (isUser ? 'truthsocial-user' : 'truthsocial-post'),
        injectionStatus: {
            userSurveyInjected: !!document.getElementById('surveyFormContainer'),
            postSurveysInjected: document.querySelectorAll('.survey-container-post').length
        },
        extractedData: { userID: crawlUserName(), profile: isUser ? extractUserProfile() : {} },
        selectorDiagnostics: Object.keys(section).filter(f => !['postVideo','postImage','userBanner'].includes(f)).map(probe)
    };
};

initializeSurveys();
