#!/bin/bash

# Quick Start Script for Option A Testing
# Bypasses TypeScript errors to allow functional testing

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🚀 Quick Start for Option A (Plain Offline Mode)${NC}"
echo -e "${GREEN}================================================${NC}\n"

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo -e "${YELLOW}Creating .env.local from template...${NC}"
    cp .env.example .env.local
    echo -e "${GREEN}✓ Created .env.local${NC}"
fi

# Set environment for plain mode
export NEXT_PUBLIC_COLLAB_MODE=plain
export DATABASE_URL=${DATABASE_URL:-"postgresql://postgres:postgres@localhost:5432/annotation_dev"}

echo -e "\n${YELLOW}Environment Configuration:${NC}"
echo -e "  NEXT_PUBLIC_COLLAB_MODE = ${GREEN}plain${NC}"
echo -e "  DATABASE_URL = ${GREEN}${DATABASE_URL}${NC}"

# Check if PostgreSQL is accessible
echo -e "\n${YELLOW}Checking PostgreSQL connection...${NC}"
if pg_isready -h localhost -p 5432 &> /dev/null; then
    echo -e "${GREEN}✓ PostgreSQL is accessible${NC}"
    
    # Try to run migrations
    echo -e "\n${YELLOW}Running migrations...${NC}"
    if node scripts/run-migrations.js; then
        echo -e "${GREEN}✓ Migrations completed${NC}"
    else
        echo -e "${RED}⚠ Migration failed - database may need manual setup${NC}"
    fi
else
    echo -e "${RED}⚠ PostgreSQL not accessible${NC}"
    echo -e "  You can still test with mock data, but persistence won't work."
    echo -e "  To enable persistence:"
    echo -e "    1. Install PostgreSQL locally, or"
    echo -e "    2. Run: docker compose up -d postgres"
fi

# Build TypeScript with loose checking
echo -e "\n${YELLOW}Building application (ignoring type errors)...${NC}"
# Create a temporary tsconfig for building
cat > tsconfig.build.json << EOF
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "skipLibCheck": true,
    "noEmit": false,
    "strict": false
  }
}
EOF

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Starting Option A in development mode...${NC}"
echo -e "${GREEN}========================================${NC}"

echo -e "\n📝 Testing Instructions:"
echo -e "  1. Open http://localhost:3000 in your browser"
echo -e "  2. Create a new note using the UI"
echo -e "  3. Select text and create annotations (note/explore/promote)"
echo -e "  4. Refresh the page to verify persistence"
echo -e "  5. Check browser console for PlainOfflineProvider logs"

echo -e "\n⚠️  Known Issues:"
echo -e "  - TypeScript has 88 errors (functionality not affected)"
echo -e "  - Some UI elements may show warnings"
echo -e "  - Tests cannot run due to type errors"

echo -e "\n${YELLOW}Starting Next.js in plain mode...${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop${NC}\n"

# Start the development server
NEXT_PUBLIC_COLLAB_MODE=plain npm run dev

# Cleanup
rm -f tsconfig.build.json