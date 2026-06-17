"""Reddit platform agents — feed, comment thread, user profile, and user-posts variants."""

from typing import Optional
from pydantic import BaseModel, Field
from bs4 import BeautifulSoup
from agents.base_agent import PlatformAgent

# Attributes Reddit custom elements carry that would otherwise be stripped by _prune_html.
_POST_ATTRS = frozenset({
    "author", "score", "comment-count", "created-timestamp",
    "permalink", "post-title", "subreddit-name",
})
_COMMENT_ATTRS = frozenset({
    "thingid", "author", "score", "depth", "collapsed",
    "created", "comment-count", "created-timestamp", "permalink", "post-title",
})
_USER_ATTRS = frozenset({"number", "datetime"})
_PROFILE_COMMENT_ATTRS = frozenset({"comment-id", "author-name", "ts", "score"})


# ── Feed (shreddit-post on home/subreddit feed) ────────────────────────────────

class RedditFeedResult(BaseModel):
    postContainer: str = Field(description="Tag name of the post custom element — almost always 'shreddit-post'.")
    postIdAttr: str = Field(description="Attribute on shreddit-post holding the post ID (e.g. 'id').")
    postIdPrefix: str = Field(description="Prefix in the ID value to strip (e.g. 't3_'). Empty string if none.")
    postTitleAttr: str = Field(description="Attribute holding the post title text (e.g. 'post-title').")
    postAuthorAttr: str = Field(description="Attribute holding the author username (e.g. 'author').")
    postScoreAttr: str = Field(description="Attribute holding the upvote score (e.g. 'score').")
    postCommentCountAttr: str = Field(description="Attribute holding the comment count (e.g. 'comment-count').")
    postTimestampAttr: str = Field(description="Attribute holding the ISO creation timestamp (e.g. 'created-timestamp').")
    postPermalinkAttr: str = Field(description="Attribute holding the post URL path (e.g. 'permalink').")
    postText: Optional[str] = Field(None, description="CSS selector inside shreddit-post for the visible body text (e.g. \"[slot='text-body'] .md\"). null if posts are title-only.")
    postVideoPlayer: Optional[str] = Field(None, description="Tag name of the video player element (e.g. 'shreddit-player'). null if absent.")
    postImage: Optional[str] = Field(None, description="CSS selector for post images (e.g. \"[slot='thumbnail'] img, [slot='media'] img\"). null if absent.")
    subredditURLPattern: str = Field(description="Regex to extract subreddit name from a URL path — always '/r/([^/?#]+)'.")


_FEED_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of a Reddit home feed or subreddit feed.

Reddit uses the custom element <shreddit-post> for each post. All post metadata lives as
HTML attributes on <shreddit-post> itself — not in child elements.
Your task: identify attribute names on <shreddit-post> and selectors for body content.

RULES:
1.  postContainer: the tag name of the post element — almost always 'shreddit-post'.
2.  postIdAttr: attribute holding the post ID (look for 'id' with a value like 't3_xxx').
3.  postIdPrefix: the prefix part to strip from the ID value (e.g. 't3_'). Use '' if absent.
4.  postTitleAttr: attribute holding the post title string (e.g. 'post-title').
5.  postAuthorAttr: attribute holding the author username string (e.g. 'author').
6.  postScoreAttr: attribute holding the numeric upvote score (e.g. 'score').
7.  postCommentCountAttr: attribute holding the comment count (e.g. 'comment-count').
8.  postTimestampAttr: attribute holding the ISO-8601 creation timestamp (e.g. 'created-timestamp').
9.  postPermalinkAttr: attribute holding the post URL path (e.g. 'permalink').
10. postText: CSS selector INSIDE shreddit-post for the visible body text.
    Try "[slot='text-body'] .md", "[slot='text-body']", or "shreddit-post-text-body".
    Set null if posts in this snapshot are title-only (no body text slot visible).
11. postVideoPlayer: tag name of any video player element (e.g. 'shreddit-player'). null if none.
12. postImage: CSS selector for post images, e.g. "[slot='thumbnail'] img, [slot='media'] img". null if none.
13. subredditURLPattern: regex that extracts the subreddit name from a URL path.
    This is always '/r/([^/?#]+)'.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""


