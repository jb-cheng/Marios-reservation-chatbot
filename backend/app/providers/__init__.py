"""Provider implementations.

Each one is imported lazily by `llm.provider_chain`, so a missing vendor package
degrades to the next provider in the chain instead of breaking the app at import
time. That is why the deterministic provider can run a full demo with none of these
installed.
"""
