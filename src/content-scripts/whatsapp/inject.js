// Context class is defined in shared.js
const availableContextsWhatsApp = [
    new Context('whatsapp-post', enableWhatsAppObserver, null)
];

let SEL_WA = {};
let waMessagesRoot = null;
let waObserver = null;
let waObserverConfig = { attributes: false, childList: true, subtree: true };

// WhatsApp opens videos in a fullscreen modal which removes the <video> tag from the message node.
// We observe the document for any <video> tags to capture their blob URLs when they play.
let recentVideoUrls = new Set();
const videoModalObserver = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        if (mutation.addedNodes) {
            mutation.addedNodes.forEach(node => {
                if (node.nodeName === 'VIDEO' && node.src && node.src.startsWith('blob:')) {
                    recentVideoUrls.add(node.src);
                } else if (node.querySelectorAll) {
                    node.querySelectorAll('video').forEach(v => {
                        if (v.src && v.src.startsWith('blob:')) {
                            recentVideoUrls.add(v.src);
                        }
                    });
                }
            });
        }
    });
});
// Start observing as soon as the script loads
if (document.documentElement) {
    videoModalObserver.observe(document.documentElement, { childList: true, subtree: true });
}


window.addEventListener('mh:download-request', async function (e) {
    let detail = e.detail;
    if (!detail) return;
    if (!detail.postID) return;

    let postID = detail.postID;
    let userID = detail.userID;
    let surveyType = detail.surveyType || 'whatsapp-post';

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



function parseUserFromPrePlainText(prePlainText) {
    if (!prePlainText) return null;
    const match = prePlainText.match(/\]\s([^:]+):\s*$/);
    return match ? match[1].trim() : null;
}

function extractMessageText(messageNode) {
    const textNodes = messageNode.querySelectorAll(SEL_WA.messageText || "[data-testid='selectable-text']");
    const chunks = [];
    textNodes.forEach(node => {
        const text = (node.textContent || '').trim();
        if (text) chunks.push(text);
    });
    return chunks.join('\n');
}

function extractMessageMedia(messageNode) {
    const mediaUrls = [];

    const imageSelector = SEL_WA.mediaImage || 'img[src]';
    messageNode.querySelectorAll(imageSelector).forEach(img => {
        const src = img.getAttribute('src') || '';
        if (!src) return;
        if (src.startsWith('data:')) return;
        mediaUrls.push(src);
    });

    let isVideoPost = false;
    const videoSelector = SEL_WA.mediaVideo || 'video, video source, [data-testid="video-content"] [style*="background-image"], [data-testid="msg-video"] [style*="background-image"]';
    messageNode.querySelectorAll(videoSelector).forEach(videoLike => {
        isVideoPost = true;
        let src = videoLike.getAttribute('src') || '';
        
        if (!src && videoLike.style && videoLike.style.backgroundImage) {
            let bg = videoLike.style.backgroundImage;
            let match = bg.match(/url\(['"]?(.*?)['"]?\)/);
            if (match) src = match[1];
        }

        if (!src) return;
        // Skip data: URLs if they are small (e.g., icons/emojis), but allow large base64 thumbnails
        if (src.startsWith('data:') && src.length < 1000) return;
        
        mediaUrls.push(src);
    });

    // If this is a video post, attach any recently played video blob URLs that were opened in the zoom modal
    if (isVideoPost && recentVideoUrls.size > 0) {
        recentVideoUrls.forEach(url => mediaUrls.push(url));
        recentVideoUrls.clear(); // Clear after consuming to prevent attaching to subsequent unrelated posts
    }

    return Array.from(new Set(mediaUrls));
}

function extractMessageDetails(messageNode) {
    if (!messageNode) return null;

    const dataTestId = messageNode.getAttribute('data-testid') || '';
    let postID = dataTestId.startsWith('conv-msg-') ? dataTestId.replace('conv-msg-', '') : null;
    if (!postID) {
        postID = messageNode.getAttribute('data-id') || null;
    }
    if (!postID) return null;

    const copyable = messageNode.querySelector(SEL_WA.copyableText || '.copyable-text[data-pre-plain-text]');
    const prePlainText = copyable ? (copyable.getAttribute('data-pre-plain-text') || '') : '';

    let userID = parseUserFromPrePlainText(prePlainText);
    if (!userID) {
        const senderLabel = messageNode.querySelector('span[aria-label$=":"]');
        if (senderLabel) {
            userID = (senderLabel.getAttribute('aria-label') || '').replace(/:$/, '').trim();
        }
    }

    return {
        postID,
        userID: userID || 'unknown'
    };
}

function injectWhatsAppPostSurvey(messageNode, postID) {
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

    const messageContainerSelector = SEL_WA.messageContainer || "[data-testid='msg-container']";
    const hasMessageBody = messageNode.querySelector(messageContainerSelector);
    if (!hasMessageBody) return;

    const details = extractMessageDetails(messageNode);
    if (!details) return;

    const existingContainer = document.getElementById('surveyFormContainer-' + details.postID);
    if (!existingContainer) {
        injectWhatsAppPostSurvey(messageNode, details.postID);
    }

    availableContextsWhatsApp[0].renderSurvey(
        details.userID,
        details.postID,
        {
            tweetContent: () => extractMessageText(messageNode),
            mediaUrls: () => extractMessageMedia(messageNode)
        }
    );
}

function createWhatsAppObserver() {
    return new MutationObserver((mutationsList) => {
        for (let mutation of mutationsList) {
            if (mutation.type !== 'childList') continue;
            mutation.addedNodes.forEach(node => {
                if (!node || node.nodeType !== 1) return;

                const postSelector = SEL_WA.postContainer || "[data-testid^='conv-msg-']";
                if (node.matches && node.matches(postSelector)) {
                    processMessageNode(node);
                }

                const nestedMessages = node.querySelectorAll ? node.querySelectorAll(postSelector) : [];
                nestedMessages.forEach(processMessageNode);
            });
        }
    });
}

function enableWhatsAppObserver() {
    const postSelector = SEL_WA.postContainer || "[data-testid^='conv-msg-']";
    document.querySelectorAll(postSelector).forEach(processMessageNode);

    if (waMessagesRoot && waObserver) {
        waObserver.observe(waMessagesRoot, waObserverConfig);
    }
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'selectors'], function (result) {
        SEL_WA = (result.selectors && result.selectors.whatsapp) ? result.selectors.whatsapp : {};

        waMessagesRoot = document.querySelector(SEL_WA.conversationMessages || "[data-testid='conversation-panel-messages']") || document.body;
        waObserverConfig = SEL_WA.observerFilter || { attributes: false, childList: true, subtree: true };
        waObserver = createWhatsAppObserver();

        const currentPlatform = 'whatsapp';

        for (let i = 0; i < availableContextsWhatsApp.length; ++i) {
            const currentContext = availableContextsWhatsApp[i];
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
