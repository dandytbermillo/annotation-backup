#!/bin/bash

echo "🔍 Validating PostgreSQL Persistence Implementation"
echo "=================================================="

# Check if all required files exist
echo -e "\n📁 Checking file structure..."

FILES=(
  "lib/adapters/postgres-adapter.ts"
  "lib/adapters/electron-postgres-adapter.ts"
  "lib/database/connection-manager.ts"
  "lib/database/oplog-sync.ts"
  "lib/database/types.ts"
  "electron/ipc/persistence-handlers.ts"
  "migrations/002_add_oplog_table.up.sql"
  "__tests__/persistence/postgres-adapter.test.ts"
  "__tests__/persistence/electron-postgres-adapter.test.ts"
  "__tests__/persistence/connection-manager.test.ts"
)

all_exist=true
for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✅ $file"
  else
    echo "  ❌ $file - MISSING"
    all_exist=false
  fi
done

# Check that enhanced-yjs-provider.ts has been updated
echo -e "\n🔄 Checking provider integration..."
if grep -q "ElectronPostgresAdapter" lib/enhanced-yjs-provider.ts; then
  echo "  ✅ ElectronPostgresAdapter integrated into provider"
else
  echo "  ❌ ElectronPostgresAdapter not integrated"
  all_exist=false
fi

# Check PostgreSQL dependencies in package.json
echo -e "\n📦 Checking package.json dependencies..."
if grep -q '"pg"' package.json; then
  echo "  ✅ pg dependency added"
else
  echo "  ❌ pg dependency missing"
  all_exist=false
fi

if grep -q '"@types/pg"' package.json; then
  echo "  ✅ @types/pg dependency added"
else
  echo "  ❌ @types/pg dependency missing"
  all_exist=false
fi

# Check implementation patterns
echo -e "\n🔍 Checking implementation patterns..."

# Check binary conversion in PostgresAdapter
if grep -q "toBuffer.*Uint8Array.*Buffer" lib/adapters/postgres-adapter.ts && \
   grep -q "fromBuffer.*Buffer.*Uint8Array" lib/adapters/postgres-adapter.ts; then
  echo "  ✅ Binary conversion methods implemented"
else
  echo "  ❌ Binary conversion methods missing"
  all_exist=false
fi

# Check failover logic in ElectronPostgresAdapter
if grep -q "currentMode.*remote.*local" lib/adapters/electron-postgres-adapter.ts && \
   grep -q "persistLocally" lib/adapters/electron-postgres-adapter.ts; then
  echo "  ✅ Failover logic implemented"
else
  echo "  ❌ Failover logic missing"
  all_exist=false
fi

# Check oplog implementation
if grep -q "INSERT INTO oplog" lib/adapters/electron-postgres-adapter.ts && \
   grep -q "syncPending" lib/database/oplog-sync.ts; then
  echo "  ✅ Oplog sync implemented"
else
  echo "  ❌ Oplog sync missing"
  all_exist=false
fi

# Check IPC handlers
if grep -q "ipcMain.handle.*persistence:" electron/ipc/persistence-handlers.ts && \
   grep -q "isValidDocName" electron/ipc/persistence-handlers.ts; then
  echo "  ✅ IPC handlers with security validation"
else
  echo "  ❌ IPC handlers or security validation missing"
  all_exist=false
fi

echo -e "\n=================================================="
if [ "$all_exist" = true ]; then
  echo "✅ All implementation files and patterns verified!"
  echo ""
  echo "📋 Next steps:"
  echo "  1. Run 'npm install' to install dependencies"
  echo "  2. Run 'docker compose up -d postgres' to start PostgreSQL"
  echo "  3. Run 'npm run db:migrate' to create tables"
  echo "  4. Run 'npx tsx test-integration.ts' for integration tests"
  echo "  5. Run 'npm test' for unit tests"
  exit 0
else
  echo "❌ Some files or patterns are missing"
  exit 1
fi