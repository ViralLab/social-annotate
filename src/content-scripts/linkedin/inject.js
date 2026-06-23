// Context class is defined in shared.js
const availableContextsLinkedIn = [
    new Context('linkedin-post', enablePostObserver, null),
    new Context('linkedin-user', enableUserSurvey, () => isLinkedInUserPage())
];

let SEL_LI = {};
let liRoot = null;
let obsConfigLI = {};
let observerLI = null;

// ── Manipulation state ────────────────────────────────────
let manipConfig_LI  = {};
let manipMap_LI     = {};
let manipMapId_LI   = '';
let manipApplied_LI     = {};
let _processedCount_LI     = 0;
const _inFlight_LI  = new Set();
registerHealthCounter(function () { return _processedCount_LI; });

// Cache of CDN video URLs captured by inject-api.js (MAIN world)
// Maps postKey → last CDN video URL seen for that post
if (!window.__socialAnnotate__) window.__socialAnnotate__ = {};
if (!window.__socialAnnotate__.liVideoUrls) window.__socialAnnotate__.liVideoUrls = {};

// Listen for CDN video URLs broadcast by the MAIN-world interceptor
window.addEventListener('mh:li-cdn-video-url', function(e) {
    if (e.detail && e.detail.url) {
        // Store globally; associated with a postKey later during download
        window.__socialAnnotate__.liLastCdnUrl = e.detail.url;
    }
});

window.addEventListener('mh:download-request', function(e) {
    let detail = e.detail;
    if (!detail) return;
    
    let initialSurveyType = detail.surveyType || 'linkedin-post';
    if (initialSurveyType !== 'linkedin-post') return;
    
    if (!detail.postID) return;
    
    let postID = detail.postID;
    let postOwner = detail.userID;
    let postSurveyType = detail.surveyType || 'linkedin-post';
    
    let containerName = 'surveyFormContainer-' + postID;
    let surveyContainer = document.getElementById(containerName);
    let injectNode = surveyContainer ? (surveyContainer.closest(SEL_LI.postContainer || '[data-testid="mainFeed"] [role="listitem"], [role="main"] [role="listitem"], .feed-shared-update-v2') || surveyContainer.parentNode) : null;

    // ── Images: use DOM-extracted URLs with credentialed fetch ────────────
    let imageUrls = [];
    if (injectNode) {
        let photos = injectNode.querySelectorAll(SEL_LI.postImage || 'img[alt="View image"]');
        photos.forEach(img => {
            if (img.src && !img.src.includes('avatar') && !img.src.includes('icon')) {
                imageUrls.push(img.src);
            }
        });
    }
    imageUrls.forEach(function(url) {
        fetch(url, { credentials: 'include' })
            .then(r => r.ok ? r.blob() : Promise.reject('HTTP ' + r.status))
            .then(blob => {
                let reader = new FileReader();
                reader.onloadend = function() {
                    if (!isExtensionContextValid()) return;
                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [reader.result], userId: postOwner || 'user', postId: postID, surveyType: postSurveyType });
                };
                reader.readAsDataURL(blob);
            })
            .catch(err => {
                if (!isExtensionContextValid()) return;
                chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [url], userId: postOwner || 'user', postId: postID, surveyType: postSurveyType });
            });
    });

    // ── Videos: use the CDN URL captured by inject-api.js (MAIN world) ───
    // LinkedIn MSE videos can't be fetched as a blob URL — we need the
    // underlying dms.licdn.com CDN URL captured by the fetch() interceptor.
    let hasVideoEl = injectNode && injectNode.querySelector('video');

    // Only use the globally-cached CDN URL if THIS post actually has a video element.
    // liLastCdnUrl is set by scrolling past any post's video — without this guard,
    // annotating a non-video post would download the wrong video.
    let cdnVideoUrl = hasVideoEl
        ? (window.__socialAnnotate__ && window.__socialAnnotate__.liLastCdnUrl)
        : null;

    if (!cdnVideoUrl && hasVideoEl) {
        // Fallback: try video.currentSrc (works if not MSE)
        let videoEl = injectNode.querySelector('video');
        let fallbackSrc = videoEl && (videoEl.currentSrc || videoEl.src);
        if (fallbackSrc && !fallbackSrc.startsWith('blob:')) {
            cdnVideoUrl = fallbackSrc;
        }
    }

    if (cdnVideoUrl) {
        let reqId = Math.random().toString(36).substr(2, 9);
        let videoId = window.__liLastVideoId || null;
        // Ask the MAIN-world fetcher to download and return a data URL
        window.dispatchEvent(new CustomEvent('mh:fetch-li-video', {
            detail: { url: cdnVideoUrl, reqId: reqId, videoId: videoId }
        }));
        // Listen for the result
        window.addEventListener('mh:fetch-li-video-result', function handler(re) {
            if (!re.detail || re.detail.reqId !== reqId) return;
            window.removeEventListener('mh:fetch-li-video-result', handler);
            if (re.detail.error) {
                console.warn('[LinkedIn] MAIN-world video fetch failed:', re.detail.error);
                // Last-resort: try direct download anyway
                if (!isExtensionContextValid()) return;
                chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [cdnVideoUrl], userId: postOwner || 'user', postId: postID, surveyType: postSurveyType });
                return;
            }
            if (!isExtensionContextValid()) return;
            chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [re.detail.dataUrl], userId: postOwner || 'user', postId: postID, surveyType: postSurveyType });
        });
        // Clear the cached URL so next post gets a fresh one
        window.__socialAnnotate__.liLastCdnUrl = null;
    } else if (hasVideoEl) {
        console.warn('[LinkedIn] No CDN video URL captured yet. Play the video first, then click Download.');
    }

    if (imageUrls.length === 0 && !cdnVideoUrl && !hasVideoEl) {
        console.log('[LinkedIn] No media found on this post.');
    }
});

