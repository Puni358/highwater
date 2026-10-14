"""HighWater — Module 3: Risk & Prioritization Engine.

Consumes Module 2 zone data (zones.json) and produces a ranked list of zones
with deterministic 0-100 priority scores, human-readable reasons, and
data-quality warnings. Output is versioned JSON suitable for downstream
consumption by the dashboard and rescue-routing modules.
"""
