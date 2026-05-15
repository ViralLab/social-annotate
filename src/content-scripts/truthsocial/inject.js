const availableContextsTruthSocial = [new Context('truthsocial-post', enablePostObserver, null)];

let SEL_TS = {};
let tsRoot = null;
let obsConfigTS = {};
let observerTS = null;

window.addEventListener('mh:download-request', function(e) {
    let detail = e.detail;
    if (!detail) return;
    
    let initialSurveyType = detail.surveyType || 'truthsocial-post';
    if (!detail.postID) return;
    
    let postID = detail.postID;
    let postOwner = detail.userID;
    let postSurveyType = detail.surveyType || 'truthsocial-post';
    
    let containerName = 'surveyFormContainer-' + postID;
    let surveyContainer = document.getElementById(containerName);
    let injectNode = surveyContainer ? (surveyContainer.closest(SEL_TS.postContainer || '[data-testid="status"]') || surveyContainer.parentNode) : null;
    
    let urlsToDownload = [];
    if (injectNode) {
        urlsToDownload = extractPostMedia(injectNode);
    }
    
    if (urlsToDownload && urlsToDownload.length > 0) {
        chrome.runtime.sendMessage({ action: 'downloadMedia', urls: urlsToDownload, userId: postOwner || 'user', postId: postID, surveyType: postSurveyType });
    } else {
        console.log("No media found on this post.");
    }
});

function processPostNode(postNode) {
    let insertElement = postNode;
    if (insertElement && insertElement.getElementsByClassName('survey-container-post').length === 0) {
        let postDetails = extractPostDetails(postNode);

        if (postDetails && postDetails.postID) {
            injectTruthSocialPostSurvey(insertElement, postDetails.postID);
            availableContextsTruthSocial[0].renderSurvey(
                postDetails.postOwner,
                postDetails.postID,
                {
                    tweetContent: () => extractPostTextContent(postNode),
                    mediaUrls: () => extractPostMedia(postNode),
                    tweetMetrics: () => extractPostMetrics(postNode)
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
}

function extractPostMedia(postNode) {
    if (!postNode) return [];
    let mediaUrls = [];

    let photos = postNode.querySelectorAll(SEL_TS.postImage || 'img');
    photos.forEach(img => {
        if (img.src && !img.src.includes('avatar') && !img.src.includes('icon') && !img.src.includes('missing.png')) {
            mediaUrls.push(img.src);
        }
    });

    let videos = postNode.querySelectorAll(SEL_TS.videoPlayer || 'video');
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
    let metrics = { replies: 0, reposts: 0, likes: 0, quotes: 0 };
    
    const parseShortNumber = (str) => {
        if (!str) return 0;
        str = str.trim().replace(/,/g, '');
        if (str.match(/k/i)) return Math.round(parseFloat(str) * 1000);
        if (str.match(/m/i)) return Math.round(parseFloat(str) * 1000000);
        return parseInt(str, 10) || 0;
    };

    let replyBtn = postNode.querySelector('button[aria-label="Reply"], button[aria-label="Replies"]');
    if (replyBtn && replyBtn.innerText) metrics.replies = parseShortNumber(replyBtn.innerText);

    let retruthBtn = postNode.querySelector('button[aria-label="ReTruth"], button[aria-label="ReTruths"]');
    if (retruthBtn && retruthBtn.innerText) metrics.reposts = parseShortNumber(retruthBtn.innerText);

    let likeBtn = postNode.querySelector('button[aria-label="Like"], button[aria-label="Likes"]');
    if (likeBtn && likeBtn.innerText) metrics.likes = parseShortNumber(likeBtn.innerText);

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
        SEL_TS = (result.selectors && result.selectors.truthsocial) ? result.selectors.truthsocial : {};

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
                        storeResults(values, currentPlatform);

                        chrome.storage.local.get(['isMediaDownloadEnabled'], function(res) {
                            if (res.isMediaDownloadEnabled) {
                                let evt = new CustomEvent('mh:download-request', { detail: { postID: values.postID, userID: values.userID, surveyType: currentContext.name } });
                                window.dispatchEvent(evt);
                            }
                        });
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.theme = config.theme || "dark";
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);
            }
        }
    });
}

initializeSurveys();
