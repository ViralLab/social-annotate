const availableContextsTruthSocial = [
    new Context('truthsocial-post', enablePostObserver, null),
    new Context('truthsocial-user', injectTruthSocialUserSurvey, checkUserURL)
];

let SEL_TS = {};
let tsRoot = null;
let obsConfigTS = {};
let observerTS = null;

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

function processPostNode(postNode) {
    let insertElement = postNode;
    if (insertElement && insertElement.getElementsByClassName('survey-container-post').length === 0) {
        let postDetails = extractPostDetails(postNode);

        if (postDetails && postDetails.postID) {
            // Kick off API fetch immediately — data will be ready long before form submit
            fetchTruthSocialPostData(postDetails.postID);

            injectTruthSocialPostSurvey(insertElement, postDetails.postID);
            availableContextsTruthSocial[0].renderSurvey(
                postDetails.postOwner,
                postDetails.postID,
                {
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
                        return t ? (t.getAttribute('datetime') || t.dateTime || null) : null;
                    }
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
                        let posts = node.querySelectorAll(SEL_TS.postContainer || '[data-testid="status"]');
                        posts.forEach(processPostNode);

                        if (node.matches && node.matches(SEL_TS.postContainer || '[data-testid="status"]')) {
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
    document.querySelectorAll(SEL_TS.postContainer || '[data-testid="status"]').forEach(processPostNode);
    if (tsRoot && observerTS) {
        observerTS.observe(tsRoot, obsConfigTS);
    }
    setTimeout(() => {
        document.querySelectorAll(SEL_TS.postContainer || '[data-testid="status"]').forEach(processPostNode);
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
        let handle = document.querySelector('p.text-muted-foreground[style="direction: ltr;"]');
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
        let nameEl = document.querySelector('h1.text-xl, div.px-4 p.text-lg');
        if (nameEl) profile.displayName = nameEl.textContent.trim();
    } catch (e) {}

    try {
        let handleEl = document.querySelector('p.text-muted-foreground[style="direction: ltr;"]');
        if (handleEl) profile.handle = handleEl.textContent.trim();
    } catch (e) {}

    try {
        let avatarEl = document.querySelector('img[src*="accounts/avatars"]');
        if (avatarEl) profile.avatarUrl = avatarEl.src;
    } catch (e) {}

    try {
        let bannerEl = document.querySelector('img[src*="accounts/headers"]');
        if (bannerEl) profile.bannerUrl = bannerEl.src;
    } catch (e) {}

    try {
        let followersEl = document.querySelector('[data-testid="followers-button"]');
        if (followersEl) {
            let text = followersEl.textContent.trim();
            profile.followersText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/i);
            if (numMatch) profile.followersCount = numMatch[1];
        }
    } catch (e) {}

    try {
        let followingEl = document.querySelector('[data-testid="following-button"]');
        if (followingEl) {
            let text = followingEl.textContent.trim();
            profile.followingText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/i);
            if (numMatch) profile.followingCount = numMatch[1];
        }
    } catch (e) {}
    
    try {
        let urlEl = document.querySelector('.max-w-\\[300px\\] a');
        if (urlEl) {
            profile.websiteUrl = urlEl.href;
        }
    } catch(e) {}

    return profile;
}

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
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'isGuided', 'selectors'], function (result) {
        const _rawTS = (result.selectors && result.selectors.truthsocial) ? result.selectors.truthsocial : {};
        SEL_TS = { ...(_rawTS.shared || {}), ...(_rawTS.account || {}), ...(_rawTS.post || {}) };
        checkSelectorHealth('truthsocial', SEL_TS, result.config && result.config.activeSurveys);

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
                            if (profile.avatarUrl) capturedAvatarUrl = profile.avatarUrl;
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

                        storeResults(values, currentPlatform);
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.theme = config.theme || "dark";
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);

                if (currentContext.name !== 'truthsocial-post') {
                    let surveyID = crawlUserName();
                    currentContext.renderSurvey(surveyID, null, {
                        user_profile: () => extractUserProfile()
                    });
                }
            }
        }
    });
}

initializeSurveys();
