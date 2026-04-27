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
        btn.val('Done!').text('Done!');
      }
    };

    // For tweet surveys, strip the #surveyForm id and use the .surveyFormTweet class instead
    // so that multiple tweet forms can coexist on the page without id collisions.
    // Note: formEl still holds the jQuery reference to the element even after the id is removed.
    var formEl = $('#surveyForm');
    if (data.surveyType === 'twitter-tweet') {
      formEl.removeAttr('id').addClass('surveyFormTweet');
    }

    // Render jsonform
    formEl.empty().jsonForm(data.formTemplate);

    // Initial button state:
    var submitBtn = formEl.find('.surveySubmitBtn');
    submitBtn.val('Annotate').text('Annotate');

    if (data.enableDownload) {
        var downloadBtnHtml = `<button class="download-media-btn" style="background: linear-gradient(135deg, #1d9bf0, #1a8cd8); color: white; border: none; border-radius: 16px; font-weight: 700; font-size: 16px; padding: 0 32px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 14px rgba(29, 155, 240, 0.35); transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); flex: 1; margin: 0;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Download Media
        </button>`;
        
        var $downloadBtn = $(downloadBtnHtml);
        
        $downloadBtn.on('mouseenter', function() {
            $(this).css({ transform: 'translateY(-2px)', background: 'linear-gradient(135deg, #4cb0f9, #1d9bf0)', boxShadow: '0 8px 20px rgba(29, 155, 240, 0.5)' });
        }).on('mouseleave', function() {
            $(this).css({ transform: 'none', background: 'linear-gradient(135deg, #1d9bf0, #1a8cd8)', boxShadow: '0 4px 14px rgba(29, 155, 240, 0.35)' });
        }).on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            window.parent.postMessage({ type: 'downloadMedia', callId: data.callId }, '*');
        });

        // Ensure the submit button container is a flex container to hold both buttons properly
        var parentWrapper = submitBtn.parent();
        if (parentWrapper.length && !parentWrapper.hasClass('action-buttons-wrapper')) {
            var wrapper = $('<div class="action-buttons-wrapper" style="display: flex; flex-direction: column; gap: 12px; align-self: stretch; flex: 0 0 auto; width: 200px;"></div>');
            submitBtn.wrap(wrapper);
        }
        
        // Force the submit button to also flex evenly
        submitBtn.attr('style', submitBtn.attr('style') + '; flex: 1 !important; margin: 0 !important;');
        submitBtn.parent().prepend($downloadBtn);
    }

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

        var submitBtn = formEl.find('.surveySubmitBtn');
        if (hasValue) {
            submitBtn.addClass('ready-to-submit');
            submitBtn.val('Submit').text('Submit');
        } else {
            submitBtn.removeClass('ready-to-submit');
            submitBtn.val('Annotate').text('Annotate');
        }
    });

  }
});
