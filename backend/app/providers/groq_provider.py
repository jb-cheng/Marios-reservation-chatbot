"""Groq, the fast path and the first fallback.

Two jobs: answering turns when Cohere is slow or down, and hosting the guardrail
classifiers. The chat model defaults to GPT-OSS 120B, which the brief names as the
fast path alongside Qwen 3.

Structured output is pinned to `method="json_schema"` with `strict=True`. That is
not a stylistic choice: LangChain's Groq binding defaults to `function_calling`,
which is tool calling, and the brief forbids slot updates arriving as tool calls
because a tool the model can invoke is a tool an injected message can invoke.
Constrained decoding through `response_format` gives the same guarantee without the
attack surface.
"""

from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_groq import ChatGroq

from ..availability import Opening, SlotStatus
from ..config import Settings
from ..schemas import AgentOutput, ChatMessage, SlotValues

logger = logging.getLogger("reservation.llm.groq")

DEFAULT_MODEL = "openai/gpt-oss-120b"

MAX_TOKENS = 900


def _to_langchain(messages: list[ChatMessage]) -> list[BaseMessage]:
    converted: list[BaseMessage] = []
    for message in messages:
        if message.role == "assistant":
            converted.append(AIMessage(content=message.content))
        else:
            converted.append(HumanMessage(content=message.content))
    return converted


class GroqProvider:
    name = "groq"

    def __init__(self, settings: Settings) -> None:
        self.model_name = settings.groq_model or DEFAULT_MODEL

        self._client = ChatGroq(
            model=self.model_name,
            api_key=settings.groq_api_key,
            temperature=0.0,
            max_tokens=MAX_TOKENS,
            timeout=max(1.0, settings.llm_timeout_ms / 1000),
            # The chain in llm.py owns retry policy. An SDK that quietly retries
            # inside our deadline turns one slow turn into three.
            max_retries=0,
        )
        self._structured_cache: dict[str, Any] = {}

    def _structured_for(self, schema: dict[str, Any]):
        key = json.dumps(schema, sort_keys=True)
        cached = self._structured_cache.get(key)
        if cached is None:
            # The binding runs a dict through convert_to_json_schema, which expects
            # an OpenAI-format tool and raises "Unsupported function" for a bare JSON
            # Schema. Wrapping it is what the binding wants; `parameters` comes back
            # out unchanged as the schema Cohere and Groq both see.
            cached = self._client.with_structured_output(
                {
                    "name": "agent_output",
                    "description": "One turn of the reservation agent.",
                    "parameters": schema,
                },
                method="json_schema",
                strict=True,
            )
            self._structured_cache[key] = cached
        return cached

    async def complete(
        self,
        system: str,
        messages: list[ChatMessage],
        schema: dict[str, Any],
        *,
        state: SlotValues | None = None,
        availability: SlotStatus | None = None,
        openings: tuple[Opening, ...] | None = None,
        today: date | None = None,
    ) -> AgentOutput:
        """One turn. The keyword arguments are already inside `system`."""
        prompt: list[BaseMessage] = [SystemMessage(content=system)]
        prompt.extend(_to_langchain(messages))

        result = await self._structured_for(schema).ainvoke(prompt)

        if isinstance(result, AgentOutput):
            return result
        return AgentOutput.model_validate(result)
