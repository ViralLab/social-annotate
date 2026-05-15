// Context class is defined in shared.js
const availableContextsTelegram = [
    new Context('telegram-post', enableTelegramObserver, null)
];

let SEL_TG = {};
let tgMessagesRoot = null;
let tgObserver = null;
let tgObserverConfig = { attributes: false, childList: true, subtree: true };

window.addEventListener('mh:download-request', async function (e) {
    let detail = e.detail;
    if (!detail) return;
    if (!detail.postID) return;

    let postID = detail.postID;
    let userID = detail.userID;
    let surveyType = detail.surveyType || 'telegram-post';

    let containerName = 'surveyFormContainer-' + postID;
    let surveyContainer = document.getElementById(containerName);
    let messageNode = surveyContainer ? surveyContainer.nextElementSibling : null;

    let urlsToDownload = [];
    if (messageNode) {
        urlsToDownload = extractMessageMedia(messageNode);
    }

    if (urlsToDownload && urlsToDownload.length > 0) {
        let finalUrls = [];
        for (let url of urlsToDownload) {
            if (url.startsWith('blob:')) {
                try {
                    let response = await fetch(url);
                    let blob = await response.blob();
                    let dataUrl = await new Promise((resolve, reject) => {
                        let reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    finalUrls.push(dataUrl);
                } catch (err) {
                    console.error("Failed to fetch blob URL:", err);
                    finalUrls.push(url);
                }
            } else {
                finalUrls.push(url);
            }
        }
        chrome.runtime.sendMessage({ action: 'downloadMedia', urls: finalUrls, userId: userID || 'user', postId: postID, surveyType: surveyType });
    } else {
        console.log("No media found on this post.");
    }
});

function extractMessageText(messageNode) {
    const textNodes = messageNode.querySelectorAll(SEL_TG.messageText || ".text-content");
    const chunks = [];
    textNodes.forEach(node => {
        const text = (node.textContent || '').trim();
        if (text) chunks.push(text);
    });
    return chunks.join('\n');
}

function extractMessageMedia(messageNode) {
    const mediaUrls = [];

    const imageSelector = SEL_TG.mediaImage || 'img.media-photo, img.full-media, canvas.thumbnail.shown';
    messageNode.querySelectorAll(imageSelector).forEach(el => {
        if (el.tagName.toLowerCase() === 'canvas') {
            try {
                let dataUrl = el.toDataURL('image/png');
                if (dataUrl && dataUrl.length > 1000) {
                    mediaUrls.push(dataUrl);
                }
            } catch (err) {
                console.error("Failed to extract dataURL from canvas:", err);
            }
        } else {
            const src = el.getAttribute('src') || '';
            if (!src) return;
            if (src.startsWith('data:')) return;
            mediaUrls.push(src);
        }
    });

    const videoSelector = SEL_TG.mediaVideo || 'video.full-media, video';
    messageNode.querySelectorAll(videoSelector).forEach(videoLike => {
        let src = videoLike.getAttribute('src') || '';
        if (!src) return;
        // Skip data: URLs if they are small (e.g., icons/emojis), but allow large base64 thumbnails
        if (src.startsWith('data:') && src.length < 1000) return;
        
        mediaUrls.push(src);
    });

    return Array.from(new Set(mediaUrls));
}

function extractMessageDetails(messageNode) {
    if (!messageNode) return null;

    let postID = messageNode.getAttribute('data-message-id') || null;
    if (!postID) return null;

    let userID = 'unknown';
    const nameNode = messageNode.querySelector(SEL_TG.userDisplayName || '.fullName');
    if (nameNode) {
        userID = nameNode.textContent.trim();
    } else {
        const headerName = document.querySelector('.MiddleHeader .fullName, .ChatInfo .fullName, .Header .fullName');
        if (headerName) {
            userID = headerName.textContent.trim();
        } else {
            userID = 'User';
        }
    }

    let timestamp = '';
    let timeNode = messageNode.querySelector(SEL_TG.postTimestamp || '.message-time');
    if (timeNode) {
        timestamp = timeNode.innerText || timeNode.textContent || '';
    }

    return {
        postID,
        userID: userID,
        postAuthorTime: timestamp
    };
}

function injectTelegramPostSurvey(messageNode, postID) {
    const containerId = 'surveyFormContainer-' + postID;
    if (document.getElementById(containerId)) return null;

    const surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-post';
    surveyContainer.setAttribute('id', containerId);

    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });
    const cssUrl = chrome.runtime.getURL('content-scripts/bluesky/inject.css');
    shadowRoot.innerHTML = `
        <iframe class="surveyIframe" src="${chrome.runtime.getURL('sandbox/survey.html')}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>
    `;

    // Insert right before the message node so the form appears above the post.
    messageNode.insertAdjacentElement('beforebegin', surveyContainer);
    return surveyContainer;
}

