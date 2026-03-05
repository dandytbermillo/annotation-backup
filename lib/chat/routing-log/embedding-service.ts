/**
 * Embedding Service — Phase 3 (server-only)
 *
 * Computes text embeddings via OpenAI text-embedding-3-small (1536 dimensions).
 * Used on:
 *   - Write path: memory UPSERT stores embedding alongside the entry
 *   - Read path: semantic lookup computes query embedding for cosine search
 *
 * Fail-open: returns null on error/timeout so callers degrade gracefully.
 */

import OpenAI from 'openai'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_TIMEOUT_MS = 600

/** Version string stored in embedding_model_version column */
export const EMBEDDING_MODEL_VERSION = 'openai:text-embedding-3-small@v1'

// ---------------------------------------------------------------------------
// LRU cache (simple Map with TTL, keyed by query_fingerprint)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const CACHE_MAX = 100

const cache = new Map<string, { embedding: number[]; expiresAt: number }>()

// ---------------------------------------------------------------------------
// OpenAI client (lazy singleton)
// ---------------------------------------------------------------------------

let client: OpenAI | null = null

function getApiKeyFromSecrets(): string | null {
  try {
    const secretsPath = join(process.cwd(), 'config', 'secrets.json')
    if (existsSync(secretsPath)) {
      const secrets = JSON.parse(readFileSync(secretsPath, 'utf-8'))
      if (secrets.OPENAI_API_KEY) return secrets.OPENAI_API_KEY
    }
  } catch {
    // Ignore file read errors
  }
  return null
}

function getClient(): OpenAI | null {
  const envKey = process.env.OPENAI_API_KEY
  const apiKey =
    envKey && envKey.startsWith('sk-') && envKey.length > 40 && !envKey.includes('paste')
      ? envKey
      : getApiKeyFromSecrets()

  if (!apiKey) return null
  if (!client) client = new OpenAI({ apiKey })
  return client
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a 1536-dimension embedding for `text`.
 *
 * @param text      The text to embed (typically normalized query text).
 * @param cacheKey  Optional key for LRU cache (e.g. query_fingerprint).
 * @returns         The embedding vector, or null on failure/timeout.
 */
export async function computeEmbedding(
  text: string,
  cacheKey?: string,
): Promise<number[] | null> {
  // Check cache
  if (cacheKey) {
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.embedding
  }

  const openai = getClient()
  if (!openai) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS)

  try {
    const response = await openai.embeddings.create(
      { model: EMBEDDING_MODEL, input: text },
      { signal: controller.signal },
    )
    clearTimeout(timer)
    const embedding = response.data[0]?.embedding ?? null

    // Populate cache
    if (embedding && cacheKey) {
      if (cache.size >= CACHE_MAX) {
        // Evict oldest entry (Map preserves insertion order)
        const oldest = cache.keys().next().value
        if (oldest) cache.delete(oldest)
      }
      cache.set(cacheKey, { embedding, expiresAt: Date.now() + CACHE_TTL_MS })
    }

    return embedding
  } catch {
    clearTimeout(timer)
    return null // fail-open
  }
}

/**
 * Compute embeddings for multiple texts in a single API call.
 * Used by the backfill script for batch efficiency.
 *
 * @param texts     Array of texts to embed.
 * @returns         Array of embeddings (null entries for failures).
 */
export async function computeEmbeddingBatch(
  texts: string[],
): Promise<(number[] | null)[]> {
  if (texts.length === 0) return []

  const openai = getClient()
  if (!openai) return texts.map(() => null)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS * 3) // longer for batch

  try {
    const response = await openai.embeddings.create(
      { model: EMBEDDING_MODEL, input: texts },
      { signal: controller.signal },
    )
    clearTimeout(timer)

    // Response data is indexed by input position
    const results: (number[] | null)[] = texts.map(() => null)
    for (const item of response.data) {
      if (item.index < results.length) {
        results[item.index] = item.embedding
      }
    }
    return results
  } catch {
    clearTimeout(timer)
    return texts.map(() => null) // fail-open
  }
}
