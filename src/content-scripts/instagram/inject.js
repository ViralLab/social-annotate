// Context class is defined in shared.js
const availableContextsInstagram = [new Context('instagram-user', injectInstagramUserSurvey, checkUserURL)];

// https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
const reactRoot = document.getElementById('react-root');


function crawlUserName() {
    let currentURL = window.location.href;
    let temp = currentURL.split('.com/');
    temp = temp[temp.length - 1];
    temp = temp.split('/')[0].split('?')[0];
    return temp;
}


function injectInstagramUserSurvey(injectElement, userID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-user";
    surveyContainer.setAttribute("id", "surveyFormContainer");
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/instagram/inject.css");
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    // Inject the form to the appropriate element in the page.
    let barElementName = injectElement.name;
    let fixedBar = null;
    if (injectElement.type === "class") {
        // @TODO: find a more specific insertion point than react-root.
        fixedBar = document.getElementById('react-root');
    } else if (injectElement.type === "id") {
        fixedBar = document.getElementById(barElementName);
    }

    if (fixedBar) {
        fixedBar.insertAdjacentElement('beforebegin', surveyContainer);
    } else {
        // Fallback for modern Instagram DOM where react-root might not exist.
        if (document.body) {
            document.body.insertAdjacentElement('afterbegin', surveyContainer);
        } else {
            document.documentElement.appendChild(surveyContainer);
        }
    }
}

function checkUserURL() {
    // Content script won't be loaded if not on Instagram, so we only need to exclude
    // the home/root/explore pages. main page looks like ?hl=en or just nothing.
    let uname = crawlUserName();
    return !(uname === '' || uname === 'home');
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID'], function (result) {
        const currentPlatform = 'instagram';
        for (let index = 0; index < availableContextsInstagram.length; ++index) {
            let currentContext = availableContextsInstagram[index];
            if (!currentContext.name.includes(currentPlatform)) {
                continue;
            }
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
                if (currentContext.name === 'instagram-user') {
                    let surveyID = crawlUserName();
                    currentContext.renderSurvey(surveyID);
                }
            }
        }
    });
}

// Fire the survey initializer on script load
initializeSurveys();
