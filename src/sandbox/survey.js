// Listen for messages from the parent window
window.addEventListener('message', function (event) {
  // Validate origin if needed, but since it's an extension communicating from host page, event.origin is the host page
  var data = event.data;

  if (data.type === 'render') {
    // Dynamically add the host's CSS if provided
    if (data.cssUrl) {
      document.getElementById('dynamic-css').textContent = '@import url("' + data.cssUrl + '");';
    }

    // Attach onSubmit callback to the schema returning message to parent
    data.formTemplate.onSubmit = function (errors, values) {
      window.parent.postMessage({
        type: 'submit',
        errors: errors,
        values: values,
        callId: data.callId
      }, '*');

      // Stage 3: transition button to green submitted state
      if (!errors) {
        var btn = $(formEl[0].tagName ? formEl : '#surveyForm, .surveyFormTweet').find('.surveySubmitBtn');
        btn.removeClass('ready-to-submit').addClass('submitted');
      }
    };

    // Adjust styles for tweets
    var formEl = $('#surveyForm');
    if (data.surveyType === 'twitter-tweet') {
      formEl.removeAttr('id').addClass('surveyFormTweet');
    }

    // Render jsonform
    formEl.empty().jsonForm(data.formTemplate);

    // Listen for changes to form inputs to highlight the submit button dynamically
    formEl.on('change', 'input, select, textarea', function() {
        var hasValue = false;
        
        // Check if any radio or checkbox is checked
        if (formEl.find('input[type="radio"]:checked, input[type="checkbox"]:checked').length > 0) {
            hasValue = true;
        }

        // Check if any text/number/select field has a value
        formEl.find('input[type="text"], input[type="number"], select, textarea').each(function() {
            // Specifically exclude hidden generated fields like initTimestamp or userID
            if ($(this).attr('type') !== 'hidden' && $(this).val() !== '') {
                hasValue = true;
            }
        });

        if (hasValue) {
            formEl.find('.surveySubmitBtn').addClass('ready-to-submit');
        } else {
            formEl.find('.surveySubmitBtn').removeClass('ready-to-submit');
        }
    });

  }
});
