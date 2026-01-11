Next depends on what you want retrieval to cover:

  1. Expand chat routing so general “how do I…” / “what is…” questions
     also call /api/docs/retrieve (beyond meta‑explain).
  2. Start Phase 3 embeddings (vector search) to improve fuzzy matches
     once routing is broadened.
  3. Tighten metrics/observability for Phase 2 usage (typo rate, fallback
     rate) before moving on.



explaination:

Option 1 = expand chat routing so doc‑style questions use /api/docs/
  retrieve automatically (not just meta‑explain).

  Right now retrieval is only used when the user says “explain / what do
  you mean” after a bot message. Option 1 makes retrieval the default for
  general knowledge questions, even when there’s no clarification in
  progress.

  What it means in practice:

  - Before: “How do I add a widget?” → falls to LLM without docs →
    inconsistent.
  - After: “How do I add a widget?” → hits /api/docs/retrieve → uses your
    docs → consistent.

  High‑level flow:

  1. Detect doc‑style queries (e.g., “what is…”, “how do I…”, “tell me
     about…”).
  2. Call /api/docs/retrieve with the query.
  3. If retrieval returns strong match → answer from docs.
  4. If ambiguous → ask clarification (“Do you mean Home (Dashboard) or
     Home (Widget)?”).
  5. If no match → fallback to LLM general answer or ask user to rephrase.

  Why this matters:

  - It makes the assistant consistently grounded in your app docs.
  - It avoids hallucinations when users ask “how does X work?”
  - It uses the retrieval system you already built instead of only
    meta‑explain.

