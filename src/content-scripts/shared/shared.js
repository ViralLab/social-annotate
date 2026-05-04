// @TODO Check if this ID already exists in storage, and just update if it does (avoid duplicates).
// @TODO Might have an allow duplicates checkbox in the config, if there is a use case for it.
// Race conditions should not occur because events are called sequentially.
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
    "initTimestamp": {
        "type": "number",
        "title": "Initial Timestamp",
        "default": 0
    },
    "userID": {
        "type": "string",
        "title": "User ID",
        "default": "hohe"
    },
    "postID": {
        "type": "string",
        "title": "Post(tweet) ID",
        "default": "hahi"
    }
};

const metadataForms = [
    {
        "key": "initTimestamp",
        "type": "hidden",
        "activeClass": "btn-success"
    },
    {
        "key": "userID",
        "type": "hidden",
        "activeClass": "btn-success"
    },
    {
        "key": "postID",
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
        if (!window.__surveyContexts) window.__surveyContexts = {};
        let callId = this.name + (postID ? '-' + postID : '');
        window.__surveyContexts[callId] = { context: this, userID: userID, postID: postID, extras: extras };

        // Clone the form template so concurrent iframe loads don't accidentally share references to hidden defaults.
        if (!this.formTemplate || !this.formTemplate.schema) {
            console.warn('[SocialAnnotate] renderSurvey called before formTemplate was set for', this.name);
            return;
        }
        let templateCopy = JSON.parse(JSON.stringify(this.formTemplate));

        // Attach metadata fields to the template schema.
        for (let key in metadataSchemes) {
            if (metadataSchemes.hasOwnProperty(key)) {
                templateCopy.schema[key] = metadataSchemes[key];
            }
        }
        let hasHidden = templateCopy.form.some(item => item.key === 'initTimestamp');
        if (!hasHidden) {
            for (let item of metadataForms) {
                templateCopy.form.splice(templateCopy.form.length - 1, 0, item);
            }
        }
        // Fill in the metadata field defaults.
        templateCopy.schema["initTimestamp"].default = Math.floor(Date.now() / 1000);
        templateCopy.schema["userID"].default = userID;

        let formName = 'surveyFormContainer';
        if (postID != null) {
            templateCopy.schema["postID"].default = postID;
            formName = formName + '-' + postID.toString()
        }

        let shadowRoot = document.getElementById(formName).shadowRoot;
        let iframe = shadowRoot.querySelector('.surveyIframe');

        // Set up global submit listener once; all survey contexts route through it.
        if (!window.__surveyListenerAdded) {
            window.addEventListener('message', function (event) {
                if (event.data && event.data.type === 'submit') {
                    let ctxData = window.__surveyContexts[event.data.callId];
                    if (ctxData && ctxData.context && ctxData.context.submitAction) {
                        // Guarantee absolute data integrity by piping the exact IDs from creation context directly into payload.
                        event.data.values.userID = ctxData.userID;
                        if (ctxData.postID !== null) {
                            event.data.values.postID = ctxData.postID;
                        }
                        if (ctxData.extras) {
                            for (let k in ctxData.extras) {
                                if (typeof ctxData.extras[k] === 'function') {
                                    event.data.values[k] = ctxData.extras[k]();
                                } else {
                                    event.data.values[k] = ctxData.extras[k];
                                }
                            }
                        }
                        ctxData.context.submitAction(event.data.errors, event.data.values);
                    }
                } else if (event.data && event.data.type === 'downloadMedia') {
                    let ctxData = window.__surveyContexts[event.data.callId];
                    if (ctxData) {
                        let evt = new CustomEvent('mh:download-request', { detail: { callId: event.data.callId, postID: ctxData.postID, userID: ctxData.userID, surveyType: ctxData.context.name } });
                        window.dispatchEvent(evt);
                    }
                }
            });
            window.__surveyListenerAdded = true;
        }

        iframe.onload = () => {
            iframe.contentWindow.postMessage({
                type: 'render',
                cssUrl: iframe.getAttribute('data-css'),
                formTemplate: templateCopy,
                callId: callId,
                surveyType: this.name,
                enableDownload: (this.name === 'x-post' || this.name === 'instagram-post' || this.name === 'bluesky-post')
            }, '*');
        };

        // Insert notification container before iframe.
        let nc = notificationContainer.cloneNode(true);
        iframe.insertAdjacentElement('beforebegin', nc);

        let surveyType = this.name;
        // Check if this element has already been annotated, and warn if so.
        chrome.storage.local.get(['annotatedElements'], function (result) {
            let checkID = (postID === null ? userID : postID);
            let entryIndex = result.annotatedElements[surveyType].indexOf(checkID);
            if (entryIndex !== -1) {
                let os = overwriteSpan.cloneNode(true);
                nc.replaceChild(os, nc.firstChild);
            }
        });
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
    surveyResults.postTimestamp = Math.floor(Date.now() / 1000);

    let apiSuccess = true;
    chrome.storage.local.get(['config'], function (result) {
        if (result.config.apiEndpoint !== '') {
            apiSuccess = false;
            let headers = new Headers();
            headers.append('Accept', 'application/json');
            headers.append('Access-Control-Allow-Origin', '*');
            headers.append('Content-Type', 'application/json');

            fetch(result.config.apiEndpoint, {
                mode: 'no-cors',
                method: "POST",
                body: JSON.stringify(surveyResults),
                headers: headers
            }).then(res => {
                console.log("Request complete! response:", res);
                // @TODO: handle non-success response status codes explicitly.
                apiSuccess = true;
            });
        }
    });

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
        }

        let surveyType = surveyResults.surveyType;

        let insertKey = null;
        if (surveyType === 'x-user') {
            insertKey = surveyResults.userID;
        } else if (surveyType === 'x-post') {
            insertKey = surveyResults.postID;
        } else if (surveyType === 'instagram-user') {
            insertKey = surveyResults.userID;
        } else if (surveyType === 'instagram-post') {
            insertKey = surveyResults.postID;
        } else if (surveyType === 'bluesky-user') {
            insertKey = surveyResults.userID;
        } else if (surveyType === 'bluesky-post') {
            insertKey = surveyResults.postID;
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
        if (result.isGuided === true && (surveyType === 'x-user' || surveyType === 'x-post' || surveyType === 'instagram-user' || surveyType === 'instagram-post' || surveyType === 'bluesky-user' || surveyType === 'bluesky-post')) {
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
                } else {
                    window.location.href = platformURL + nextUser;
                }
            }

            if (apiSuccess) {
                // @TODO: endpoint error handling isn't done properly; all API-related paths need full exception handling.
                let divName = "surveyFormContainer";
                if (surveyResults.surveyType === "x-post" || surveyResults.surveyType === "instagram-post") {
                    divName += '-' + surveyResults.postID.toString();
                }

                let ss = successSpan.cloneNode(true);  // @TODO: Have this blink for back-to-back submissions.

                let surveyContainer = document.getElementById(divName).shadowRoot;
                let nc = surveyContainer.querySelector('.notification-container');

                if (nc !== null) {
                    nc.replaceChild(ss, nc.firstChild);
                    $(ss).fadeOut(0);
                    $(ss).fadeIn(200);
                }
            }
        });
    });
}