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
5. Instagram does NOT show follower counts in the feed — userFollowers / userFollowing
   may be null for feed snapshots.
6. Profile-page selectors may be null if this is a feed snapshot.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""

_to_nested = make_to_nested("instagram")

INSTAGRAM_PLATFORM_AGENT = PlatformAgent(
    name="instagram",
    survey_type="instagram-post",
    schema_class=BaseSelectorResult,
    validate_fn=generic_validate,
    to_nested_fn=_to_nested,
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
