"""Mastodon platform agent — home timeline feed."""

from agents.base_agent import BaseSelectorResult, PlatformAgent, generic_validate, make_to_nested

_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of Mastodon
(mastodon.social or any Mastodon v4.x instance).

Your task: identify CSS selectors so a browser extension can inject survey forms
into each post and extract post metadata (author, text, media, timestamp, metrics).

RULES:
1. appRoot: Mastodon mounts as a React SPA inside '#mastodon'. Use '#mastodon'.
2. postContainer: each status (toot) in the timeline is wrapped in a div or article
   with the class '.status__wrapper'. This is the per-post container — do NOT select
   the column scroll container, only the individual status wrappers.
   Use: .status__wrapper
3. postText: the body text lives in '.status__content'. Use that.
4. postTimestamp: each post has a timestamp element inside
   'a.status__relative-time time' — use the 'datetime' attribute for the ISO value.
5. metricsReply / metricsLike / metricsBookmark: Mastodon uses icon-buttons inside
   '.status__action-bar'. Use aria-label or title attribute selectors to identify each:
   - reply:    .status__action-bar .icon-button[title="Reply"]
   - boost:    .status__action-bar .icon-button[title="Boost"]
   - favourite:.status__action-bar .icon-button[title="Favourite"]
   - bookmark: .status__action-bar .icon-button[title="Bookmark"]
   Put the boost selector in metricsRepost.
6. postImage: look inside '.media-gallery img' or '.attachment-thumbnail__image'.
7. Profile-page selectors (userFollowers, userBio, etc.) may be null if this is a
   feed/timeline snapshot.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""

_to_nested = make_to_nested("mastodon")

MASTODON_PLATFORM_AGENT = PlatformAgent(
    name="mastodon",
    survey_type="mastodon-post",
    schema_class=BaseSelectorResult,
    validate_fn=generic_validate,
    to_nested_fn=_to_nested,
    prompt_template=_PROMPT,
    offline_selectors=[
        ".status__wrapper",
        "article.status",
        '[role="article"]',
    ],
    block_spa_scripts=False,
)