def _reddit_feed_validate(soup: BeautifulSoup, result: RedditFeedResult) -> str | None:
    posts = soup.find_all(result.postContainer)
    if not posts:
        return f"No <{result.postContainer}> elements found."
    if len(posts) < 2:
        return f"Only {len(posts)} <{result.postContainer}> found; expected multiple posts."
    sample = posts[0]
    missing = [a for a in [result.postIdAttr, result.postAuthorAttr, result.postScoreAttr]
               if not sample.has_attr(a)]
    if missing:
        return f"Attribute(s) {missing} not found on <{result.postContainer}>."
    return None


def _reddit_feed_to_nested(result: RedditFeedResult, existing: dict | None = None) -> dict:
    base = (existing or {}).get("reddit", {})
    return {
        "reddit": {
            "shared": base.get("shared", {
                "appRoot": "shreddit-app",
                "observerFilter": {"childList": True, "subtree": True},
            }),
            "account": base.get("account", {}),
            "post": {
                "postContainer": result.postContainer,
                "postIdAttr": result.postIdAttr,
                "postIdPrefix": result.postIdPrefix,
                "postTitleAttr": result.postTitleAttr,
                "postAuthorAttr": result.postAuthorAttr,
                "postScoreAttr": result.postScoreAttr,
                "postCommentCountAttr": result.postCommentCountAttr,
                "postTimestampAttr": result.postTimestampAttr,
                "postPermalinkAttr": result.postPermalinkAttr,
                "postText": result.postText,
                "postVideoPlayer": result.postVideoPlayer,
                "postImage": result.postImage,
                "metricsLike": None,
                "metricsReply": None,
                "metricsRepost": None,
            },
            "comment": base.get("comment", {}),
        }
    }


REDDIT_FEED_AGENT = PlatformAgent(
    name="reddit-feed",
    survey_type="reddit-post",
    selectors_key="reddit",
    schema_class=RedditFeedResult,
    validate_fn=_reddit_feed_validate,
    to_nested_fn=_reddit_feed_to_nested,
    prompt_template=_FEED_PROMPT,
    offline_selectors=["shreddit-post"],
    extra_keep_attrs=_POST_ATTRS,
    block_spa_scripts=True,
)


# ── Comment thread (shreddit-post + shreddit-comment) ─────────────────────────

class RedditPostResult(BaseModel):
    # shreddit-post attrs
    postContainer: str = Field(description="Tag name of the post element — 'shreddit-post'.")
    postIdAttr: str = Field(description="Attribute on shreddit-post holding the post ID (e.g. 'id').")
    postIdPrefix: str = Field(description="Prefix to strip from post ID (e.g. 't3_').")
    postTitleAttr: str = Field(description="Attribute holding the post title (e.g. 'post-title').")
    postAuthorAttr: str = Field(description="Attribute holding the post author (e.g. 'author').")
    postScoreAttr: str = Field(description="Attribute holding the post score (e.g. 'score').")
    postCommentCountAttr: str = Field(description="Attribute holding the comment count (e.g. 'comment-count').")
    postTimestampAttr: str = Field(description="Attribute holding the post creation timestamp (e.g. 'created-timestamp').")
    postPermalinkAttr: str = Field(description="Attribute holding the post URL path (e.g. 'permalink').")
    postText: Optional[str] = Field(None, description="CSS selector inside shreddit-post for the post body text.")
    postVideoPlayer: Optional[str] = Field(None, description="Tag name of the video player (e.g. 'shreddit-player'). null if absent.")
    postImage: Optional[str] = Field(None, description="CSS selector for post images. null if absent.")
    # shreddit-comment attrs
    commentContainer: str = Field(description="Tag name of the comment element — 'shreddit-comment'.")
    commentIdAttr: str = Field(description="Attribute on shreddit-comment holding the comment ID (e.g. 'thingid', value like 't1_xxx').")
    commentIdPrefix: str = Field(description="Prefix to strip from comment ID (e.g. 't1_').")
    commentAuthorAttr: str = Field(description="Attribute holding the comment author username (e.g. 'author').")
    commentScoreAttr: str = Field(description="Attribute holding the comment score (e.g. 'score').")
    commentTimestampAttr: str = Field(description="Attribute holding the comment creation timestamp (e.g. 'created').")
    commentDepthAttr: str = Field(description="Attribute holding the nesting depth number (e.g. 'depth').")
    commentCollapsedAttr: str = Field(description="Attribute present when a comment is collapsed (e.g. 'collapsed').")
    commentContentSlot: str = Field(description="CSS selector for the light-DOM slot inside shreddit-comment — use \"[slot='comment']\".")
    commentContentSel: str = Field(description="CSS selector for the comment body text div (e.g. \"[id*='-post-rtjson-content']\").")
    commentText: str = Field(description="Comma-separated CSS selectors for comment text extraction, tried in order.")
    subredditURLPattern: str = Field(description="Regex to extract subreddit name from URL path — always '/r/([^/?#]+)'.")
    parentPostIdURLPattern: str = Field(description="Regex to extract the parent post ID from URL path — always '/comments/([^/?#]+)'.")


