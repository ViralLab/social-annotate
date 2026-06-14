(function (w, d, s, l, i) {
  if (d.getElementById('gtm-script-loader')) {
    return;
  }

  w[l] = w[l] || [];
  w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });

  var firstScript = d.getElementsByTagName(s)[0];
  var gtmScript = d.createElement(s);
  var dataLayerParam = l !== 'dataLayer' ? '&l=' + l : '';

  gtmScript.id = 'gtm-script-loader';
  gtmScript.async = true;
  gtmScript.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dataLayerParam;
  firstScript.parentNode.insertBefore(gtmScript, firstScript);
}(window, document, 'script', 'dataLayer', 'GTM-P6GQDSGF'));
