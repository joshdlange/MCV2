#!/bin/bash

# Monitor the import progress
echo "=== IMPORT MONITOR ==="

# Check if process is running
PID=$(cat background-import.pid 2>/dev/null || echo "")
if [ -z "$PID" ]; then
    echo "❌ No PID file found"
    exit 1
fi

if ! ps -p $PID > /dev/null 2>&1; then
    echo "❌ Import process ($PID) is not running"
    exit 1
fi

echo "✅ Import process ($PID) is running"

# Show progress
echo ""
echo "=== LATEST PROGRESS ==="
tail -20 background-import.log

# Show current card count
echo ""
echo "=== CURRENT CARD COUNT ==="
npx tsx -e "
import { db } from './server/db';
import { cards } from './shared/schema';
import { count } from 'drizzle-orm';
async function check() {
  const [result] = await db.select({ count: count() }).from(cards);
  console.log('Total cards:', result.count);
}
check().catch(console.error);
"

echo ""
echo "=== MONITORING COMPLETE ==="