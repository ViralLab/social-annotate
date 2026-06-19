"""Instagram platform agents — feed/post and comment variants."""

from typing import Optional
from pydantic import BaseModel, Field
from bs4 import BeautifulSoup
from agents.base_agent import BaseSelectorResult, PlatformAgent, generic_validate, make_to_nested


# ── Feed / post page ──────────────────────────────────────────────────────────

_POST_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of Instagram (web.instagram.com).

Your task: identify CSS selectors so a browser extension can inject survey forms into
each post and extract post metadata (author, text, media, timestamp).

RULES:
1. Instagram heavily uses obfuscated class names — prefer aria-label, role, and structural
   selectors over class names where possible.
2. postContainer must match MULTIPLE individual post cards, AND each match must have a
   DIFFERENT parent node. The extension injects the survey into postContainer.parentNode —
   if all matches share the same parent only one form will appear.
   Tip: <article> elements are usually the best post containers.
3. postTimestamp: Instagram renders timestamps in <time> elements inside each post.
4. metricsLike / metricsReply: Instagram hides exact counts. Use aria-label selectors
   such as [aria-label*="like"] or [aria-label*="comment"] scoped inside each article.
   Set to null if engagement counts are genuinely absent.
5. userFollowers / userFollowing: target the FOLLOWER COUNT and FOLLOWING COUNT links,
   NOT the "Followed by [names]..." mutual-followers section. On live pages the count
   links use href ending in /followers/ or /following/. Use: a[href$="/followers/"] and
   a[href$="/following/"]. Set null only if the count links are genuinely absent.
6. All other profile-page selectors (userHandle, userBio, userAvatar) are preserved
   automatically from the existing file — leave them null in your response.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""

def _ig_post_to_nested(result: BaseSelectorResult, existing: dict | None = None) -> dict:
    """
    Custom to_nested for the Instagram post/feed agent.

    Profile-page account selectors (userHandle, userBio, userAvatar, etc.) are preserved
    from the existing file rather than regenerated from feed HTML — the feed DOM doesn't
    contain a profile header, so the LLM would return null and overwrite good values.

    userFollowers / userFollowing use href$= selectors targeting the count links on live
    pages. On saved fixtures hrefs are "#" so the JS text-pattern scan acts as fallback.
    """
    base = (existing or {}).get("instagram", {})
    base_shared  = base.get("shared", {})
    base_account = base.get("account", {})
    base_post    = base.get("post", {})

    output: dict = {
        "instagram": {
            "shared": {
                "appRoot": result.appRoot,
                "observerFilter": base_shared.get("observerFilter") or {
                    "attributes": False,
                    "childList": True,
                    "subtree": True,
                },
            },
            "account": {
                # Preserve all existing profile-page selectors — the healer only runs
                # on feed HTML where these elements don't exist.
                "userDisplayName":  base_account.get("userDisplayName"),
                "userHandle":       base_account.get("userHandle"),
                "userAvatar":       base_account.get("userAvatar"),
                "userProfileAvatar": base_account.get("userProfileAvatar"),
                "userProfileSchema": base_account.get("userProfileSchema"),
                "userBanner":       base_account.get("userBanner"),
                "userBio":          base_account.get("userBio"),
                "userHeadline":     base_account.get("userHeadline"),
                "userVerified":     base_account.get("userVerified"),
                # On live pages these link to /followers/ and /following/ paths.
                # On saved fixtures hrefs are "#" so the JS text-pattern scan is the fallback.
                "userFollowers":    result.userFollowers,
                "userFollowing":    result.userFollowing,
                "userConnections":  base_account.get("userConnections"),
                "userLocation":     base_account.get("userLocation"),
                "userJoinDate":     base_account.get("userJoinDate"),
                "userUrl":          base_account.get("userUrl"),
                "userLink":         base_account.get("userLink"),
            },
            "post": {
                "postContainer":     result.postContainer,
                "postText":          result.postText,
                "postImage":         result.postImage,
                "postVideo":         result.postVideo,
                "postTimestamp":     result.postTimestamp,
                "postTimestampAttr": result.postTimestampAttr,
                "postLink":          None,
                "cardWrapper":       result.cardWrapper,
                "conversationMessages": None,
                "messageContainer":  None,
                "copyableText":      None,
                "metricsReply":      result.metricsReply,
                "metricsRepost":     result.metricsRepost,
                "metricsLike":       result.metricsLike,
                "metricsBookmark":   result.metricsBookmark,
                "metricsViews":      None,
                "metricsQuote":      None,
                "metricsViewsPattern": base_post.get("metricsViewsPattern") or "views?",
            },
        }
    }
    # Preserve extra sub-sections (e.g. "comment", "reel") that this agent doesn't touch.
    for key, val in base.items():
        if key not in ("shared", "account", "post"):
            output["instagram"][key] = val
    return output


INSTAGRAM_PLATFORM_AGENT = PlatformAgent(
    name="instagram",
    survey_type="instagram-post",
    schema_class=BaseSelectorResult,
    validate_fn=generic_validate,
    to_nested_fn=_ig_post_to_nested,
    prompt_template=_POST_PROMPT,
    offline_selectors=[
        "article",
        'article[role="presentation"]',
        '[role="main"] article',
        "._aatb",
    ],
)


