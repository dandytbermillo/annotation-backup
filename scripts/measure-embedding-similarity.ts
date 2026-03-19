#!/usr/bin/env npx tsx
/**
 * Measure cosine similarity between wrapper variants and seeded base queries.
 * Shows whether the embedding model naturally handles conversational wrappers.
 */

import { computeEmbedding } from '../lib/chat/routing-log/embedding-service'
import { normalizeForStorage, computeQueryFingerprint } from '../lib/chat/routing-log/normalization'

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

async function main() {
  const bases = ['take me home', 'what did i just do?', 'go home']
  const variants = [
    'take me home',
    'pls take me home',
    'hey take me home',
    'hi take me home',
    'take me home now pls',
    'please take me home',
    'pls take me home now pls',
    'take me home now',
    'go home',
    'return home',
    'what did i just do?',
    'pls what did i just do?',
    'please what did i just do? thanks',
    'hey what did i just do?',
  ]

  // Embed all bases
  const baseEmbeddings: Record<string, number[]> = {}
  for (const b of bases) {
    const norm = normalizeForStorage(b)
    const fp = computeQueryFingerprint(norm)
    const emb = await computeEmbedding(norm, fp)
    if (!emb) { console.error(`Failed to embed base: ${b}`); continue }
    baseEmbeddings[b] = emb
  }

  // Compare each variant against the most relevant base
  console.log('\n=== Cosine Similarity vs Seeded Base ===\n')
  console.log('Variant'.padEnd(40), 'vs Base'.padEnd(25), 'Cosine', ' >=0.92?', ' >=0.80?')
  console.log('-'.repeat(100))

  for (const v of variants) {
    const norm = normalizeForStorage(v)
    const fp = computeQueryFingerprint(norm)
    const emb = await computeEmbedding(norm, fp)
    if (!emb) { console.log(v.padEnd(40), 'EMBEDDING FAILED'); continue }

    // Find best matching base
    let bestBase = ''
    let bestSim = -1
    for (const [baseName, baseEmb] of Object.entries(baseEmbeddings)) {
      const sim = cosineSimilarity(emb, baseEmb)
      if (sim > bestSim) { bestSim = sim; bestBase = baseName }
    }

    const pass92 = bestSim >= 0.92 ? '✅' : '❌'
    const pass80 = bestSim >= 0.80 ? '✅' : '❌'
    console.log(v.padEnd(40), bestBase.padEnd(25), bestSim.toFixed(4), pass92.padStart(7), pass80.padStart(7))
  }
}

main().catch(console.error)
