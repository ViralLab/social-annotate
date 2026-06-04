"""
X (Twitter) profile page agent: schema, validation, mapping, and PlatformAgent instance.
Companion to x_agent.py — targets user profile pages, not feeds.
"""

from typing import Optional
from pydantic import BaseModel, Field
from bs4 import BeautifulSoup

from agents.base_agent import PlatformAgent


# ──────────────────────────────────────────────────────────────────────────────
# Schema
# ──────────────────────────────────────────────────────────────────────────────

class XProfileSelectorResult(BaseModel):
    """Flat selector schema for X user profile pages."""

    appRoot: str = Field(
        description="CSS selector for the React root element (e.g. #react-root)."
    )
    userDisplayName: Optional[str] = Field(
        None, description="CSS selector for the user's display name on their profile page."
    )
    userHandle: Optional[str] = Field(
        None, description="CSS selector for the @username/handle on the profile page."
    )
    userProfileAvatar: Optional[str] = Field(
        None, description="CSS selector for the large profile picture on the profile page (not a post thumbnail)."
    )
    userBanner: Optional[str] = Field(
        None, description="CSS selector for the cover/banner image at the top of the profile."
    )
    userBio: Optional[str] = Field(
        None, description="CSS selector for the user's bio or description text."
    )
    userVerified: Optional[str] = Field(
        None, description="CSS selector for the verified badge/checkmark icon."
    )
    userFollowers: Optional[str] = Field(
        None, description="CSS selector for the followers count element."
    )
    userFollowing: Optional[str] = Field(
        None, description="CSS selector for the following count element."
    )
    userLocation: Optional[str] = Field(
        None, description="CSS selector for the location field on the profile."
    )
    userJoinDate: Optional[str] = Field(
        None, description="CSS selector for the join/member-since date."
    )
    userUrl: Optional[str] = Field(
        None, description="CSS selector for the website URL link on the profile."
    )


# ──────────────────────────────────────────────────────────────────────────────
# Validation
# ──────────────────────────────────────────────────────────────────────────────

def validate_x_profile_selectors(soup: BeautifulSoup, result: XProfileSelectorResult) -> str | None:
    if not soup.select(result.appRoot):
        return f"appRoot '{result.appRoot}' matched 0 elements."

    identity_fields = [
        ("userDisplayName", result.userDisplayName),
        ("userHandle",      result.userHandle),
    ]
    found = [(name, sel) for name, sel in identity_fields if sel and soup.select(sel)]
    if not found:
        provided = [(name, sel) for name, sel in identity_fields if sel]
        if not provided:
            return "Both userDisplayName and userHandle are null — at least one must be provided."
        details = ", ".join(f"{n}='{s}'" for n, s in provided)
        return f"Profile identity selectors matched nothing ({details}). The HTML may not be a profile page."

    return None


# ──────────────────────────────────────────────────────────────────────────────
# selectors.json mapping — only updates account section, preserves shared + post
# ──────────────────────────────────────────────────────────────────────────────

def to_nested_x_profile(result: XProfileSelectorResult, existing: dict | None = None) -> dict:
    base = (existing or {}).get("x", {})
    return {
        "x": {
            "shared": base.get("shared", {}),
            "account": {
                "userDisplayName":   result.userDisplayName,
                "userHandle":        result.userHandle,
                "userAvatar":        base.get("account", {}).get("userAvatar"),
                "userProfileAvatar": result.userProfileAvatar,
                "userProfileSchema": base.get("account", {}).get("userProfileSchema"),
                "userBanner":        result.userBanner,
                "userBio":           result.userBio,
                "userHeadline":      None,
                "userVerified":      result.userVerified,
                "userFollowers":     result.userFollowers,
                "userFollowing":     result.userFollowing,
                "userConnections":   None,
                "userLocation":      result.userLocation,
                "userJoinDate":      result.userJoinDate,
                "userUrl":           result.userUrl,
                "userLink":          None,
            },
            "post": base.get("post", {}),
        }
    }


# ──────────────────────────────────────────────────────────────────────────────
# Prompt
# ──────────────────────────────────────────────────────────────────────────────

_X_PROFILE_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of an X (Twitter) user profile page.

Your task: identify CSS selectors so a browser extension can extract the user's profile data
(display name, handle, bio, avatar, follower counts, etc.).

RULES:
1. Examine the HTML era. Modern X (post-2016) uses data-testid attributes — prefer those when
   present. Older Twitter archives have no data-testid; use CSS class selectors instead.
2. userHandle: the @username element on the profile page.
3. userDisplayName: the display name (distinct from the @handle — often a larger heading).
4. userProfileAvatar: the LARGE profile picture shown on the profile, not a small thumbnail.
5. userBanner: the wide cover image at the top. Set null if absent in this snapshot.
6. userBio: the bio/description text block.
7. userFollowers / userFollowing: elements containing the follower and following counts.
   May be null if not present in this snapshot.
8. All selectors are document-scoped — there is no post container to scope inside.
9. Set any field to null if genuinely absent in this snapshot.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""


# ──────────────────────────────────────────────────────────────────────────────
# PlatformAgent instance
# ──────────────────────────────────────────────────────────────────────────────

X_PROFILE_AGENT = PlatformAgent(
    name="x",
    survey_type="x-user",
    schema_class=XProfileSelectorResult,
    validate_fn=validate_x_profile_selectors,
    to_nested_fn=to_nested_x_profile,
    prompt_template=_X_PROFILE_PROMPT,
    offline_selectors=[
        '[data-testid="UserName"]',
        '[data-testid="UserProfileHeader_Items"]',
        '[data-testid="UserAvatar"]',
        ".ProfileHeaderCard",
        ".ProfileCard-bioContainer",
    ],
    block_spa_scripts=True,
)
