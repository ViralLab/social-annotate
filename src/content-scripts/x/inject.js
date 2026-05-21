
// Context class is defined in shared.js
const availableContextsTwitter = [new Context('x-user', injectTwitterUserSurvey, checkUserURL),
new Context('x-post', enableTweetObserver, null)];

// Selectors loaded from storage (populated by initializeSurveys)
let SEL = {};

// MutationObserver globals — initialized after selectors are loaded
let reactRoot = null;
let obsConfig = {};
let observer = null;

if (!window.__socialAnnotate__) window.__socialAnnotate__ = {};
if (!window.__socialAnnotate__.twitterApiMediaMap) window.__socialAnnotate__.twitterApiMediaMap = {};
document.addEventListener('mh:media-response', function (e) {
    if (e.detail) {
        Object.assign(window.__socialAnnotate__.twitterApiMediaMap, e.detail);
    }
});

window.addEventListener('mh:download-request', function (e) {
    let detail = e.detail;
    if (!detail) return;

    let initialSurveyType = detail.surveyType || 'x-post';

    // User-survey downloads (profile picture & banner) are handled directly
    // in the submitAction to avoid race conditions with guided-mode navigation.
    if (initialSurveyType === 'x-user') return;

    if (!detail.postID) return;

    let tweetID = detail.postID;
    let tweetOwner = detail.userID;
    let postSurveyType = detail.surveyType || 'x-post';

    let containerName = 'surveyFormContainer-' + tweetID;
    let surveyContainer = document.getElementById(containerName);
    let injectNode = surveyContainer ? surveyContainer.parentNode : null;

    let urlsToDownload = [];
    if (window.__socialAnnotate__ && window.__socialAnnotate__.twitterApiMediaMap && window.__socialAnnotate__.twitterApiMediaMap[tweetID]) {
        urlsToDownload = window.__socialAnnotate__.twitterApiMediaMap[tweetID];
    } else {
        if (injectNode) {
            urlsToDownload = extractTweetMedia(injectNode);
        }
    }

    if (urlsToDownload && urlsToDownload.length > 0) {
        urlsToDownload = urlsToDownload.filter(u => !u.startsWith('blob:') && !u.startsWith('[Video Thumbnail]'));
        if (urlsToDownload.length > 0) {
            chrome.runtime.sendMessage({ action: 'downloadMedia', urls: urlsToDownload, userId: tweetOwner || 'user', postId: tweetID, surveyType: postSurveyType });
        } else {
            console.log("No original media URLs found. Wait for the API to load or check the post.");
        }
    } else {
        console.log("No media found on this post.");
    }
});

function processArticleNode(articleNode) {
    let insertElement = articleNode.parentNode;
    if (insertElement && insertElement.getElementsByClassName('survey-container-tweet').length === 0) {
        let tweetDetails = extractTweetDetails(insertElement);

        if (tweetDetails) {
            injectTwitterTweetSurvey(insertElement, tweetDetails.tweetID, tweetDetails.tweetOwner);
            availableContextsTwitter[1].renderSurvey(
                tweetDetails.tweetOwner,
                tweetDetails.tweetID,
                {
                    body: () => extractTweetTextContent(insertElement),
                    media_urls: () => extractTweetMedia(insertElement),
                    post_metrics: () => extractTweetMetrics(insertElement),
                    created_at: () => { let t = insertElement.querySelector(SEL.postTimestamp || 'time'); return t ? (t.getAttribute('datetime') || t.dateTime || null) : null; }
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
                    if (node.nodeType === 1) { // ELEMENT_NODE
                        if (node.getAttribute('role') === 'article') {
                            processArticleNode(node);
                        } else {
                            let articles = node.querySelectorAll(SEL.postContainer || 'article[role="article"]');
                            articles.forEach(processArticleNode);
                        }
                    }
                });
            } else if (mutation.type === 'attributes') {
                if (mutation.target.getAttribute('role') === "article") {
                    processArticleNode(mutation.target);
                }
            }
        }
    };
    return new MutationObserver(observerCallback);
}


