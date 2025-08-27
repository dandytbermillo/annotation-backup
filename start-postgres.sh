#!/bin/bash

echo "Starting PostgreSQL with Docker..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "Docker is not running. Please start Docker first."
  echo "On macOS: Open Docker Desktop from Applications"
  exit 1
fi

# Start PostgreSQL
echo "Starting PostgreSQL container..."
docker compose up -d postgres

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
sleep 5

# Check if PostgreSQL is running
if docker compose ps | grep -q "postgres.*running"; then
  echo "PostgreSQL is running successfully!"
  echo ""
  echo "Connection details:"
  echo "  Host: localhost"
  echo "  Port: 5432"
  echo "  Database: annotation_system"
  echo "  Username: postgres"
  echo "  Password: postgres"
  echo ""
  echo "To stop PostgreSQL: docker compose down"
else
  echo "Failed to start PostgreSQL. Check Docker logs:"
  echo "docker compose logs postgres"
  exit 1
fi