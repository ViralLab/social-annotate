"""Instagram platform agent."""

from agents.base_agent import BaseSelectorResult, PlatformAgent, generic_validate, make_to_nested

_PROMPT = """\
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
    prompt_template=_PROMPT,
    offline_selectors=[
        "article",
        'article[role="presentation"]',
        '[role="main"] article',
        "._aatb",
    ],
)