_POST_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of a Reddit comment thread page.

Reddit uses two custom elements:
  - <shreddit-post>    — the original post at the top of the thread (one element)
  - <shreddit-comment> — each comment (many nested elements)

All metadata is stored as HTML attributes on these elements, not in child CSS classes.
Your task: identify all relevant attribute names and CSS selectors for both elements.

RULES — shreddit-post (one element at top of page):
1.  postContainer: 'shreddit-post'
2.  postIdAttr: attribute holding the post ID (e.g. 'id' with value 't3_xxx').
3.  postIdPrefix: prefix to strip from post ID (e.g. 't3_').
4.  postTitleAttr: attribute holding the post title (e.g. 'post-title').
5.  postAuthorAttr: attribute holding the author username (e.g. 'author').
6.  postScoreAttr: attribute holding the upvote score (e.g. 'score').
7.  postCommentCountAttr: attribute holding the comment count (e.g. 'comment-count').
8.  postTimestampAttr: attribute holding the ISO creation timestamp (e.g. 'created-timestamp').
9.  postPermalinkAttr: attribute holding the post URL path (e.g. 'permalink').
10. postText: CSS selector inside shreddit-post for visible body text. Try "[slot='text-body'] .md" or "shreddit-post-text-body". null if title-only.
11. postVideoPlayer: video player tag name (e.g. 'shreddit-player'). null if absent.
12. postImage: CSS selector for post images (e.g. "[slot='thumbnail'] img, [slot='media'] img"). null if absent.

RULES — shreddit-comment (many elements, nested):
13. commentContainer: 'shreddit-comment'
14. commentIdAttr: attribute holding the comment ID (e.g. 'thingid', value like 't1_xxx').
15. commentIdPrefix: prefix to strip from comment ID (e.g. 't1_').
16. commentAuthorAttr: attribute holding the comment author (e.g. 'author').
17. commentScoreAttr: attribute holding the comment score (e.g. 'score').
18. commentTimestampAttr: attribute holding the ISO creation timestamp (e.g. 'created').
19. commentDepthAttr: attribute holding the nesting depth integer (e.g. 'depth').
20. commentCollapsedAttr: attribute that appears when a comment is collapsed (e.g. 'collapsed').
21. commentContentSlot: CSS selector for the light-DOM slot where we inject the form.
    Use "[slot='comment']" — this is a named slot in the custom element's shadow DOM.
22. commentContentSel: CSS selector for the comment body text div.
    Try "[id*='-post-rtjson-content']".
23. commentText: comma-separated selectors for text extraction, tried in order.
    E.g. "[id*='-post-rtjson-content'], [slot='comment'] div[dir='auto'], [slot='comment']".
24. subredditURLPattern: regex to extract subreddit from URL path — always '/r/([^/?#]+)'.
25. parentPostIdURLPattern: regex to extract parent post ID — always '/comments/([^/?#]+)'.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""


def _reddit_post_validate(soup: BeautifulSoup, result: RedditPostResult) -> str | None:
    comments = soup.find_all(result.commentContainer)
    if not comments:
        return f"No <{result.commentContainer}> elements found."
    if len(comments) < 2:
        return f"Only {len(comments)} <{result.commentContainer}> found; expected multiple."
    sample = comments[0]
    missing = [a for a in [result.commentIdAttr, result.commentAuthorAttr, result.commentScoreAttr]
               if not sample.has_attr(a)]
    if missing:
        return f"Attribute(s) {missing} not found on <{result.commentContainer}>."
    return None


