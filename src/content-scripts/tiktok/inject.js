const availableContextsTikTok = [
    new Context('tiktok-reel', enablePostObserver, null),
    new Context('tiktok-user', injectTikTokUserSurvey, checkUserURL)
];

let SEL_TT = {};
let ttRoot = null;
let obsConfigTT = {};
let observerTT = null;


let manipConfig_TT  = {};
let manipMap_TT     = {};
let manipMapId_TT   = '';
let manipApplied_TT     = {};
let _processedCount_TT     = 0;
registerHealthCounter(function () { return _processedCount_TT; });

window.addEventListener('mh:download-request', function(e) {
    let detail = e.detail;
    if (!detail || detail.surveyType === 'tiktok-user') return;
    if (!detail.postID) return;

    let postID = detail.postID;
    let postOwner = detail.userID;
    let postSurveyType = detail.surveyType || 'tiktok-reel';

    console.log('[SA inject] download | postID:', postID);

    let key = Math.random().toString(36).substr(2, 9);
    let safeUser = (postOwner || 'user').replace(/[^a-zA-Z0-9._-]/g, '_');
    let safePost = String(postID || 'video').replace(/[^a-zA-Z0-9._-]/g, '_');

    chrome.runtime.sendMessage({
        action: 'registerTikTokDownload',
        key: key,
        userId: postOwner || 'user',
        postId: postID,
        surveyType: postSurveyType
    });

    // inject-api.js looks up the CDN URL from its API cache (keyed by aweme_id = postID)
    // and fetches in MAIN world so tt_chain_token cookie is included.
    document.dispatchEvent(new CustomEvent('sa:tiktok-download-video', {
        detail: { postId: postID, filename: 'tiktok__' + key + '__' + safeUser + '_' + safePost + '.mp4' }
    }));
});

