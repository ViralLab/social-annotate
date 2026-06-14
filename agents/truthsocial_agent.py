"""TruthSocial platform agent (Mastodon-based)."""

from agents.base_agent import BaseSelectorResult, PlatformAgent, generic_validate, make_to_nested

_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of TruthSocial
(truthsocial.com), which is based on the Mastodon platform.

Your task: identify CSS selectors so a browser extension can inject survey forms into
each post ("Truth") and extract post metadata (author, text, media, metrics, timestamp).

RULES:
1. TruthSocial uses Mastodon class names such as .status, .detailed-status, .entry.
   Prefer structural selectors over deeply nested class chains.
2. postContainer must match MULTIPLE individual status cards, AND each match must have a
   DIFFERENT parent node. The extension injects into postContainer.parentNode.
   Common containers: article.status, .entry, .status-public, or the outermost
   per-status div in the feed list.
3. postTimestamp: selector for the timestamp element inside a post. Also set
   postTimestampAttr to the exact HTML attribute on that element that holds the date
   string — inspect the matched element in the HTML above (e.g. 'datetime', 'aria-label',
   'title'). Do not guess: look at what attribute is actually present.
4. metricsReply / metricsRepost / metricsLike: TruthSocial uses Mastodon's action bar
   (.status__action-bar or .detailed-status__action-bar) with buttons for reply, boost,
   and favourite. Use class-based CSS selectors scoped inside each post container.
5. userHandle: look for the @username element inside each post — often .display-name__account
   or a link containing the handle.
6. Profile-page selectors may be null if this is a feed snapshot.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""

_to_nested = make_to_nested("truthsocial")

TRUTHSOCIAL_PLATFORM_AGENT = PlatformAgent(
    name="truthsocial",
    survey_type="truthsocial-post",
    schema_class=BaseSelectorResult,
    validate_fn=generic_validate,
    to_nested_fn=_to_nested,
    prompt_template=_PROMPT,
    offline_selectors=[
        "article.status",
        ".status",
        ".entry",
        ".status-public",
        '[data-id]',
    ],
)
