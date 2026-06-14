"""Bluesky platform agent."""

from agents.base_agent import BaseSelectorResult, PlatformAgent, generic_validate, make_to_nested

_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of Bluesky (bsky.app).

Your task: identify CSS selectors so a browser extension can inject survey forms into
each post and extract post metadata (author, text, media, metrics, timestamp).

RULES:
1. Bluesky uses React with data-testid attributes — prefer these for stability.
2. postContainer must match MULTIPLE individual post cells in the feed, AND each match
   must have a DIFFERENT parent node. The extension injects into postContainer.parentNode.
   Common post containers: [data-testid^="feedItem-"], [data-testid="postThreadItem-by-"],
   or the top-level div wrapping each feed card.
3. postTimestamp: selector for the timestamp element inside a post. Also set
   postTimestampAttr to the exact HTML attribute on that element that holds the date
   string — inspect the element in the HTML above (e.g. 'datetime', 'aria-label', 'title').
   Do not guess: look at what attribute is present on the matched element.
4. metricsReply / metricsRepost / metricsLike: Bluesky posts have reply, repost, and
   like buttons with aria-label or data-testid attributes. Use data-testid values if
   present; otherwise use aria-label CSS selectors.
5. userHandle: the @handle appears in feed posts — look for links to /profile/{handle}.
6. Profile-page selectors may be null if this is a feed snapshot.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""

_to_nested = make_to_nested("bluesky")

BLUESKY_PLATFORM_AGENT = PlatformAgent(
    name="bluesky",
    survey_type="bluesky-post",
    schema_class=BaseSelectorResult,
    validate_fn=generic_validate,
    to_nested_fn=_to_nested,
    prompt_template=_PROMPT,
    offline_selectors=[
        '[data-testid^="feedItem-"]',
        '[data-testid="postThreadItem-by-"]',
        '[data-testid^="post-"]',
        "article",
    ],
    block_spa_scripts=False,
)
