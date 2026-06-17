"""Facebook platform agents — user/profile page and feed posts."""

from typing import Optional
from pydantic import BaseModel, Field
from bs4 import BeautifulSoup
from agents.base_agent import BaseSelectorResult, PlatformAgent, generic_validate, make_to_nested


class FacebookUserResult(BaseModel):
    appRoot: str = Field(description="CSS selector for the React mount root — '[id^=mount]'.")
    userDisplayName: Optional[str] = Field(None, description="Selector for the profile/page display name.")
    userAvatar: Optional[str] = Field(None, description="Selector for the profile picture <a> or <img>.")
    userBanner: Optional[str] = Field(None, description="Selector for the cover photo <img>.")
    userBio: Optional[str] = Field(None, description="Selector for the bio/intro text element.")
    userFollowers: Optional[str] = Field(None, description="Selector for the followers count link.")
    userFollowing: Optional[str] = Field(None, description="Selector for the following count link.")


_USER_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of a Facebook profile or Page.

Your task: identify CSS selectors so a browser extension can extract profile metadata
(name, avatar, cover photo, bio, followers, following).

RULES:
1. appRoot is always '[id^=mount]' — Facebook's React root has a dynamic id like 'mount_0_0_Y4'.
2. userDisplayName: the profile/page name — look for [data-ad-rendering-role="profile_name"].
3. userAvatar: the profile picture — Facebook renders it as SVG <image xlink:href="..."> inside
   a link to /photo/?fbid=. Use 'a[href*="photo/?fbid="] svg image'. This scopes to the large
   profile photo and excludes the logged-in user's navbar avatar (no photo link parent).
4. userBanner: the cover photo — prefer 'a[aria-label="View profile cover photo"] img'
   or 'img[data-imgperflogname="profileCoverPhoto"]'.
5. userBio: the intro/about section — look for 'span[role="list"]' or a div containing
   the page category or personal intro text.
6. userFollowers: the followers link — 'a[href*="/followers/"]' whose text contains the count.
7. userFollowing: the following link — 'a[href*="/following"]' whose text contains the count.
8. Prefer aria-label and data-* attributes over hashed class names (Facebook uses atomic CSS).
9. Return null for any field you cannot find a reliable selector for.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""


def _facebook_user_validate(soup: BeautifulSoup, result: FacebookUserResult) -> str | None:
    if not soup.select(result.appRoot):
        return f"appRoot '{result.appRoot}' matched 0 elements."
    profile_fields = [result.userDisplayName, result.userAvatar, result.userFollowers]
    if not any(f and soup.select(f) for f in profile_fields):
        return "No profile selectors matched: userDisplayName, userAvatar, and userFollowers all returned 0 elements."
    return None


def _facebook_user_to_nested(result: FacebookUserResult, existing: dict | None = None) -> dict:
    base = (existing or {}).get("facebook", {})
    base_account = base.get("account", {})
    return {
        "facebook": {
            "shared": {
                "appRoot": result.appRoot,
                "observerFilter": base.get("shared", {}).get("observerFilter") or {
                    "attributes": False, "childList": True, "subtree": True,
                },
            },
            "account": {
                **base_account,
                "userDisplayName": result.userDisplayName,
                "userHandle": base_account.get("userHandle"),
                "userAvatar": result.userAvatar,
                "userBanner": result.userBanner,
                "userBio": result.userBio,
                "userFollowers": result.userFollowers,
                "userFollowing": result.userFollowing,
            },
            "post": base.get("post", {}),
        }
    }


FACEBOOK_USER_PLATFORM_AGENT = PlatformAgent(
    name="facebook-user",
    survey_type="facebook-user",
    schema_class=FacebookUserResult,
    validate_fn=_facebook_user_validate,
    to_nested_fn=_facebook_user_to_nested,
    prompt_template=_USER_PROMPT,
    offline_selectors=["[data-ad-rendering-role=\"profile_name\"]", "a[href*=\"photo/?fbid=\"] svg image", "[id^=mount]"],
    block_spa_scripts=True,
)


# ── Post agent ────────────────────────────────────────────────────────────────

_POST_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of the Facebook news feed.

Your task: identify CSS selectors so a browser extension can inject survey forms into
each post and extract post metadata (author, text, media, timestamp, metrics).

RULES:
1. appRoot is always '[id^=mount]' — Facebook's React root has a dynamic id like 'mount_0_0_Y4'.
2. postContainer must match MULTIPLE individual feed post cards, each with a DIFFERENT parent.
   Facebook wraps each feed item in a div with role="article" — use 'div[role="article"]'.
   The extension injects the survey at the top of postContainer, so it must scope to one post.
3. postText: the visible text body of a post. Look for:
   - div[data-ad-rendering-role="story_message"]
   - div[data-ad-preview="message"]
   - span with dir="auto" inside the feed item
4. postTimestamp: the relative-time link inside each post (e.g. "2h", "1d").
   Facebook renders this inside an anchor — look for 'a[role="link"] span' near the author header,
   or 'abbr[data-utime]', or 'span[id*="jsc"]'. Set postTimestampAttr to the attribute that
   holds the actual date ('data-utime', 'title', or 'datetime').
5. Post ID extraction: set postLink to a selector for an anchor whose href contains
   the post identifier. Good candidates:
   - 'a[href*="/posts/"]'
   - 'a[href*="story_fbid"]'
   - 'a[href*="/permalink/"]'
   - 'a[href*="/videos/"]'
   Pick the one present in THIS snapshot. The extension parses the ID from the href.
6. metricsLike: selector for the like count element (span or button with like count text).
   Facebook hides exact counts on some posts — use null if not reliably present.
7. metricsReply / metricsRepost: comment count and share count elements. May be null.
8. userHandle: selector for the post author name element inside each post card.
9. Prefer aria-label, data-*, and role= attributes over hashed atomic class names.
10. Return null for any field you cannot find a reliable selector for.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""


def _facebook_post_to_nested(result: BaseSelectorResult, existing: dict | None = None) -> dict:
    base = (existing or {}).get("facebook", {})
    base_shared = base.get("shared", {})
    base_account = base.get("account", {})
    return {
        "facebook": {
            "shared": {
                "appRoot": result.appRoot,
                "observerFilter": base_shared.get("observerFilter") or {
                    "attributes": False, "childList": True, "subtree": True,
                },
            },
            "account": base_account,
            "post": {
                "postContainer": result.postContainer,
                "postText": result.postText,
                "postImage": result.postImage,
                "postVideo": result.postVideo,
                "postTimestamp": result.postTimestamp,
                "postTimestampAttr": result.postTimestampAttr,
                "postLink": result.postLink if hasattr(result, "postLink") else None,
                "metricsLike": result.metricsLike,
                "metricsReply": result.metricsReply,
                "metricsRepost": result.metricsRepost,
                "userHandle": result.userHandle,
            },
        }
    }


FACEBOOK_POST_PLATFORM_AGENT = PlatformAgent(
    name="facebook-post",
    survey_type="facebook-post",
    schema_class=BaseSelectorResult,
    validate_fn=generic_validate,
    to_nested_fn=_facebook_post_to_nested,
    prompt_template=_POST_PROMPT,
    offline_selectors=[
        'div[role="article"]',
        'div[data-pagelet^="FeedUnit"]',
        'div[data-ad-rendering-role="story_message"]',
    ],
    block_spa_scripts=True,
)
