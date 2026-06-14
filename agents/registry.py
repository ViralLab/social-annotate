"""
Platform registry — maps platform name string → PlatformAgent.
Import REGISTRY to look up the correct agent for a given platform.
"""

from agents.base_agent import PlatformAgent
from agents.x_agent import X_PLATFORM_AGENT
from agents.instagram_agent import INSTAGRAM_PLATFORM_AGENT
from agents.bluesky_agent import BLUESKY_PLATFORM_AGENT
from agents.truthsocial_agent import TRUTHSOCIAL_PLATFORM_AGENT
from agents.linkedin_agent import LINKEDIN_PLATFORM_AGENT, LINKEDIN_USER_PLATFORM_AGENT
from agents.telegram_agent import TELEGRAM_PLATFORM_AGENT
from agents.whatsapp_agent import WHATSAPP_PLATFORM_AGENT

REGISTRY: dict[str, PlatformAgent] = {
    "x":           X_PLATFORM_AGENT,
    "instagram":   INSTAGRAM_PLATFORM_AGENT,
    "bluesky":     BLUESKY_PLATFORM_AGENT,
    "truthsocial": TRUTHSOCIAL_PLATFORM_AGENT,
    "linkedin":      LINKEDIN_PLATFORM_AGENT,
    "linkedin-user": LINKEDIN_USER_PLATFORM_AGENT,
    "telegram":    TELEGRAM_PLATFORM_AGENT,
    "whatsapp":    WHATSAPP_PLATFORM_AGENT,
}

__all__ = ["REGISTRY"]