function _liTextEl(postNode) {
    return postNode.querySelector(SEL_LI.postText || '[data-testid="expandable-text-box"]')
        || postNode.querySelector('.update-components-text')
        || postNode.querySelector('.feed-shared-update-v2__description');
}

function _liToggleBtn(textEl, originalNodes, rewrittenText, mode) {
    if (mode !== 'aware') return;
    let isOriginal = false;
    let toggleBtn  = document.createElement('button');
    toggleBtn.textContent = '👁 Show original';
    toggleBtn.setAttribute('data-sa-interv-toggle', '1');
    toggleBtn.style.cssText = [
        'display:block','margin-left:auto','margin-bottom:4px',
        'padding:2px 10px','font-size:11px','line-height:1.6',
        'cursor:pointer','border-radius:4px',
        'background:rgba(10,102,194,0.08)','color:rgb(10,102,194)',
        'border:1px solid rgba(10,102,194,0.25)',
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

function _liApplyResult(result, postNode, mode) {
    let textEl = _liTextEl(postNode);
    if (textEl && result.rewritten_text) {
        let originalNodes = Array.from(textEl.childNodes).map(function(n) { return n.cloneNode(true); });
        textEl.textContent = result.rewritten_text;
        _liToggleBtn(textEl, originalNodes, result.rewritten_text, mode);
    }
}

async function processPostNode(postNode) {
    _processedCount_LI++;
    if (!isExtensionContextValid()) return;
    if (!postNode || postNode.getElementsByClassName('survey-container-post').length > 0) return;

    let postDetails = extractPostDetails(postNode);
    if (!postDetails || !postDetails.postID) return;

    const _renderSurvey = function() {
        availableContextsLinkedIn[0].renderSurvey(
            postDetails.postOwner,
            postDetails.postID,
            {
                body: () => extractPostTextContent(postNode),
                media_urls: () => extractPostMedia(postNode),
                post_metrics: () => extractPostMetrics(postNode),
                created_at: () => {
                    let t = postNode.querySelector(SEL_LI.postTimestamp || 'time[datetime]');
                    if (!t) return null;
                    let attr = SEL_LI.postTimestampAttr || 'datetime';
                    if (attr === 'textContent' || attr === 'innerText') return t.textContent.trim() || null;
                    return t.getAttribute(attr) || null;
                }
            }
        );
    };

    // ── API path ──────────────────────────────────────────────────────────────
    if (manipConfig_LI.enabled && manipConfig_LI.source === 'api' && manipConfig_LI.endpoint && window.__sa_intervApi) {
        if (document.getElementById('surveyFormContainer-' + postDetails.postID)) {
            _renderSurvey();
            return;
        }
        if (_inFlight_LI.has(postDetails.postID)) return;
        _inFlight_LI.add(postDetails.postID);

        const cached = window.__sa_intervApi.getCached(postDetails.postID);
        if (cached) {
            _liApplyResult(cached, postNode, manipConfig_LI.mode);
            _inFlight_LI.delete(postDetails.postID);
            injectLinkedInPostSurvey(postNode, postDetails.postID);
            _renderSurvey();
            return;
        }

        const overlay = window.__sa_intervApi.createOverlay(postNode, manipConfig_LI.mode);
        const doRetry = function() { _inFlight_LI.delete(postDetails.postID); overlay.remove(); processPostNode(postNode); };
        try {
            const body = extractPostTextContent(postNode);
            const postData = {
                post_id:      postDetails.postID,
                account_id:   postDetails.postOwner,
                body,
                media_urls:   extractPostMedia(postNode),
                post_metrics: extractPostMetrics(postNode)
            };
            const result = await window.__sa_intervApi.queuePost(postData);

            const meta = { applied: true, label: result.prompt_label || '', map_id: result.map_id || window.__sa_intervApi.getMapId() };
            if (manipConfig_LI.logOriginal) meta.original_text = body;
            const extras = {};
            for (const k in result) {
                if (!['post_id', 'rewritten_text', 'map_id', 'prompt_label'].includes(k)) extras[k] = result[k];
            }
            if (Object.keys(extras).length > 0) meta.extras = extras;
            manipApplied_LI[postDetails.postID] = meta;

            overlay.parentNode && overlay.parentNode.removeChild(overlay);
            _inFlight_LI.delete(postDetails.postID);

            _liApplyResult(result, postNode, manipConfig_LI.mode);
            injectLinkedInPostSurvey(postNode, postDetails.postID);
            _renderSurvey();
        } catch(err) {
            overlay.showError(doRetry);
        }
        return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Map path ──────────────────────────────────────────────────────────────
    if (manipConfig_LI.enabled && manipMap_LI[postDetails.postID]) {
        let entry  = manipMap_LI[postDetails.postID];
        let textEl = _liTextEl(postNode);
        if (textEl) {
            let rewrittenText = entry.rewritten_text;
            let originalText  = entry.original_text || '';
            textEl.textContent = rewrittenText;
            if (manipConfig_LI.mode === 'aware') {
                let isOriginal = false;
                let toggleBtn  = document.createElement('button');
                toggleBtn.textContent = '👁 Show original';
                toggleBtn.setAttribute('data-sa-interv-toggle', '1');
                toggleBtn.style.cssText = [
                    'display:block','margin-left:auto','margin-bottom:4px',
                    'padding:2px 10px','font-size:11px','line-height:1.6',
                    'cursor:pointer','border-radius:4px',
                    'background:rgba(10,102,194,0.08)','color:rgb(10,102,194)',
                    'border:1px solid rgba(10,102,194,0.25)',
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
            let meta = { applied: true, label: entry.prompt_label || '', map_id: manipMapId_LI };
            if (manipConfig_LI.logOriginal) meta.original_text = originalText;
            manipApplied_LI[postDetails.postID] = meta;
        }
        if (entry.replacement_image) {
            let avatarImg = postNode.querySelector(SEL_LI.postAuthorAvatar || '.update-components-actor img, img[src*="profile"]');
            if (avatarImg) { avatarImg.src = entry.replacement_image; avatarImg.srcset = ''; }
        }
    }
    // ─────────────────────────────────────────────────────────────────────────

    injectLinkedInPostSurvey(postNode, postDetails.postID);
    _renderSurvey();
}

function createObserver() {
    const observerCallback = function (mutationsList, obs) {
        for (let mutation of mutationsList) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        let posts = node.querySelectorAll(SEL_LI.postContainer || '[data-testid="mainFeed"] [role="listitem"], [role="main"] [role="listitem"], .feed-shared-update-v2');
                        posts.forEach(processPostNode);

                        if (node.matches && node.matches(SEL_LI.postContainer || '[data-testid="mainFeed"] [role="listitem"], [role="main"] [role="listitem"], .feed-shared-update-v2')) {
                            processPostNode(node);
                        }
                    }
                });
            }
        }
    };
    return new MutationObserver(observerCallback);
}

