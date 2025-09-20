const { Client } = require('pg')

async function main() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'annotation_dev'
  })

  await client.connect()

  const result = await client.query(`
    SELECT panel_id, version, content
    FROM document_saves
    ORDER BY created_at DESC
    LIMIT 5
  `)

  console.log(result.rows)

  await client.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
