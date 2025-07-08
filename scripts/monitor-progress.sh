#!/bin/bash

echo "📊 PriceCharting Import Progress Monitor"
echo "========================================"
echo ""

# Check if process is running
if ps aux | grep -q "[t]sx scripts/pricecharting-import.ts"; then
    echo "✅ Import process is running"
    echo ""
    
    # Show recent progress
    echo "📈 Recent Progress:"
    tail -20 pricecharting-import.log | grep -E "(Processing set|Added.*new cards|Found.*matching)"
    
    echo ""
    echo "📊 Summary Statistics:"
    
    # Count processed sets
    PROCESSED=$(grep -c "Processing set:" pricecharting-import.log)
    echo "  Sets processed: $PROCESSED / 1,114"
    
    # Count new cards added
    NEW_CARDS=$(grep -c "Added new card:" pricecharting-import.log)
    echo "  New cards added: $NEW_CARDS"
    
    # Count sets with matches
    SETS_WITH_MATCHES=$(grep -c "Found.*matching trading cards" pricecharting-import.log)
    echo "  Sets with matches: $SETS_WITH_MATCHES"
    
    # Progress percentage
    PROGRESS=$((PROCESSED * 100 / 1114))
    echo "  Progress: $PROGRESS%"
    
    # Estimate remaining time
    if [ $PROCESSED -gt 0 ]; then
        REMAINING=$((1114 - PROCESSED))
        MINUTES_LEFT=$((REMAINING / 2))  # Roughly 2 sets per minute with 30s delays
        echo "  Estimated time remaining: $MINUTES_LEFT minutes"
    fi
    
else
    echo "❌ Import process is not running"
    echo ""
    echo "Last 10 lines of log:"
    tail -10 pricecharting-import.log
fi