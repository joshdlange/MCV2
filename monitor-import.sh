#!/bin/bash
echo "=== MONITORING PRICECHARTING IMPORT ==="
echo "Started at: $(date)"
echo "Process ID: $$"

while true; do
  if [ -f full-import-stats.log ]; then
    echo "=== CURRENT PROGRESS ==="
    tail -20 full-import-stats.log
    echo ""
    
    # Check if import is complete
    if grep -q "PriceCharting import completed" full-import-stats.log; then
      echo "✅ IMPORT COMPLETED!"
      break
    fi
  fi
  
  echo "Waiting 30 seconds..."
  sleep 30
done

echo "=== FINAL RESULTS ==="
grep -A 20 "PriceCharting import completed" full-import-stats.log || echo "Import still running..."
