// @TODO Check if this ID already exists in storage, and just update if it does (avoid duplicates).
// @TODO Might have an allow duplicates checkbox in the config, if there is a use case for it.
// Race conditions should not occur because events are called sequentially.

// Guard against calls after the extension has been reloaded (context invalidated).
function isExtensionContextValid() {
    try { return !!chrome.runtime.id; } catch(e) { return false; }
}
function getCurrentScreenName(platform) {
    if (platform === "x" || platform === "twitter") {
        let currentURL = window.location.href;
        let temp = currentURL.split('.com/');
        temp = temp[temp.length - 1];
        let screenName = temp.split('/')[0].split('?')[0];
        return screenName;
    } else if (platform === "bluesky") {
        let currentURL = window.location.href;
        let match = currentURL.match(/bsky\.app\/profile\/([^/?#]+)/);
        return match ? match[1] : '';
    } else {
        return 'Mahmut';
    }
}

const metadataSchemes = {
    "survey_init_timestamp": {
        "type": "number",
        "title": "Initial Timestamp",
        "default": 0
    },
    "account_id": {
        "type": "string",
        "title": "Account ID",
        "default": "hohe"
    },
    "post_id": {
        "type": "string",
        "title": "Post ID",
        "default": "hahi"
    }
};

const metadataForms = [
    {
        "key": "survey_init_timestamp",
        "type": "hidden",
        "activeClass": "btn-success"
    },
    {
        "key": "account_id",
        "type": "hidden",
        "activeClass": "btn-success"
    },
    {
        "key": "post_id",
        "type": "hidden",
        "activeClass": "btn-success"
    }
];

const notificationContainer = document.createElement("div");
notificationContainer.className = "notification-container";
notificationContainer.style.background = "transparent";
notificationContainer.style.textAlign = "center";
notificationContainer.style.padding = "10px 0";
notificationContainer.style.width = "100%";
notificationContainer.style.fontFamily = "-apple-system, BlinkMacSystemFont, sans-serif";

let defaultSpan = document.createElement("SPAN");
defaultSpan.style.display = "none";  // Default placeholder is invisible
notificationContainer.appendChild(defaultSpan);

const overwriteSpan = document.createElement("SPAN");
overwriteSpan.className = "label label-warning";
overwriteSpan.innerText = "Record already exists. New submissions will overwrite.";
overwriteSpan.style.color = "#FFD400";
overwriteSpan.style.fontWeight = "bold";
overwriteSpan.style.padding = "5px 15px";

const successSpan = document.createElement("SPAN");
successSpan.className = "label label-success";
successSpan.innerText = "Submission Successful!";
successSpan.style.color = "#00BA7C";
successSpan.style.fontWeight = "bold";
successSpan.style.padding = "5px 15px";


class Context {

    constructor(contextName, injectFunction, auxCheckFunction) {
        this.name = contextName;
        this.injectSurvey = injectFunction;
        if (auxCheckFunction !== null) {
            this.auxiliaryCheck = auxCheckFunction;
        } else {
            this.auxiliaryCheck = function () { return true; }
        }
        this.formTemplate = null;
        this.submitAction = null;
    }

    renderSurvey(userID, postID = null, extras = {}) {
        if (!isExtensionContextValid()) return;
        
        let formName = 'surveyFormContainer';
        if (postID != null) {
            formName = formName + '-' + postID.toString();
        }
        
        let wrapper = document.getElementById(formName);
        if (wrapper && wrapper.shadowRoot) {
            let iframe = wrapper.shadowRoot.querySelector('.surveyIframe');
            if (iframe) {
                iframe.addEventListener('load', () => {
                    iframe.dataset.loaded = 'true';
                });
            }
        }

        chrome.storage.local.get(['config'], (result) => {
            let freshTemplate = this.formTemplate;
            let freshTheme = this.theme || 'dark';
            
            if (!chrome.runtime.lastError && result && result.config && result.config.surveys && result.config.surveys[this.name]) {
                let config = result.config.surveys[this.name];
                if (config.surveyFormSchema) freshTemplate = config.surveyFormSchema;
                if (config.theme) freshTheme = config.theme;
            }
            this._doRenderSurvey(userID, postID, extras, freshTemplate, freshTheme);
        });
    }

    _doRenderSurvey(userID, postID, extras, freshTemplate, freshTheme) {
        // namespace per-extension to avoid global collisions
        if (!window.__socialAnnotate__) window.__socialAnnotate__ = {};
        if (!window.__socialAnnotate__.surveyContexts) window.__socialAnnotate__.surveyContexts = {};
        let callId = this.name + (postID ? '-' + postID : '');
        const token = Math.random().toString(36).slice(2);
        window.__socialAnnotate__.surveyContexts[callId] = { context: this, userID: userID, postID: postID, extras: extras, token: token };

        // Clone the form template so concurrent iframe loads don't accidentally share references to hidden defaults.
        if (!freshTemplate || !freshTemplate.schema) {
            console.warn('[SocialAnnotate] renderSurvey called before formTemplate was set for', this.name);
            return;
        }
        let templateCopy = JSON.parse(JSON.stringify(freshTemplate));

        // Attach metadata fields to the template schema.
        for (let key in metadataSchemes) {
            if (metadataSchemes.hasOwnProperty(key)) {
                templateCopy.schema[key] = metadataSchemes[key];
            }
        }
        let hasHidden = templateCopy.form.some(item => item.key === 'survey_init_timestamp');
        if (!hasHidden) {
            for (let item of metadataForms) {
                templateCopy.form.splice(templateCopy.form.length - 1, 0, item);
            }
        }
        // Fill in the metadata field defaults.
        templateCopy.schema["survey_init_timestamp"].default = Math.floor(Date.now() / 1000);
        templateCopy.schema["account_id"].default = userID;

        let formName = 'surveyFormContainer';
        if (postID != null) {
            templateCopy.schema["post_id"].default = postID;
            formName = formName + '-' + postID.toString()
        }

        let shadowRoot = document.getElementById(formName).shadowRoot;
        let iframe = shadowRoot.querySelector('.surveyIframe');

        // Set up global submit listener once; all survey contexts route through it.
        if (!window.__socialAnnotate__.listenerAdded) {
            // Sandbox pages are served from a different origin; validate using per-call token instead.
            window.addEventListener('message', function (event) {
                if (!event || !event.data) return;
                const data = event.data;
                const callId = data.callId;
                if (!callId) return;

                const ctxData = window.__socialAnnotate__.surveyContexts[callId];
                if (!ctxData || !ctxData.token) return;
                if (data.token !== ctxData.token) return; // token mismatch => ignore

                if (data.type === 'submit') {
                    if (ctxData && ctxData.context && ctxData.context.submitAction) {
                        data.values.account_id = ctxData.userID;
                        if (ctxData.postID !== null) data.values.post_id = ctxData.postID;
                        if (ctxData.extras) {
                            for (let k in ctxData.extras) {
                                if (typeof ctxData.extras[k] === 'function') {
                                    data.values[k] = ctxData.extras[k]();
                                } else {
                                    data.values[k] = ctxData.extras[k];
                                }
                            }
                        }
                        ctxData.context.submitAction(data.errors, data.values);
                    }
                } else if (data.type === 'downloadMedia') {
                    let evt = new CustomEvent('mh:download-request', { detail: { callId: callId, postID: ctxData.postID, userID: ctxData.userID, surveyType: ctxData.context.name } });
                    window.dispatchEvent(evt);
                } else if (data.type === 'resize') {
                    let formName = 'surveyFormContainer';
                    if (ctxData.postID != null) formName = formName + '-' + ctxData.postID;
                    let wrapper = document.getElementById(formName);
                    if (wrapper && wrapper.shadowRoot) {
                        let iframe = wrapper.shadowRoot.querySelector('.surveyIframe');
                        if (iframe) {
                            iframe.style.height = data.height + 'px';
                            wrapper.style.height = data.height + 'px';
                        }
                    }
                }
            });
            window.__socialAnnotate__.listenerAdded = true;
        }

        let sendRenderMsg = () => {
            const ctxToken = window.__socialAnnotate__.surveyContexts[callId].token;
            iframe.contentWindow.postMessage({
                type: 'render',
                cssUrl: iframe.getAttribute('data-css'),
                formTemplate: templateCopy,
                callId: callId,
                token: ctxToken,
                surveyType: this.name,
                theme: freshTheme,
                enableDownload: (this.name === 'x-post' || this.name === 'instagram-post' || this.name === 'bluesky-post' || this.name === 'whatsapp-post' || this.name === 'linkedin-post' || this.name === 'linkedin-user')
            }, '*');
        };

        // If the iframe's onload already fired while we were waiting for storage, send immediately.
        if (iframe.dataset.loaded === 'true') {
            sendRenderMsg();
        } else {
            // Otherwise wait for it
            iframe.addEventListener('load', sendRenderMsg);
        }

        // Insert notification container before iframe.
        let nc = notificationContainer.cloneNode(true);
        iframe.insertAdjacentElement('beforebegin', nc);

        let surveyType = this.name;
        // Check if this element has already been annotated, and warn if so.
        try {
            if (!isExtensionContextValid()) return;
            chrome.storage.local.get(['annotatedElements'], function (result) {
                let checkID = (postID === null ? userID : postID);
                let tracked = (result.annotatedElements && result.annotatedElements[surveyType]) ? result.annotatedElements[surveyType] : [];
                let entryIndex = tracked.indexOf(checkID);
                if (entryIndex !== -1) {
                    let os = overwriteSpan.cloneNode(true);
                    nc.replaceChild(os, nc.firstChild);
                }
            });
        } catch(e) { console.debug('[SocialAnnotate] Extension context invalidated, skipping annotatedElements check.'); }
    }

}

// @TODO: ideally, failure should be handled/retried on the background, overall failure handling is a bit lacking,
//          can use some further work.
const failureSpan = document.createElement('SPAN');
failureSpan.classList.add('notification-message-failure');
failureSpan.innerHTML = "Submission Failed. Please try again.";
failureSpan.style.color = "#F4212E";
failureSpan.style.fontWeight = "bold";
failureSpan.style.padding = "5px 15px";

function storeResults(surveyResults, socialMediaPlatform) {
    if (!isExtensionContextValid()) { console.debug('[SocialAnnotate] Extension context invalidated, skipping storeResults.'); return; }
    surveyResults.submission_timestamp = Math.floor(Date.now() / 1000);

    let apiSuccess = true;
    try {
        chrome.storage.local.get(['config'], function (result) {
            if (result && result.config && result.config.apiEndpoint) {
                apiSuccess = false;
                // Proxy POST via background to avoid no-cors issues and allow reporting
                chrome.runtime.sendMessage({ action: 'postApi', endpoint: result.config.apiEndpoint, body: surveyResults }, function (resp) {
                    if (resp && resp.ok) {
                        apiSuccess = true;
                    } else {
                        console.warn('[SocialAnnotate] API POST failed', resp);
                    }
                });
            }
        });
    } catch(e) { console.debug('[SocialAnnotate] Extension context invalidated during API call.'); }

    try {
        chrome.storage.local.get(['resultsArrays', 'annotatedElements', 'activeTargetList', 'isGuided', 'clientID'], function (result) {
            surveyResults.clientID = result.clientID;

            let resultsArrays = result.resultsArrays;
            let annotatedElements = result.annotatedElements;
            let activeTargetList = result.activeTargetList;
            let platformURL;

            // @TODO: store this in the config when adding more platforms.
            if (socialMediaPlatform == 'x' || socialMediaPlatform == 'twitter') {
                platformURL = window.location.hostname.includes("x.com") ? "https://x.com/" : "https://twitter.com/";
            } else if (socialMediaPlatform == 'instagram') {
                platformURL = "https://instagram.com/";
            } else if (socialMediaPlatform == 'bluesky') {
                platformURL = "https://bsky.app/";
            } else if (socialMediaPlatform == 'whatsapp') {
                platformURL = "https://web.whatsapp.com/";
            } else if (socialMediaPlatform == 'truthsocial') {
                platformURL = "https://truthsocial.com/";
            } else if (socialMediaPlatform == 'linkedin') {
                platformURL = "https://www.linkedin.com/";
            }

            let surveyType = surveyResults.surveyType;

            if (!resultsArrays[surveyType]) resultsArrays[surveyType] = [];
            if (!annotatedElements[surveyType]) annotatedElements[surveyType] = [];

            let insertKey = null;
            if (surveyType === 'x-user') {
                insertKey = surveyResults.account_id;
            } else if (surveyType === 'x-post') {
                insertKey = surveyResults.post_id;
            } else if (surveyType === 'instagram-user') {
                insertKey = surveyResults.account_id;
            } else if (surveyType === 'instagram-post') {
                insertKey = surveyResults.post_id;
            } else if (surveyType === 'bluesky-user') {
                insertKey = surveyResults.account_id;
            } else if (surveyType === 'bluesky-post') {
                insertKey = surveyResults.post_id;
            } else if (surveyType === 'whatsapp-post') {
                insertKey = surveyResults.post_id;
            } else if (surveyType === 'telegram-post') {
                insertKey = surveyResults.post_id;
            } else if (surveyType === 'truthsocial-post') {
                insertKey = surveyResults.post_id;
            } else if (surveyType === 'linkedin-post') {
                insertKey = surveyResults.post_id;
            }

            let insertIndex = annotatedElements[surveyType].indexOf(insertKey);
            if (insertIndex === -1) {
                // New entry: append to end.
                insertIndex = resultsArrays[surveyType].length;
            }

            resultsArrays[surveyType][insertIndex] = surveyResults;
            annotatedElements[surveyType][insertIndex] = insertKey;

            let lists2update = {
                'resultsArrays': resultsArrays,
                'annotatedElements': annotatedElements,
            };

            let bringNextUser = false;
            let nextUser = '';
            // If guided mode is enabled, advance to the next target after a successful annotation.
            if (result.isGuided === true && (surveyType === 'x-user' || surveyType === 'x-post' || surveyType === 'instagram-user' || surveyType === 'instagram-post' || surveyType === 'bluesky-user' || surveyType === 'bluesky-post' || surveyType === 'truthsocial-post' || surveyType === 'linkedin-post')) {
                let dropIndex = activeTargetList.findIndex(item => insertKey.toLowerCase() === item.toLowerCase());
                if (dropIndex > -1) {
                    activeTargetList.splice(dropIndex, 1);
                }

                if (activeTargetList.length > 0) {
                    bringNextUser = true;
                    nextUser = activeTargetList[0];
                }

                lists2update.activeTargetList = activeTargetList;
            }

            chrome.storage.local.set(lists2update, function () {
                if (bringNextUser === true) {
                    if (surveyType === 'x-post') {
                        window.location.href = platformURL + 'i/web/status/' + nextUser;
                    } else if (surveyType === 'instagram-post') {
                        window.location.href = platformURL + 'p/' + nextUser;
                    } else if (surveyType === 'bluesky-user') {
                        window.location.href = platformURL + 'profile/' + nextUser;
                    } else if (surveyType === 'bluesky-post') {
                        window.location.href = platformURL + 'profile/' + nextUser;
                    } else if (surveyType === 'truthsocial-post') {
                        window.location.href = platformURL + nextUser;
                    } else {
                        window.location.href = platformURL + nextUser;
                    }
                }

                if (apiSuccess) {
                    // @TODO: endpoint error handling isn't done properly; all API-related paths need full exception handling.
                    let divName = "surveyFormContainer";
                    if (surveyResults.surveyType === "x-post" || surveyResults.surveyType === "instagram-post" || surveyResults.surveyType === "bluesky-post" || surveyResults.surveyType === "whatsapp-post" || surveyResults.surveyType === "telegram-post" || surveyResults.surveyType === "truthsocial-post" || surveyResults.surveyType === "linkedin-post") {
                        divName += '-' + surveyResults.post_id.toString();
                    }

                    let ss = successSpan.cloneNode(true);  // @TODO: Have this blink for back-to-back submissions.

                    try {
                        let surveyContainer = document.getElementById(divName).shadowRoot;
                        let nc = surveyContainer.querySelector('.notification-container');

                        if (nc !== null) {
                            nc.replaceChild(ss, nc.firstChild);
                            $(ss).fadeOut(0);
                            $(ss).fadeIn(200);
                        }
                    } catch (e) { console.debug('Could not show success UI:', e); }
                }
            });
        });
    } catch(e) { console.debug('[SocialAnnotate] Extension context invalidated during storeResults.'); }
}