function enablePostObserver(injectElement) {
    document.querySelectorAll(SEL_LI.postContainer || '[data-testid="mainFeed"] [role="listitem"], [role="main"] [role="listitem"], .feed-shared-update-v2').forEach(processPostNode);
    if (liRoot && observerLI) {
        observerLI.observe(liRoot, obsConfigLI);
    }
    setTimeout(() => {
        document.querySelectorAll(SEL_LI.postContainer || '[data-testid="mainFeed"] [role="listitem"], [role="main"] [role="listitem"], .feed-shared-update-v2').forEach(processPostNode);
    }, 1500);
}

function extractPostMedia(postNode) {
    if (!postNode) return [];
    let mediaUrls = [];

    let photos = postNode.querySelectorAll(SEL_LI.postImage || 'img[alt="View image"]');
    photos.forEach(img => {
        if (img.src && !img.src.includes('avatar') && !img.src.includes('icon') && !img.src.includes('missing.png')) {
            mediaUrls.push(img.src);
        }
    });

    let videos = postNode.querySelectorAll(SEL_LI.postVideo || 'video');
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
    let sel = SEL_LI.postText || '[data-testid="expandable-text-box"]';
    let textNodes = postNode.querySelectorAll(sel);
    if (textNodes.length === 0) textNodes = postNode.querySelectorAll('.update-components-text, .feed-shared-update-v2__description');
    textNodes.forEach(node => {
        if (node.innerText) textParts.push(node.innerText.trim());
    });
    return textParts.join('\n\n');
}