def _reddit_post_to_nested(result: RedditPostResult, existing: dict | None = None) -> dict:
    base = (existing or {}).get("reddit", {})
    base_comment = base.get("comment", {})
    return {
        "reddit": {
            "shared": base.get("shared", {
                "appRoot": "shreddit-app",
                "observerFilter": {"childList": True, "subtree": True},
            }),
            "account": base.get("account", {}),
            "post": {
                "postContainer": result.postContainer,
                "postIdAttr": result.postIdAttr,
                "postIdPrefix": result.postIdPrefix,
                "postTitleAttr": result.postTitleAttr,
                "postAuthorAttr": result.postAuthorAttr,
                "postScoreAttr": result.postScoreAttr,
                "postCommentCountAttr": result.postCommentCountAttr,
                "postTimestampAttr": result.postTimestampAttr,
                "postPermalinkAttr": result.postPermalinkAttr,
                "postText": result.postText,
                "postVideoPlayer": result.postVideoPlayer,
                "postImage": result.postImage,
                "metricsLike": None,
                "metricsReply": None,
                "metricsRepost": None,
            },
            "comment": {
                # Preserve profile-comment keys from existing selectors
                "profileCommentContainer": base_comment.get("profileCommentContainer"),
                "profileCommentIdAttr": base_comment.get("profileCommentIdAttr"),
                "profileCommentHrefAttr": base_comment.get("profileCommentHrefAttr"),
                "profileCommentAuthorSel": base_comment.get("profileCommentAuthorSel"),
                "profileCommentAuthorNameAttr": base_comment.get("profileCommentAuthorNameAttr"),
                "profileCommentScoreSel": base_comment.get("profileCommentScoreSel"),
                "profileCommentTimestampSel": base_comment.get("profileCommentTimestampSel"),
                # Comment thread selectors from this result
                "commentContainer": result.commentContainer,
                "commentIdAttr": result.commentIdAttr,
                "commentIdPrefix": result.commentIdPrefix,
                "commentAuthorAttr": result.commentAuthorAttr,
                "commentScoreAttr": result.commentScoreAttr,
                "commentTimestampAttr": result.commentTimestampAttr,
                "commentDepthAttr": result.commentDepthAttr,
                "commentCollapsedAttr": result.commentCollapsedAttr,
                "commentContentSlot": result.commentContentSlot,
                "commentContentSel": result.commentContentSel,
                "commentText": result.commentText,
                "subredditURLPattern": result.subredditURLPattern,
                "parentPostIdURLPattern": result.parentPostIdURLPattern,
            },
        }
    }


REDDIT_POST_AGENT = PlatformAgent(
    name="reddit-post",
    survey_type="reddit-comment",
    selectors_key="reddit",
    schema_class=RedditPostResult,
    validate_fn=_reddit_post_validate,
    to_nested_fn=_reddit_post_to_nested,
    prompt_template=_POST_PROMPT,
    offline_selectors=["shreddit-comment", "shreddit-post"],
    extra_keep_attrs=_COMMENT_ATTRS,
    block_spa_scripts=True,
)


# ── User profile (account info) ────────────────────────────────────────────────

class RedditUserResult(BaseModel):
    userDisplayName: Optional[str] = Field(None, description="CSS selector for the display name element.")
    userAvatar: Optional[str] = Field(None, description="CSS selector for the profile avatar image.")
    userKarma: Optional[str] = Field(None, description="CSS selector for the karma count element.")
    userCakeDay: Optional[str] = Field(None, description="CSS selector for the cake day element.")
    userCakeDayDateAttr: Optional[str] = Field(None, description="Attribute on the cake day element that holds the date (e.g. 'datetime').")
    userContributions: Optional[str] = Field(None, description="CSS selector for the contributions count element.")
    userContributionsNumberAttr: Optional[str] = Field(None, description="Attribute on the contributions element that holds the numeric value (e.g. 'number').")


_USER_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of a Reddit user profile page.

