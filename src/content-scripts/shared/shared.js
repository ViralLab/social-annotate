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
            let freshTheme = this.theme || 'light';
            
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

        let platform = this.name.split('-')[0];
        chrome.storage.local.get(['config', 'consentGiven_' + platform], (res) => {
            let surveyConf = res && res.config && res.config.surveys && res.config.surveys[this.name];
            let consentRequired = surveyConf && surveyConf.informedConsent && surveyConf.informedConsent.enabled;
            let consentText = consentRequired ? (surveyConf.informedConsent.html || surveyConf.informedConsent.text) : "";
            consentText = consentText.replace(/{platform}/g, platform.charAt(0).toUpperCase() + platform.slice(1));
            let hasConsent = res['consentGiven_' + platform];

            let proceed = () => {
                // If the iframe's onload already fired while we were waiting for storage, send immediately.
                if (iframe.dataset.loaded === 'true') {
                    sendRenderMsg();
                } else {
                    // Otherwise wait for it
                    iframe.addEventListener('load', sendRenderMsg);
                }
            };

            if (consentRequired && !hasConsent) {
                if (!document.getElementById('sa-global-consent')) {
                    let overlay = document.createElement('div');
                    overlay.id = 'sa-global-consent';
                    overlay.style.position = 'fixed';
                    overlay.style.top = '0';
                    overlay.style.left = '0';
                    overlay.style.width = '100vw';
                    overlay.style.height = '100vh';
                    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.65)';
                    overlay.style.backdropFilter = 'blur(10px)';
                    overlay.style.webkitBackdropFilter = 'blur(10px)';
                    overlay.style.zIndex = '999999';
                    overlay.style.display = 'flex';
                    overlay.style.alignItems = 'center';
                    overlay.style.justifyContent = 'center';
                    overlay.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

                    if (!document.getElementById('sa-consent-styles')) {
                        let style = document.createElement('style');
                        style.id = 'sa-consent-styles';
                        style.innerHTML = `
                            .sa-consent-content h1, .sa-consent-content h2, .sa-consent-content h3 {
                                margin: 0 0 16px 0; font-weight: 700; line-height: 1.3;
                            }
                            .sa-consent-content h3 { font-size: 22px; }
                            .sa-consent-content p { margin: 0 0 16px 0; line-height: 1.6; }
                            .sa-consent-content b, .sa-consent-content strong { font-weight: 600; }
                            .sa-consent-checkbox-wrap {
                                padding: 16px; background: rgba(128, 128, 128, 0.1);
                                border-radius: 8px; margin-top: 24px; display: flex; align-items: center;
                                border: 1px solid rgba(128, 128, 128, 0.2);
                            }
                            .sa-btn-approve {
                                padding: 14px 28px; background: #657786; color: #fff; border: none;
                                border-radius: 9999px; cursor: not-allowed; font-weight: bold;
                                font-size: 16px; transition: all 0.2s ease;
                            }
                            .sa-btn-approve.active {
                                background: #00BA7C; cursor: pointer; box-shadow: 0 4px 12px rgba(0,186,124,0.3);
                            }
                            .sa-btn-approve.active:hover { background: #00a06b; transform: translateY(-1px); }
                        `;
                        document.head.appendChild(style);
                    }

                    let consentDiv = document.createElement('div');
                    consentDiv.className = 'consent-container';
                    consentDiv.style.padding = '40px';
                    consentDiv.style.maxWidth = '640px';
                    consentDiv.style.maxHeight = '85vh';
                    consentDiv.style.overflowY = 'auto';
                    consentDiv.style.textAlign = 'left';
                    consentDiv.style.color = freshTheme === 'dark' ? '#E7E9EA' : '#0F1419';
                    consentDiv.style.background = freshTheme === 'dark' ? '#15202B' : '#FFFFFF';
                    consentDiv.style.border = '1px solid ' + (freshTheme === 'dark' ? '#38444D' : '#EFF3F4');
                    consentDiv.style.borderRadius = '16px';
                    consentDiv.style.fontSize = '15px';
                    consentDiv.style.boxShadow = '0 20px 50px rgba(0,0,0,0.5)';

                    let textP = document.createElement('div');
                    textP.className = 'sa-consent-content';
                    textP.innerHTML = consentText;
                    consentDiv.appendChild(textP);

                    let checkboxDiv = document.createElement('div');
                    checkboxDiv.className = 'sa-consent-checkbox-wrap';
                    
                    let checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.id = 'sa-consent-checkbox';
                    checkbox.style.margin = '0 12px 0 0';
                    checkbox.style.width = '20px';
                    checkbox.style.height = '20px';
                    checkbox.style.cursor = 'pointer';
                    checkbox.style.accentColor = '#00BA7C';
                    checkbox.style.flexShrink = '0';

                    let label = document.createElement('label');
                    label.htmlFor = 'sa-consent-checkbox';
                    label.innerText = 'I have read the informed consent and agree to participate.';
                    label.style.cursor = 'pointer';
                    label.style.fontWeight = '600';
                    label.style.fontSize = '14px';
                    label.style.margin = '0';
                    label.style.lineHeight = '1.2';
                    label.style.display = 'block';

                    checkboxDiv.appendChild(checkbox);
                    checkboxDiv.appendChild(label);
                    consentDiv.appendChild(checkboxDiv);

                    let actionDiv = document.createElement('div');
                    actionDiv.style.textAlign = 'center';
                    actionDiv.style.marginTop = '30px';

                    let approveBtn = document.createElement('button');
                    approveBtn.innerText = 'Approve';
                    approveBtn.className = 'sa-btn-approve';
                    approveBtn.disabled = true;

                    checkbox.addEventListener('change', (e) => {
                        if (e.target.checked) {
                            approveBtn.disabled = false;
                            approveBtn.classList.add('active');
                        } else {
                            approveBtn.disabled = true;
                            approveBtn.classList.remove('active');
                        }
                    });

                    approveBtn.onclick = () => {
                        if (!checkbox.checked) return;
                        let nowUnix = Math.floor(Date.now() / 1000);
                        let consentData = {
                            timestamp: nowUnix,
                            userAgent: navigator.userAgent
                        };
                        let toSave = {};
                        toSave['consentGiven_' + platform] = consentData;

                        chrome.runtime.sendMessage({
                            action: 'saveConsentRecord',
                            platform: platform,
                            surveyType: this.name,
                            studyID: surveyConf ? surveyConf.studyID : '',
                            consentTextMarkdown: surveyConf && surveyConf.informedConsent ? surveyConf.informedConsent.text : '',
                            consentTextHtml: consentText,
                            timestampUnix: nowUnix,
                            timestampIso: new Date(nowUnix * 1000).toISOString(),
                            userAgent: navigator.userAgent
                        });

                        chrome.storage.local.set(toSave, () => {
                            window.location.reload();
                        });
                    };
                    actionDiv.appendChild(approveBtn);
                    consentDiv.appendChild(actionDiv);
                    overlay.appendChild(consentDiv);

                    document.body.appendChild(overlay);
                }
                
                // Hide the iframe since consent is not given yet.
                iframe.style.display = 'none';
            } else {
                proceed();
            }
        });

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

