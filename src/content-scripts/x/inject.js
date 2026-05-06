
// Context class is defined in shared.js
const availableContextsTwitter = [new Context('x-user', injectTwitterUserSurvey, checkUserURL),
new Context('x-post', enableTweetObserver, null)];

// Selectors loaded from storage (populated by initializeSurveys)
let SEL = {};

// MutationObserver globals — initialized after selectors are loaded
let reactRoot = null;
let obsConfig = {};
let observer = null;

window.twitterApiMediaMap = {};
document.addEventListener('mh:media-response', function (e) {
    if (e.detail) {
        Object.assign(window.twitterApiMediaMap, e.detail);
    }
});

window.addEventListener('mh:download-request', function (e) {
    let detail = e.detail;
    if (!detail) return;

    let initialSurveyType = detail.surveyType || 'x-post';

    if (initialSurveyType === 'x-user') {
        let userID = detail.userID;
        chrome.storage.local.get(['isProfileDownloadEnabled', 'isBannerDownloadEnabled'], function(res) {
            if (res.isProfileDownloadEnabled) {
                let avatarEl = document.querySelector(SEL.userProfileAvatar || '[data-testid="UserAvatar"] img[src*="profile_images"]');
                if (avatarEl && avatarEl.src) {
                    let avatarUrl = avatarEl.src.replace('_normal', '').replace('_bigger', '').replace('_mini', '');
                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [avatarUrl], userId: userID || 'user', postId: 'profile', surveyType: initialSurveyType });
                }
            }
            if (res.isBannerDownloadEnabled) {
                let bannerEl = document.querySelector(SEL.userBanner || 'img[src*="profile_banners"]');
                if (bannerEl && bannerEl.src) {
                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [bannerEl.src], userId: userID || 'user', postId: 'banner', surveyType: initialSurveyType });
                }
            }
        });
        return;
    }

    if (!detail.postID) return;

    let tweetID = detail.postID;
    let tweetOwner = detail.userID;
    let postSurveyType = detail.surveyType || 'x-post';

    let containerName = 'surveyFormContainer-' + tweetID;
    let surveyContainer = document.getElementById(containerName);
    let injectNode = surveyContainer ? surveyContainer.parentNode : null;

    let urlsToDownload = [];
    if (window.twitterApiMediaMap && window.twitterApiMediaMap[tweetID]) {
        urlsToDownload = window.twitterApiMediaMap[tweetID];
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
            alert("No original media URLs found. Wait for the API to load or check the post.");
        }
    } else {
        alert("No media found on this post.");
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
                    tweetContent: () => extractTweetTextContent(insertElement),
                    mediaUrls: () => extractTweetMedia(insertElement),
                    tweetMetrics: () => extractTweetMetrics(insertElement)
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
                            let articles = node.querySelectorAll(SEL.tweetContainer || 'article[role="article"]');
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
        let avatarEl = document.querySelector(SEL.userAvatar || '[data-testid="UserAvatar"] img[src*="profile_images"]');
        if (avatarEl) {
            profile.avatarUrl = avatarEl.src;
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
    let fixedBar = document.querySelector(SEL.reactRoot || '#react-root');
    if (fixedBar) {
        fixedBar.insertAdjacentElement('beforebegin', surveyContainer);
    }
}

function enableTweetObserver(injectElement) {
    document.querySelectorAll(SEL.tweetContainer || 'article[role="article"]').forEach(processArticleNode);
    if (reactRoot && observer) {
        observer.observe(reactRoot, obsConfig);
    }
}

function extractTweetMedia(articleNode) {
    if (!articleNode) return "";
    let mediaUrls = [];

    let details = extractTweetDetails(articleNode);
    if (details && details.tweetID && window.twitterApiMediaMap && window.twitterApiMediaMap[details.tweetID]) {
        return window.twitterApiMediaMap[details.tweetID];
    }

    // Extract standard high-res image sources
    let photos = articleNode.querySelectorAll(SEL.tweetPhoto || '[data-testid="tweetPhoto"] img');
    photos.forEach(img => {
        if (img.src) mediaUrls.push(img.src);
    });

    // Extract videos (attempt to grab raw MP4 source first, fallback to thumbnail if stream is encrypted blob)
    let videos = articleNode.querySelectorAll(SEL.videoPlayer || '[data-testid="videoPlayer"] video');
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
    let textNodes = articleNode.querySelectorAll(SEL.tweetText || '[data-testid="tweetText"]');
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
        replies: 0,
        retweets: 0,
        likes: 0,
        views: 0,
        bookmarks: 0
    };

    if (!articleNode) return metrics;

    const parseShortNumber = (str) => {
        if (!str) return 0;
        str = str.trim().replace(/,/g, '');
        if (str.match(/K/i)) return parseFloat(str) * 1000;
        if (str.match(/M/i)) return parseFloat(str) * 1000000;
        return parseInt(str, 10) || 0;
    };

    const extractFromAria = (testId) => {
        let el = articleNode.querySelector(`[data-testid="${testId}"]`) || articleNode.querySelector(`[data-testid="un${testId}"]`);
        if (el) {
            let aria = el.getAttribute('aria-label');
            if (aria) {
                let match = aria.match(/^([\d,\.]+[kmKM]?)\s+/i);
                if (match) return parseShortNumber(match[1]);
            }
            return parseShortNumber(el.innerText);
        }
        return 0;
    };

    metrics.replies = extractFromAria(SEL.metricsReply || 'reply');
    metrics.retweets = extractFromAria(SEL.metricsRetweet || 'retweet');
    metrics.likes = extractFromAria(SEL.metricsLike || 'like');
    metrics.bookmarks = extractFromAria(SEL.metricsBookmark || 'bookmark');

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
            metrics.views = parseShortNumber(match[1]);
        } else {
            metrics.views = parseShortNumber(viewEl.innerText);
        }
    }

    return metrics;
}

