#!/bin/bash

echo "🚀 Starting PriceCharting import process..."
echo "📊 Processing 1,114 card sets with 30-second delays between requests"
echo "⏱️  Estimated completion time: 9-10 hours"
echo "📋 Monitor progress with: tail -f import-progress.log"
echo ""

# Run the import in background with progress logging
cd /home/runner/workspace
nohup tsx scripts/pricecharting-import.ts > import-progress.log 2>&1 &

# Get the process ID
PID=$!
echo "✅ Import process started with PID: $PID"
echo "📊 Check progress: tail -f import-progress.log"
echo "⏹️  Stop process: kill $PID"
echo ""

# Monitor for first minute
echo "🔍 Initial progress:"
sleep 5
tail -10 import-progress.log