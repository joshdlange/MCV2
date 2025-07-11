import { readFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';

async function monitorImport() {
  console.log('=== PriceCharting Import Monitor ===');
  
  // Check if import is running
  const pidFile = 'full-import.pid';
  if (!existsSync(pidFile)) {
    console.log('No import process found');
    return;
  }
  
  const pid = readFileSync(pidFile, 'utf8').trim();
  console.log(`Monitoring import process PID: ${pid}`);
  
  // Check if process is still running
  try {
    const checkProcess = spawn('ps', ['-p', pid], { stdio: 'pipe' });
    let processExists = false;
    
    checkProcess.on('exit', (code) => {
      processExists = code === 0;
      
      if (!processExists) {
        console.log('Import process has completed');
        
        // Check for log files
        const logFiles = ['full-import-complete.log', 'zero-match-sets.log', 'partial-completion-sets.log', 'import.log'];
        
        logFiles.forEach(file => {
          if (existsSync(file)) {
            console.log(`\n=== ${file} ===`);
            const content = readFileSync(file, 'utf8');
            console.log(content.slice(-2000)); // Show last 2000 chars
          }
        });
      } else {
        console.log('Import process is still running...');
        
        // Show current progress
        if (existsSync('full-import-complete.log')) {
          console.log('\n=== Recent Progress ===');
          const content = readFileSync('full-import-complete.log', 'utf8');
          const lines = content.split('\n');
          console.log(lines.slice(-20).join('\n')); // Show last 20 lines
        }
      }
    });
    
  } catch (error) {
    console.log('Error checking process:', error);
  }
}

monitorImport().catch(console.error);