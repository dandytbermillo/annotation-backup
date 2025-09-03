#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting development environment...${NC}"

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo -e "${YELLOW}Docker is not running. Starting Docker...${NC}"
    
    # For macOS, open Docker app
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open -a Docker
        
        # Wait for Docker to start (with timeout)
        echo -e "${YELLOW}Waiting for Docker to start...${NC}"
        timeout=60
        elapsed=0
        while ! docker info >/dev/null 2>&1; do
            if [ $elapsed -ge $timeout ]; then
                echo -e "${RED}Docker failed to start within ${timeout} seconds${NC}"
                exit 1
            fi
            sleep 2
            elapsed=$((elapsed + 2))
            echo -n "."
        done
        echo ""
        echo -e "${GREEN}Docker started successfully!${NC}"
    else
        echo -e "${RED}Please start Docker manually${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}Docker is already running${NC}"
fi

# Check if postgres container exists and is running
if docker-compose ps postgres 2>/dev/null | grep -q "Up"; then
    echo -e "${GREEN}PostgreSQL container is already running${NC}"
else
    echo -e "${YELLOW}Starting PostgreSQL container...${NC}"
    docker-compose up -d postgres
    
    # Wait for PostgreSQL to be ready
    echo -e "${YELLOW}Waiting for PostgreSQL to be ready...${NC}"
    max_attempts=30
    attempt=0
    while ! docker-compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do
        if [ $attempt -ge $max_attempts ]; then
            echo -e "${RED}PostgreSQL failed to start within 60 seconds${NC}"
            exit 1
        fi
        sleep 2
        attempt=$((attempt + 1))
        echo -n "."
    done
    echo ""
    echo -e "${GREEN}PostgreSQL is ready!${NC}"
fi

# Run database migrations if needed
if [ -f "scripts/run-migrations.js" ]; then
    echo -e "${YELLOW}Running database migrations...${NC}"
    node scripts/run-migrations.js
fi

# Start the Next.js development server
echo -e "${GREEN}Starting Next.js development server...${NC}"
next dev