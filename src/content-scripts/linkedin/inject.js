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

function processPostNode(postNode) {
    _processedCount_LI++;
    if (!isExtensionContextValid()) return;
    let insertElement = postNode;
    if (insertElement && insertElement.getElementsByClassName('survey-container-post').length === 0) {
        let postDetails = extractPostDetails(postNode);

        if (postDetails && postDetails.postID) {
            // ── Manipulation DOM patch ────────────────────────────
            if (manipConfig_LI.enabled && manipMap_LI[postDetails.postID]) {
                let entry  = manipMap_LI[postDetails.postID];
                let textEl = postNode.querySelector(SEL_LI.postText || '[data-testid="expandable-text-box"]')
                              || postNode.querySelector('.update-components-text')
                              || postNode.querySelector('.feed-shared-update-v2__description');
                if (textEl) {
                    let rewrittenText = entry.rewritten_text;
                    let originalText  = entry.original_text || '';
                    textEl.textContent = rewrittenText;
                    if (manipConfig_LI.mode === 'aware') {
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
                    let meta = { applied: true, label: entry.prompt_label || '', map_id: manipMapId_LI };
                    if (manipConfig_LI.logOriginal) meta.original_text = originalText;
                    manipApplied_LI[postDetails.postID] = meta;
                }
                if (entry.replacement_image) {
                    let avatarImg = postNode.querySelector('.update-components-actor img')
                                   || postNode.querySelector('img[src*="profile"]');
                    if (avatarImg) { avatarImg.src = entry.replacement_image; avatarImg.srcset = ''; }
                }
            }
            // ─────────────────────────────────────────────────────

            injectLinkedInPostSurvey(insertElement, postDetails.postID);
            availableContextsLinkedIn[0].renderSurvey(
                postDetails.postOwner,
                postDetails.postID,
                {
                    body: () => extractPostTextContent(postNode),
                    media_urls: () => extractPostMedia(postNode),
                    post_metrics: () => extractPostMetrics(postNode),
                    created_at: () => { let t = postNode.querySelector('time[datetime]'); return t ? t.getAttribute('datetime') : null; }
                }
            );
        }
    }
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
        if (nameEl) profile.displayName = nameEl.textContent.trim();
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
            if (src && src.startsWith('http')) profile.avatarUrl = src;
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
        if (manipConfig_LI.enabled && result.manipulationMaps && result.manipulationMaps['linkedin-post']) {
            let fullMap = result.manipulationMaps['linkedin-post'];
            manipMapId_LI = (fullMap._meta && fullMap._meta.map_id) || '';
            for (let k in fullMap) { if (k !== '_meta') manipMap_LI[k] = fullMap[k]; }
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

                        // Attach manipulation metadata
                        if (!isUserSurvey) {
                            let _ma = manipApplied_LI[values.post_id];
                            if (_ma) {
                                values.manipulation_applied = true;
                                values.manipulation_label   = _ma.label;
                                values.manipulation_map_id  = _ma.map_id;
                                if (_ma.original_text !== undefined) values.original_text = _ma.original_text;
                            } else {
                                values.manipulation_applied = false;
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
                                if (res.isProfileDownloadEnabled && profile.avatarUrl) downloadUrl(profile.avatarUrl, 'profile');
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

initializeSurveys();