# ── Comment panel (post detail / reel) ───────────────────────────────────────
#
# DOM structure (all class names are hashed — never use them):
#   <div>  ← scrollable comment list container (multiple /c/ anchors)
#     <div>  ← per-comment wrapper (exactly ONE /c/ anchor inside)
#       <a href="/p/POST/c/COMMENT_ID/" role="link">  ← timestamp anchor
#       <a href="/USERNAME/" role="link">              ← author profile link
#       <span dir="auto">  ← comment text (not inside <a>)
#
# The extension identifies each comment by walking UP from the timestamp anchor
# to the outermost div that still contains exactly one /c/ anchor.

class InstagramCommentResult(BaseModel):
    commentTimestampAnchor: str = Field(
        description=(
            "CSS selector for the timestamp anchor inside each comment. "
            "This anchor's href contains '/c/COMMENT_ID/' and has role='link'. "
            "Use: a[href*='/c/'][role='link']"
        )
    )
    commentText: str = Field(
        description=(
            "CSS selector for the comment body text, scoped inside the comment block. "
            "Instagram renders text in <span dir='auto'> elements not wrapped in <a> tags. "
            "Use: span[dir='auto']"
        )
    )
    commentAuthorLink: str = Field(
        description=(
            "CSS selector for the comment author's profile link inside the comment block. "
            "This is an <a role='link'> whose href is a profile path — NOT a /c/ timestamp link. "
            "Use: a[role='link']:not([href*='/c/'])"
        )
    )


def _ig_comment_validate(soup: BeautifulSoup, result: InstagramCommentResult) -> str | None:
    anchors = soup.select(result.commentTimestampAnchor)
    if not anchors:
        return f"commentTimestampAnchor '{result.commentTimestampAnchor}' matched 0 elements."
    if len(anchors) < 2:
        return (
            f"commentTimestampAnchor '{result.commentTimestampAnchor}' matched only "
            f"{len(anchors)} element; expected one per comment (multiple)."
        )
    # Verify text selector hits at least one comment's parent subtree
    if result.commentText:
        hits = sum(1 for a in anchors[:10] if a.find_parent() and a.find_parent().select_one(result.commentText))
        if hits == 0:
            return f"commentText '{result.commentText}' matched 0 elements near any comment anchor."
    return None


def _ig_comment_to_nested(result: InstagramCommentResult, existing: dict | None = None) -> dict:
    base = (existing or {}).get("instagram", {})
    return {
        "instagram": {
            "shared":  base.get("shared", {}),
            "account": base.get("account", {}),
            "post":    base.get("post", {}),
            "reel":    base.get("reel", {}),
            "comment": {
                "commentTimestampAnchor": result.commentTimestampAnchor,
                "commentText":            result.commentText,
                "commentAuthorLink":      result.commentAuthorLink,
            },
        }
    }


_COMMENT_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of an Instagram comment panel
(visible on post detail pages and reels).

Your task: identify CSS selectors so a browser extension can inject survey forms into each
comment and extract comment metadata (timestamp anchor, body text, author profile link).

CRITICAL — Instagram uses HASHED class names that change every deploy. NEVER use class names.
Only use: tag names, role, dir, href patterns, aria-label, and structural relationships.

DOM STRUCTURE (class names omitted — they are all hashed and useless):
  <div>                                      ← scrollable comment list (contains ALL comments)
    <div>                                    ← per-comment wrapper (ONE /c/ anchor inside)
      <a href="/p/POST/c/COMMENT_ID/" role="link">  ← timestamp anchor  ← USE THIS
      <a href="/USERNAME/" role="link">             ← author profile link
      <span dir="auto">comment text here</span>     ← body text (NOT inside <a>)

RULES:
1. commentTimestampAnchor: the anchor whose href contains '/c/' and has role='link'.
   This is what the extension uses to find and identify each comment.
   Use: a[href*='/c/'][role='link']

2. commentText: the <span> with dir='auto' containing the comment body.
   It must NOT be inside an <a> tag (that would be a hashtag/mention, not the full text).
   Use: span[dir='auto']

3. commentAuthorLink: an <a role='link'> whose href is a user profile path (e.g. /username/).
   It must NOT contain '/c/' in the href (that would be the timestamp anchor).
   Use: a[role='link']:not([href*='/c/'])

These selectors are structural and stable — they will survive Instagram's class-name shuffles.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""

INSTAGRAM_COMMENT_PLATFORM_AGENT = PlatformAgent(
    name="instagram-comment",
    survey_type="instagram-comment",
    selectors_key="instagram",
    schema_class=InstagramCommentResult,
    validate_fn=_ig_comment_validate,
    to_nested_fn=_ig_comment_to_nested,
    prompt_template=_COMMENT_PROMPT,
    offline_selectors=[
        "a[role='link'][href*='/c/']",
        "span[dir='auto']",
    ],
    block_spa_scripts=True,
)
