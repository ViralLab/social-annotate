"""
X (Twitter) platform agent: Pydantic schema, BeautifulSoup validation,
mapping from flat LLM output → nested selectors.json format, and PlatformAgent instance.
"""

import re
from typing import Optional
from pydantic import BaseModel, Field
from bs4 import BeautifulSoup

from agents.base_agent import PlatformAgent


# ──────────────────────────────────────────────────────────────────────────────
# Schema (flat — matched to what the LLM is asked to produce)
# ──────────────────────────────────────────────────────────────────────────────

class XSelectorResult(BaseModel):
    """
    Flat selector schema for LLM extraction.
    Fields match the keys that inject.js merges from selectors.x.{shared,account,post}.
    """

    # Root
    appRoot: str = Field(
        description="CSS selector for the React SPA root element (e.g. #react-root)."
    )

    # Post structure (critical — must match multiple per-post containers)
    postContainer: str = Field(
        description=(
            "CSS selector that uniquely wraps a single tweet/post card. "
            "Must match MULTIPLE elements in the feed (use [data-testid='tweet'] or article[role='article'])."
        )
    )
    postText: str = Field(
        description="CSS selector for the text body of a post (e.g. [data-testid='tweetText'])."
    )
    postImage: Optional[str] = Field(
        None,
        description="CSS selector for image attachments inside a post (not profile pictures).",
    )
    postVideo: Optional[str] = Field(
        None,
        description="CSS selector for video elements inside a post.",
    )
    postTimestamp: str = Field(
        description=(
            "CSS selector for the <time> element inside a post. "
            "Its parent anchor must href to a /status/{id} URL."
        )
    )
    cardWrapper: Optional[str] = Field(
        None,
        description="CSS selector for external link preview cards inside a post.",
    )

    # Metrics — KEYWORDS, not CSS selectors.
    # Return None for any metric that is genuinely absent in this HTML snapshot
    # (e.g. an old archive where engagement buttons did not exist).
    metricsReply: Optional[str] = Field(
        None,
        description=(
            "Short keyword found in the reply button's aria-label "
            "(e.g. 'reply', 'comment'). NOT a CSS selector. "
            "Set to null if reply buttons are absent in this HTML."
        ),
    )
    metricsRepost: Optional[str] = Field(
        None,
        description=(
            "Short keyword found in the repost/retweet button's aria-label "
            "(e.g. 'retweet', 'repost'). NOT a CSS selector. "
            "Set to null if repost buttons are absent in this HTML."
        ),
    )
    metricsLike: Optional[str] = Field(
        None,
        description=(
            "Short keyword found in the like/favorite button's aria-label "
            "(e.g. 'like', 'favorite'). NOT a CSS selector. "
            "Set to null if like buttons are absent in this HTML."
        ),
    )
    metricsBookmark: Optional[str] = Field(
        None,
        description=(
            "Short keyword found in the bookmark button's aria-label. "
            "E.g. 'bookmark'. NOT a CSS selector."
        ),
    )

    # Account / profile (can be null for feed-only snapshots)
    userDisplayName: Optional[str] = Field(
        None,
        description="CSS selector for the display name inside a post.",
    )
    userHandle: Optional[str] = Field(
        None,
        description="CSS selector for the @handle inside a post.",
    )
    userAvatar: Optional[str] = Field(
        None,
        description="CSS selector for the profile picture thumbnail inside a post.",
    )
    userProfileAvatar: Optional[str] = Field(
        None,
        description="CSS selector for the main profile picture on a profile page.",
    )
    userBanner: Optional[str] = Field(
        None,
        description="CSS selector for the banner/cover image on a user profile page.",
    )
    userBio: Optional[str] = Field(
        None,
        description="CSS selector for the user bio/description on a profile page.",
    )
    userVerified: Optional[str] = Field(
        None,
        description="CSS selector for the verified badge icon.",
    )
    userFollowers: Optional[str] = Field(
        None,
        description="CSS selector for the followers count link on a profile page.",
    )
    userFollowing: Optional[str] = Field(
        None,
        description="CSS selector for the following count link on a profile page.",
    )
    userLocation: Optional[str] = Field(
        None,
        description="CSS selector for the user location element on a profile page.",
    )
    userJoinDate: Optional[str] = Field(
        None,
        description="CSS selector for the join date element on a profile page.",
    )
    userUrl: Optional[str] = Field(
        None,
        description="CSS selector for the user website URL element on a profile page.",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

_CSS_CHARS = re.compile(r'[\s.#\[\]>:+~]')


def _metric_hits(containers: list, value: str) -> int:
    """
    Mirror inject.js findMetricElement logic:
    - value contains CSS special chars → use as direct CSS selector
    - otherwise → try [data-testid="{value}"] and [data-testid="un{value}"]
    Returns count of containers where the element is found.
    """
    if not value:
        return 0
    is_selector = bool(_CSS_CHARS.search(value))
    found = 0
    for c in containers[:15]:
        if is_selector:
            el = c.select_one(value)
        else:
            el = (
                c.select_one(f'[data-testid="{value}"]')
                or c.select_one(f'[data-testid="un{value}"]')
            )
        if el:
            found += 1
    return found


# ──────────────────────────────────────────────────────────────────────────────
# Validation
# ──────────────────────────────────────────────────────────────────────────────

def validate_x_selectors(soup: BeautifulSoup, result: XSelectorResult) -> str | None:
    """
    BeautifulSoup-based validation of generated selectors.
    Returns an error string if any critical check fails, None on success.
    """

    # 1. appRoot must exist
    if not soup.select(result.appRoot):
        return f"appRoot '{result.appRoot}' matched 0 elements."

    # 2. postContainer must match multiple posts
    containers = soup.select(result.postContainer)
    if not containers:
        return f"postContainer '{result.postContainer}' matched 0 elements."
    if len(containers) < 2:
        return (
            f"postContainer '{result.postContainer}' matched only {len(containers)} element — "
            "expected multiple per-post containers."
        )

    # 2b. All postContainer elements must NOT share the same parent.
    # inject.js injects the survey into postContainer.parentNode; if every container
    # has the same parent (e.g. <li> children of a single <ol>), only one form appears.
    unique_parents = {id(c.parent) for c in containers}
    if len(unique_parents) == 1:
        parent_tag = containers[0].parent.name if containers[0].parent else "?"
        return (
            f"postContainer '{result.postContainer}' matched {len(containers)} elements "
            f"that all share the same <{parent_tag}> parent. "
            "The extension injects into parentNode, so only one form would appear. "
            "Select a child element INSIDE each tweet wrapper instead, so each match "
            "has a different parent (the unique per-tweet node)."
        )

    # 3. postTimestamp must find <time> whose parent href includes /status/
    good = 0
    for c in containers:
        ts = c.select_one(result.postTimestamp)
        if ts:
            parent = ts.parent
            href = (parent.get("href") or "") if parent else ""
            if "/status/" in href:
                good += 1

    min_good = max(2, len(containers) // 3)
    if good < min_good:
        return (
            f"postTimestamp '{result.postTimestamp}': only {good}/{len(containers)} containers "
            "had a <time> element whose parent links to /status/."
        )

    # 4. postText must hit at least one container
    if result.postText:
        text_hits = sum(1 for c in containers if c.select_one(result.postText))
        if text_hits == 0:
            return f"postText '{result.postText}' matched 0 containers."

    # 5. Metrics check — only for fields the LLM did not explicitly set to None.
    # A None value means the LLM determined that metric is absent in this HTML.
    metric_fields = [
        ("metricsReply",  result.metricsReply),
        ("metricsRepost", result.metricsRepost),
        ("metricsLike",   result.metricsLike),
    ]
    provided = [(name, val) for name, val in metric_fields if val is not None]

    if not provided:
        # LLM signalled no engagement buttons in this snapshot — skip check.
        pass
    else:
        hits = [(name, val, _metric_hits(containers, val)) for name, val in provided]
        found = sum(1 for _, _, h in hits if h > 0)
        # Require all provided metrics to hit; allow 1 miss only when 3 are provided.
        min_required = len(provided) if len(provided) < 3 else 2
        if found < min_required:
            details = ", ".join(f"{n}='{v}' ({h} hits)" for n, v, h in hits)
            return (
                f"Metrics not found in post containers ({details}). "
                "For modern X use data-testid tokens like 'reply', 'retweet', 'like'. "
                "For old Twitter use CSS class selectors. "
                "If this snapshot genuinely has no engagement buttons, set the field to null."
            )

    return None


# ──────────────────────────────────────────────────────────────────────────────
# selectors.json mapping
# ──────────────────────────────────────────────────────────────────────────────

def to_nested_selectors(result: XSelectorResult, existing: dict | None = None) -> dict:
    """
    Map flat XSelectorResult → the nested selectors.json structure expected by inject.js.

    Non-LLM fields (observerFilter, platform-specific nulls) are preserved from
    `existing` if present, or set to safe defaults.
    """
    base_x = (existing or {}).get("x", {})
    base_shared = base_x.get("shared", {})
    base_account = base_x.get("account", {})
    base_post = base_x.get("post", {})

    return {
        "x": {
            "shared": {
                "appRoot": result.appRoot,
                "observerFilter": base_shared.get("observerFilter") or {
                    "attributes": True,
                    "childList": True,
                    "subtree": True,
                    "attributeFilter": ["role"],
                },
            },
            "account": {
                "userDisplayName": result.userDisplayName,
                "userHandle": result.userHandle,
                "userAvatar": result.userAvatar,
                "userProfileAvatar": result.userProfileAvatar,
                # Preserve existing schema selector — not producible by LLM
                "userProfileSchema": base_account.get("userProfileSchema"),
                "userBanner": result.userBanner,
                "userBio": result.userBio,
                "userHeadline": None,
                "userVerified": result.userVerified,
                "userFollowers": result.userFollowers,
                "userFollowing": result.userFollowing,
                "userConnections": None,
                "userLocation": result.userLocation,
                "userJoinDate": result.userJoinDate,
                "userUrl": result.userUrl,
                "userLink": None,
            },
            "post": {
                "postContainer": result.postContainer,
                "postText": result.postText,
                "postImage": result.postImage,
                "postVideo": result.postVideo,
                "postTimestamp": result.postTimestamp,
                "postLink": None,
                "cardWrapper": result.cardWrapper,
                "conversationMessages": None,
                "messageContainer": None,
                "copyableText": None,
                "metricsReply": result.metricsReply,
                "metricsRepost": result.metricsRepost,
                "metricsLike": result.metricsLike,
                "metricsBookmark": result.metricsBookmark,
                "metricsViews": None,
                "metricsQuote": None,
                "metricsViewsPattern": base_post.get("metricsViewsPattern") or "views?",
            },
        }
    }


# ──────────────────────────────────────────────────────────────────────────────
# X prompt template
# ──────────────────────────────────────────────────────────────────────────────

_X_PROMPT_TEMPLATE = """\
You are an expert web scraper analyzing a saved HTML snapshot of X (formerly Twitter).

Your task: identify CSS selectors so a browser extension can inject survey forms into
each post and extract post metadata (ID, author, text, media, metrics).

RULES:
1. Prefer data-testid attributes over class names — X uses these for stable targeting.
2. postContainer must match MULTIPLE individual tweet cards in the feed, AND each matched
   element must have a DIFFERENT parent node. The extension injects the survey into
   postContainer's parentNode — if all postContainer elements share the same parent (e.g.
   you selected <li> items whose parent is a single <ol>), only one form will appear.
   Fix: select a direct child INSIDE each tweet wrapper instead of the wrapper itself,
   so that parentNode resolves to the unique per-tweet element.
3. postTimestamp selects the <time> element whose parent <a> href contains /status/{{id}}.
4. For metricsReply / metricsRepost / metricsLike / metricsBookmark: provide a value that
   locates the action button element inside each post. The value is interpreted as follows:
   - If it contains any CSS special characters (space . # [ ] > : + ~) → used as querySelector
   - Otherwise → used as data-testid lookup: [data-testid="<value>"] or [data-testid="un<value>"]
   Examine the HTML to determine which form applies. The element must exist inside post containers.
5. Profile-page selectors (userBanner, userFollowers, etc.) may be null if not visible
   in this feed snapshot.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""

# ──────────────────────────────────────────────────────────────────────────────
# PlatformAgent instance for X
# ──────────────────────────────────────────────────────────────────────────────

X_PLATFORM_AGENT = PlatformAgent(
    name="x",
    survey_type="x-post",
    schema_class=XSelectorResult,
    validate_fn=validate_x_selectors,
    to_nested_fn=to_nested_selectors,
    prompt_template=_X_PROMPT_TEMPLATE,
    offline_selectors=[
        'article[role="article"]',
        '[data-testid="tweet"]',
        '[data-testid="tweetText"]',
        "li.hentry",
        "[data-id]",
    ],
)
