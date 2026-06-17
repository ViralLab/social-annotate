"""TikTok platform agents — feed and user-profile variants."""

from bs4 import BeautifulSoup
from agents.base_agent import BaseSelectorResult, PlatformAgent, make_to_nested

# ── Feed agent ────────────────────────────────────────────────────────────────

_FEED_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of TikTok (tiktok.com).

Your task: identify CSS selectors so a browser extension can inject survey forms into
each video post and extract post metadata (author, description, metrics).

RULES:
1. TikTok uses data-e2e attributes for stable identification. ALWAYS prefer these over
   class names. Class names like .css-6wvhtq-... are hashed build artifacts that change.
2. postContainer: use article[data-e2e="recommend-list-item-container"].
   All articles share the same parent (#column-list-container) — this is expected for TikTok.
   The extension injects INSIDE each postContainer (not into parentNode), so shared parents
   are fine. Do NOT select a child of the article as postContainer.
3. postText: the video description/caption — use [data-e2e="video-desc"].
   Some videos have no caption; if video-desc appears in any post, use it.
   If no video-desc is found, set postText to [data-e2e="feed-video"].
4. Metrics use these data-e2e selectors (all are strong or span elements):
     metricsLike     → strong[data-e2e="like-count"]
     metricsReply    → strong[data-e2e="comment-count"]
     metricsBookmark → strong[data-e2e="favorite-count"]
     metricsRepost   → strong[data-e2e="share-count"]
5. postTimestamp: TikTok feed does not show per-post timestamps. Set postTimestamp to null.
6. userAvatar: a[data-e2e="video-author-avatar"] — the link wrapping the author avatar.
7. postVideo: [data-e2e="feed-video"] video — the video element inside the card.
8. appRoot: #app
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""


def _tiktok_feed_validate(soup: BeautifulSoup, result: BaseSelectorResult) -> str | None:
    if not soup.select(result.appRoot):
        return f"appRoot '{result.appRoot}' matched 0 elements."

    containers = soup.select(result.postContainer)
    if not containers:
        return f"postContainer '{result.postContainer}' matched 0 elements."
    if len(containers) < 2:
        return (
            f"postContainer '{result.postContainer}' matched only {len(containers)} element — "
            "expected multiple video post containers."
        )
    # TikTok articles all share the same parent (#column-list-container) — skip unique-parent check.

    if result.postText:
        text_hits = sum(1 for c in containers if c.select_one(result.postText))
        if text_hits == 0:
            return f"postText '{result.postText}' matched 0 containers."

    return None


_to_nested = make_to_nested("tiktok")

TIKTOK_PLATFORM_AGENT = PlatformAgent(
    name="tiktok",
    survey_type="tiktok-reel",
    schema_class=BaseSelectorResult,
    validate_fn=_tiktok_feed_validate,
    to_nested_fn=_to_nested,
    prompt_template=_FEED_PROMPT,
    offline_selectors=[
        'article[data-e2e="recommend-list-item-container"]',
        '[data-e2e="recommend-list-item-container"]',
        '[data-e2e="feed-video"]',
    ],
    block_spa_scripts=True,
)

# ── User-profile agent ────────────────────────────────────────────────────────

_USER_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of a TikTok user profile page.

Your task: identify CSS selectors so a browser extension can extract profile metadata
(display name, username, bio, followers, following, likes, avatar).

RULES:
1. TikTok uses data-e2e attributes for stable identification. ALWAYS prefer these.
2. userDisplayName: h1[data-e2e="user-title"] — the displayed name.
3. userHandle: h2[data-e2e="user-subtitle"] — the @username shown below the name.
4. userAvatar: [data-e2e="user-avatar"] or img inside it.
5. userFollowers: strong[data-e2e="followers-count"]
6. userFollowing: strong[data-e2e="following-count"]
7. userBio: h2[data-e2e="user-bio"] (may be absent if bio is empty).
8. postContainer: [data-e2e="user-post-item"] — the video thumbnails in the profile grid.
9. postText: null — no description shown on profile grid thumbnails.
10. appRoot: #app
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""


def _tiktok_user_validate(soup: BeautifulSoup, result: BaseSelectorResult) -> str | None:
    if not soup.select(result.appRoot):
        return f"appRoot '{result.appRoot}' matched 0 elements."

    profile_fields = [
        result.userDisplayName, result.userHandle, result.userBio,
        result.userProfileAvatar, result.userFollowers,
    ]
    if not any(f and soup.select(f) for f in profile_fields):
        return (
            "No profile selectors matched: userDisplayName, userHandle, userBio, "
            "userProfileAvatar, and userFollowers all returned 0 elements."
        )
    return None


TIKTOK_USER_PLATFORM_AGENT = PlatformAgent(
    name="tiktok-user",
    survey_type="tiktok-user",
    schema_class=BaseSelectorResult,
    validate_fn=_tiktok_user_validate,
    to_nested_fn=_to_nested,
    prompt_template=_USER_PROMPT,
    offline_selectors=[
        '[data-e2e="user-page"]',
        '[data-e2e="user-title"]',
        'main',
    ],
    block_spa_scripts=True,
)
