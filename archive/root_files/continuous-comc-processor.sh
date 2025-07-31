#!/bin/bash

echo "🏪 CONTINUOUS COMC IMAGE PROCESSOR"
echo "=================================="

# Function to check if process is running
check_process() {
  if [ -f comc-current.pid ]; then
    PID=$(cat comc-current.pid)
    if ps -p $PID > /dev/null 2>&1; then
      return 0  # Running
    else
      return 1  # Not running
    fi
  else
    return 1  # No PID file
  fi
}

# Function to start processing
start_processing() {
  echo "Starting COMC processing batch..."
  npx tsx scripts/comc-image-population.ts 1000 100 > comc-current.log 2>&1 &
  echo $! > comc-current.pid
  echo "Started batch with PID: $(cat comc-current.pid)"
}

# Main processing loop
BATCH_COUNT=0
while true; do
  BATCH_COUNT=$((BATCH_COUNT + 1))
  echo ""
  echo "🔄 Batch $BATCH_COUNT - $(date)"
  
  # Check if process is still running
  if check_process; then
    echo "✅ Process still running, waiting..."
    sleep 30
    continue
  fi
  
  # Check remaining cards
  REMAINING=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM cards WHERE front_image_url IS NULL OR front_image_url = ''" 2>/dev/null | tr -d ' ')
  
  if [ -z "$REMAINING" ] || [ "$REMAINING" -eq 0 ]; then
    echo "🎉 All cards processed! No more cards without images."
    break
  fi
  
  echo "📊 Remaining cards without images: $REMAINING"
  
  # Start new batch
  start_processing
  
  # Wait a bit before checking again
  sleep 60
done

echo "🏁 Continuous processing complete!"