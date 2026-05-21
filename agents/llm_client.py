"""
Configurable LLM client: auto-selects Claude or Gemini based on available API key.

Priority: ANTHROPIC_API_KEY → Claude, else GEMINI_API_KEY → Gemini.
Override model via CLAUDE_MODEL or GEMINI_MODEL env vars.
"""

import os
from abc import ABC, abstractmethod
from pydantic import BaseModel


class LLMClient(ABC):
    @abstractmethod
    def generate_structured(self, prompt: str, schema_class: type[BaseModel]) -> BaseModel:
        """Generate a structured response conforming to schema_class."""
        pass


class ClaudeClient(LLMClient):
    def __init__(self):
        import anthropic
        self.client = anthropic.Anthropic()
        self.model = os.environ.get("CLAUDE_MODEL", "claude-haiku-4-5-20251001")

    def generate_structured(self, prompt: str, schema_class: type[BaseModel]) -> BaseModel:
        # Use tool_use for guaranteed structured output
        schema = schema_class.model_json_schema()

        response = self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            tools=[{
                "name": "extract_selectors",
                "description": "Extract CSS selectors for the given social media platform.",
                "input_schema": schema,
            }],
            tool_choice={"type": "tool", "name": "extract_selectors"},
            messages=[{"role": "user", "content": prompt}],
        )

        for block in response.content:
            if block.type == "tool_use":
                return schema_class(**block.input)

        raise ValueError("Claude returned no tool_use block.")


class GeminiClient(LLMClient):
    def __init__(self):
        from google import genai
        self.client = genai.Client()
        self.model = os.environ.get("GEMINI_MODEL", "gemini-2.5-pro")

    def generate_structured(self, prompt: str, schema_class: type[BaseModel]) -> BaseModel:
        from google.genai import types

        response = self.client.models.generate_content(
            model=self.model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema_class,
                temperature=0.1,
            ),
        )

        # Detect blocked / empty responses before accessing .text
        if not response.candidates:
            raise ValueError(
                f"Gemini returned no candidates. "
                f"Prompt feedback: {getattr(response, 'prompt_feedback', 'n/a')}"
            )

        candidate = response.candidates[0]
        finish = getattr(candidate, "finish_reason", None)
        if finish and str(finish) not in ("FinishReason.STOP", "STOP", "1"):
            raise ValueError(f"Gemini generation stopped with reason: {finish}")

        text = response.text
        if not text:
            raise ValueError("Gemini returned an empty response text.")

        return schema_class.model_validate_json(text)


def get_llm_client() -> LLMClient:
    if os.environ.get("ANTHROPIC_API_KEY"):
        client = ClaudeClient()
        print(f"🤖 LLM: Claude ({client.model})")
        return client
    if os.environ.get("GEMINI_API_KEY"):
        client = GeminiClient()
        print(f"🤖 LLM: Gemini ({client.model})")
        return client
    raise EnvironmentError(
        "No LLM API key found. Set ANTHROPIC_API_KEY or GEMINI_API_KEY."
    )
