
// Context class is defined in shared.js
const availableContextsTwitter = [new Context('twitter-user', injectTwitterUserSurvey, checkUserURL),
new Context('twitter-tweet', enableTweetObserver, null)];


// https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
// Select the node that will be observed for mutations
const reactRoot = document.getElementById('react-root');

// Options for the observer (which mutations to observe)
const obsConfig = { attributes: true, childList: true, subtree: true, attributeFilter: ['role'] };

function processArticleNode(articleNode) {
    let insertElement = articleNode.parentNode;
    if (insertElement && insertElement.getElementsByClassName('survey-container-tweet').length === 0) {
        let tweetDetails = extractTweetDetails(insertElement);

        if (tweetDetails) {
            injectTwitterTweetSurvey(insertElement, tweetDetails.tweetID);
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

// @TODO All this observer stuff needs to be platform-specific so instagram etc. can have their own.
const observerCallback = function (mutationsList, observer) {
    for (let mutation of mutationsList) {
        if (mutation.type === 'childList') {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) { // ELEMENT_NODE
                    if (node.getAttribute('role') === 'article') {
                        processArticleNode(node);
                    } else {
                        let articles = node.querySelectorAll('article[role="article"]');
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

// Create an observer instance linked to the callback function
const observer = new MutationObserver(observerCallback);


function crawlUserName() {
    let currentURL = window.location.href;
    let temp = currentURL.split('.com/');
    temp = temp[temp.length - 1];
    temp = temp.split('/')[0].split('?')[0];
    return temp;
}


function injectTwitterUserSurvey(injectElement, userID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-user";
    surveyContainer.setAttribute("id", "surveyFormContainer");
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/twitter/inject.css");
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    // Inject the survey before the react root.
    let fixedBar = document.getElementById('react-root');
    fixedBar.insertAdjacentElement('beforebegin', surveyContainer);
}

function enableTweetObserver(injectElement) {
    document.querySelectorAll('article[role="article"]').forEach(processArticleNode);
    observer.observe(reactRoot, obsConfig)
}

function extractTweetMedia(articleNode) {
    if (!articleNode) return "";
    let mediaUrls = [];

    // Extract standard high-res image sources
    let photos = articleNode.querySelectorAll('[data-testid="tweetPhoto"] img');
    photos.forEach(img => {
        if (img.src) mediaUrls.push(img.src);
    });

    // Extract videos (attempt to grab raw MP4 source first, fallback to thumbnail if stream is encrypted blob)
    let videos = articleNode.querySelectorAll('[data-testid="videoPlayer"] video');
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
    let textNodes = articleNode.querySelectorAll('[data-testid="tweetText"]');
    textNodes.forEach(node => {
        if (node.innerText) tweetTextParts.push(node.innerText.trim());
    });

    // Grab URLs from link previews instead of the bulky card text
    let cardNodes = articleNode.querySelectorAll('[data-testid="card.wrapper"]');
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

    metrics.replies = extractFromAria('reply');
    metrics.retweets = extractFromAria('retweet');
    metrics.likes = extractFromAria('like');
    metrics.bookmarks = extractFromAria('bookmark');

    // Attempt to grab views from the analytics label
    let viewEls = Array.from(articleNode.querySelectorAll('[aria-label]'));
    let viewEl = viewEls.find(el => {
        let label = el.getAttribute('aria-label') || '';
        if (/(?:^|\s)([\d,\.]+[kmKM]?)\s*views?(?:$|\s|\.)/i.test(label)) return true;
        if (label.toLowerCase().includes('view post analytics') && el.innerText.trim().match(/^[\d,\.]+[kmKM]?$/)) return true;
        return false;
    });

    if (viewEl) {
        let aria = viewEl.getAttribute('aria-label') || '';
        let match = aria.match(/(?:^|\s)([\d,\.]+[kmKM]?)\s*views?(?:$|\s|\.)/i);
        if (match) {
            metrics.views = parseShortNumber(match[1]);
        } else {
            metrics.views = parseShortNumber(viewEl.innerText);
        }
    }

    return metrics;
}

function extractTweetDetails(articleNode) {
    // There is only one <time> element per tweet article.
    let timeElement = articleNode.querySelector("time");
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

function injectTwitterTweetSurvey(injectNode, tweetID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-tweet";
    let containerName = "surveyFormContainer-" + tweetID;
    surveyContainer.setAttribute("id", containerName);
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/twitter/inject.css");
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    injectNode.insertAdjacentElement('afterbegin', surveyContainer);
}

function checkUserURL() {
    // Content script won't be loaded if not on Twitter, so we only need to exclude
    // the home/root page. Settings are excluded via manifest.
    let uname = crawlUserName();
    return !(uname === '' || uname === 'home');
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'isGuided'], function (result) {

        // Auto-Start Guided Mode: if we land on the bare platform URL and have targets waiting, navigate to the first one.
        let isBasePlatform = window.location.pathname === '/' || window.location.pathname.startsWith('/home');
        if (result.isEnabled && result.isGuided && result.activeTargetList && result.activeTargetList.length > 0 && isBasePlatform) {
            let firstTarget = result.activeTargetList[0];
            let platformURL = window.location.hostname.includes("x.com") ? "https://x.com/" : "https://twitter.com/";
            let activeSurvey = result.config.activeSurveys && result.config.activeSurveys.length > 0 ? result.config.activeSurveys[0] : null;

            if (activeSurvey === 'twitter-tweet') {
                window.location.href = platformURL + 'i/web/status/' + firstTarget;
                return;
            } else if (activeSurvey === 'twitter-user') {
                window.location.href = platformURL + firstTarget;
                return;
            }
        }

        const currentPlatform = 'twitter';
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
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);

                if (currentContext.name !== 'twitter-tweet') {
                    let surveyID = crawlUserName();
                    currentContext.renderSurvey(surveyID);
                }
            }
        }
    });
}

// Fire the survey initializer on script load
initializeSurveys();