// ---------------------------------------------------------------------------
// Selector health check — call once per initializeSurveys after SEL is built.
// Tests only selectors that must be present on page load. Logs a structured
// warning and fires mh:selector-health so the selector_agent pipeline can react.
// ---------------------------------------------------------------------------
function checkSelectorHealth(platform, selectors, activeSurveys) {
    const candidates = [
        // appRoot is the only reliable at-init check: it's a static SPA mount point.
        // postContainer and conversationMessages are excluded because they are
        // dynamic/lazy-loaded — they won't be in the DOM yet on a feed page at init
        // time, which would produce false positives on every page load.
        { key: 'appRoot', alwaysCheck: true }
    ];

    const failed = [];
    for (const c of candidates) {
        const selector = selectors[c.key];
        if (!selector || typeof selector !== 'string') continue; // null → not applicable

        const surveyActive = !c.requiresSurvey ||
            (Array.isArray(activeSurveys) && activeSurveys.includes(c.requiresSurvey));
        if (!c.alwaysCheck && !surveyActive) continue;

        try {
            if (!document.querySelector(selector)) {
                failed.push({ key: c.key, selector });
            }
        } catch (e) {
            failed.push({ key: c.key, selector, error: e.message });
        }
    }

    if (failed.length > 0) {
        const details = failed.map(f => `${f.key}: "${f.selector}"`).join(', ');
        console.warn(`[SocialAnnotate:health] ${platform} — ${failed.length} selector(s) matched nothing at init: ${details}`);
        document.dispatchEvent(new CustomEvent('mh:selector-health', {
            detail: { platform, failed, url: location.href }
        }));
    }
}

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