Your task: identify CSS selectors for user profile metadata.
Reddit uses data-testid attributes and faceplate custom elements.

RULES:
1. userDisplayName: selector for the user's display name.
   Try '[data-testid="profile-display-name"]'.
2. userAvatar: selector for the profile picture image.
   Try '[data-testid="profile-icon"]' or an img inside the avatar container.
3. userKarma: selector for the karma count element.
   Try '[data-testid="karma-number"]'.
4. userCakeDay: selector for the cake day / account age element.
   Try 'time[data-testid="cake-day"]'.
5. userCakeDayDateAttr: attribute on the cake day element holding the date value (e.g. 'datetime').
6. userContributions: selector for the contributions / post count element.
   Try 'faceplate-number[number]'.
7. userContributionsNumberAttr: attribute on that element holding the numeric value (e.g. 'number').
8. Return null for any field not present in this snapshot.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""


def _reddit_user_validate(soup: BeautifulSoup, result: RedditUserResult) -> str | None:
    profile_fields = [result.userDisplayName, result.userAvatar, result.userKarma]
    if not any(f and soup.select(f) for f in profile_fields):
        return "No profile selectors matched: userDisplayName, userAvatar, and userKarma all returned 0 elements."
    return None


def _reddit_user_to_nested(result: RedditUserResult, existing: dict | None = None) -> dict:
    base = (existing or {}).get("reddit", {})
    return {
        "reddit": {
            "shared": base.get("shared", {}),
            "account": {
                "userDisplayName": result.userDisplayName,
                "userAvatar": result.userAvatar,
                "userBio": None,
                "userFollowers": None,
                "userKarma": result.userKarma,
                "userCakeDay": result.userCakeDay,
                "userCakeDayDateAttr": result.userCakeDayDateAttr,
                "userContributions": result.userContributions,
                "userContributionsNumberAttr": result.userContributionsNumberAttr,
            },
            "post": base.get("post", {}),
            "comment": base.get("comment", {}),
        }
    }


REDDIT_USER_AGENT = PlatformAgent(
    name="reddit-user",
    survey_type="reddit-user",
    selectors_key="reddit",
    schema_class=RedditUserResult,
    validate_fn=_reddit_user_validate,
    to_nested_fn=_reddit_user_to_nested,
    prompt_template=_USER_PROMPT,
    offline_selectors=["[data-testid='profile-display-name']", "[data-testid='karma-number']", "shreddit-app"],
    extra_keep_attrs=_USER_ATTRS,
    block_spa_scripts=True,
)


# ── User posts / comments listing (shreddit-profile-comment) ──────────────────

class RedditUserPostsResult(BaseModel):
    profileCommentContainer: str = Field(description="Tag name of the list item element — almost always 'shreddit-profile-comment'.")
    profileCommentIdAttr: str = Field(description="Attribute on shreddit-profile-comment holding the comment ID (e.g. 'comment-id').")
    profileCommentHrefAttr: str = Field(description="Attribute holding the permalink URL path (e.g. 'href').")
    profileCommentAuthorSel: str = Field(description="CSS selector INSIDE shreddit-profile-comment for the element that carries the author name attribute (e.g. 'shreddit-overflow-menu[author-name]').")
    profileCommentAuthorNameAttr: str = Field(description="Attribute name on that element holding the username (e.g. 'author-name').")
    profileCommentScoreSel: str = Field(description="CSS selector for the score element inside each item (e.g. 'shreddit-comment-action-row[score]').")
    profileCommentTimestampSel: str = Field(description="CSS selector for the timestamp element inside each item (e.g. 'faceplate-timeago[ts]').")
    commentContentSel: str = Field(description="CSS selector for the text content div inside each item (e.g. \"[id*='-post-rtjson-content']\").")
    commentIdPrefix: str = Field(description="Prefix in the comment ID attribute to strip (e.g. 't1_'). Use '' if none.")


