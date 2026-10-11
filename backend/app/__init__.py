"""Reservation agent backend.

Modules are deliberately narrow: config holds restaurant facts, floor_plan holds
the room, availability computes what is free, validate mirrors the browser's slot
rules, storage owns SQLite, llm owns providers, and main sequences them.
"""
