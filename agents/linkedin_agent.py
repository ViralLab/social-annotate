"""LinkedIn platform agents — feed and user-profile variants."""

from bs4 import BeautifulSoup
from agents.base_agent import BaseSelectorResult, PlatformAgent, generic_validate, make_to_nested

# ── Feed agent ────────────────────────────────────────────────────────────────

_FEED_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of LinkedIn (linkedin.com).

Your task: identify CSS selectors so a browser extension can inject survey forms into
each post and extract post metadata (author, text, media, metrics, timestamp).

RULES:
1. LinkedIn uses a mix of semantic attributes and obfuscated class names. ALWAYS prefer
   role, aria-*, data-urn, data-id, or element type over class names. NEVER use hashed
   or obfuscated class names (random-looking lowercase strings like .b812a3bb or ._285d22c4)
   — these are build artifacts that change between deployments and will match nothing.
2. postContainer must match MULTIPLE individual post cards in the feed, AND each match
   must have a DIFFERENT parent node. The extension injects into postContainer.parentNode.
   Prefer: [role="listitem"], [data-urn*="activity"], .feed-shared-update-v2, .occludable-update.
3. postTimestamp: LinkedIn shows relative timestamps (e.g. "1d •", "3w •", "2h •") as short
   text inside a <p> or <span> element in the post header. Look for elements whose text content
   starts with a short time string (digits + letter like "1d", "3w", "2h"). Set postTimestampAttr
   to "textContent" since the date is the element's visible text, not an HTML attribute.
   The timestamp element has DIFFERENT classes than the connection-degree element (•2nd, •3rd).
   If NO such element appears anywhere in the pruned HTML, set postTimestamp to null.
4. metricsReply / metricsRepost / metricsLike: LinkedIn uses "Comment", "Repost", and
   reaction buttons. Use aria-label CSS selectors (e.g. [aria-label*="comment"]) or
   class-based selectors. metricsLike should target the reaction button.
5. userHeadline: LinkedIn shows the poster's job title below their name — use the
   selector for this headline element inside each post.
6. userConnections: on profile pages, the connections count is shown — use its selector
   or null if not visible.
7. Profile-page selectors may be null if this is a feed snapshot.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""

_to_nested = make_to_nested("linkedin")

LINKEDIN_PLATFORM_AGENT = PlatformAgent(
    name="linkedin",
    survey_type="linkedin-post",
    schema_class=BaseSelectorResult,
    validate_fn=generic_validate,
    to_nested_fn=_to_nested,
    prompt_template=_FEED_PROMPT,
    offline_selectors=[
        ".feed-shared-update-v2",
        ".occludable-update",
        '[data-urn*="activity"]',
        "article",
    ],
)

# ── User-profile agent ────────────────────────────────────────────────────────

_USER_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of a LinkedIn user profile page.

Your task: identify CSS selectors so a browser extension can extract profile metadata
(display name, headline, bio, connections, avatar, location, etc.).

RULES:
1. LinkedIn uses obfuscated class names (random lowercase strings like .b812a3bb).
   NEVER use hashed class names. ALWAYS prefer role, aria-*, data-urn, element type,
   and semantic class names like .pv-text-details or .top-card-layout.
2. For postContainer: the profile page may show a recent activity feed below the profile
   card. If so, set postContainer to the activity post wrapper. If no feed is visible,
   set postContainer to the profile-intro section (e.g. section[data-member-id]) so the
   extension has at least one injection target — a single match is acceptable here.
3. userDisplayName: selector for the profile's full name (e.g. h1).
4. userHeadline: selector for the professional headline below the name.
5. userBio: selector for the "About" section text.
6. userConnections: selector for the connections count (e.g. "500+ connections").
7. userProfileAvatar: selector for the profile photo.
8. userLocation: selector for the location line under the headline.
9. Post-level selectors (postText, metricsLike, etc.) may be null if no activity feed
   is visible.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""


def _linkedin_user_validate(soup: BeautifulSoup, result: BaseSelectorResult) -> str | None:
    """Profile-page validation: only require appRoot and at least one profile selector."""
    if not soup.select(result.appRoot):
        return f"appRoot '{result.appRoot}' matched 0 elements."

    profile_fields = [
        result.userDisplayName, result.userHeadline, result.userBio,
        result.userProfileAvatar, result.userConnections,
    ]
    if not any(f and soup.select(f) for f in profile_fields):
        return (
            "No profile selectors matched: userDisplayName, userHeadline, userBio, "
            "userProfileAvatar, and userConnections all returned 0 elements."
        )
    return None


LINKEDIN_USER_PLATFORM_AGENT = PlatformAgent(
    name="linkedin-user",
    survey_type="linkedin-user",
    schema_class=BaseSelectorResult,
    validate_fn=_linkedin_user_validate,
    to_nested_fn=_to_nested,
    prompt_template=_USER_PROMPT,
    offline_selectors=[
        "section[data-member-id]",
        ".pv-top-card",
        ".top-card-layout",
        "main",
    ],
)