_USER_POSTS_PROMPT = """\
You are an expert web scraper analyzing a saved HTML snapshot of a Reddit user profile page
that lists the user's comments and posts.

Reddit uses the custom element <shreddit-profile-comment> for each list item.
Your task: identify attribute names on <shreddit-profile-comment> and CSS selectors for content inside each item.

RULES:
1.  profileCommentContainer: tag name of the list item — almost always 'shreddit-profile-comment'.
2.  profileCommentIdAttr: attribute on shreddit-profile-comment holding the comment ID
    (e.g. 'comment-id' with value like 't1_xxx').
3.  profileCommentHrefAttr: attribute holding the permalink URL path (e.g. 'href').
4.  profileCommentAuthorSel: CSS selector INSIDE shreddit-profile-comment for the element
    that carries the author name as an attribute.
    Try 'shreddit-overflow-menu[author-name]'.
5.  profileCommentAuthorNameAttr: attribute on that element holding the username
    (e.g. 'author-name').
6.  profileCommentScoreSel: CSS selector for the score element inside each item.
    Try 'shreddit-comment-action-row[score]'.
7.  profileCommentTimestampSel: CSS selector for the timestamp element inside each item.
    Try 'faceplate-timeago[ts]'.
8.  commentContentSel: CSS selector for the comment body text div.
    Try "[id*='-post-rtjson-content']".
9.  commentIdPrefix: prefix in the ID attribute value to strip (e.g. 't1_'). Use '' if absent.
{context_section}{error_section}
--- PRUNED HTML START ---
{html}
--- PRUNED HTML END ---
"""


def _reddit_user_posts_validate(soup: BeautifulSoup, result: RedditUserPostsResult) -> str | None:
    items = soup.find_all(result.profileCommentContainer)
    if not items:
        return f"No <{result.profileCommentContainer}> elements found."
    if len(items) < 2:
        return f"Only {len(items)} <{result.profileCommentContainer}> found; expected multiple."
    sample = items[0]
    if not sample.has_attr(result.profileCommentIdAttr):
        return f"Attribute '{result.profileCommentIdAttr}' not found on <{result.profileCommentContainer}>."
    return None


def _reddit_user_posts_to_nested(result: RedditUserPostsResult, existing: dict | None = None) -> dict:
    base = (existing or {}).get("reddit", {})
    base_comment = base.get("comment", {})
    return {
        "reddit": {
            "shared": base.get("shared", {}),
            "account": base.get("account", {}),
            "post": base.get("post", {}),
            "comment": {
                # Preserve comment thread selectors
                "commentContainer": base_comment.get("commentContainer"),
                "commentIdAttr": base_comment.get("commentIdAttr"),
                "commentIdPrefix": result.commentIdPrefix,
                "commentAuthorAttr": base_comment.get("commentAuthorAttr"),
                "commentScoreAttr": base_comment.get("commentScoreAttr"),
                "commentTimestampAttr": base_comment.get("commentTimestampAttr"),
                "commentDepthAttr": base_comment.get("commentDepthAttr"),
                "commentCollapsedAttr": base_comment.get("commentCollapsedAttr"),
                "commentContentSlot": base_comment.get("commentContentSlot"),
                "commentText": base_comment.get("commentText"),
                "subredditURLPattern": base_comment.get("subredditURLPattern"),
                "parentPostIdURLPattern": base_comment.get("parentPostIdURLPattern"),
                # Profile-comment selectors from this result
                "profileCommentContainer": result.profileCommentContainer,
                "profileCommentIdAttr": result.profileCommentIdAttr,
                "profileCommentHrefAttr": result.profileCommentHrefAttr,
                "profileCommentAuthorSel": result.profileCommentAuthorSel,
                "profileCommentAuthorNameAttr": result.profileCommentAuthorNameAttr,
                "profileCommentScoreSel": result.profileCommentScoreSel,
                "profileCommentTimestampSel": result.profileCommentTimestampSel,
                "commentContentSel": result.commentContentSel,
            },
        }
    }


REDDIT_USER_POSTS_AGENT = PlatformAgent(
    name="reddit-user-posts",
    survey_type="reddit-comment",
    selectors_key="reddit",
    schema_class=RedditUserPostsResult,
    validate_fn=_reddit_user_posts_validate,
    to_nested_fn=_reddit_user_posts_to_nested,
    prompt_template=_USER_POSTS_PROMPT,
    offline_selectors=["shreddit-profile-comment"],
    extra_keep_attrs=_PROFILE_COMMENT_ATTRS,
    block_spa_scripts=True,
)
