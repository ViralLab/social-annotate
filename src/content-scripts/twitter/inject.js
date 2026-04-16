
// Context class is defined in shared.js
// @TODO make this array a struct to avoid magic indices.
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
                    mediaUrls: () => extractTweetMedia(insertElement)
                }
            );
        }
    }
}

let lastKnownUrl = window.location.href;

// @TODO All this observer stuff needs to be twitter specific, so that instagram etc. can have theirs as well.
const observerCallback = function (mutationsList, observer) {
    if (window.location.href !== lastKnownUrl) {
        lastKnownUrl = window.location.href;
        initializeSurveys(); // Re-trigger injection logic if URL physically changed via Single Page Application routing
    }

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

// Start observing the target node for configured mutations
// observer.observe(reactRoot, config);


function crawlUserName() {
    let currentURL = window.location.href;
    let temp = currentURL.split('.com/');
    temp = temp[temp.length - 1];
    temp = temp.split('/')[0].split('?')[0];
    return temp;
}


function injectTwitterUserSurvey(injectElement, userID) {
    let existingContainer = document.getElementById("surveyFormContainer");
    if (existingContainer) {
        existingContainer.remove();
    }

    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-user";
    surveyContainer.setAttribute("id", "surveyFormContainer");
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/twitter/inject.css");
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    // Inject the form to the appropriate element in the page.
    let barElementName = injectElement.name;
    let fixedBar = {};
    if (injectElement.type === "class") {
        //fixedBar = document.getElementsByClassName(barElementName)[injectElement.index];
        fixedBar = document.getElementById('react-root');
    } else if (injectElement.type === "id") {
        fixedBar = document.getElementById(barElementName);
    }

    // let nc = notificationContainer.cloneNode();  // from shared.js
    // fixedBar.insertAdjacentElement('beforebegin', nc);  // I don't know why there is a warning here...
    fixedBar.insertAdjacentElement('beforebegin', surveyContainer);

    // chrome.storage.local.get(['annotatedElements'], function(result) {
    //     // This one is only called for users, though a more general implementation would be nice in the future.
    //     let surveyType = 'twitter-user';
    //     let entryIndex = result.annotatedElements[surveyType].indexOf(userID);
    //     if (entryIndex !== -1) {  // if an entry already exists
    //         let os = overwriteSpan.cloneNode();  // from shared.js
    //         nc.replaceChild(os, notificationContainer.firstChild);
    //     }
    // });
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

    // Extract videos (Attempt to grab raw MP4 source first, fallback to thumbnail if stream is encrypted blob)
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

function extractTweetDetails(articleNode) {
    // there is only one time element, at least for now...
    let timeElement = articleNode.querySelector("time");
    if(!timeElement || !timeElement.parentNode || !timeElement.parentNode.href) {
        return null; // Ignore ads, sponsored posts, or unrendered skeleton nodes
    }
    
    let tweetLink = timeElement.parentNode.href;
    tweetLink = tweetLink.split('/');

    return { 
        tweetOwner: tweetLink[3], 
        tweetID: tweetLink[tweetLink.length - 1]
    };
}

// var tweetCount = 0;
// @TODO check if an entry already exists for this tweetID, and show a warning if so. This is going to be inefficient
//      with our current implementation ( O(kn) k=number of tweets, n=number of entries) but neither k nor n should ever
//      get very large, we should still rewamp this in the future. ----!!! Storage API call limit may also be an issue
//      if so that rewamping will have to happen now !!!----
// This is how to check if exists...
// let insertIndex = annotatedElements[surveyType].indexOf(insertKey);
// if (insertIndex === -1) {
//     // keeping a separate list of IDs for quick access, doesn't take much space.
//     // resultsArray.push(surveyResults);
//     // annotatedUserIDs.push(surveyResults.userID);
//     // this index appends to the end of the list.
//     insertIndex = resultsArrays[surveyType].length;
// }

function injectTwitterTweetSurvey(injectNode, tweetID) {
    // @ TODO This shall be done by mutation observer so it supports new tweets too
    // alert('attempting to inject tweets');
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-tweet";
    let containerName = "surveyFormContainer-" + tweetID;
    surveyContainer.setAttribute("id", containerName);
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/twitter/inject.css");
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;


    //
    // let survey = document.createElement('form');
    // survey.setAttribute("id", "surveyForm-" + tweetID);
    // // survey.setAttribute("surveyInitTimestamp", Math.floor(Date.now() / 1000));
    // survey.classList.add("surveyFormTweet");
    // surveyContainer.appendChild(survey);
    injectNode.insertAdjacentElement('afterbegin', surveyContainer);
    // return tweetCount++;  // well its a global variable but this is the fastest way for now.
}

function checkUserURL() {
    // content script won't be loaded if its not actually twitter, so all I need to check
    //  is if its the main page or not. Anything thats not the main page is a user page
    //  @TODO exclude settings page from the manifest blob match.
    let uname = crawlUserName();
    return !(uname === '' || uname === 'home')
    /*

    let currentURL = window.location.href;
    let isUserURL = true;

    if (currentURL == "https://twitter.com/" || currentURL == "https://twitter.com/home") {
        isUserURL = false;
    }

    return isUserURL;
    */
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID'], function (result) {
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
                let clientID = config.clientID;

                function submitAction(errors, values) {
                    if (!errors) {
                        values.surveyType = currentContext.name;
                        values.studyID = studyID;
                        values.clientID = clientID;
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