function extractPostMetrics(postNode) {
    let metrics = { like_count: null, share_count: null, comment_count: null, bookmark_count: null, view_count: null, quote_count: null };

    function parseCount(text) {
        if (!text) return null;
        text = text.trim().replace(/,/g, '');
        let m = text.match(/^([\d.]+)\s*([KkMm]?)/);
        if (!m) return null;
        let n = parseFloat(m[1]);
        let s = m[2].toLowerCase();
        if (s === 'k') n = Math.round(n * 1000);
        else if (s === 'm') n = Math.round(n * 1000000);
        return isNaN(n) ? null : n;
    }

    // Scan all elements for LinkedIn social count text patterns.
    // LinkedIn uses hashed class names so we rely on direct text content + aria-label.
    let allEls = postNode.querySelectorAll('*');
    for (let el of allEls) {
        // Use direct text only (skip nested element text to avoid false positives)
        let directText = '';
        for (let child of el.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) directText += child.textContent;
        }
        directText = directText.trim();

        let candidates = [directText, el.getAttribute('aria-label') || ''];
        for (let t of candidates) {
            if (!t) continue;
            if (metrics.like_count === null) {
                let m = t.match(/^([\d,]+(?:\.\d+)?[KkMm]?)\s+reactions?/i);
                if (m) { metrics.like_count = parseCount(m[1]); continue; }
            }
            if (metrics.comment_count === null) {
                let m = t.match(/^([\d,]+(?:\.\d+)?[KkMm]?)\s+comments?/i);
                if (m) { metrics.comment_count = parseCount(m[1]); continue; }
            }
            if (metrics.share_count === null) {
                let m = t.match(/^([\d,]+(?:\.\d+)?[KkMm]?)\s+(?:reposts?|shares?)/i);
                if (m) { metrics.share_count = parseCount(m[1]); continue; }
            }
            if (metrics.view_count === null) {
                let m = t.match(/^([\d,]+(?:\.\d+)?[KkMm]?)\s+(?:impressions?|views?)/i);
                if (m) { metrics.view_count = parseCount(m[1]); continue; }
            }
        }
    }

    // Reaction count fallback: bare number in a span immediately after the reaction
    // icons <ul role="presentation"> — e.g. <button><ul>…</ul><span>247</span></button>
    if (metrics.like_count === null) {
        let reactionUl = postNode.querySelector('ul[role="presentation"]');
        if (reactionUl) {
            let parent = reactionUl.parentElement;
            if (parent) {
                let siblings = Array.from(parent.children);
                let idx = siblings.indexOf(reactionUl);
                for (let i = idx + 1; i < siblings.length; i++) {
                    let t = siblings[i].textContent.trim();
                    if (/^\d/.test(t)) {
                        let parsed = parseCount(t);
                        if (parsed !== null) { metrics.like_count = parsed; break; }
                    }
                }
            }
        }
    }

    return metrics;
}

