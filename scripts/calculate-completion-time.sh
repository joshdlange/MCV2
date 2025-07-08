#!/bin/bash

LOG_FILE="full-import-progress.log"
TOTAL_SETS=1114

echo "⏱️  PriceCharting Import Time Estimate"
echo "====================================="
echo ""

if [ ! -f "$LOG_FILE" ]; then
    echo "❌ Log file not found. Starting fresh calculation..."
    echo ""
    echo "📊 Baseline estimates:"
    echo "  Total sets: $TOTAL_SETS"
    echo "  API delay: 30 seconds between requests"
    echo "  Processing time: ~10 seconds per set"
    echo "  Total time per set: ~40 seconds"
    echo ""
    echo "🕐 Estimated completion: $(($TOTAL_SETS * 40 / 60)) minutes ($(($TOTAL_SETS * 40 / 3600)) hours)"
    echo ""
    exit 0
fi

# Count processed sets
PROCESSED=$(grep -c "Processing set:" "$LOG_FILE" 2>/dev/null || echo "0")
COMPLETED=$(grep -c "Added .* new cards to set" "$LOG_FILE" 2>/dev/null || echo "0")
NEW_CARDS=$(grep -c "Added new card:" "$LOG_FILE" 2>/dev/null || echo "0")

echo "📊 Current Progress:"
echo "  Sets processed: $PROCESSED / $TOTAL_SETS"
echo "  Sets completed: $COMPLETED"
echo "  New cards added: $NEW_CARDS"
echo ""

if [ $PROCESSED -gt 0 ]; then
    # Calculate progress percentage
    PROGRESS=$((PROCESSED * 100 / TOTAL_SETS))
    REMAINING=$((TOTAL_SETS - PROCESSED))
    
    echo "🎯 Progress: $PROGRESS% complete"
    echo "📋 Remaining sets: $REMAINING"
    echo ""
    
    # Calculate time estimates
    if [ $PROCESSED -gt 1 ]; then
        # Get start time from first log entry
        START_TIME=$(head -1 "$LOG_FILE" | grep -o '[0-9][0-9]:[0-9][0-9]:[0-9][0-9]' | head -1)
        CURRENT_TIME=$(date +%H:%M:%S)
        
        # Calculate elapsed time in minutes (rough estimate)
        ELAPSED_MINUTES=$((PROCESSED * 1))  # Assume 1 minute per set average
        
        if [ $ELAPSED_MINUTES -gt 0 ]; then
            RATE=$((PROCESSED * 60 / ELAPSED_MINUTES))  # Sets per hour
            REMAINING_HOURS=$((REMAINING * 60 / RATE / 60))
            REMAINING_MINUTES=$((REMAINING * 60 / RATE % 60))
            
            echo "⏱️  Time Estimates:"
            echo "  Processing rate: ~$RATE sets/hour"
            echo "  Remaining time: ~$REMAINING_HOURS hours, $REMAINING_MINUTES minutes"
            echo ""
        fi
    fi
    
    # Show recent activity
    echo "📈 Recent Activity:"
    tail -5 "$LOG_FILE" | grep -E "(Processing set|Added.*new cards|Found.*matching)" | tail -3
    
else
    echo "⏳ Import just started - calculating baseline estimates..."
    echo ""
    echo "📊 Expected timeline:"
    echo "  Total sets: $TOTAL_SETS"
    echo "  Time per set: ~40 seconds (30s API delay + 10s processing)"
    echo "  Total time: ~$(($TOTAL_SETS * 40 / 60)) minutes ($(($TOTAL_SETS * 40 / 3600)) hours)"
    echo ""
    echo "🎯 Estimated completion: $(date -d "+$(($TOTAL_SETS * 40 / 60)) minutes" +"%H:%M %p")"
fi