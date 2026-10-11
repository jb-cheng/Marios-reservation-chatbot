"""Cohere Command A+, the default provider.

Chosen in the brief for its hallucination rate, which is a UX concern here rather
than a benchmark concern: a model that invents an email address writes garbage into
a receipt a real person reads.

Structured output goes through Cohere's Structured Output API. LangChain's binding
defaults to `method="json_schema"` for this model family, verified by reading the
installed binding rather than trusting a docstring, and that is Cohere's constrained
decoding rather than tool calling. So the brief's rule that slot updates are
structured output and not tool calls holds here.

The schema comes from `llm.agent_output_schema`, which is restricted to the
constructs Cohere accepts. Two live calls established that limit: `pattern` was
rejected with "unsupported patterns: '^, $, ?=, ?!'", and `minimum` on an integer
was rejected next. Enums are accepted, and `time` and `type` use them.
"""

from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any

from langchain_cohere import ChatCohere
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from ..availability import Opening, SlotStatus
from ..config import Settings
from ..schemas import AgentOutput, ChatMessage, SlotValues

logger = logging.getLogger("reservation.llm.cohere")

DEFAULT_MODEL = "command-a-plus-05-2026"

# Replies are one or two sentences plus a slots object, so this is generous rather
# than tight, and it bounds the cost of a model that decides to monologue.
MAX_TOKENS = 900


def _to_langchain(messages: list[ChatMessage]) -> list[BaseMessage]:
    converted: list[BaseMessage] = []
    for message in messages:
        if message.role == "assistant":
            converted.append(AIMessage(content=message.content))
        else:
            converted.append(HumanMessage(content=message.content))
    return converted


class CohereProvider:
    name = "cohere"

    def __init__(self, settings: Settings) -> None:
        self.model_name = settings.cohere_model or DEFAULT_MODEL

        self._client = ChatCohere(
            model=self.model_name,
            api_key=settings.cohere_api_key,
            temperature=0.0,
            max_tokens=MAX_TOKENS,
            # The chain in llm.py also enforces a deadline with asyncio.wait_for.
            # Having it here too means a hung socket is released by the SDK rather
            # than leaving the request in flight after the chain has moved on.
            request_timeout=max(1.0, settings.llm_timeout_ms / 1000),
            max_retries=0,
        )
        self._structured_cache: dict[str, Any] = {}

    def _structured_for(self, schema: dict[str, Any]):
        key = json.dumps(schema, sort_keys=True)
        cached = self._structured_cache.get(key)
        if cached is None:
            cached = self._client.with_structured_output(schema)
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
        """One turn.

        The keyword arguments are already rendered into `system` by prompts.py, so
        they are accepted for protocol compatibility and deliberately unused here.
        The deterministic provider does read them, because it does not parse its own
        prompt.
        """
        prompt: list[BaseMessage] = [SystemMessage(content=system)]
        prompt.extend(_to_langchain(messages))

        result = await self._structured_for(schema).ainvoke(prompt)

        if isinstance(result, AgentOutput):
            return result

        # A dict is what comes back for a schema-bound runnable. Validating here
        # rather than trusting it is what turns a malformed answer into a retry on
        # the next provider instead of a crash mid-conversation.
        return AgentOutput.model_validate(result)
