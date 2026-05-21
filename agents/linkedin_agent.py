"""LinkedIn platform agent."""

from agents.base_agent import BaseSelectorResult, PlatformAgent, generic_validate, make_to_nested

_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of LinkedIn (linkedin.com).

Your task: identify CSS selectors so a browser extension can inject survey forms into
each post and extract post metadata (author, text, media, metrics, timestamp).

RULES:
1. LinkedIn uses a mix of BEM class names and data attributes. Prefer data-urn,
   data-id, or stable class names (.feed-shared-update-v2, .occludable-update).
2. postContainer must match MULTIPLE individual post cards in the feed, AND each match
   must have a DIFFERENT parent node. The extension injects into postContainer.parentNode.
   Common containers: .feed-shared-update-v2, .occludable-update, [data-urn*="activity"].
3. postTimestamp: LinkedIn shows relative timestamps (e.g. "2 days ago") in a <time>
   element or a span with class .feed-shared-actor__sub-description. Use the selector
   that reliably appears inside each post.
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
    prompt_template=_PROMPT,
    offline_selectors=[
        ".feed-shared-update-v2",
        ".occludable-update",
        '[data-urn*="activity"]',
        "article",
    ],
)
