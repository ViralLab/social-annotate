// Runs in MAIN world to intercept XHR and extract media URLs
(function() {
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (url && typeof url === 'string' && url.includes('/graphql/')) {
            this.addEventListener('load', function() {
                if (this.status === 200) {
                    try {
                        const responseBody = this.responseText;
                        const data = JSON.parse(responseBody);
                        
                        const mediaMap = {};
                        
                        // Recursive function to find tweets in the JSON
                        function findTweets(obj) {
                            if (!obj || typeof obj !== 'object') return;
                            
                            if (obj.legacy && obj.legacy.id_str && obj.legacy.extended_entities && obj.legacy.extended_entities.media) {
                                const tweetId = obj.legacy.id_str;
                                const mediaList = obj.legacy.extended_entities.media;
                                const urls = [];
                                
                                mediaList.forEach(m => {
                                    if (m.type === 'video' || m.type === 'animated_gif') {
                                        if (m.video_info && m.video_info.variants) {
                                            // Find highest bitrate mp4
                                            let bestVideo = null;
                                            let highestBitrate = -1;
                                            m.video_info.variants.forEach(v => {
                                                if (v.content_type === 'video/mp4' && (v.bitrate || 0) > highestBitrate) {
                                                    highestBitrate = v.bitrate || 0;
                                                    bestVideo = v.url;
                                                }
                                            });
                                            if (bestVideo) urls.push(bestVideo);
                                        }
                                    } else if (m.type === 'photo') {
                                        urls.push(m.media_url_https);
                                    }
                                });
                                
                                if (urls.length > 0) {
                                    mediaMap[tweetId] = urls;
                                }
                            }
                            
                            // Recurse into children
                            if (Array.isArray(obj)) {
                                obj.forEach(findTweets);
                            } else {
                                Object.values(obj).forEach(findTweets);
                            }
                        }
                        
                        findTweets(data);
                        
                        if (Object.keys(mediaMap).length > 0) {
                            const event = new CustomEvent('mh:media-response', {
                                detail: mediaMap
                            });
                            document.dispatchEvent(event);
                        }
                    } catch (e) {
                        // ignore parsing errors
                    }
                }
            });
        }
        return originalOpen.apply(this, arguments);
    };
})();
