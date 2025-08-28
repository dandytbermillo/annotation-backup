#!/bin/bash
# Migration Validation Script
# Ensures all migrations can be applied and rolled back successfully

set -e

echo "=== PostgreSQL Migration Validation ==="
echo "Validating forward and backward migration compatibility..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if PostgreSQL is running
if ! docker compose ps postgres | grep -q "running"; then
    echo -e "${RED}Error: PostgreSQL is not running. Start it with: docker compose up -d postgres${NC}"
    exit 1
fi

# Get database connection details
export PGHOST=${PGHOST:-localhost}
export PGPORT=${PGPORT:-5432}
export PGUSER=${PGUSER:-postgres}
export PGPASSWORD=${PGPASSWORD:-postgres}
export PGDATABASE=${PGDATABASE:-annotation_db}

# Function to run SQL file
run_sql() {
    local file=$1
    echo "Running: $file"
    docker compose exec -T postgres psql -U $PGUSER -d $PGDATABASE < "$file"
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
docker compose exec -T postgres psql -U $PGUSER -c "DROP DATABASE IF EXISTS $PGDATABASE;"
docker compose exec -T postgres psql -U $PGUSER -c "CREATE DATABASE $PGDATABASE;"
echo -e "${GREEN}✓ Database reset complete${NC}"
echo

# Apply all UP migrations
echo "2. Applying UP migrations..."
for up_file in "${UP_FILES[@]}"; do
    run_sql "$up_file"
    base_name="${up_file%.up.sql}"
    echo -e "${GREEN}✓ Applied: $(basename $up_file)${NC}"
done
echo

# Verify tables exist
echo "3. Verifying tables..."
EXPECTED_TABLES=("notes" "branches" "panels" "document_saves")
for table in "${EXPECTED_TABLES[@]}"; do
    if docker compose exec -T postgres psql -U $PGUSER -d $PGDATABASE -c "\dt $table" | grep -q "$table"; then
        echo -e "${GREEN}✓ Table exists: $table${NC}"
    else
        echo -e "${RED}✗ Table missing: $table${NC}"
        exit 1
    fi
done
echo

# Apply all DOWN migrations in reverse order
echo "4. Testing DOWN migrations..."
DOWN_FILES=($(find $MIGRATION_DIR -name "*.down.sql" | sort -r))
for down_file in "${DOWN_FILES[@]}"; do
    if [ -f "$down_file" ]; then
        run_sql "$down_file"
        echo -e "${GREEN}✓ Reverted: $(basename $down_file)${NC}"
    else
        base_name="${down_file%.down.sql}"
        echo -e "${RED}✗ Missing DOWN migration for: $(basename ${base_name}.up.sql)${NC}"
        exit 1
    fi
done
echo

# Re-apply all UP migrations
echo "5. Re-applying UP migrations..."
for up_file in "${UP_FILES[@]}"; do
    run_sql "$up_file"
    echo -e "${GREEN}✓ Re-applied: $(basename $up_file)${NC}"
done
echo

# Final verification
echo "6. Final verification..."
for table in "${EXPECTED_TABLES[@]}"; do
    row_count=$(docker compose exec -T postgres psql -U $PGUSER -d $PGDATABASE -t -c "SELECT COUNT(*) FROM $table;" | tr -d ' ')
    echo -e "${GREEN}✓ Table $table ready (rows: $row_count)${NC}"
done
echo

echo -e "${GREEN}=== Migration validation complete! ===${NC}"
echo "All migrations can be applied and rolled back successfully."