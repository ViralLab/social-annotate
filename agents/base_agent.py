"""
Shared base schema, generic validation/mapping, and PlatformAgent dataclass.
Each platform agent imports from here and exports a PlatformAgent instance.
"""

import re
from dataclasses import dataclass
from typing import Any, Callable, Optional
from pydantic import BaseModel, Field
from bs4 import BeautifulSoup


# ──────────────────────────────────────────────────────────────────────────────
# Shared Pydantic schema
# ──────────────────────────────────────────────────────────────────────────────

class BaseSelectorResult(BaseModel):
    """
    Platform-agnostic flat selector schema for LLM extraction.
    All field names match the keys used in selectors.json.
    Platform agents subclass or reuse this with tailored Field descriptions.
    """

    # Root
    appRoot: str = Field(
        description="CSS selector for the app root element (e.g. #react-root, #root, body)."
    )

    # Post structure
    postContainer: str = Field(
        description=(
            "CSS selector that wraps one post/message. Must match MULTIPLE elements AND "
            "each match must have a DIFFERENT parent node — the extension injects the survey "
            "into postContainer.parentNode, so shared parents mean only one form appears."
        )
    )
    postText: str = Field(
        description="CSS selector for the text/body of a post, scoped inside postContainer."
    )
    postImage: Optional[str] = Field(
        None, description="CSS selector for image attachments inside a post (not avatars)."
    )
    postVideo: Optional[str] = Field(
        None, description="CSS selector for video elements inside a post."
    )
    postTimestamp: Optional[str] = Field(
        None, description="CSS selector for the timestamp element inside a post."
    )
    cardWrapper: Optional[str] = Field(
        None, description="CSS selector for external link preview cards inside a post."
    )

    # Metrics
    metricsReply: Optional[str] = Field(
        None,
        description=(
            "Value to locate the reply/comment action inside a post. "
            "If it contains CSS special chars (space . # [ ] > : + ~) it is used as querySelector; "
            "otherwise it is matched as [data-testid=<value>] or [data-testid=un<value>]. "
            "Set null if genuinely absent in this HTML."
        ),
    )
    metricsRepost: Optional[str] = Field(
        None,
        description=(
            "Value for repost/share action. Same lookup rules as metricsReply. Null if absent."
        ),
    )
    metricsLike: Optional[str] = Field(
        None,
        description=(
            "Value for like/favourite/reaction action. Same lookup rules. Null if absent."
        ),
    )
    metricsBookmark: Optional[str] = Field(
        None, description="Value for bookmark action. Same lookup rules. Null if absent."
    )

    # Account / profile
    userDisplayName: Optional[str] = Field(
        None, description="CSS selector for display name inside a post."
    )
    userHandle: Optional[str] = Field(
        None, description="CSS selector for @handle or unique username inside a post."
    )
    userAvatar: Optional[str] = Field(
        None, description="CSS selector for profile picture thumbnail inside a post."
    )
    userProfileAvatar: Optional[str] = Field(
        None, description="CSS selector for main profile picture on a profile page."
    )
    userBanner: Optional[str] = Field(
        None, description="CSS selector for banner/cover image on a profile page."
    )
    userBio: Optional[str] = Field(
        None, description="CSS selector for user bio/description on a profile page."
    )
    userHeadline: Optional[str] = Field(
        None, description="CSS selector for user headline/tagline (e.g. LinkedIn job title)."
    )
    userVerified: Optional[str] = Field(
        None, description="CSS selector for verified badge icon."
    )
    userFollowers: Optional[str] = Field(
        None, description="CSS selector for followers count on a profile page."
    )
    userFollowing: Optional[str] = Field(
        None, description="CSS selector for following count on a profile page."
    )
    userConnections: Optional[str] = Field(
        None, description="CSS selector for connections count (e.g. LinkedIn connections)."
    )
    userLocation: Optional[str] = Field(
        None, description="CSS selector for user location on a profile page."
    )
    userJoinDate: Optional[str] = Field(
        None, description="CSS selector for join/member-since date on a profile page."
    )
    userUrl: Optional[str] = Field(
        None, description="CSS selector for user website URL on a profile page."
    )


# ──────────────────────────────────────────────────────────────────────────────
# Generic validation helpers
# ──────────────────────────────────────────────────────────────────────────────

_CSS_CHARS = re.compile(r'[\s.#\[\]>:+~]')


def _metric_hits(containers: list, value: str) -> int:
    """Mirror inject.js findMetricElement: keyword → data-testid; CSS → querySelector."""
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


def generic_validate(soup: BeautifulSoup, result: BaseSelectorResult) -> str | None:
    """
    Generic BeautifulSoup validation for all platforms:
      1. appRoot exists
      2. postContainer matches multiple elements
      3. Matched elements have different parent nodes
      4. postText hits at least one container
    """
    if not soup.select(result.appRoot):
        return f"appRoot '{result.appRoot}' matched 0 elements."

    containers = soup.select(result.postContainer)
    if not containers:
        return f"postContainer '{result.postContainer}' matched 0 elements."
    if len(containers) < 2:
        return (
            f"postContainer '{result.postContainer}' matched only {len(containers)} element — "
            "expected multiple post containers."
        )

    unique_parents = {id(c.parent) for c in containers}
    if len(unique_parents) == 1:
        parent_tag = containers[0].parent.name if containers[0].parent else "?"
        return (
            f"postContainer '{result.postContainer}' matched {len(containers)} elements "
            f"that all share the same <{parent_tag}> parent. "
            "The extension injects into parentNode — select a child element INSIDE each "
            "post wrapper so each match has a different parent."
        )

    if result.postText:
        text_hits = sum(1 for c in containers if c.select_one(result.postText))
        if text_hits == 0:
            return f"postText '{result.postText}' matched 0 containers."

    return None


# ──────────────────────────────────────────────────────────────────────────────
# Generic selectors.json mapping
# ──────────────────────────────────────────────────────────────────────────────

def make_to_nested(platform: str) -> Callable:
    """
    Factory: returns a to_nested_selectors(result, existing) function for the given
    platform key. Maps flat BaseSelectorResult → {platform: {shared, account, post}}.
    """
    def to_nested(result: BaseSelectorResult, existing: dict | None = None) -> dict:
        base = (existing or {}).get(platform, {})
        base_shared = base.get("shared", {})
        base_account = base.get("account", {})
        base_post = base.get("post", {})

        return {
            platform: {
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
                    "userProfileSchema": base_account.get("userProfileSchema"),
                    "userBanner": result.userBanner,
                    "userBio": result.userBio,
                    "userHeadline": result.userHeadline,
                    "userVerified": result.userVerified,
                    "userFollowers": result.userFollowers,
                    "userFollowing": result.userFollowing,
                    "userConnections": result.userConnections,
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
    return to_nested


# ──────────────────────────────────────────────────────────────────────────────
# PlatformAgent dataclass
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class PlatformAgent:
    """Bundle of platform-specific logic consumed by SelectorHealer."""

    name: str
    survey_type: str
    schema_class: type[BaseModel]
    validate_fn: Callable[[BeautifulSoup, Any], str | None]
    to_nested_fn: Callable[[Any, dict | None], dict]
    prompt_template: str
    offline_selectors: list[str]
    block_spa_scripts: bool = True
