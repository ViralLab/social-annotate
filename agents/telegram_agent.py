"""Telegram Web platform agent (web.telegram.org)."""

from typing import Optional
from pydantic import Field
from bs4 import BeautifulSoup
from agents.base_agent import BaseSelectorResult, PlatformAgent


class TelegramSelectorResult(BaseSelectorResult):
    """Extends base schema with Telegram-specific messageSignature field."""
    messageSignature: Optional[str] = Field(
        None,
        description=(
            "CSS selector for the per-message channel author signature, scoped inside each "
            "message container. Present in channels (e.g. .message-signature) — null for DMs."
        ),
    )


def _tg_validate(soup: BeautifulSoup, result: TelegramSelectorResult) -> str | None:
    # appRoot
    if not soup.select(result.appRoot):
        return f"appRoot '{result.appRoot}' matched 0 elements."

    # postContainer: must match multiple elements
    # NOTE: Telegram injects beforebegin each message node (not into parentNode), so
    # the parent-uniqueness check from generic_validate does NOT apply here.
    containers = soup.select(result.postContainer)
    if not containers:
        return f"postContainer '{result.postContainer}' matched 0 elements."
    if len(containers) < 2:
        return (
            f"postContainer '{result.postContainer}' matched only {len(containers)} element — "
            "expected multiple message containers."
        )

    # postText must hit at least one container
    if result.postText:
        hits = sum(1 for c in containers if c.select_one(result.postText))
        if hits == 0:
            return f"postText '{result.postText}' matched 0 containers."

    # messageSignature may be null (DMs have none) — only validate when set
    if result.messageSignature:
        hits = sum(1 for c in containers[:15] if c.select_one(result.messageSignature))
        if hits == 0:
            return (
                f"messageSignature '{result.messageSignature}' matched 0 message containers. "
                "Set to null if this is a DM fixture (DMs have no per-message author signature)."
            )
    return None


def _tg_to_nested(result: TelegramSelectorResult, existing: dict | None = None) -> dict:
    base = (existing or {}).get("telegram", {})
    base_shared = base.get("shared", {})
    base_post = base.get("post", {})

    output = {
        "telegram": {
            "shared": {
                "appRoot": result.appRoot,
                "observerFilter": base_shared.get("observerFilter") or {
                    "attributes": False,
                    "childList": True,
                    "subtree": True,
                },
            },
            "account": base.get("account", {}),
            "post": {
                "postContainer":      result.postContainer,
                "postText":           result.postText,
                "postImage":          result.postImage,
                "postVideo":          result.postVideo,
                "postTimestamp":      result.postTimestamp,
                "postTimestampAttr":  result.postTimestampAttr,
                "postLink":           None,
                "cardWrapper":        result.cardWrapper,
                "conversationMessages": base_post.get("conversationMessages") or ".MessageList .messages-container",
                "messageContainer":   None,
                "copyableText":       None,
                "metricsReply":       result.metricsReply,
                "metricsRepost":      result.metricsRepost,
                "metricsLike":        result.metricsLike,
                "metricsBookmark":    result.metricsBookmark,
                "metricsViews":       result.metricsViews,
                "metricsQuote":       None,
                "metricsViewsPattern": base_post.get("metricsViewsPattern"),
                "messageSignature":   result.messageSignature,
            },
        }
    }
    return output


_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of Telegram Web
(web.telegram.org — the web client, NOT t.me preview pages).

Your task: identify CSS selectors so a browser extension can inject survey forms into
each message and extract message metadata (text, media, timestamp, view count).

DOM STRUCTURE (Telegram Web K/A — class names are stable, NOT hashed):
  body
    div.MiddleColumn
      div.MessageList
        div.messages-container
          div.Message  ← one per message
            div.message-content-wrapper
              div.text-content   ← message text
              div.message-time   ← timestamp (visible text like "17:54")
              span.message-views ← view count (channels only, e.g. "10.3M")
              span.message-signature  ← channel author name (channels only, e.g. "Pavel Durov")
    div.ChatInfo
      div.info
        h3.fullName  ← channel/contact name in the chat header

RULES:
1. appRoot: Telegram Web has no dedicated React root — use "body".
2. postContainer: ".Message" — each message is a div with class Message.
   Must match MULTIPLE elements with DIFFERENT parents.
3. postText: ".text-content" — the text body inside each message.
4. postTimestamp: ".message-time" — use textContent (visible time string like "17:54").
   Set postTimestampAttr to "textContent".
5. metricsViews: ".message-views" — view count shown in channel messages.
   Set null if absent (DMs have no view counts).
6. messageSignature: ".message-signature" — per-message channel author label.
   Present in channels (one per .Message). Set null if absent (DMs have none).
7. userDisplayName: ".ChatInfo .fullName" — the channel/contact name in the chat header.
   Scoped to .ChatInfo so it does NOT match the logged-in user's name in the sidebar.
8. postImage: "img.media-photo, img.full-media, canvas.thumbnail.shown"
9. postVideo: "video.full-media, video"
10. metricsReply / metricsRepost / metricsLike / metricsBookmark: null (not applicable).
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""

TELEGRAM_PLATFORM_AGENT = PlatformAgent(
    name="telegram",
    survey_type="telegram-post",
    schema_class=TelegramSelectorResult,
    validate_fn=_tg_validate,
    to_nested_fn=_tg_to_nested,
    prompt_template=_PROMPT,
    offline_selectors=[
        ".Message",
    ],
)