function crawlUserName() {
    let currentURL = window.location.href;
    // Handle file:// URLs for local testing
    if (window.location.protocol === 'file:') {
        // Try to extract from page DOM instead
        let handle = document.querySelector(SEL.userHandle || '[data-testid="UserName"] a[href] span');
        if (handle) {
            let text = handle.textContent.trim().replace(/^@/, '');
            if (text) return text;
        }
        return 'local-test-user';
    }
    let temp = currentURL.split('.com/');
    temp = temp[temp.length - 1];
    temp = temp.split('/')[0].split('?')[0];
    return temp;
}

/**
 * Extract the profile avatar URL from the current page.
 * X/Twitter has changed their DOM structure multiple times, so this function
 * tries multiple strategies in order of reliability.
 *
 * All selectors come from SEL (populated from selectors.json) so that
 * selector_agent.py can update them dynamically without code changes.
 */
function getProfileAvatarUrl() {
    // Strategy 1: JSON-LD structured data (most reliable source)
    // X injects a <script type="application/ld+json"> that always contains
    // the profile image URL at 400x400 resolution.
    try {
        let schemaSelector = SEL.userProfileSchema || 'script[data-testid="UserProfileSchema-test"]';
        let schemaEl = document.querySelector(schemaSelector);
        if (schemaEl) {
            let schema = JSON.parse(schemaEl.textContent);
            let imageUrl = schema?.mainEntity?.image?.contentUrl;
            if (imageUrl) return imageUrl;
            let thumbUrl = schema?.mainEntity?.image?.thumbnailUrl;
            if (thumbUrl) return thumbUrl;
        }
    } catch (e) { /* JSON parse failed, continue to next strategy */ }

    // Strategy 2: Avatar container element (SEL.userProfileAvatar)
    // This may be a direct img selector or a container; handle both.
    let avatarSelector = SEL.userProfileAvatar || '[data-testid^="UserAvatar-Container-"]';
    let avatarContainer = document.querySelector(avatarSelector);
    if (avatarContainer) {
        // If the selector matched an <img> directly, return its src
        if (avatarContainer.tagName === 'IMG' && avatarContainer.src) return avatarContainer.src;
        // Otherwise search inside the container
        let img = avatarContainer.querySelector('img[src*="profile_images"]');
        if (img && img.src) return img.src;
        let anyImg = avatarContainer.querySelector('img[src*="pbs.twimg.com"]');
        if (anyImg && anyImg.src) return anyImg.src;
    }

    // Strategy 3: Legacy fallback — [data-testid="UserAvatar"]
    let legacyContainer = document.querySelector('[data-testid="UserAvatar"]');
    if (legacyContainer) {
        let img = legacyContainer.querySelector('img[src*="profile_images"]');
        if (img && img.src) return img.src;
        let anyImg = legacyContainer.querySelector('img[src*="pbs.twimg.com"]');
        if (anyImg && anyImg.src) return anyImg.src;
    }

    // Strategy 4: background-image CSS on avatar container divs
    let containers = document.querySelectorAll(avatarSelector + ', [data-testid="UserAvatar"]');
    for (let container of containers) {
        let allDivs = container.querySelectorAll('div');
        for (let div of allDivs) {
            let bg = window.getComputedStyle(div).backgroundImage;
            if (bg && bg !== 'none' && bg.includes('profile_images')) {
                let match = bg.match(/url\(["']?(.*?)["']?\)/);
                if (match && match[1]) return match[1];
            }
        }
    }

    // Strategy 5: Page-wide fallback — any img with profile_images not inside tweets
    let allProfileImgs = document.querySelectorAll('img[src*="profile_images"]');
    for (let img of allProfileImgs) {
        let tweetAvatar = img.closest('[data-testid="Tweet-User-Avatar"]');
        if (!tweetAvatar && img.src) return img.src;
    }

    return null;
}

function extractUserProfile() {
    let profile = {};

    // Display name
    try {
        let nameEl = document.querySelector(SEL.userDisplayName || '[data-testid="UserName"]');
        if (nameEl) {
            // The first text-containing span is the display name
            let spans = nameEl.querySelectorAll('span');
            for (let s of spans) {
                let text = s.textContent.trim();
                if (text && !text.startsWith('@')) {
                    profile.displayName = text;
                    break;
                }
            }
        }
    } catch (e) { /* skip */ }

    // Handle / @username
    try {
        let handleEl = document.querySelector(SEL.userHandle || '[data-testid="UserName"] a[href] span');
        if (handleEl) {
            profile.handle = handleEl.textContent.trim();
        }
    } catch (e) { /* skip */ }

    // Profile picture URL
    try {
        let avatarUrl = getProfileAvatarUrl();
        if (avatarUrl) {
            profile.avatarUrl = avatarUrl;
        }
    } catch (e) { /* skip */ }

    // Bio / description
    try {
        let bioEl = document.querySelector(SEL.userBio || '[data-testid="UserDescription"]');
        if (bioEl) {
            profile.bio = bioEl.textContent.trim();
        }
    } catch (e) { /* skip */ }

    // Verified badge
    try {
        let verifiedEl = document.querySelector(SEL.userVerified || '[data-testid="icon-verified"]');
        profile.isVerified = !!verifiedEl;
    } catch (e) {
        profile.isVerified = false;
    }

    // Followers count
    try {
        let followersEl = document.querySelector(SEL.userFollowers || 'a[href$="/verified_followers"], a[href$="/followers"]');
        if (followersEl) {
            let text = followersEl.textContent.trim();
            profile.followersText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/);
            if (numMatch) profile.followersCount = numMatch[1];
        }
    } catch (e) { /* skip */ }

    // Following count
    try {
        let followingEl = document.querySelector(SEL.userFollowing || 'a[href$="/following"]');
        if (followingEl) {
            let text = followingEl.textContent.trim();
            profile.followingText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/);
            if (numMatch) profile.followingCount = numMatch[1];
        }
    } catch (e) { /* skip */ }

    // Location
    try {
        let locEl = document.querySelector(SEL.userLocation || '[data-testid="UserLocation"]');
        if (locEl) {
            profile.location = locEl.textContent.trim();
        }
    } catch (e) { /* skip */ }

    // Join date
    try {
        let joinEl = document.querySelector(SEL.userJoinDate || '[data-testid="UserJoinDate"]');
        if (joinEl) {
            profile.joinDate = joinEl.textContent.trim();
        }
    } catch (e) { /* skip */ }

    // Website URL
    try {
        let urlEl = document.querySelector(SEL.userUrl || '[data-testid="UserUrl"]');
        if (urlEl) {
            let link = urlEl.querySelector('a');
            profile.websiteUrl = link ? link.href : urlEl.textContent.trim();
        }
    } catch (e) { /* skip */ }

    return profile;
}


function injectTwitterUserSurvey(injectElement, userID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-user";
    surveyContainer.setAttribute("id", "surveyFormContainer");
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/x/inject.css");
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    // Inject the survey before the react root.
    let fixedBar = document.querySelector(SEL.appRoot || '#react-root');
    if (fixedBar) {
        fixedBar.insertAdjacentElement('beforebegin', surveyContainer);
    }
}

function enableTweetObserver(injectElement) {
    document.querySelectorAll(SEL.postContainer || 'article[role="article"]').forEach(processArticleNode);
    if (reactRoot && observer) {
        observer.observe(reactRoot, obsConfig);
    }
}

function extractTweetMedia(articleNode) {
    if (!articleNode) return "";
    let mediaUrls = [];

    let details = extractTweetDetails(articleNode);
    if (details && details.tweetID && window.__socialAnnotate__ && window.__socialAnnotate__.twitterApiMediaMap && window.__socialAnnotate__.twitterApiMediaMap[details.tweetID]) {
        return window.__socialAnnotate__.twitterApiMediaMap[details.tweetID];
    }

    // Extract standard high-res image sources
    let photos = articleNode.querySelectorAll(SEL.postImage || '[data-testid="tweetPhoto"] img');
    photos.forEach(img => {
        if (img.src) mediaUrls.push(img.src);
    });

    // Extract videos (attempt to grab raw MP4 source first, fallback to thumbnail if stream is encrypted blob)
    let videos = articleNode.querySelectorAll(SEL.postVideo || '[data-testid="videoPlayer"] video');
    videos.forEach(video => {
        let mp4Source = video.querySelector('source');
        if (mp4Source && mp4Source.src && !mp4Source.src.startsWith('blob:')) {
            mediaUrls.push(mp4Source.src);
        } else if (video.src && !video.src.startsWith('blob:')) {
            mediaUrls.push(video.src);
        } else if (video.poster) {
            mediaUrls.push("[Video Thumbnail] " + video.poster);
        }
    });

    return mediaUrls;
}

function extractTweetTextContent(articleNode) {
    let tweetTextParts = [];

    // Grab all tweet text blocks natively
    let textNodes = articleNode.querySelectorAll(SEL.postText || '[data-testid="tweetText"]');
    textNodes.forEach(node => {
        if (node.innerText) tweetTextParts.push(node.innerText.trim());
    });

    // Grab URLs from link previews instead of the bulky card text
    let cardNodes = articleNode.querySelectorAll(SEL.cardWrapper || '[data-testid="card.wrapper"]');
    cardNodes.forEach(node => {
        let linkNode = node.querySelector('a');
        if (linkNode && linkNode.href) {
            tweetTextParts.push(linkNode.href);
        }
    });

    return tweetTextParts.join('\n\n');
}

function extractTweetMetrics(articleNode) {
    let metrics = {
        like_count: null,
        share_count: null,
        comment_count: null,
        bookmark_count: null,
        view_count: null,
        quote_count: null
    };

    if (!articleNode) return metrics;

    const parseShortNumber = (str) => {
        if (!str) return 0;
        str = str.trim().replace(/,/g, '');
        if (str.match(/K/i)) return parseFloat(str) * 1000;
        if (str.match(/M/i)) return parseFloat(str) * 1000000;
        return parseInt(str, 10) || 0;
    };

    const isLikelyCssSelector = (value) => {
        if (!value || typeof value !== 'string') return false;
        // If it contains common CSS selector characters, treat it as a selector.
        return /[\s.#\[\]>:+~]/.test(value);
    };

    const findMetricElement = (selectorOrTestId) => {
        if (!selectorOrTestId) return null;

        if (isLikelyCssSelector(selectorOrTestId)) {
            return articleNode.querySelector(selectorOrTestId);
        }

        // Backward-compatible path for data-testid tokens (e.g. "reply", "retweet").
        return articleNode.querySelector(`[data-testid="${selectorOrTestId}"]`) ||
            articleNode.querySelector(`[data-testid="un${selectorOrTestId}"]`);
    };

    const extractFromAria = (selectorOrTestId) => {
        let el = findMetricElement(selectorOrTestId);
        if (el) {
            let aria = el.getAttribute('aria-label');
            if (aria) {
                let match = aria.match(/^([\d,\.]+[kmKM]?)\s+/i);
                if (match) return parseShortNumber(match[1]);
            }

            // Some older Twitter UIs encode counts in attributes.
            let attrCount = el.getAttribute('data-tweet-stat-count');
            if (attrCount) {
                return parseShortNumber(attrCount);
            }

            // Sometimes the count is in a nested child rather than the action root.
            let nestedCount = el.querySelector('[data-tweet-stat-count], .ProfileTweet-actionCountForPresentation, .icon-and-text');
            if (nestedCount) {
                let nestedAttr = nestedCount.getAttribute('data-tweet-stat-count');
                if (nestedAttr) return parseShortNumber(nestedAttr);
                return parseShortNumber(nestedCount.innerText);
            }

            return parseShortNumber(el.innerText);
        }
        return null;
    };

    metrics.comment_count = extractFromAria(SEL.metricsReply || 'reply');
    metrics.share_count = extractFromAria(SEL.metricsRepost || 'retweet');
    metrics.like_count = extractFromAria(SEL.metricsLike || 'like');
    metrics.bookmark_count = extractFromAria(SEL.metricsBookmark || 'bookmark');
    if (SEL.metricsQuote) metrics.quote_count = extractFromAria(SEL.metricsQuote);

    // Attempt to grab views from the analytics label
    let viewsWord = SEL.metricsViewsPattern || 'views?';
    let viewsRegex = new RegExp('(?:^|\\s)([\\d,\\.]+[kmKM]?)\\s*' + viewsWord + '(?:$|\\s|\\.)', 'i');

    let viewEls = Array.from(articleNode.querySelectorAll('[aria-label]'));
    let viewEl = viewEls.find(el => {
        let label = el.getAttribute('aria-label') || '';
        if (viewsRegex.test(label)) return true;
        if (label.toLowerCase().includes('view post analytics') && el.innerText.trim().match(/^[\d,\.]+[kmKM]?$/)) return true;
        return false;
    });

    if (viewEl) {
        let aria = viewEl.getAttribute('aria-label') || '';
        let match = aria.match(viewsRegex);
        if (match) {
            metrics.view_count = parseShortNumber(match[1]);
        } else {
            metrics.view_count = parseShortNumber(viewEl.innerText);
        }
    }

    return metrics;
}

function extractTweetDetails(articleNode) {
    let timeElement = articleNode.querySelector(SEL.postTimestamp || "time");
    if (!timeElement || !timeElement.parentNode || !timeElement.parentNode.href) {
        return null; // Ignore ads, sponsored posts, or unrendered skeleton nodes.
    }

    let href = timeElement.parentNode.href;

    // Prefer explicit status URL parsing, including archive-wrapped links.
    // Examples handled:
    // - https://twitter.com/user/status/1234567890
    // - https://x.com/user/status/1234567890
    // - https://web.archive.org/.../https://twitter.com/user/status/1234567890
    let statusMatch = href.match(/(?:https?:\/\/)?(?:x|twitter)\.com\/([^\/?#]+)\/status\/(\d+)/i);
    if (statusMatch) {
        return {
            tweetOwner: statusMatch[1],
            tweetID: statusMatch[2]
        };
    }

    // Fallback: extract from any /status/<digits> fragment.
    let idMatch = href.match(/\/status\/(\d+)/i);
    if (idMatch) {
        let owner = 'unknown';
        let ownerMatch = href.match(/(?:x|twitter)\.com\/([^\/?#]+)\//i);
        if (ownerMatch) owner = ownerMatch[1];
        return {
            tweetOwner: owner,
            tweetID: idMatch[1]
        };
    }

    return null;
}

function injectTwitterTweetSurvey(injectNode, tweetID, tweetOwner) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-tweet";
    let containerName = "surveyFormContainer-" + tweetID;
    surveyContainer.setAttribute("id", containerName);
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/x/inject.css");

    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    injectNode.insertAdjacentElement('afterbegin', surveyContainer);
}

function checkUserURL() {
    // On local file:// URLs (saved HTML testing), always allow injection
    if (window.location.protocol === 'file:') return true;
    // Content script won't be loaded if not on Twitter, so we only need to exclude
    // the home/root page. Settings are excluded via manifest.
    let uname = crawlUserName();
    return !(uname === '' || uname === 'home');
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'isGuided', 'selectors'], function (result) {

        // Load selectors into the module-level variable
        const _rawX = (result.selectors && result.selectors.x) ? result.selectors.x : {};
        SEL = { ...(_rawX.shared || {}), ...(_rawX.account || {}), ...(_rawX.post || {}) };

        // Initialize observer infrastructure now that selectors are available
        reactRoot = document.querySelector(SEL.appRoot || '#react-root');
        obsConfig = SEL.observerFilter || { attributes: true, childList: true, subtree: true, attributeFilter: ['role'] };
        observer = createObserver();

        // Auto-Start Guided Mode: skip on local files (testing mode)
        let isLocalFile = window.location.protocol === 'file:';
        let isBasePlatform = window.location.pathname === '/' || window.location.pathname.startsWith('/home');
        if (!isLocalFile && result.isEnabled && result.isGuided && result.activeTargetList && result.activeTargetList.length > 0 && isBasePlatform) {
            let firstTarget = result.activeTargetList[0];
            let platformURL = window.location.hostname.includes("x.com") ? "https://x.com/" : "https://twitter.com/";
            let activeSurvey = result.config.activeSurveys && result.config.activeSurveys.length > 0 ? result.config.activeSurveys[0] : null;

            if (activeSurvey === 'x-post') {
                window.location.href = platformURL + 'i/web/status/' + firstTarget;
                return;
            } else if (activeSurvey === 'x-user') {
                window.location.href = platformURL + firstTarget;
                return;
            }
        }

        const currentPlatform = 'x';
        for (let index = 0; index < availableContextsTwitter.length; ++index) {
            let currentContext = availableContextsTwitter[index];
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
                            // IMPORTANT: Capture media URLs synchronously BEFORE storeResults,
                            // because storeResults triggers guided-mode navigation which
                            // changes the page and invalidates the DOM elements.
                            let capturedAvatarUrl = null;
                            let capturedBannerUrl = null;
                            let rawAvatarUrl = getProfileAvatarUrl();
                            if (rawAvatarUrl) {
                                capturedAvatarUrl = rawAvatarUrl.replace('_normal', '').replace('_bigger', '').replace('_mini', '').replace('_200x200', '_400x400').replace('_reasonably_small', '_400x400');
                            }
                            let bannerEl = document.querySelector(SEL.userBanner || 'img[src*="profile_banners"]');
                            if (bannerEl && bannerEl.src) {
                                capturedBannerUrl = bannerEl.src;
                            }
                            let capturedUserID = values.account_id;
                            let capturedSurveyType = currentContext.name;

                            // Send download messages BEFORE storeResults to avoid the navigation race.
                            chrome.storage.local.get(['isProfileDownloadEnabled', 'isBannerDownloadEnabled'], function (res) {
                                if (res.isProfileDownloadEnabled && capturedAvatarUrl) {
                                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [capturedAvatarUrl], userId: capturedUserID || 'user', postId: 'profile', surveyType: capturedSurveyType });
                                }
                                if (res.isBannerDownloadEnabled && capturedBannerUrl) {
                                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [capturedBannerUrl], userId: capturedUserID || 'user', postId: 'banner', surveyType: capturedSurveyType });
                                }
                            });
                        } else {
                            chrome.storage.local.get(['isMediaDownloadEnabled'], function (res) {
                                if (res.isMediaDownloadEnabled) {
                                    let evt = new CustomEvent('mh:download-request', { detail: { postID: values.post_id, userID: values.account_id, surveyType: currentContext.name } });
                                    window.dispatchEvent(evt);
                                }
                            });
                        }

                        // Call storeResults AFTER capturing media URLs.
                        // This is safe because storeResults is also async internally.
                        storeResults(values, currentPlatform);
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.theme = config.theme || "dark";
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);

                if (currentContext.name !== 'x-post') {
                    let surveyID = crawlUserName();
                    currentContext.renderSurvey(surveyID, null, {
                        user_profile: () => extractUserProfile()
                    });
                }
            }
        }
    });
}

// Fire the survey initializer on script load
initializeSurveys();
