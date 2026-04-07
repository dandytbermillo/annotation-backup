 The clear Phase 2 plan is:

  1. Preseed known nouns into semantic memory

  - add curated semantic rows for noun-only forms and close variants, for example:
      - recent
      - widget manager
      - links panel a
      - navigator
  - include accurate metadata:
      - target identity
      - action type
      - surface/panel family
      - risk tier
      - policy hints if needed

  2. Route known-noun queries into the shared semantic pipeline first

  - bare nouns
  - typo/noise variants
  - noun-like panel names
  - do not send these first to a separate known-noun router

  3. Keep known-noun logic only as shared policy/validation

  - question guard:
      - links panel? -> open-vs-docs
      - what is links panel? -> docs
  - visibility validation
  - duplicate-family validation
  - near-match clarification rules
  - unknown noun fallback only after semantic/shared retrieval and safe downstream
    failure

  4. Use the same semantic decision contract as Phase 1

  - one strong safe winner -> execute
  - useful but not execution-safe candidates -> clarify
  - only empty/insufficient shared candidate set -> downstream fallback
  - if all else fails -> clarification

  5. Remove known-noun as an independent execution lane

  - no separate Tier 4 winner
  - no direct handleKnownNounRouting() execution path
  - keep helper functions only if they are used by shared policy

  6. Verify the noun-only cases explicitly

  - recent -> semantic execute
  - widget manager -> semantic execute
  - links panel a -> semantic execute or clarify if ambiguous
  - links panel? -> open-vs-docs
  - what is links panel? -> docs
  - typo like widgt managr -> semantic candidate then execute/clarify by policy
  - unknown noun like xyzzy -> clarify/fallback only after semantic + downstream fail

  So the short version is:

  - Phase 2 should make known nouns semantic-first
  - known-noun logic becomes policy, not routing