// @TODO Check if this ID already exists in storage, and just update if it does (avoid duplicates).
// @TODO Might have an allow duplicates checkbox in the config, if there is a use case for it.
// Race conditions should not occur because events are called sequentially. 
function getCurrentScreenName(platform) {
    if (platform === "twitter") {
        /*
        headerCardClass = 'ProfileHeaderCard-screenname';
        screenNameClass = 'u-linkComplex-target';
        headerCard = document.getElementsByClassName(headerCardClass);
        screenNameContainer = headerCard[0].getElementsByClassName(screenNameClass);    
        screenName = screenNameContainer[0].innerText;
        */
        var currentURL = window.location.href;
        var temp = currentURL.split('.com/');
        temp = temp[temp.length - 1];
        screenName = temp.split('/')[0].split('?')[0];
    } else {
        screenName = 'Mahmut';
        //throw "Not implemented yet"
    }

    return screenName;
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

var defaultSpan = document.createElement("SPAN");
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
        // this.renderSurvey = renderFunction;  // render function is set after construction
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

        // Clone the form template so that concurrent iframe loads don't accidentally overwrite each other's hidden defaults due to javascript references
        let templateCopy = JSON.parse(JSON.stringify(this.formTemplate));

        // attach the metadata fields to the template
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
        // fill in the attached metadata fields.
        templateCopy.schema["initTimestamp"].default = Math.floor(Date.now() / 1000);
        templateCopy.schema["userID"].default = userID;

        let formName = 'surveyFormContainer';
        if (postID != null) {
            templateCopy.schema["postID"].default = postID;
            formName = formName + '-' + postID.toString()
        }

        let shadowRoot = document.getElementById(formName).shadowRoot;
        let iframe = shadowRoot.querySelector('.surveyIframe');

        // Setup global listener if we haven't already
        if (!window.__surveyListenerAdded) {
            window.addEventListener('message', function (event) {
                if (event.data && event.data.type === 'submit') {
                    let ctxData = window.__surveyContexts[event.data.callId];
                    if (ctxData && ctxData.context && ctxData.context.submitAction) {
                        // Guarantee absolute data integrity by piping the exact IDs from creation context directly into payload
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
                surveyType: this.name
            }, '*');
        };

        // Insert notification container before iframe
        let nc = notificationContainer.cloneNode(true);
        iframe.insertAdjacentElement('beforebegin', nc);

        let surveyType = this.name;
        // Check if this one is already annotated.
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
    //surveyResults.userID = getCurrentScreenName(socialMediaPlatform);
    // surveyResults.userID = document.getElementById('surveyForm').getAttribute('surveyId');
    surveyResults.postTimestamp = Math.floor(Date.now() / 1000);
    // surveyResults.initTimestamp = document.getElementById('surveyForm').getAttribute('surveyInitTimestamp');

    // _gaq.push(['_trackEvent', 'SurveySubmitted', 'clicked']); // Track number of survey submitted by Google Analytics.

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
                // @TODO might not necessarily be success here, handle response types.
                apiSuccess = true;
            });
        }
    });

    // get annotated count and increment that too. Also annotatedUserIDs.
    chrome.storage.local.get(['resultsArrays', 'annotatedElements', 'activeTargetList', 'isGuided', 'clientID'], function (result) {
        // console.log('Number of recorded results: ' + result.resultsArray.length);

        surveyResults.clientID = result.clientID;

        resultsArrays = result.resultsArrays;
        annotatedElements = result.annotatedElements;
        activeTargetList = result.activeTargetList;

        // @TODO: store this in the config when adding more platforms.
        if (socialMediaPlatform == 'twitter') {
            platformURL = window.location.hostname.includes("x.com") ? "https://x.com/" : "https://twitter.com/";
        } else if (socialMediaPlatform == 'instagram') {
            platformURL = "https://instagram.com/";
        }

        let surveyType = surveyResults.surveyType;

        // @TODO update for tweet storage.
        // check if this user is already in storage, and if so, where.
        let insertKey = null;
        if (surveyType === 'twitter-user') {
            insertKey = surveyResults.userID;
        }
        else if (surveyType === 'twitter-tweet') {
            insertKey = surveyResults.postID;
        }
        else if (surveyType === 'instagram-user') {
            insertKey = surveyResults.userID;
        }

        let insertIndex = annotatedElements[surveyType].indexOf(insertKey);
        if (insertIndex === -1) {
            // keeping a separate list of IDs for quick access, doesn't take much space.
            // resultsArray.push(surveyResults);
            // annotatedUserIDs.push(surveyResults.userID);
            // this index appends to the end of the list.
            insertIndex = resultsArrays[surveyType].length;
        }

        resultsArrays[surveyType][insertIndex] = surveyResults;
        annotatedElements[surveyType][insertIndex] = insertKey;
        // alert(insertKey);
        // alert(insertIndex);
        let lists2update = {
            'resultsArrays': resultsArrays,
            'annotatedElements': annotatedElements,
        };

        var bringNextUser = false;
        // if guided mode is enabled in the popup UI
        if (result.isGuided === true && (surveyType === 'twitter-user' || surveyType === 'twitter-tweet' || surveyType === 'instagram-user')) {
            // drop the saved ID from the list, if it exists in the list.
            // insertKey holds either userID or postID
            dropIndex = activeTargetList.findIndex(item => insertKey.toLowerCase() === item.toLowerCase());
            if (dropIndex > -1) {  // -1 when no match
                activeTargetList.splice(dropIndex, 1);  // remove 1 element, starting from dropIndex
            }

            // If guided mode is active and there are users in the list, determine next in line. 

            var nextUser = '';

            if (activeTargetList.length > 0) {
                bringNextUser = true;
                nextUser = activeTargetList[0]; // pop from the list when successfully submitted, not beforehand.
            }

            lists2update.activeTargetList = activeTargetList;

        }
        chrome.storage.local.set(lists2update, function () {
            if (bringNextUser === true) {
                if (surveyType === 'twitter-tweet') {
                    window.location.href = platformURL + 'i/web/status/' + nextUser;
                } else {
                    window.location.href = platformURL + nextUser;
                }
            }

            if (apiSuccess) {  // @TODO: endpoint error handling isn't done properly, all parts part related to API needs
                // full on exception handling.
                let divName = "surveyFormContainer";
                if (surveyResults.surveyType === "twitter-tweet") {
                    divName += '-' + surveyResults.postID.toString();
                }

                let ss = successSpan.cloneNode(true);  // @TODO: Have this blink so works for back2back submissions. can remove the span in submit click to achieve that maybe.

                let surveyContainer = document.getElementById(divName).shadowRoot;
                let nc = surveyContainer.querySelector('.notification-container');

                // if (surveyResults.surveyType === "twitter-tweet") {
                //     // notification container is guaranteed to exist here as the only sibling of surveyCont, grab it and
                //     // just clone a span into it.
                //     nc = surveyContainer.getElementsByClassName("notification-container")[0];
                // }
                // else if (surveyResults.surveyType === "twitter-user") {
                //     // guaranteed to have one of these
                //     nc = surveyContainer.getElementsByClassName("notification-container")[0];
                // }
                if (nc !== null) {
                    nc.replaceChild(ss, nc.firstChild);
                    // @TODO Doesn't look good but works when someone hits submit back-to-back. Can use better UI overall.
                    $(ss).fadeOut(0);
                    $(ss).fadeIn(200);
                }
            }

        });
    });
}