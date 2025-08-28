#!/bin/bash

echo "📦 Installing missing Y.js dependencies with pnpm"
echo "================================================"
echo ""

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed. Installing pnpm first..."
    npm install -g pnpm
fi

echo "Current y-protocols status:"
pnpm list y-protocols

echo ""
echo "Installing y-webrtc (y-protocols is already available)..."
pnpm add y-webrtc

echo ""
echo "✅ Dependencies installed!"
echo ""
echo "Verifying installation:"
pnpm list y-protocols y-webrtc

echo ""
echo "Now restart the dev server:"
echo "npm run dev"