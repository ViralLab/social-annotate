"""
Platform registry — maps platform name string → PlatformAgent.
Import REGISTRY to look up the correct agent for a given platform.
"""

from agents.base_agent import PlatformAgent
from agents.x_agent import X_PLATFORM_AGENT
from agents.facebook_agent import FACEBOOK_USER_PLATFORM_AGENT, FACEBOOK_POST_PLATFORM_AGENT
from agents.instagram_agent import INSTAGRAM_PLATFORM_AGENT, INSTAGRAM_COMMENT_PLATFORM_AGENT
from agents.bluesky_agent import BLUESKY_PLATFORM_AGENT
from agents.mastodon_agent import MASTODON_PLATFORM_AGENT
from agents.truthsocial_agent import TRUTHSOCIAL_PLATFORM_AGENT
from agents.linkedin_agent import LINKEDIN_PLATFORM_AGENT, LINKEDIN_USER_PLATFORM_AGENT
from agents.telegram_agent import TELEGRAM_PLATFORM_AGENT
from agents.whatsapp_agent import WHATSAPP_PLATFORM_AGENT
from agents.tiktok_agent import TIKTOK_PLATFORM_AGENT, TIKTOK_USER_PLATFORM_AGENT
from agents.youtube_agent import (
    YOUTUBE_VIDEO_PLATFORM_AGENT,
    YOUTUBE_USER_PLATFORM_AGENT,
    YOUTUBE_COMMENT_PLATFORM_AGENT,
)
from agents.reddit_agent import (
    REDDIT_FEED_AGENT,
    REDDIT_POST_AGENT,
    REDDIT_USER_AGENT,
    REDDIT_USER_POSTS_AGENT,
)

REGISTRY: dict[str, PlatformAgent] = {
    "x":              X_PLATFORM_AGENT,
    "facebook-user":  FACEBOOK_USER_PLATFORM_AGENT,
    "facebook-post":  FACEBOOK_POST_PLATFORM_AGENT,
    "instagram":          INSTAGRAM_PLATFORM_AGENT,
    "instagram-comment":  INSTAGRAM_COMMENT_PLATFORM_AGENT,
    "bluesky":        BLUESKY_PLATFORM_AGENT,
    "mastodon":       MASTODON_PLATFORM_AGENT,
    "truthsocial":    TRUTHSOCIAL_PLATFORM_AGENT,
    "linkedin":       LINKEDIN_PLATFORM_AGENT,
    "linkedin-user":  LINKEDIN_USER_PLATFORM_AGENT,
    "telegram":       TELEGRAM_PLATFORM_AGENT,
    "whatsapp":       WHATSAPP_PLATFORM_AGENT,
    "tiktok":         TIKTOK_PLATFORM_AGENT,
    "tiktok-user":    TIKTOK_USER_PLATFORM_AGENT,
    "youtube-video":    YOUTUBE_VIDEO_PLATFORM_AGENT,
    "youtube-user":     YOUTUBE_USER_PLATFORM_AGENT,
    "youtube-comment":  YOUTUBE_COMMENT_PLATFORM_AGENT,
    "reddit-feed":       REDDIT_FEED_AGENT,
    "reddit-post":       REDDIT_POST_AGENT,
    "reddit-user":       REDDIT_USER_AGENT,
    "reddit-user-posts": REDDIT_USER_POSTS_AGENT,
}

__all__ = ["REGISTRY"]
