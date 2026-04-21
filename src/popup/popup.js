'use strict';

document.querySelector('#go-to-options').addEventListener('click', function(e) {
  console.log('Options clicked!');
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
});

function refresh_page(){
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.update(tabs[0].id, {url: tabs[0].url});
    });
}

function updateAnnotationCount () {
    var annotationCountSpan = document.getElementById('annotationCount');
    chrome.storage.local.get(['config', 'annotatedElements'], function(data) {
        // @TODO for now supporting only one active survey at one time, most of the codebase supports multiple just needs
        //      testing and UI updates.
        let activeSurvey = data.config.activeSurveys[0];
        annotationCountSpan.innerText = data.annotatedElements[activeSurvey].length;
    });
}

// Display the number of annotated users in the storage.
var surveyDropdown = document.getElementById('dropdown-menu');
chrome.storage.local.get('config', function(data) {
    for (var key in data.config.surveys){
        var option = document.createElement('li');
        option.data = key;
        // Event for clicking on a survey name in the dropdown, selecting that survey.
        option.addEventListener("click", function(){
            let chosenSurvey = this.data;
            document.getElementById('survey-id').innerHTML = chosenSurvey;
            // Update the active survey in the stored config variable.
            chrome.storage.local.get('config', function (data) {
                data.config.activeSurveys = [chosenSurvey];

                let newTargetList = data.config.surveys[chosenSurvey] && data.config.surveys[chosenSurvey].screenNameList
                                    ? [...data.config.surveys[chosenSurvey].screenNameList] : [];

                chrome.storage.local.set({
                    'config': data.config,
                    'activeTargetList': newTargetList
                }, function() {
                    updateAnnotationCount();
                    refresh_page();
                });
            });
        });

        option.innerHTML = "<a href='#'>" + key + "</a>";
        surveyDropdown.appendChild(option);
    }
    // Set the default as the current active survey.
    // @TODO for now supporting only one active survey at one time, most of the codebase supports multiple just needs
    //      testing and UI updates.
    let activeSurvey = data.config.activeSurveys[0];
    document.getElementById('survey-id').innerHTML = activeSurvey;
    updateAnnotationCount();
});


document.querySelector('#exportLink').addEventListener('click', function(e) {
    chrome.storage.local.get(['resultsArrays', 'config'], function(data) {
        let activeSurvey = data.config.activeSurveys[0];
        if (data.resultsArrays && data.resultsArrays[activeSurvey]) {
            let filteredResults = {};
            filteredResults[activeSurvey] = data.resultsArrays[activeSurvey];
            exportStoredResults(filteredResults);
        }
    });
});

var toggleGuidedCheckbox = document.querySelector('#toggleGuidedMode');

function updateInterface (disableLink) {
    chrome.storage.local.get(['isEnabled','isGuided'], function(data) {
        disableLink.innerHTML = data.isEnabled === true ? "Disable" : "Enable";
        toggleGuidedCheckbox.checked = data.isGuided === true;
    });
}

var disableLink = document.querySelector('#disableLink');
// Populate the interface for initial values.
updateInterface(disableLink);


disableLink.addEventListener('click', function(e) {
    // Toggle enable/disable: get current state, flip it, store it.
    chrome.storage.local.get('isEnabled', function(data) {
        let tempValue = !data.isEnabled;
        chrome.storage.local.set({"isEnabled": tempValue}, function() {
            updateInterface(disableLink)
        });
    });
    refresh_page();
});


toggleGuidedCheckbox.addEventListener('click', function(e) {
    chrome.storage.local.set({"isGuided": toggleGuidedCheckbox.checked}, function() {});
});

function exportStoredResults (resultArrays) {
    for (let surveyType in resultArrays) {
        if (resultArrays.hasOwnProperty(surveyType)) {
            let filedata = objectList2jsonl(resultArrays[surveyType]);
            let fileName = 'annotations-' + surveyType + '.jsonl';
            fileName = fileName.replace(/-/g ,'_');
            let url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(filedata);
            chrome.downloads.download({
                url: url,
                filename: fileName
            });
        }
    }
}

function objectList2jsonl(items) {
    let jsonl = '';
    for(let row = 0; row < items.length; row++){
        jsonl += JSON.stringify(items[row]) + '\n';
    }
    return jsonl;
}
