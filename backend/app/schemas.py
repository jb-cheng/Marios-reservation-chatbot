"""Wire types, and the boundary where untrusted JSON becomes typed data.

Two different strictness rules apply, and the difference is deliberate.

Requests are `extra="forbid"`. A client sending a field this API does not define
is a bug in the client, and a 422 that names the field is how it gets found.

Model output is `extra="ignore"`. A provider that appends one stray key is
common, and refusing the whole turn over it would cost the customer a canned
"could you repeat that" for no benefit. The stray key is dropped here, and cannot
reach memory anyway, because the browser's merge iterates its own SLOT_KEYS list
rather than trusting the object it was handed.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .config import SLOT_KEYS

SlotKey = Literal[
    "date",
    "time",
    "party_size",
    "type",
    "name",
    "email",
    "phone",
    "special_requests",
]


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str


class SlotValues(BaseModel):
    model_config = ConfigDict(extra="ignore")

    date: str | None = None
    time: str | None = None
    party_size: int | None = None
    type: str | None = None
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    special_requests: str | None = None

    @field_validator("party_size")
    @classmethod
    def reject_bool_party_size(cls, value: int | None) -> int | None:
        # `true` is an int in Python, and a party of one is a plausible number, so
        # this is worth an explicit refusal rather than a silently booked boolean.
        if isinstance(value, bool):
            raise ValueError("party_size must be an integer, not a boolean")
        return value

    def as_slots(self) -> dict[str, Any]:
        """Only the keys that are present, for the merge and for storage."""
        raw = self.model_dump()
        return {key: raw[key] for key in SLOT_KEYS if raw.get(key) is not None}


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: SlotValues
    messages: list[ChatMessage] = Field(default_factory=list)
    message: str
    current_date: str


class AgentOutput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    reply: str
    slots: SlotValues = Field(default_factory=SlotValues)
    changed: list[str] = Field(default_factory=list)
    submit: bool = False


class AlternativeOut(BaseModel):
    time: str
    table_id: str
    seats: int
    type: str


class AvailabilityOut(BaseModel):
    date: str
    time: str
    party_size: int
    type: str | None = None
    state: Literal["available", "booked", "no_table"]
    table_id: str | None = None
    alternatives: list[AlternativeOut] = Field(default_factory=list)


class OpeningOut(BaseModel):
    """One seating time that is still open, and how much room is left at it."""

    time: str
    free: int
    by_type: dict[str, int] = Field(default_factory=dict)


class ChatResponse(BaseModel):
    reply: str
    slots: SlotValues
    changed: list[str] = Field(default_factory=list)
    submit: bool = False
    availability: AvailabilityOut | None = None
    openings: list[OpeningOut] = Field(default_factory=list)
    # Names the provider that answered, so a latency comparison or a fallback in
    # production is visible in the network tab rather than guessed at.
    provider: str | None = None


class SubmitRequest(BaseModel):
    """Every slot optional, deliberately.

    A missing email is not a schema violation, it is an incomplete booking, and the
    customer is owed `{"error": "incomplete", "missing": ["email"]}` rather than a
    pydantic traceback. The endpoint reports business errors for exactly the fields
    the agent is supposed to be collecting.
    """

    model_config = ConfigDict(extra="forbid")

    session_id: str
    date: str | None = None
    time: str | None = None
    party_size: int | None = None
    type: str | None = None
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    special_requests: str | None = None

    @field_validator("party_size")
    @classmethod
    def reject_bool_party_size(cls, value: int | None) -> int | None:
        if isinstance(value, bool):
            raise ValueError("party_size must be an integer, not a boolean")
        return value


class SubmitResponse(BaseModel):
    submission_id: str
    table_id: str
    state: str


class SlotConflict(BaseModel):
    error: Literal["slot_taken"]
    alternatives: list[AlternativeOut] = Field(default_factory=list)


class NoTableError(BaseModel):
    error: Literal["no_table"]
    largest_table: int


class ReservationOut(BaseModel):
    submission_id: str
    session_id: str
    date: str
    time: str
    party_size: int
    table_id: str
    table_type: str
    name: str
    email: str
    # Optional: email is the only required contact channel, and a phone number is
    # only there in case the team has to call.
    phone: str | None = None
    special_requests: str | None = None
    status: str
    created_at: str
    decided_at: str | None = None


class QueueResponse(BaseModel):
    pending: list[ReservationOut] = Field(default_factory=list)
    official: list[ReservationOut] = Field(default_factory=list)
    double_booked: list[dict[str, Any]] = Field(default_factory=list)


class TtsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=600)


class ConfigResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
