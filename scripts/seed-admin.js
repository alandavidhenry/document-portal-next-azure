// Creates the initial Tenant Admin login, using DEFAULT_ADMIN_EMAIL from
// .env.local. Safe to re-run — skips if a user with that email already
// exists. This is the only account that can sign in before any other data
// exists; `npm run db:seed` (prisma/seed.ts) seeds sample companies/
// templates/assignments on top of it.
//
//   node scripts/seed-admin.js <password> "Display Name"
const crypto = require('node:crypto')

const bcrypt = require('bcryptjs')
const { Client } = require('pg')

const { loadEnvLocal } = require('./load-env')

loadEnvLocal()

async function main() {
  const [password, displayName] = process.argv.slice(2)
  if (!password || !displayName) {
    console.error('Usage: node scripts/seed-admin.js <password> "Display Name"')
    process.exit(1)
  }

  const email = process.env.DEFAULT_ADMIN_EMAIL
  const connectionString = process.env.DATABASE_URL
  if (!email || !connectionString) {
    console.error(
      'DEFAULT_ADMIN_EMAIL and DATABASE_URL must be set in .env.local'
    )
    process.exit(1)
  }

  const client = new Client({ connectionString })
  await client.connect()

  try {
    const { rows } = await client.query(
      'SELECT id FROM "User" WHERE email = $1',
      [email]
    )
    if (rows.length > 0) {
      console.log(`Admin user "${email}" already exists — skipping.`)
      return
    }

    const passwordHash = await bcrypt.hash(password, 10)
    await client.query(
      `INSERT INTO "User" (id, email, "displayName", "passwordHash", role)
       VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), email, displayName, passwordHash, 'Tenant Admin']
    )
    console.log(`Created admin user "${email}" (${displayName})`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('Failed to seed admin user:', error)
  process.exit(1)
})
