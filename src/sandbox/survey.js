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
    };

    // Adjust styles for tweets
    var formEl = $('#surveyForm');
    if (data.surveyType === 'twitter-tweet') {
      formEl.removeAttr('id').addClass('surveyFormTweet');
    }

    // Render jsonform
    formEl.empty().jsonForm(data.formTemplate);

  }
});
