#!/bin/bash

echo "🚀 PriceCharting Import Progress"
echo "================================"
echo ""

# Check if process is running
if ps aux | grep -q "[t]sx scripts/pricecharting-import.ts"; then
    echo "✅ Import process is running (PID: $(cat full-import.pid 2>/dev/null || echo 'unknown'))"
    echo ""
    
    # Count progress from log
    if [ -f "full-import.log" ]; then
        PROCESSED=$(grep -c "Processing set:" full-import.log)
        NEW_CARDS=$(grep -c "Added new card:" full-import.log)
        SETS_WITH_CARDS=$(grep -c "Added .* new cards to set" full-import.log)
        
        echo "📊 Progress:"
        echo "  Sets processed: $PROCESSED / 1,114"
        echo "  New cards added: $NEW_CARDS"
        echo "  Sets with new cards: $SETS_WITH_CARDS"
        echo ""
        
        # Show recent activity
        echo "📈 Recent activity:"
        tail -10 full-import.log | grep -E "(Processing set|Added.*new cards|Found.*matching)"
        
        # Progress percentage
        if [ $PROCESSED -gt 0 ]; then
            PROGRESS=$((PROCESSED * 100 / 1114))
            echo ""
            echo "🎯 $PROGRESS% complete"
        fi
    fi
else
    echo "❌ Import process is not running"
    echo ""
    echo "Last activity:"
    tail -5 full-import.log 2>/dev/null || echo "No log file found"
fi