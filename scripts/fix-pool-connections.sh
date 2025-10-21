#!/bin/bash

# Fix PostgreSQL connection pool exhaustion by replacing individual pools with shared pool
# This script updates all API routes to use the shared pool from lib/db/pool.ts

echo "Fixing PostgreSQL pool connections..."
echo "========================================"

# Find all route.ts files that create their own Pool
FILES=$(grep -r "new Pool({" app/api --include="route.ts" -l)

COUNT=0
for FILE in $FILES; do
  echo "Processing: $FILE"

  # Check if it already uses getServerPool (skip if already fixed)
  if grep -q "getServerPool" "$FILE"; then
    echo "  ✓ Already using shared pool, skipping"
    continue
  fi

  # Replace import
  if grep -q "import { Pool } from 'pg';" "$FILE"; then
    sed -i.bak "s/import { Pool } from 'pg';/import { getServerPool } from '@\/lib\/db\/pool';/" "$FILE"
    echo "  ✓ Updated import"
  fi

  # Replace pool initialization (handle both single and multi-line)
  sed -i.bak "s/const pool = new Pool({[^}]*});/const pool = getServerPool();/" "$FILE"

  # If that didn't work (multi-line case), try a different approach
  perl -i.bak2 -0pe 's/const pool = new Pool\(\{[^}]+\}\);/const pool = getServerPool();/gs' "$FILE"

  echo "  ✓ Replaced pool initialization"
  COUNT=$((COUNT + 1))
done

echo ""
echo "========================================"
echo "Fixed $COUNT files"
echo ""
echo "Backup files created with .bak extension"
echo "Run 'find app/api -name \"*.bak\" -delete' to remove backups after verification"
