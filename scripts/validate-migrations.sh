#!/bin/bash
# Migration Validation Script
# Ensures all migrations can be applied and rolled back successfully

set -e

echo "=== PostgreSQL Migration Validation ==="
echo "Validating forward and backward migration compatibility..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Track errors
ERRORS=0

# Check if PostgreSQL is running (compatible with both Docker Compose v1 and v2 output formats)
if ! docker compose ps --status running 2>/dev/null | grep -q "postgres"; then
    # Fallback: try direct container health check
    if ! docker exec annotation_postgres pg_isready -U postgres >/dev/null 2>&1; then
        echo -e "${RED}Error: PostgreSQL is not running. Start it with: docker compose up -d postgres${NC}"
        exit 1
    fi
fi

# Get database connection details
export PGHOST=${PGHOST:-localhost}
export PGPORT=${PGPORT:-5432}
export PGUSER=${PGUSER:-postgres}
export PGPASSWORD=${PGPASSWORD:-postgres}
export PGDATABASE=${PGDATABASE:-annotation_dev}

# Function to run SQL file (ON_ERROR_STOP=1 ensures psql exits non-zero on SQL errors)
run_sql() {
    local file=$1
    echo "Running: $file"
    if ! docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $PGUSER -d $PGDATABASE < "$file" 2>&1; then
        echo -e "${RED}✗ FAILED: $(basename $file)${NC}"
        return 1
    fi
    return 0
}

# Find all migration files
MIGRATION_DIR="migrations"
if [ ! -d "$MIGRATION_DIR" ]; then
    echo -e "${RED}Error: migrations directory not found${NC}"
    exit 1
fi

# Get all .up.sql files
UP_FILES=($(find $MIGRATION_DIR -name "*.up.sql" | sort))

if [ ${#UP_FILES[@]} -eq 0 ]; then
    echo -e "${RED}Error: No migration files found${NC}"
    exit 1
fi

echo "Found ${#UP_FILES[@]} migrations to validate"
echo

# Reset database
echo "1. Resetting database..."
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $PGUSER -c "DROP DATABASE IF EXISTS $PGDATABASE;"
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $PGUSER -c "CREATE DATABASE $PGDATABASE;"
echo -e "${GREEN}✓ Database reset complete${NC}"
echo

# Apply all UP migrations
echo "2. Applying UP migrations..."
for up_file in "${UP_FILES[@]}"; do
    if run_sql "$up_file"; then
        echo -e "${GREEN}✓ Applied: $(basename $up_file)${NC}"
    else
        echo -e "${RED}✗ Failed to apply: $(basename $up_file)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done
echo

# Verify tables exist
echo "3. Verifying tables..."
EXPECTED_TABLES=("notes" "branches" "panels" "document_saves")
for table in "${EXPECTED_TABLES[@]}"; do
    if docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $PGUSER -d $PGDATABASE -tAc "SELECT 1 FROM pg_tables WHERE tablename='$table';" 2>/dev/null | grep -q "1"; then
        echo -e "${GREEN}✓ Table exists: $table${NC}"
    else
        echo -e "${RED}✗ Table missing: $table${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done
echo

# Apply all DOWN migrations in reverse order
echo "4. Testing DOWN migrations..."
DOWN_FILES=($(find $MIGRATION_DIR -name "*.down.sql" | sort -r))
for down_file in "${DOWN_FILES[@]}"; do
    if [ -f "$down_file" ]; then
        if run_sql "$down_file"; then
            echo -e "${GREEN}✓ Reverted: $(basename $down_file)${NC}"
        else
            echo -e "${RED}✗ Failed to revert: $(basename $down_file)${NC}"
            ERRORS=$((ERRORS + 1))
        fi
    else
        base_name="${down_file%.down.sql}"
        echo -e "${RED}✗ Missing DOWN migration for: $(basename ${base_name}.up.sql)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done
echo

# Re-apply all UP migrations
echo "5. Re-applying UP migrations..."
for up_file in "${UP_FILES[@]}"; do
    if run_sql "$up_file"; then
        echo -e "${GREEN}✓ Re-applied: $(basename $up_file)${NC}"
    else
        echo -e "${RED}✗ Failed to re-apply: $(basename $up_file)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done
echo

# Final verification
echo "6. Final verification..."
for table in "${EXPECTED_TABLES[@]}"; do
    if row_count=$(docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $PGUSER -d $PGDATABASE -tAc "SELECT COUNT(*) FROM $table;" 2>&1); then
        echo -e "${GREEN}✓ Table $table ready (rows: $row_count)${NC}"
    else
        echo -e "${RED}✗ Table $table does not exist or is inaccessible${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done
echo

# Final report
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}=== Migration validation complete! ===${NC}"
    echo "All migrations can be applied and rolled back successfully."
    exit 0
else
    echo -e "${RED}=== Migration validation FAILED ===${NC}"
    echo "$ERRORS error(s) detected. Review output above for details."
    exit 1
fi
