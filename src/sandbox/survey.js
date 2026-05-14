// Listen for messages from the parent window
window.addEventListener('message', function (event) {
  // Debug: log incoming messages to help trace preview issues
  try { console.debug('[Sandbox] message received origin=', event.origin, 'data=', event.data && event.data.type); } catch(e) {}
  // Validate origin if needed, but since it's an extension communicating from host page, event.origin is the host page
  var data = event.data;

  if (data.type === 'render') {
    if (data.theme) {
      document.body.setAttribute('data-theme', data.theme);
      document.documentElement.setAttribute('data-theme', data.theme);
    }
    // Dynamically add the host's CSS if provided
    if (data.cssUrl) {
      document.getElementById('dynamic-css').textContent = '@import url("' + data.cssUrl + '");';
    }

    // Attach onSubmit callback to the schema returning message to parent
    data.formTemplate.onSubmit = function (errors, values) {
      // Prefer targeting the parent origin if available via document.referrer
      let parentOrigin = '*';
      try { if (document.referrer) parentOrigin = (new URL(document.referrer)).origin; } catch(e) { parentOrigin = '*'; }
      window.parent.postMessage({
        type: 'submit',
        errors: errors,
        values: values,
        callId: data.callId,
        token: data.token
      }, parentOrigin);

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
    if (data.surveyType === 'x-post' || data.surveyType === 'instagram-post' || data.surveyType === 'bluesky-post') {
      formEl.removeAttr('id').addClass('surveyFormTweet');
    }

    // Render jsonform
    formEl.empty().jsonForm(data.formTemplate);

    // jsonform wraps all fields in a single root <div> as the only direct
    // child of the form. Convert it to the carousel container.
    var rootDiv = formEl.find('> div').first();
    if (rootDiv.length > 0) {
      rootDiv.addClass('sa-fields-scroll');

      // Ensure submit button is the last item inside the carousel
      var submitBtn = formEl.find('.surveySubmitBtn, input[type="submit"]').first();
      if (submitBtn.length > 0 && !$.contains(rootDiv[0], submitBtn[0])) {
        rootDiv.append(submitBtn);
      }

      // Add mouse drag scrolling to the carousel
      var slider = rootDiv[0];
      var isDown = false;
      var startX;
      var scrollLeft;

      slider.addEventListener('mousedown', function(e) {
        isDown = true;
        slider.style.cursor = 'grabbing';
        slider.style.scrollSnapType = 'none'; // Disable snap while dragging for smoother feel
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
      });
      slider.addEventListener('mouseleave', function() {
        isDown = false;
        slider.style.cursor = '';
        slider.style.scrollSnapType = '';
      });
      slider.addEventListener('mouseup', function() {
        isDown = false;
        slider.style.cursor = '';
        slider.style.scrollSnapType = '';
      });
      slider.addEventListener('mousemove', function(e) {
        if (!isDown) return;
        e.preventDefault();
        var x = e.pageX - slider.offsetLeft;
        var walk = (x - startX) * 1.5; // Scroll speed multiplier
        slider.scrollLeft = scrollLeft - walk;
      });
    }

    // Notify parent of rendered height so the iframe can shrink-wrap.
    // Use ResizeObserver so we re-fire whenever CSS loads and changes layout.
    function reportHeight() {
      var h = document.body.offsetHeight || document.documentElement.offsetHeight;
      let parentOrigin = '*';
      try { if (document.referrer) parentOrigin = (new URL(document.referrer)).origin; } catch(e) { parentOrigin = '*'; }
      window.parent.postMessage({ type: 'resize', height: h, callId: data.callId, token: data.token }, parentOrigin);
    }

    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(reportHeight);
      ro.observe(document.body);
    } else {
      // Fallback: probe at increasing delays to catch async CSS load
      reportHeight();
      setTimeout(reportHeight, 150);
      setTimeout(reportHeight, 500);
    }

    // Initial button state:
    var submitBtn = formEl.find('.surveySubmitBtn');
    submitBtn.val('Annotate').text('Annotate');


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
