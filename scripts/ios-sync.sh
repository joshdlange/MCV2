#!/bin/bash
# ios-sync.sh — Run this on your Mac after pulling latest from Replit.
# Applies repo-managed patches to node_modules, then syncs to the Xcode project.
#
# Usage:
#   sh scripts/ios-sync.sh
#
# What it does:
#   1. Applies patches/ to node_modules (currently: Apple Sign-In iOS 16+ fix)
#   2. Runs npx cap sync ios to copy patched native code into the Xcode project
#   3. Prints next steps

set -e

echo ""
echo "=== Step 1: Applying node_modules patches ==="
npx patch-package
echo "✅ Patches applied"

echo ""
echo "=== Step 2: Syncing Capacitor to Xcode project ==="
npx cap sync ios
echo "✅ Capacitor synced"

echo ""
echo "=== Done! ==="
echo ""
echo "Next steps in Xcode:"
echo "  1. Open ios/App/App.xcworkspace"
echo "  2. Product → Clean Build Folder"
echo "  3. Select your device and click Run"
echo ""
