#!/bin/bash

# Script to keep PriceCharting import running reliably
LOG_FILE="pricecharting-import.log"
PID_FILE="import.pid"

# Function to start the import process
start_import() {
    echo "$(date): Starting PriceCharting import process..."
    cd /home/runner/workspace
    nohup tsx scripts/pricecharting-import.ts > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "$(date): Process started with PID: $(cat $PID_FILE)"
}

# Function to check if process is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Main monitoring loop
echo "$(date): Starting import monitor..."

while true; do
    if ! is_running; then
        echo "$(date): Import process not running, starting it..."
        start_import
    else
        echo "$(date): Import process is running (PID: $(cat $PID_FILE))"
        
        # Show progress if log exists
        if [ -f "$LOG_FILE" ]; then
            PROCESSED=$(grep -c "Processing set:" "$LOG_FILE" 2>/dev/null || echo "0")
            NEW_CARDS=$(grep -c "Added new card:" "$LOG_FILE" 2>/dev/null || echo "0")
            echo "$(date): Progress - Sets: $PROCESSED/1114, New cards: $NEW_CARDS"
        fi
    fi
    
    # Check every 2 minutes
    sleep 120
done