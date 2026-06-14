document.addEventListener("DOMContentLoaded", function() {
  var pathname = window.location && window.location.pathname
    ? window.location.pathname
    : "";
  var isEmbedRoute =
    /^\/embed\/[^/]+\/?$/.test(pathname) ||
    /^\/@?[^/]+\/[^/]+\/embed\/?$/.test(pathname) ||
    /^\/@?[^/]+\/posts\/[^/]+\/embed\/?$/.test(pathname);
  if (isEmbedRoute) return;

  var isUserEnabled = window.localStorage.getItem("truth:gdpr") === "true";
  if (!isUserEnabled) return;

  if (window.environment === "production") {
    // Begin TVSquared Tracking Code
    var _tvq = window._tvq = window._tvq || [];
    (function() {
        var u = (("https:" == document.location.protocol) ? "https://collector-47615.us.tvsquared.com/" : "http://collector-47615.us.tvsquared.com/");
        _tvq.push(["setSiteId", "TV-5427368145-1"]);
        _tvq.push(["setTrackerUrl", u + "tv2track.php"]);
        _tvq.push([function() {
            this.deleteCustomVariable(5, "page")
        }]);
        _tvq.push(["trackPageView"]);
        var d = document,
            g = d.createElement("script"),
            s = d.getElementsByTagName("script")[0];
        g.type = "text/javascript";
        g.defer = true;
        g.async = true;
        g.src = u + "tv2track.js";
        s.parentNode.insertBefore(g, s);
    })();
    // End TVSquared Tracking Code
  }
})
