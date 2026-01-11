# Phase 2 Metrics Baseline Report

**Date:** 2026-01-11
**Purpose:** Establish baseline metrics to inform Phase 3 (embedding) decision

---

## Executive Summary

Phase 2 keyword retrieval performs well for exact matches and synonyms but fails completely on typos. Latency is excellent (p95: 2ms). Phase 3 (embeddings) would primarily benefit fuzzy/typo tolerance.

---

## Test Configuration

- **Total queries:** 29
- **Categories:** exact_concept, multi_word, natural_language, fuzzy_typo, synonym, edge_case
- **Endpoint:** `POST /api/docs/retrieve` with `mode=chunks`

---

## Results Summary

### Status Distribution

| Status | Count | Percentage |
|--------|-------|------------|
| weak | 19 | 65.5% |
| no_match | 7 | 24.1% |
| ambiguous | 2 | 6.9% |
| error | 1 | 3.4% |

**Note:** "weak" means the system found a match but asks for confirmation. This is a successful retrieval.

### Success Rate by Category

| Category | Success | Fail | Rate |
|----------|---------|------|------|
| exact_concept | 8/8 | 0 | 100% |
| multi_word | 5/5 | 0 | 100% |
| synonym | 4/4 | 0 | 100% |
| natural_language | 4/5 | 1 | 80% |
| fuzzy_typo | 0/4 | 4 | **0%** |
| edge_case | 0/3 | 3 | 0% (expected) |

**Overall (excluding edge cases):** 21/26 = **80.8% success rate**

### Latency (retrieval_ms)

| Metric | Value |
|--------|-------|
| min | 0ms |
| max | 9ms |
| avg | 1ms |
| p50 | 2ms |
| p95 | 2ms |

**Verdict:** Excellent latency. No performance concerns.

---

## Failure Analysis

### No-Match Queries

| Query | Category | Root Cause |
|-------|----------|------------|
| "how do I navigate" | natural_language | "navigate" not in vocab; needs stem to "navigation" |
| "widgts" | fuzzy_typo | Typo - no fuzzy matching |
| "dashbord" | fuzzy_typo | Typo - no fuzzy matching |
| "navigtor" | fuzzy_typo | Typo - no fuzzy matching |
| "workspce" | fuzzy_typo | Typo - no fuzzy matching |
| "xyz123" | edge_case | Expected - nonsense query |
| "the a an is" | edge_case | Expected - all stopwords |

### Patterns

1. **Fuzzy/typo queries: 100% failure** - Keyword matching cannot handle misspellings
2. **Natural language: 1 failure** - "navigate" → "navigation" stemming gap
3. **Synonyms: 100% success** - Synonym mapping works well

---

## Phase 3 Decision Framework

### When to trigger Phase 3

Based on this baseline, Phase 3 (embeddings) should be triggered if:

| Condition | Current State | Threshold | Action |
|-----------|---------------|-----------|--------|
| Typo frequency in production | Unknown | >5% of queries | Monitor production logs |
| Natural language failure rate | 20% | >30% | Add more stems/synonyms first |
| Overall success rate | 80.8% | <70% | Consider Phase 3 |
| Latency p95 | 2ms | >100ms | Not a concern |

### Recommendation

**Hold on Phase 3 for now.** Instead:

1. **Quick wins first:**
   - Add "navigate" → "navigation" stemming
   - Monitor production query patterns

2. **If typos are common in production:**
   - Consider lightweight fuzzy matching (Levenshtein) before full embeddings
   - Phase 3 embeddings if fuzzy matching insufficient

3. **Phase 3 triggers:**
   - Typo rate >5% in production
   - User complaints about "didn't understand" responses
   - Need for semantic similarity (e.g., "main screen" → "home")

---

## Raw Data

### Query Results

| Category | Query | Status | Latency (ms) | Matched |
|----------|-------|--------|--------------|---------|
| exact_concept | home | weak | 9 | 24 |
| exact_concept | workspace | weak | 2 | 44 |
| exact_concept | dashboard | weak | 2 | 87 |
| exact_concept | widgets | weak | 2 | 51 |
| exact_concept | navigator | weak | 2 | 7 |
| exact_concept | recent | weak | 2 | 18 |
| exact_concept | notes | ambiguous | 1 | 43 |
| exact_concept | entry | weak | 2 | 43 |
| multi_word | quick links | weak | 2 | 26 |
| multi_word | widget manager | weak | 1 | 51 |
| multi_word | home overview | ambiguous | 2 | 44 |
| multi_word | workspace actions | weak | 2 | 53 |
| multi_word | navigation actions | weak | 2 | 26 |
| natural_language | what is home | weak | 2 | 24 |
| natural_language | how do I navigate | no_match | 1 | 0 |
| natural_language | explain the dashboard | weak | 2 | 89 |
| natural_language | tell me about widgets | weak | 2 | 51 |
| natural_language | where are my recent items | weak | 2 | 18 |
| fuzzy_typo | widgts | no_match | 2 | 0 |
| fuzzy_typo | dashbord | no_match | 1 | 0 |
| fuzzy_typo | navigtor | no_match | 2 | 0 |
| fuzzy_typo | workspce | no_match | 2 | 0 |
| synonym | shortcuts | weak | 2 | 26 |
| synonym | bookmarks | weak | 2 | 26 |
| synonym | folders | weak | 2 | 7 |
| synonym | history | weak | 1 | 18 |
| edge_case | (empty) | error | 0 | 0 |
| edge_case | xyz123 | no_match | 1 | 0 |
| edge_case | the a an is | no_match | 0 | 0 |

---

## Next Steps

1. [ ] Add "navigate" → "navigation" to stemming/synonyms
2. [ ] Deploy to production and monitor query patterns
3. [ ] Collect typo frequency data (1-2 weeks)
4. [ ] Re-evaluate Phase 3 based on production data

---

## Immediate Follow-ups (Quick Wins)

1. **Add synonym/stem:** `navigate` → `navigation`
   - Rationale: fixes the only natural-language failure in the baseline.

2. **Add production typo metric**
   - Capture `% of queries with status = no_match` and `matched_terms = 0`.
   - Track per week to decide if Phase 3 (embeddings) is needed.
