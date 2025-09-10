#!/bin/bash

echo "🚀 Starting Annotation System Standalone Desktop App"
echo "=================================================="
echo ""

# Check if dev server is running
echo "📡 Checking if development server is running..."
if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "✅ Development server is running"
else
    echo "⚠️  Development server not detected"
    echo "Starting development server in background..."
    npm run dev &
    echo "Waiting for server to start..."
    sleep 5
fi

echo ""
echo "🖥️  Launching Electron desktop application..."
echo ""

# Launch Electron app
npx electron electron-standalone.js

echo ""
echo "👋 Application closed"