function extractTweetDetails(articleNode) {
    let timeElement = articleNode.querySelector(SEL.tweetTimestamp || "time");
    if (!timeElement || !timeElement.parentNode || !timeElement.parentNode.href) {
        return null; // Ignore ads, sponsored posts, or unrendered skeleton nodes.
    }

    let tweetLink = timeElement.parentNode.href;
    tweetLink = tweetLink.split('/');

    return {
        tweetOwner: tweetLink[3],
        tweetID: tweetLink[tweetLink.length - 1]
    };
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
        SEL = (result.selectors && result.selectors.x) ? result.selectors.x : {};

        // Initialize observer infrastructure now that selectors are available
        reactRoot = document.querySelector(SEL.reactRoot || '#react-root');
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
                        storeResults(values, currentPlatform);

                        let isUserSurvey = currentContext.name.endsWith('-user');
                        if (isUserSurvey) {
                            chrome.storage.local.get(['isProfileDownloadEnabled', 'isBannerDownloadEnabled'], function(res) {
                                if (res.isProfileDownloadEnabled || res.isBannerDownloadEnabled) {
                                    let evt = new CustomEvent('mh:download-request', { detail: { userID: values.userID, surveyType: currentContext.name } });
                                    window.dispatchEvent(evt);
                                }
                            });
                        } else {
                            chrome.storage.local.get(['isMediaDownloadEnabled'], function(res) {
                                if (res.isMediaDownloadEnabled) {
                                    let evt = new CustomEvent('mh:download-request', { detail: { postID: values.postID, userID: values.userID, surveyType: currentContext.name } });
                                    window.dispatchEvent(evt);
                                }
                            });
                        }
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.theme = config.theme || "dark";
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);

                if (currentContext.name !== 'x-post') {
                    let surveyID = crawlUserName();
                    currentContext.renderSurvey(surveyID, null, {
                        userProfile: () => extractUserProfile()
                    });
                }
            }
        }
    });
}

// Fire the survey initializer on script load
initializeSurveys();