function processMessageNode(messageNode) {
    if (!messageNode || !messageNode.querySelector) return;

    const details = extractMessageDetails(messageNode);
    if (!details) return;

    const existingContainer = document.getElementById('surveyFormContainer-' + details.postID);
    if (!existingContainer) {
        injectTelegramPostSurvey(messageNode, details.postID);
    }

    availableContextsTelegram[0].renderSurvey(
        details.userID,
        details.postID,
        {
            tweetContent: () => extractMessageText(messageNode),
            mediaUrls: () => extractMessageMedia(messageNode),
            postCreationTime: details.postAuthorTime
        }
    );
}

function createTelegramObserver() {
    return new MutationObserver((mutationsList) => {
        for (let mutation of mutationsList) {
            if (mutation.type !== 'childList') continue;
            mutation.addedNodes.forEach(node => {
                if (!node || node.nodeType !== 1) return;

                const postSelector = SEL_TG.postContainer || ".Message";
                if (node.matches && node.matches(postSelector)) {
                    processMessageNode(node);
                }

                const nestedMessages = node.querySelectorAll ? node.querySelectorAll(postSelector) : [];
                nestedMessages.forEach(processMessageNode);
            });
        }
    });
}

function enableTelegramObserver() {
    const postSelector = SEL_TG.postContainer || ".Message";
    document.querySelectorAll(postSelector).forEach(processMessageNode);

    if (tgMessagesRoot && tgObserver) {
        tgObserver.observe(tgMessagesRoot, tgObserverConfig);
    }
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'selectors'], function (result) {
        SEL_TG = (result.selectors && result.selectors.telegram) ? result.selectors.telegram : {};

        tgMessagesRoot = document.querySelector(SEL_TG.conversationMessages || ".MessageList .messages-container") || document.body;
        tgObserverConfig = SEL_TG.observerFilter || { attributes: false, childList: true, subtree: true };
        tgObserver = createTelegramObserver();

        const currentPlatform = 'telegram';

        for (let i = 0; i < availableContextsTelegram.length; ++i) {
            const currentContext = availableContextsTelegram[i];
            if (!currentContext.name.includes(currentPlatform)) continue;

            const contextFlag = result.config.activeSurveys.includes(currentContext.name);
            const auxFlag = currentContext.auxiliaryCheck();

            if (result.isEnabled === true && contextFlag === true && auxFlag === true) {
                const activeSurvey = currentContext.name;
                const config = result.config.surveys[activeSurvey];
                const studyID = config.studyID;

                function submitAction(errors, values) {
                    if (!errors) {
                        values.surveyType = currentContext.name;
                        values.studyID = studyID;

                        chrome.storage.local.get(['isMediaDownloadEnabled'], function (res) {
                            if (res.isMediaDownloadEnabled) {
                                let evt = new CustomEvent('mh:download-request', { detail: { postID: values.postID, userID: values.userID, surveyType: currentContext.name } });
                                window.dispatchEvent(evt);
                            }
                        });

                        storeResults(values, currentPlatform);
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.theme = config.theme || 'dark';
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);
            }
        }
    });
}

initializeSurveys();
