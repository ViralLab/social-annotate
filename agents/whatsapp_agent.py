"""WhatsApp Web platform agent."""

from agents.base_agent import BaseSelectorResult, PlatformAgent, generic_validate, make_to_nested

_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of WhatsApp Web
(web.whatsapp.com) — either a chat/group conversation or a Channel page.

Your task: identify CSS selectors so a browser extension can inject survey forms into
each message and extract message metadata (text, media, timestamp, sender).

RULES:
1. WhatsApp Web renders messages as divs with a [data-id] attribute or class names like
   .message-in / .message-out for chat messages. Channel posts may use different wrappers.
2. postContainer must match MULTIPLE individual message elements, AND each match must have
   a DIFFERENT parent node. The extension injects into postContainer.parentNode.
   Good candidates: [data-id], .message-in, .message-out, or the outermost per-message div.
3. postTimestamp: WhatsApp timestamps are in [data-pre-plain-text] attributes or
   .message-time / ._ak8q elements. If using an attribute-based selector, select the
   element that CONTAINS the attribute, not just a timestamp text node.
4. postText: WhatsApp message text is in .selectable-text or .copyable-text spans.
   For Channel posts, look for the post body container.
5. metricsReply / metricsRepost / metricsLike: Standard chat messages have no metrics —
   set all to null. Channel posts may have reaction counts; use their selector if present.
6. userDisplayName: in group chats, the sender name appears above each message bubble.
   In channels, the channel name is the "author". May be null for DM snapshots.
7. userAvatar: group chat avatars appear inline — use the img selector inside a message
   if visible; null otherwise.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""

_to_nested = make_to_nested("whatsapp")

WHATSAPP_PLATFORM_AGENT = PlatformAgent(
    name="whatsapp",
    survey_type="whatsapp-post",
    schema_class=BaseSelectorResult,
    validate_fn=generic_validate,
    to_nested_fn=_to_nested,
    prompt_template=_PROMPT,
    offline_selectors=[
        "[data-id]",
        ".message-in",
        ".message-out",
        ".focusable-list-item",
        '[role="row"]',
    ],
)
