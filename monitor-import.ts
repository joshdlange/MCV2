import { db } from './server/db';
import { cards } from './shared/schema';
import { count } from 'drizzle-orm';
import fs from 'fs';

async function monitorImport() {
  console.log('=== IMPORT MONITORING ===');
  
  // Check if process is running
  let pidFile = 'live-progress.pid';
  if (!fs.existsSync(pidFile)) {
    console.log('❌ No PID file found');
    return;
  }
  
  const pid = fs.readFileSync(pidFile, 'utf8').trim();
  
  try {
    process.kill(parseInt(pid), 0); // Check if process exists
    console.log(`✅ Import process (${pid}) is running`);
  } catch (error) {
    console.log(`❌ Import process (${pid}) is not running`);
  }
  
  // Check current card count
  const [result] = await db.select({ count: count() }).from(cards);
  console.log(`Current card count: ${result.count}`);
  
  // Show latest progress
  if (fs.existsSync('live-randomized-import.log')) {
    console.log('\n=== LATEST PROGRESS ===');
    const log = fs.readFileSync('live-randomized-import.log', 'utf8');
    const lines = log.split('\n');
    const lastLines = lines.slice(-20).filter(line => line.trim());
    lastLines.forEach(line => console.log(line));
  }
}

monitorImport().catch(console.error);