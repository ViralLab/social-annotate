"""
Profile registry — maps platform name → profile PlatformAgent.
Each agent targets user profile pages, not feeds.
"""

from agents.base_agent import PlatformAgent
from agents.x_profile_agent import X_PROFILE_AGENT

PROFILE_REGISTRY: dict[str, PlatformAgent] = {
    "x": X_PROFILE_AGENT,
}

__all__ = ["PROFILE_REGISTRY"]
