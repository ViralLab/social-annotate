"""YouTube platform agents — video watch, shorts, and user-channel variants."""

from typing import Optional
from pydantic import BaseModel, Field
from bs4 import BeautifulSoup
from agents.base_agent import PlatformAgent


# ── Shared helpers ────────────────────────────────────────────────────────────

def _base_post(existing_post: dict) -> dict:
    """Return existing post section as a base so we don't lose unrelated keys."""
    return dict(existing_post)


# ── Video (watch page) ────────────────────────────────────────────────────────

class YouTubeVideoResult(BaseModel):
    appRoot: str = Field(description="CSS selector for the app root — almost always 'ytd-app'.")
    postText: Optional[str] = Field(None, description="Selector for the video title (h1 element).")
    postAuthorLink: Optional[str] = Field(None, description="Selector for the channel link inside ytd-video-owner-renderer.")
    postTimestamp: Optional[str] = Field(None, description="Selector for the upload date string.")
    postVideo: Optional[str] = Field(None, description="Selector for the main <video> element.")
    metricsLike: Optional[str] = Field(None, description="Selector for the like button (aria-label carries the count).")
    metricsViews: Optional[str] = Field(None, description="Selector for the view count element.")


_VIDEO_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of a YouTube video watch page.

Your task: identify CSS selectors so a browser extension can extract video metadata
(title, channel, upload date, view count, like count).

