#!/bin/bash

echo "📦 Installing missing Y.js dependencies"
echo "======================================"
echo ""

echo "Installing y-protocols and y-webrtc..."
npm install y-protocols y-webrtc

echo ""
echo "✅ Dependencies installed!"
echo ""
echo "Now restart the dev server:"
echo "npm run dev"