function extractPostDetails(postNode) {
    let postID = "";

    // Tier 1: activity URN from any child componentkey — stable across sessions
    let urnEl = postNode.querySelector('[componentkey*="urn:li:activity:"]');
    if (urnEl) {
        let m = (urnEl.getAttribute('componentkey') || '').match(/urn:li:activity:(\d+)/);
        if (m) postID = m[1];
    }

    // Tier 2: activity URN from any data-* attribute on the post node itself
    if (!postID) {
        for (let attr of postNode.attributes) {
            let m = attr.value.match(/urn:li:activity:(\d+)/);
            if (m) { postID = m[1]; break; }
        }
    }

    // Tier 3: stable anchor href (e.g. share URL contains the activity URN)
    if (!postID) {
        let anchors = postNode.querySelectorAll('a[href*="urn%3Ali%3Aactivity%3A"], a[href*="urn:li:activity:"]');
        for (let a of anchors) {
            let m = decodeURIComponent(a.href).match(/urn:li:activity:(\d+)/);
            if (m) { postID = m[1]; break; }
        }
    }

    // Tier 4: fall back to componentkey (session-specific but keeps surveys working)
    if (!postID) {
        postID = postNode.dataset.componentkey || postNode.getAttribute('componentkey') || '';
    }

    // Last resort: random stable-for-this-session ID
    if (!postID) {
        postID = Math.random().toString(36).substr(2, 9);
        postNode.setAttribute('componentkey', postID);
    }

    let postOwner = "unknown";
    let ownerEl = postNode.querySelector(SEL_LI.userHandle || 'a[href*="/in/"]');
    if (ownerEl && ownerEl.href) {
        let ownerMatch = ownerEl.href.match(/\/in\/([^/?#]+)/);
        if (ownerMatch) postOwner = ownerMatch[1];
    }

    return { postOwner, postID };
}

// ───────────────────────────────────────────────────────────────────────
// LinkedIn User Survey
// ───────────────────────────────────────────────────────────────────────

function isLinkedInUserPage() {
    // User profile pages: /in/{username}/
    if (window.location.protocol === 'file:') return true;
    // Local HTTP test fixtures served via 127.0.0.1 or localhost
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') return true;
    return /^\/in\/[^/]+\/?/.test(window.location.pathname);
}

function crawlLinkedInUsername() {
    // Extract from URL: linkedin.com/in/{username}/
    let m = window.location.pathname.match(/^\/in\/([^/?#]+)/);
    if (m) return m[1];
    // Fallback: look at the topcard profile link
    let profileLink = document.querySelector(SEL_LI.userHandle || "a[href*='/in/'][tabindex='0']:not([componentkey])");
    if (profileLink && profileLink.href) {
        let lm = profileLink.href.match(/\/in\/([^/?#]+)/);
        if (lm) return lm[1];
    }
    return 'unknown';
}

function extractLinkedInUserProfile() {
    let profile = {};
    try {
        let nameEl = document.querySelector(SEL_LI.userDisplayName || "section[componentkey*='Topcard'] h2");
        if (nameEl) profile.profile_name = nameEl.textContent.trim();
    } catch(e) {}
    try {
        let headlineEl = document.querySelector(SEL_LI.userHeadline || "section[componentkey*='Topcard'] p.d8d5bbbc._2f6a5622");
        if (!headlineEl) headlineEl = document.querySelector("main p");
        if (headlineEl) profile.headline = headlineEl.textContent.trim();
    } catch(e) {}
    try {
        let locEl = document.querySelector(SEL_LI.userLocation || "section[componentkey*='Topcard'] p.bab73015._98cb9b8f");
        if (locEl) profile.location = locEl.textContent.trim();
    } catch(e) {}
    try {
        let followersEl = document.querySelector(SEL_LI.userFollowers || "a[href*='followers'] p");
        if (followersEl) profile.followersText = followersEl.textContent.trim();
    } catch(e) {}
    try {
        let connEl = document.querySelector(SEL_LI.userConnections || "a[href*='connections'] p");
        if (connEl) profile.connectionsText = connEl.textContent.trim();
    } catch(e) {}
    try {
        // The avatar is a figure>img inside the Topcard section — NOT wrapped in a[href*=/in/].
        // Prefer fetchpriority=high to skip the low-res thumbnail variants.
        let avatarEl = document.querySelector(SEL_LI.userAvatar || "section[componentkey*='Topcard'] figure img._17236dac:not([alt='Cover photo'])[fetchpriority='high']");
        if (!avatarEl) avatarEl = document.querySelector("img[srcset*='profile-displayphoto']");
        if (!avatarEl) avatarEl = document.querySelector("section[componentkey*='Topcard'] figure img._17236dac");
        if (avatarEl) {
            // Prefer a CDN URL from srcset (works on saved pages where src is a local path).
            let src = avatarEl.currentSrc || avatarEl.src || '';
            if (!src || src.includes('saved_resource') || src.includes('data:image') || !src.startsWith('http')) {
                let srcset = avatarEl.getAttribute('srcset') || '';
                let cdnUrls = srcset.split(',')
                    .map(s => s.trim().split(/\s+/)[0])
                    .filter(u => u.startsWith('https://'));
                if (cdnUrls.length > 0) src = cdnUrls[cdnUrls.length - 1]; // last entry is highest res
            }
            if (src && src.startsWith('http')) profile.profile_img_url = src;
        }
    } catch(e) {}
    try {
        let bannerEl = document.querySelector(SEL_LI.userBanner || "section[componentkey*='Topcard'] figure img._17236dac[alt='Cover photo']");
        if (!bannerEl) bannerEl = document.querySelector("img[srcset*='profile-displaybackgroundimage']");
        if (bannerEl) {
            let src = bannerEl.currentSrc || bannerEl.src || '';
            if (!src || src.includes('saved_resource') || src.includes('data:image') || !src.startsWith('http')) {
                let srcset = bannerEl.getAttribute('srcset') || '';
                let cdnUrls = srcset.split(',')
                    .map(s => s.trim().split(/\s+/)[0])
                    .filter(u => u.startsWith('https://'));
                if (cdnUrls.length > 0) src = cdnUrls[cdnUrls.length - 1];
            }
            if (src && src.startsWith('http')) profile.bannerUrl = src;
        }
    } catch(e) {}
    return profile;
}

function injectLinkedInUserSurvey() {
    if (!isExtensionContextValid()) return;
    // Only inject once
    if (document.getElementById('surveyFormContainer')) return;

    let cssUrl, surveyUrl;
    try {
        cssUrl = chrome.runtime.getURL('content-scripts/linkedin/inject.css');
        surveyUrl = chrome.runtime.getURL('sandbox/survey.html');
    } catch(e) { return; }

    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-user';
    surveyContainer.id = 'surveyFormContainer';
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `<iframe class="surveyIframe" src="${surveyUrl}" data-css="${cssUrl}" style="border:none;width:100%;height:100%;background:transparent;"></iframe>`;

    // Insert BEFORE #root so it's outside LinkedIn's SPA-managed area.
    // This prevents two issues: (1) SPA re-renders wiping the node and
    // (2) CSS transforms on #root ancestors breaking position:fixed.
    let root = document.getElementById('root');
    if (root) {
        root.insertAdjacentElement('beforebegin', surveyContainer);
    } else {
        document.body.insertAdjacentElement('afterbegin', surveyContainer);
    }
}

function enableUserSurvey(injectElement) {
    // For user surveys, injection happens immediately (no observer needed)
    injectLinkedInUserSurvey();
}


function injectLinkedInPostSurvey(injectNode, postID) {
    if (!isExtensionContextValid()) return;

    let cssUrl, surveyUrl;
    try {
        cssUrl = chrome.runtime.getURL("content-scripts/linkedin/inject.css");
        surveyUrl = chrome.runtime.getURL("sandbox/survey.html");
    } catch(e) {
        console.debug('[SocialAnnotate] Extension context invalidated in injectLinkedInPostSurvey.');
        return;
    }

    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-post";
    let containerName = "surveyFormContainer-" + postID;
    surveyContainer.setAttribute("id", containerName);
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${surveyUrl}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    // Append survey to the top of the post
    injectNode.insertAdjacentElement('afterbegin', surveyContainer);
}

function initializeSurveys() {
    if (!isExtensionContextValid()) return;
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'isGuided', 'selectors', 'manipulationMaps'], function (result) {
        const _rawLI = (result.selectors && result.selectors.linkedin) ? result.selectors.linkedin : {};
        SEL_LI = { ...(_rawLI.shared || {}), ...(_rawLI.account || {}), ...(_rawLI.post || {}) };
        watchPostCounter('linkedin', function () { return _processedCount_LI; });

        // Load manipulation map for linkedin-post
        const _postConfLI = result.config && result.config.surveys && result.config.surveys['linkedin-post'];
        manipConfig_LI = (_postConfLI && _postConfLI.manipulation) || {};
        if (manipConfig_LI.enabled && manipConfig_LI.source !== 'api' && result.manipulationMaps && result.manipulationMaps['linkedin-post']) {
            let fullMap = result.manipulationMaps['linkedin-post'];
            manipMapId_LI = (fullMap._meta && fullMap._meta.map_id) || '';
            for (let k in fullMap) { if (k !== '_meta') manipMap_LI[k] = fullMap[k]; }
        }

        if (manipConfig_LI.enabled && manipConfig_LI.source === 'api' && manipConfig_LI.endpoint && window.__sa_intervApi) {
            window.__sa_intervApi.init({ endpoint: manipConfig_LI.endpoint, survey_type: 'linkedin-post', platform: 'linkedin', mode: manipConfig_LI.mode, logOriginal: manipConfig_LI.logOriginal });
        }

        liRoot = document.getElementById('root') || document.querySelector(SEL_LI.appRoot || '#root') || document.body;
        obsConfigLI = SEL_LI.observerFilter || { attributes: false, childList: true, subtree: true };
        observerLI = createObserver();

        // Guided-mode navigation
        let isBasePlatform = window.location.pathname === '/' || window.location.pathname === '/feed/';
        if (result.isEnabled && result.isGuided && result.activeTargetList && result.activeTargetList.length > 0 && isBasePlatform) {
            let firstTarget = result.activeTargetList[0];
            let platformURL = 'https://www.linkedin.com/';
            let activeSurvey = result.config.activeSurveys && result.config.activeSurveys.length > 0 ? result.config.activeSurveys[0] : null;

            if (activeSurvey === 'linkedin-post') {
                window.location.href = platformURL + firstTarget;
                return;
            } else if (activeSurvey === 'linkedin-user') {
                // firstTarget should be a LinkedIn username like 'in/username/'
                let target = firstTarget.startsWith('in/') ? firstTarget : 'in/' + firstTarget;
                window.location.href = platformURL + target;
                return;
            }
        }

        const currentPlatform = 'linkedin';
        for (let index = 0; index < availableContextsLinkedIn.length; ++index) {
            let currentContext = availableContextsLinkedIn[index];
            if (!currentContext.name.includes(currentPlatform)) continue;

            let contextFlag = result.config.activeSurveys.includes(currentContext.name);
            let auxFlag = currentContext.auxiliaryCheck();

            if (result.isEnabled === true && contextFlag === true && auxFlag === true) {
                let activeSurvey = currentContext.name;
                let config = result.config['surveys'][activeSurvey];
                let studyID = config.studyID;
                let isUserSurvey = activeSurvey.endsWith('-user');

                function submitAction(errors, values) {
                    if (!errors) {
                        if (!isExtensionContextValid()) return;
                        values.surveyType = currentContext.name;
                        values.studyID = studyID;

                        // Attach intervention metadata
                        if (!isUserSurvey) {
                            let _ma = manipApplied_LI[values.post_id];
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
                            let profile = extractLinkedInUserProfile();
                            let capturedUserId = values.account_id;
                            let capturedSurveyType = currentContext.name;
                            chrome.storage.local.get(['isProfileDownloadEnabled', 'isBannerDownloadEnabled'], function(res) {
                                function downloadUrl(url, postId) {
                                    fetch(url, { credentials: 'include' })
                                        .then(r => r.blob())
                                        .then(blob => {
                                            let reader = new FileReader();
                                            reader.onloadend = function() {
                                                if (!isExtensionContextValid()) return;
                                                chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [reader.result], userId: capturedUserId || 'user', postId: postId, surveyType: capturedSurveyType });
                                            };
                                            reader.readAsDataURL(blob);
                                        })
                                        .catch(() => {
                                            if (isExtensionContextValid()) {
                                                chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [url], userId: capturedUserId || 'user', postId: postId, surveyType: capturedSurveyType });
                                            }
                                        });
                                }
                                if (res.isProfileDownloadEnabled && profile.profile_img_url) downloadUrl(profile.profile_img_url, 'profile');
                                if (res.isBannerDownloadEnabled && profile.bannerUrl) downloadUrl(profile.bannerUrl, 'banner');
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

                if (isUserSurvey) {
                    let userID = crawlLinkedInUsername();
                    currentContext.renderSurvey(userID, null, {
                        user_profile: () => extractLinkedInUserProfile()
                    });
                }
            }
        }
    });
}

window.__socialAnnotate__.platformDebugCapture = function(selectors, stored) {
    let raw = selectors.linkedin || {};
    let SEL = Object.assign({}, raw.shared || {}, raw.account || {}, raw.post || {});
    let activeSurvey = stored && stored.config && stored.config.activeSurveys && stored.config.activeSurveys[0];

    function probe(field) {
        let selector = SEL[field];
        if (!selector) return { field, selector: null, matched: false, value: null, note: 'not in selectors.json' };
        try {
            let el = document.querySelector(selector);
            return { field, selector, matched: !!el, value: el ? (el.src || el.currentSrc || el.textContent.trim().slice(0, 200) || null) : null };
        } catch(e) {
            return { field, selector, matched: false, value: null, note: 'invalid selector' };
        }
    }

    let isUser = activeSurvey ? activeSurvey.endsWith('-user') : isLinkedInUserPage();
    let section = isUser ? (raw.account || {}) : (raw.post || {});
    return {
        platform: 'linkedin',
        surveyType: activeSurvey || (isUser ? 'linkedin-user' : 'linkedin-post'),
        injectionStatus: {
            userSurveyInjected: !!document.getElementById('surveyFormContainer'),
            postSurveysInjected: document.querySelectorAll('.survey-container-post').length
        },
        extractedData: { userID: crawlLinkedInUsername(), profile: isUser ? extractLinkedInUserProfile() : {} },
        selectorDiagnostics: Object.keys(section).filter(f => !['postVideo','postImage','userBanner'].includes(f)).map(probe)
    };
};

initializeSurveys();