RULES:
1. appRoot is always 'ytd-app'.
2. postText: the video title — look inside #title, ytd-watch-metadata, or h1.
3. postAuthorLink: the <a> tag linking to the channel inside ytd-video-owner-renderer.
4. postTimestamp: the upload date text — typically inside #info-strings yt-formatted-string.
5. postVideo: the main video element — 'video.html5-main-video'.
6. metricsLike: the like button — prefer '#segmented-like-button button[aria-label]'.
7. metricsViews: the view count — prefer 'ytd-video-view-count-renderer span.view-count'.
8. YouTube is a SPA — use stable element names (ytd-*, #id) over class hashes.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""


def _youtube_video_validate(soup: BeautifulSoup, result: YouTubeVideoResult) -> str | None:
    if not soup.select(result.appRoot):
        return f"appRoot '{result.appRoot}' matched 0 elements."
    if result.postText and not soup.select(result.postText):
        return f"postText '{result.postText}' matched 0 elements."
    if result.metricsLike and not soup.select(result.metricsLike):
        return f"metricsLike '{result.metricsLike}' matched 0 elements."
    return None


def _youtube_video_to_nested(result: YouTubeVideoResult, existing: dict | None = None) -> dict:
    base = (existing or {}).get("youtube", {})
    return {
        "youtube": {
            "shared": {
                "appRoot": result.appRoot,
                "observerFilter": base.get("shared", {}).get("observerFilter") or {
                    "attributes": False, "childList": True, "subtree": True,
                },
            },
            "account": base.get("account", {}),
            "post": {
                **_base_post(base.get("post", {})),
                "postContainer": None,
                "postText": result.postText,
                "postVideo": result.postVideo,
                "postTimestamp": result.postTimestamp,
                "postAuthorLink": result.postAuthorLink,
                "metricsLike": result.metricsLike,
                "metricsViews": result.metricsViews,
            },
        }
    }


YOUTUBE_VIDEO_PLATFORM_AGENT = PlatformAgent(
    name="youtube-video",
    survey_type="youtube-video",
    schema_class=YouTubeVideoResult,
    validate_fn=_youtube_video_validate,
    to_nested_fn=_youtube_video_to_nested,
    prompt_template=_VIDEO_PROMPT,
    offline_selectors=["ytd-watch-flexy", "#primary", "ytd-app"],
    block_spa_scripts=True,
)


# ── User / channel page ───────────────────────────────────────────────────────

class YouTubeUserResult(BaseModel):
    appRoot: str = Field(description="CSS selector for the app root — 'ytd-app'.")
    userDisplayName: Optional[str] = Field(None, description="Selector for the channel display name (h1 or yt-formatted-string).")
    userHandle: Optional[str] = Field(None, description="Selector for the @handle shown below the channel name.")
    userAvatar: Optional[str] = Field(None, description="Selector for the channel avatar <img>.")
    userBanner: Optional[str] = Field(None, description="Selector for the channel banner <img>.")
    userFollowers: Optional[str] = Field(None, description="Selector for the subscriber count element.")


_USER_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of a YouTube channel page.

Your task: identify CSS selectors so a browser extension can extract channel profile data
(name, handle, avatar, banner, subscriber count).

RULES:
1. appRoot is always 'ytd-app'.
2. userDisplayName: the channel name — look in h1.dynamicTextViewModelH1,
   yt-page-header-view-model h1, or #channel-name yt-formatted-string.
3. userHandle: the @handle text — often a yt-formatted-string below the name.
4. userAvatar: the channel avatar <img> — look inside #avatar or .ytSpecAvatarShape* img.
5. userBanner: the banner <img> — look inside yt-image-banner-view-model or #channel-header-container #banner.
6. userFollowers: subscriber count — '#subscriber-count yt-formatted-string' or a span
   inside yt-content-metadata-view-model containing "subscriber".
7. Prefer ytd-* element names and #id selectors over hashed class names.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""


def _youtube_user_validate(soup: BeautifulSoup, result: YouTubeUserResult) -> str | None:
    if not soup.select(result.appRoot):
        return f"appRoot '{result.appRoot}' matched 0 elements."
    profile_fields = [result.userDisplayName, result.userAvatar, result.userFollowers]
    if not any(f and soup.select(f) for f in profile_fields):
        return "No profile selectors matched: userDisplayName, userAvatar, and userFollowers all returned 0 elements."
    return None


def _youtube_user_to_nested(result: YouTubeUserResult, existing: dict | None = None) -> dict:
    base = (existing or {}).get("youtube", {})
    base_account = base.get("account", {})
    return {
        "youtube": {
            "shared": {
                "appRoot": result.appRoot,
                "observerFilter": base.get("shared", {}).get("observerFilter") or {
                    "attributes": False, "childList": True, "subtree": True,
                },
            },
            "account": {
                **base_account,
                "userDisplayName": result.userDisplayName,
                "userHandle": result.userHandle,
                "userAvatar": result.userAvatar,
                "userBanner": result.userBanner,
                "userFollowers": result.userFollowers,
            },
            "post": base.get("post", {}),
        }
    }


YOUTUBE_USER_PLATFORM_AGENT = PlatformAgent(
    name="youtube-user",
    survey_type="youtube-user",
    schema_class=YouTubeUserResult,
    validate_fn=_youtube_user_validate,
    to_nested_fn=_youtube_user_to_nested,
    prompt_template=_USER_PROMPT,
    offline_selectors=["ytd-channel-name", "#channel-header-container", "ytd-app"],
    block_spa_scripts=True,
)


# ── Comment (watch page, ytd-comment-view-model) ──────────────────────────────
#
# DOM structure (shady DOM — all children visible via querySelector):
#   ytd-comment-thread-renderer
#     ytd-comment-view-model           ← commentContainer (one per comment)
#       div#body  (flex-row)
#         a#author-thumbnail            ← avatar
#         div#main  (flex-column)       ← commentInjectionSel (survey injected here)
#           div#header                  ← author name + timestamp
#           div#content
#             yt-attributed-string#content-text  ← commentContentSel
#           div#footer                  ← likes + reply button

class YouTubeCommentResult(BaseModel):
    commentContainer: str = Field(description="CSS selector for a single comment element — always 'ytd-comment-view-model'.")
    commentInjectionSel: str = Field(description="CSS selector INSIDE commentContainer for the vertical content column where the survey is injected (afterbegin). Always 'div#main' or '#main'.")
    commentContentSel: str = Field(description="CSS selector inside commentContainer for the comment text body. Use '#content-text'.")
    commentAuthorSel: str = Field(description="CSS selector inside commentContainer for the author name. Use '#author-text span, #author-text yt-formatted-string'.")
    commentIdLinkSel: str = Field(description="CSS selector inside commentContainer for the anchor whose href contains 'lc=COMMENT_ID'. Use '#published-time-text a[href]'.")
    commentTimestampSel: str = Field(description="CSS selector inside commentContainer for the timestamp text. Use '#published-time-text a'.")
    commentLikeSel: Optional[str] = Field(None, description="CSS selector inside commentContainer for the like count element. Use '#vote-count-middle'. null if absent.")


_COMMENT_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of a YouTube video watch page
that includes the comments section.

Your task: identify CSS selectors so a browser extension can inject survey forms into each comment
and extract comment metadata (author, text, like count, timestamp, comment ID).

IMPORTANT — DOM STRUCTURE (shady DOM, all elements queryable):
  ytd-comment-thread-renderer
    ytd-comment-view-model              ← one per top-level comment
      div#body  [display:flex; flex-direction:row]
        a#author-thumbnail              ← avatar on the left
        div#main  [flex-direction:column]  ← survey injected HERE (afterbegin)
          div#header                    ← author name + timestamp row
          div#content
            yt-attributed-string#content-text
          div#footer                    ← likes, reply button

RULES:
1. commentContainer: always 'ytd-comment-view-model'. Each one wraps a single comment.
2. commentInjectionSel: always '#main'. This is the vertical column inside #body (NOT #body
   itself, which is a flex-row — injecting there pushes content sideways).
