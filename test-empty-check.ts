import { PlainOfflineProvider } from './lib/providers/plain-offline-provider'
import { PostgresOfflineAdapter } from './lib/adapters/postgres-offline-adapter'

async function main() {
  const adapter = new PostgresOfflineAdapter({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/annotation_dev'
  })
  const provider = new PlainOfflineProvider(adapter)
  const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }
  const nonEmptyDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] }

  console.log('Empty doc recognized?', provider.isEmptyContent(emptyDoc))
  console.log('Non-empty doc recognized?', provider.isEmptyContent(nonEmptyDoc))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
