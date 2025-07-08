#!/bin/bash

echo "🔍 Monitoring Full Import Progress"
echo "=================================="
echo ""

# Check if import is running
if ps aux | grep -q "[r]un-complete-import"; then
    echo "✅ Import process is running (PID: $(cat full-import.pid 2>/dev/null || echo 'unknown'))"
else
    echo "❌ Import process is not running"
fi

echo ""
echo "📊 Current Progress:"
if [ -f "full-import.log" ]; then
    PROCESSED=$(grep -c "Processing set:" full-import.log 2>/dev/null || echo "0")
    NEW_CARDS=$(grep -c "Added new card:" full-import.log 2>/dev/null || echo "0")
    MATCHES=$(grep -c "matching trading cards" full-import.log 2>/dev/null || echo "0")
    
    echo "  Sets processed: $PROCESSED / 1114"
    echo "  New cards added: $NEW_CARDS"
    echo "  Sets with matches: $MATCHES"
    
    echo ""
    echo "📝 Recent activity:"
    tail -10 full-import.log | grep -E "(Processing set|Added.*new cards|matching trading cards)" | tail -5
    
    echo ""
    echo "🔄 Last few log lines:"
    tail -3 full-import.log
else
    echo "  No log file found yet"
fi

echo ""
echo "💾 Database Status:"
TOTAL_CARDS=$(psql $DATABASE_URL -t -c "SELECT COUNT(*) FROM cards;" 2>/dev/null | tr -d ' ')
echo "  Total cards in database: $TOTAL_CARDS"

echo ""
echo "⏱️  To check progress again, run: ./scripts/monitor-import.sh"
echo "📋 To view live log: tail -f full-import.log"