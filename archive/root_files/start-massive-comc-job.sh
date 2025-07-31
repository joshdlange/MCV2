#!/bin/bash

echo "🏪 Starting COMC Massive Image Processing Job"
echo "=============================================="

# Kill any existing COMC jobs
echo "Stopping any existing COMC jobs..."
pkill -f "comc-image-population" 2>/dev/null || true
sleep 2

# Remove old log files older than 1 hour
find . -name "comc-*.log" -mmin +60 -delete 2>/dev/null || true

# Start the massive processing job
echo "Starting new COMC processing job..."
echo "Target: Process all 31,206 remaining cards"
echo "Batch size: 150 cards per batch"
echo "Rate limiting: 1000ms between requests"
echo ""

npx tsx scripts/comc-image-population.ts 31206 150 > comc-continuous-job.log 2>&1 &
JOB_PID=$!
echo $JOB_PID > comc-continuous-job.pid

echo "✅ COMC job started with PID: $JOB_PID"
echo "📋 Log file: comc-continuous-job.log"
echo "🔄 This job will run until all 31,206 cards are processed"
echo ""
echo "Monitor progress with:"
echo "  tail -f comc-continuous-job.log"
echo "  npx tsx scripts/monitor-comc-progress.ts"
echo ""
echo "Stop the job with:"
echo "  kill $JOB_PID"

sleep 5
echo ""
echo "📊 Initial log output:"
tail -10 comc-continuous-job.log 2>/dev/null || echo "Log not ready yet..."