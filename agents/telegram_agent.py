"""Telegram Web platform agent (t.me channel preview / web.telegram.org)."""

from agents.base_agent import BaseSelectorResult, PlatformAgent, generic_validate, make_to_nested

_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of Telegram Web
(t.me channel preview page or web.telegram.org).

Your task: identify CSS selectors so a browser extension can inject survey forms into
each message and extract message metadata (text, media, timestamp, views).

RULES:
1. For t.me channel preview pages, messages are in .tgme_widget_message elements.
   For web.telegram.org, messages are in .message elements inside chat containers.
2. postContainer must match MULTIPLE individual message elements, AND each match must
   have a DIFFERENT parent node. The extension injects into postContainer.parentNode.
   For t.me: use .tgme_widget_message_wrap or .tgme_widget_message.
   For web.telegram.org: use .message.base or a similar per-message wrapper.
3. postTimestamp: Telegram timestamps are in <time> elements or .tgme_widget_message_date
   anchors. The href usually links to https://t.me/{channel}/{message_id}.
4. metricsReply: Telegram channels don't have traditional reply buttons visible —
   set to null unless explicitly present.
   metricsRepost: set to null (not applicable for channels).
   metricsLike: Telegram has reaction buttons on some messages — use the reaction
   button selector if present, otherwise null.
5. postText: look for .tgme_widget_message_text or equivalent text container.
6. Views: Telegram channels show view counts in .tgme_widget_message_views —
   include in metricsReply if applicable, or leave metrics null.
7. userDisplayName / userHandle: Telegram channel names — often in .tgme_channel_info_header
   or page title; may be null for individual message snapshots.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""

_to_nested = make_to_nested("telegram")

TELEGRAM_PLATFORM_AGENT = PlatformAgent(
    name="telegram",
    survey_type="telegram-post",
    schema_class=BaseSelectorResult,
    validate_fn=generic_validate,
    to_nested_fn=_to_nested,
    prompt_template=_PROMPT,
    offline_selectors=[
        ".tgme_widget_message",
        ".tgme_widget_message_wrap",
        ".message.base",
        ".message",
    ],
)