3. commentContentSel: the comment text — use '#content-text'.
4. commentAuthorSel: the author name — use '#author-text span, #author-text yt-formatted-string'.
5. commentIdLinkSel: the anchor whose href has 'lc=COMMENT_ID' — use '#published-time-text a[href]'.
   The extension extracts the comment ID via href.match(/[?&]lc=([^&]+)/).
6. commentTimestampSel: the relative timestamp text — use '#published-time-text a'.
7. commentLikeSel: the like count inside the comment — use '#vote-count-middle'. null if absent.
8. All selectors except commentContainer must work scoped INSIDE a single ytd-comment-view-model.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""


def _youtube_comment_validate(soup: BeautifulSoup, result: YouTubeCommentResult) -> str | None:
    comments = soup.select(result.commentContainer)
    if not comments:
        return f"commentContainer '{result.commentContainer}' matched 0 elements."
    if len(comments) < 2:
        return f"commentContainer '{result.commentContainer}' matched only {len(comments)} element; expected multiple."
    sample = comments[0]
    if not sample.select(result.commentInjectionSel):
        return f"commentInjectionSel '{result.commentInjectionSel}' matched 0 elements inside first comment."
    if not sample.select(result.commentContentSel):
        return f"commentContentSel '{result.commentContentSel}' matched 0 elements inside first comment."
    if not sample.select(result.commentAuthorSel):
        return f"commentAuthorSel '{result.commentAuthorSel}' matched 0 elements inside first comment."
    if not sample.select(result.commentIdLinkSel):
        return f"commentIdLinkSel '{result.commentIdLinkSel}' matched 0 elements inside first comment."
    return None


def _youtube_comment_to_nested(result: YouTubeCommentResult, existing: dict | None = None) -> dict:
    base = (existing or {}).get("youtube", {})
    return {
        "youtube": {
            "shared":  base.get("shared", {}),
            "account": base.get("account", {}),
            "post":    base.get("post", {}),
            "comment": {
                "commentContainer":    result.commentContainer,
                "commentInjectionSel": result.commentInjectionSel,
                "commentContentSel":   result.commentContentSel,
                "commentAuthorSel":    result.commentAuthorSel,
                "commentIdLinkSel":    result.commentIdLinkSel,
                "commentTimestampSel": result.commentTimestampSel,
                "commentLikeSel":      result.commentLikeSel,
            },
        }
    }


YOUTUBE_COMMENT_PLATFORM_AGENT = PlatformAgent(
    name="youtube-comment",
    survey_type="youtube-comment",
    selectors_key="youtube",
    schema_class=YouTubeCommentResult,
    validate_fn=_youtube_comment_validate,
    to_nested_fn=_youtube_comment_to_nested,
    prompt_template=_COMMENT_PROMPT,
    offline_selectors=["ytd-comment-view-model", "ytd-comment-thread-renderer", "#main"],
    block_spa_scripts=True,
)