function extractPostDetails(postNode) {
    // Return cached ID if this element was already processed (prevents recycled articles colliding)
    if (postNode.dataset.saPostId) {
        return { postID: postNode.dataset.saPostId, postOwner: postNode.dataset.saPostOwner || '' };
    }

    let videoId = null;
    let authorUsername = '';

    let videoLink = postNode.querySelector(SEL_TT.postLink || 'a[href*="/video/"]');
    if (videoLink) {
        let href = videoLink.href || videoLink.getAttribute('href') || '';
        let m = href.match(/\/@([^/?#]+)\/video\/(\d+)/);
        if (m) { authorUsername = m[1]; videoId = m[2]; }
    }

    // Fallback: extract author from any /@username link
    if (!authorUsername) {
        let authorLink = postNode.querySelector(SEL_TT.postAuthorLink || 'a[href*="/@"]') || postNode.querySelector(SEL_TT.userAvatar || '[data-e2e="video-author-avatar"]');
        if (authorLink) {
            let href = authorLink.href || authorLink.getAttribute('href') || '';
            let m = href.match(/\/@([^/?#\s]+)/);
            if (m) authorUsername = m[1];
        }
    }

    // Fallback: use author + timestamp for uniqueness (scroll-index recycles on virtual scroll)
    if (!videoId) {
        videoId = (authorUsername || 'video') + '-' + Date.now();
    }

    // Cache on element so recycled DOM nodes don't generate a new ID on re-injection
    postNode.dataset.saPostId = videoId;
    postNode.dataset.saPostOwner = authorUsername;

    return { postID: videoId, postOwner: authorUsername };
}

function processPostNode(postNode) {
    _processedCount_TT++;
    // Inject into the feed-video section inside the article, not the article root
    if (postNode && postNode.getElementsByClassName('survey-container-post').length === 0) {
        let postDetails = extractPostDetails(postNode);
        if (!postDetails || !postDetails.postID) return;

        // Manipulation patch
        if (manipConfig_TT.enabled && manipMap_TT[postDetails.postID]) {
            let entry = manipMap_TT[postDetails.postID];
            let textEl = postNode.querySelector(SEL_TT.postText || '[data-e2e="video-desc"]');
            if (textEl) {
                let rewrittenText = entry.rewritten_text;
                let originalText = entry.original_text || '';
                textEl.textContent = rewrittenText;
                if (manipConfig_TT.mode === 'aware') {
                    let isOriginal = false;
                    let toggleBtn = document.createElement('button');
                    toggleBtn.textContent = '👁 Show original';
                    toggleBtn.setAttribute('data-sa-manip-toggle', '1');
                    toggleBtn.style.cssText = [
                        'display:block', 'margin-bottom:4px', 'padding:2px 10px',
                        'font-size:11px', 'cursor:pointer', 'border-radius:4px',
                        'background:rgba(254,44,85,0.1)', 'color:rgb(254,44,85)',
                        'border:1px solid rgba(254,44,85,0.3)',
                    ].join(';');
                    toggleBtn.addEventListener('click', function(ev) {
                        ev.stopPropagation();
                        isOriginal = !isOriginal;
                        textEl.textContent = isOriginal ? originalText : rewrittenText;
                        toggleBtn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
                    });
                    textEl.parentNode.insertBefore(toggleBtn, textEl);
                }
                let meta = { applied: true, label: entry.prompt_label || '', map_id: manipMapId_TT };
                if (manipConfig_TT.logOriginal) meta.original_text = originalText;
                manipApplied_TT[postDetails.postID] = meta;
            }
        }

        injectTikTokPostSurvey(postNode, postDetails.postID);
        availableContextsTikTok[0].renderSurvey(
            postDetails.postOwner,
            postDetails.postID,
            {
                body: () => extractPostTextContent(postNode),
                media_urls: () => extractPostMedia(postNode),
                post_metrics: () => extractPostMetrics(postNode),
                created_at: () => null
            }
        );
    }
}

function createObserver() {
    const observerCallback = function(mutationsList) {
        for (let mutation of mutationsList) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType !== 1) return;
                    let posts = node.querySelectorAll(SEL_TT.postContainer || 'article[data-e2e="recommend-list-item-container"]');
                    posts.forEach(processPostNode);
                    if (node.matches && node.matches(SEL_TT.postContainer || 'article[data-e2e="recommend-list-item-container"]')) {
                        processPostNode(node);
                    }
                });
            }
        }
    };
    return new MutationObserver(observerCallback);
}

function enablePostObserver() {
    document.querySelectorAll(SEL_TT.postContainer || 'article[data-e2e="recommend-list-item-container"]').forEach(processPostNode);
    if (ttRoot && observerTT) {
        observerTT.observe(ttRoot, obsConfigTT);
    }
    setTimeout(function() {
        document.querySelectorAll(SEL_TT.postContainer || 'article[data-e2e="recommend-list-item-container"]').forEach(processPostNode);
    }, 1500);
}

function extractPostMedia(postNode) {
    if (!postNode) return [];
    let mediaUrls = [];

    let videos = postNode.querySelectorAll(SEL_TT.postVideo || '[data-e2e="feed-video"] video, video');
    videos.forEach(function(video) {
        let src = video.currentSrc || video.getAttribute('src') || video.src;
        if (!src) {
            let source = video.querySelector('source');
            if (source) src = source.currentSrc || source.getAttribute('src') || source.src;
        }
        if (src && !mediaUrls.includes(src)) mediaUrls.push(src);
    });

    return mediaUrls;
}

function extractPostTextContent(postNode) {
    let textEl = postNode.querySelector(SEL_TT.postText || '[data-e2e="video-desc"]');
    if (!textEl) return '';
    return (textEl.innerText || textEl.textContent || '').trim();
}

function extractPostMetrics(postNode) {
    let metrics = { like_count: null, share_count: null, comment_count: null, bookmark_count: null, view_count: null, quote_count: null };

    const parseShortNumber = function(str) {
        if (!str) return null;
        str = str.trim().replace(/,/g, '');
        if (/K/i.test(str)) return Math.round(parseFloat(str) * 1000);
        if (/M/i.test(str)) return Math.round(parseFloat(str) * 1000000);
        if (/B/i.test(str)) return Math.round(parseFloat(str) * 1000000000);
        let n = parseInt(str, 10);
        return isNaN(n) ? null : n;
    };

    let likeEl = postNode.querySelector(SEL_TT.metricsLike || 'strong[data-e2e="like-count"]');
    if (likeEl) metrics.like_count = parseShortNumber(likeEl.textContent);

    let commentEl = postNode.querySelector(SEL_TT.metricsReply || 'strong[data-e2e="comment-count"]');
    if (commentEl) metrics.comment_count = parseShortNumber(commentEl.textContent);

    let bookmarkEl = postNode.querySelector(SEL_TT.metricsBookmark || 'strong[data-e2e="favorite-count"]');
    if (bookmarkEl) metrics.bookmark_count = parseShortNumber(bookmarkEl.textContent);

    let shareEl = postNode.querySelector(SEL_TT.metricsRepost || 'strong[data-e2e="share-count"]');
    if (shareEl) metrics.share_count = parseShortNumber(shareEl.textContent);

    return metrics;
}

function crawlUserName() {
    if (window.location.protocol === 'file:' || window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
        let handleEl = document.querySelector(SEL_TT.userHandle || 'h2[data-e2e="user-subtitle"]');
        if (handleEl) {
            let text = handleEl.textContent.trim().replace(/^@/, '');
            if (text) return text;
        }
        return 'local-test-user';
    }
    let m = window.location.pathname.match(/^\/@([^/?#]+)/);
    return m ? m[1] : '';
}

function extractUserProfile() {
    let profile = {};

    try {
        let nameEl = document.querySelector(SEL_TT.userDisplayName || 'h1[data-e2e="user-title"]');
        if (nameEl) profile.profile_name = nameEl.textContent.trim();
    } catch(e) {}

    try {
        let handleEl = document.querySelector(SEL_TT.userHandle || 'h2[data-e2e="user-subtitle"]');
        if (handleEl) profile.handle = handleEl.textContent.trim();
    } catch(e) {}

    try {
        let avatarEl = document.querySelector(SEL_TT.userProfileAvatar || '[data-e2e="user-avatar"] img');
        if (!avatarEl) avatarEl = document.querySelector(SEL_TT.userAvatarContainer || '[data-e2e="user-avatar"]');
        if (avatarEl) profile.profile_img_url = avatarEl.src || null;
    } catch(e) {}

    try {
        let bioEl = document.querySelector(SEL_TT.userBio || 'h2[data-e2e="user-bio"]');
        if (bioEl) profile.bio = bioEl.textContent.trim();
    } catch(e) {}

    try {
        let followersEl = document.querySelector(SEL_TT.userFollowers || 'strong[data-e2e="followers-count"]');
        if (followersEl) {
            let text = followersEl.textContent.trim();
            profile.followersText = text;
            let m = text.match(/([\d,.]+[KMB]?)/i);
            if (m) profile.followersCount = m[1];
        }
    } catch(e) {}

    try {
        let followingEl = document.querySelector(SEL_TT.userFollowing || 'strong[data-e2e="following-count"]');
        if (followingEl) {
            let text = followingEl.textContent.trim();
            profile.followingText = text;
            let m = text.match(/([\d,.]+[KMB]?)/i);
            if (m) profile.followingCount = m[1];
        }
    } catch(e) {}

    try {
        let likesEl = document.querySelector(SEL_TT.userTotalLikes || 'strong[data-e2e="likes-count"]');
        if (likesEl) profile.totalLikes = likesEl.textContent.trim();
    } catch(e) {}

    return profile;
}

function injectTikTokUserSurvey() {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-user';
    surveyContainer.setAttribute('id', 'surveyFormContainer');
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL('content-scripts/tiktok/inject.css');
    shadowRoot.innerHTML = '<iframe class="surveyIframe" src="' + chrome.runtime.getURL('sandbox/survey.html') + '" data-css="' + cssUrl + '" style="border:none; width:100%; height:100%; background:transparent;"></iframe>';

    let appRoot = document.getElementById('app') || document.querySelector(SEL_TT.appRoot || '#app') || document.body;
    if (appRoot) {
        appRoot.insertAdjacentElement('beforebegin', surveyContainer);
    }
}

function injectTikTokPostSurvey(injectNode, postID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-post';
    surveyContainer.setAttribute('id', 'surveyFormContainer-' + postID);
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL('content-scripts/tiktok/inject.css');
    // pointer-events:auto re-enables interaction on the iframe inside the pointer-events:none container
    shadowRoot.innerHTML = '<iframe class="surveyIframe" src="' + chrome.runtime.getURL('sandbox/survey.html') + '" data-css="' + cssUrl + '" style="border:none; width:100%; height:100%; background:transparent; pointer-events:auto;"></iframe>';

    // Inject into the video section so the survey sits at the top of the video area,
    // not in the empty left gutter of the article's flex-row layout.
    let videoSection = injectNode.querySelector(SEL_TT.postVideoContainer || '[data-e2e="feed-video"]') || injectNode;
    videoSection.insertAdjacentElement('afterbegin', surveyContainer);
}

function checkUserURL() {
    if (window.location.protocol === 'file:') return true;
    let path = window.location.pathname;
    return path.startsWith('/@') && !path.includes('/video/');
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'isGuided', 'selectors', 'manipulationMaps'], function(result) {
        const _rawTT = (result.selectors && result.selectors.tiktok) ? result.selectors.tiktok : {};
        SEL_TT = Object.assign({}, _rawTT.shared || {}, _rawTT.account || {}, _rawTT.post || {});
        watchPostCounter('tiktok', function() { return _processedCount_TT; });

        const _postConfTT = result.config && result.config.surveys && result.config.surveys['tiktok-reel'];
        manipConfig_TT = (_postConfTT && _postConfTT.manipulation) || {};
        if (manipConfig_TT.enabled && result.manipulationMaps && result.manipulationMaps['tiktok-reel']) {
            let fullMap = result.manipulationMaps['tiktok-reel'];
            manipMapId_TT = (fullMap._meta && fullMap._meta.map_id) || '';
            for (let k in fullMap) { if (k !== '_meta') manipMap_TT[k] = fullMap[k]; }
        }

        ttRoot = document.getElementById('app') || document.querySelector(SEL_TT.appRoot || '#app') || document.body;
        obsConfigTT = SEL_TT.observerFilter || { attributes: false, childList: true, subtree: true };
        observerTT = createObserver();

        let isBasePlatform = window.location.pathname === '/' || window.location.pathname === '' || window.location.pathname.startsWith('/foryou');
        if (result.isEnabled && result.isGuided && result.activeTargetList && result.activeTargetList.length > 0 && isBasePlatform) {
            let activeSurvey = result.config.activeSurveys && result.config.activeSurveys.length > 0 ? result.config.activeSurveys[0] : null;
            if (activeSurvey === 'tiktok-reel' || activeSurvey === 'tiktok-user') {
                let firstTarget = result.activeTargetList[0];
                window.location.href = 'https://www.tiktok.com/' + firstTarget;
                return;
            }
        }

        const currentPlatform = 'tiktok';
        for (let index = 0; index < availableContextsTikTok.length; ++index) {
            let currentContext = availableContextsTikTok[index];
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
                            let profile = extractUserProfile();
                            let capturedAvatarUrl = profile.profile_img_url || null;
                            let capturedUserID = values.account_id;
                            let capturedSurveyType = currentContext.name;

                            chrome.storage.local.get(['isProfileDownloadEnabled'], function(res) {
                                if (res.isProfileDownloadEnabled && capturedAvatarUrl) {
                                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [capturedAvatarUrl], userId: capturedUserID || 'user', postId: 'profile', surveyType: capturedSurveyType });
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

                        let _ma = manipApplied_TT[values.post_id];
                        if (_ma) {
                            values.manipulation_applied = true;
                            values.manipulation_label = _ma.label;
                            values.manipulation_map_id = _ma.map_id;
                            if (_ma.original_text !== undefined) values.original_text = _ma.original_text;
                        } else {
                            values.manipulation_applied = false;
                        }

                        storeResults(values, currentPlatform);
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.theme = config.theme || 'light';
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);

                if (currentContext.name !== 'tiktok-reel') {
                    _processedCount_TT++;
                    let surveyID = crawlUserName();
                    currentContext.renderSurvey(surveyID, null, {
                        user_profile: () => extractUserProfile()
                    });
                }
            }
        }
    });
}

window.__socialAnnotate__.platformDebugCapture = function(selectors, stored) {
    let raw = selectors.tiktok || {};
    let SEL_D = Object.assign({}, raw.shared || {}, raw.account || {}, raw.post || {});
    let activeSurvey = stored && stored.config && stored.config.activeSurveys && stored.config.activeSurveys[0];

    function probe(field) {
        let selector = SEL_D[field];
        if (!selector) return { field, selector: null, matched: false, value: null, note: 'not in selectors.json' };
        try {
            let el = document.querySelector(selector);
            return { field, selector, matched: !!el, value: el ? (el.src || el.textContent.trim().slice(0, 200) || null) : null };
        } catch(e) {
            return { field, selector, matched: false, value: null, note: 'invalid selector' };
        }
    }

    let isUser = activeSurvey ? activeSurvey.endsWith('-user') : checkUserURL();
    let section = isUser ? (raw.account || {}) : (raw.post || {});
    return {
        platform: 'tiktok',
        surveyType: activeSurvey || (isUser ? 'tiktok-user' : 'tiktok-reel'),
        injectionStatus: {
            userSurveyInjected: !!document.getElementById('surveyFormContainer'),
            postSurveysInjected: document.querySelectorAll('.survey-container-post').length
        },
        extractedData: { userID: crawlUserName(), profile: isUser ? extractUserProfile() : {} },
        selectorDiagnostics: Object.keys(section).map(probe)
    };
};

initializeSurveys();
