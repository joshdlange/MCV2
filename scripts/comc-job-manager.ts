#!/usr/bin/env tsx

import { COMCMassiveImageProcessor } from './comc-massive-image-population';
import { COMCProgressMonitor } from './comc-progress-monitor';
import * as fs from 'fs';
import * as path from 'path';

interface JobState {
  isRunning: boolean;
  pid?: number;
  startTime?: Date;
  lastProcessedId: number;
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  batchSize: number;
  estimatedCompletion?: Date;
}

class COMCJobManager {
  private stateFile: string;
  private logFile: string;

  constructor() {
    this.stateFile = path.join(process.cwd(), 'comc-job-state.json');
    this.logFile = path.join(process.cwd(), 'comc-job-manager.log');
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(logMessage.trim());
    
    try {
      fs.appendFileSync(this.logFile, logMessage);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  private loadState(): JobState {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = fs.readFileSync(this.stateFile, 'utf8');
        const state = JSON.parse(data);
        // Convert date strings back to Date objects
        if (state.startTime) state.startTime = new Date(state.startTime);
        if (state.estimatedCompletion) state.estimatedCompletion = new Date(state.estimatedCompletion);
        return state;
      }
    } catch (error) {
      this.log(`Error loading state: ${error}`);
    }

    return {
      isRunning: false,
      lastProcessedId: 0,
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      batchSize: 150
    };
  }

  private saveState(state: JobState): void {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      this.log(`Error saving state: ${error}`);
    }
  }

  public async startJob(options: {
    batchSize?: number;
    maxCards?: number;
    resumeFromId?: number;
    forceRestart?: boolean;
  } = {}): Promise<void> {
    const state = this.loadState();

    if (state.isRunning && !options.forceRestart) {
      this.log('❌ Job is already running. Use --force to restart.');
      return;
    }

    if (options.forceRestart && state.isRunning) {
      this.log('🔄 Force restart requested - stopping existing job...');
      await this.stopJob();
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    }

    this.log('🚀 Starting COMC massive image processing job...');

    // Set environment variables for the processor
    if (options.batchSize) process.env.COMC_BATCH_SIZE = options.batchSize.toString();
    if (options.maxCards) process.env.COMC_MAX_CARDS = options.maxCards.toString();
    if (options.resumeFromId !== undefined) process.env.COMC_RESUME_FROM = options.resumeFromId.toString();
    else if (state.lastProcessedId > 0) process.env.COMC_RESUME_FROM = state.lastProcessedId.toString();

    // Update state
    const newState: JobState = {
      ...state,
      isRunning: true,
      pid: process.pid,
      startTime: new Date(),
      batchSize: options.batchSize || state.batchSize || 150
    };
    this.saveState(newState);

    try {
      const processor = new COMCMassiveImageProcessor();
      
      // Set up periodic state updates
      const stateInterval = setInterval(() => {
        const stats = processor.getStats();
        const currentState = this.loadState();
        
        currentState.totalProcessed = stats.totalProcessed;
        currentState.successCount = stats.successCount;
        currentState.failureCount = stats.failureCount;
        currentState.lastProcessedId = stats.lastProcessedId;
        
        // Calculate estimated completion
        if (stats.totalProcessed > 0) {
          const elapsed = Date.now() - stats.startTime.getTime();
          const rate = stats.totalProcessed / elapsed; // cards per ms
          
          // Estimate remaining cards (rough calculation)
          const estimatedRemaining = 30000; // This would be calculated more accurately
          const estimatedTimeRemaining = estimatedRemaining / rate;
          currentState.estimatedCompletion = new Date(Date.now() + estimatedTimeRemaining);
        }
        
        this.saveState(currentState);
      }, 30000); // Update every 30 seconds

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        this.log('🛑 Received SIGINT - stopping job...');
        clearInterval(stateInterval);
        processor.stop();
      });

      process.on('SIGTERM', () => {
        this.log('🛑 Received SIGTERM - stopping job...');
        clearInterval(stateInterval);
        processor.stop();
      });

      // Start processing
      await processor.processAllCards();

      // Job completed successfully
      clearInterval(stateInterval);
      const finalState = this.loadState();
      finalState.isRunning = false;
      finalState.pid = undefined;
      this.saveState(finalState);

      this.log('✅ COMC massive image processing job completed successfully!');

    } catch (error) {
      this.log(`❌ Job failed: ${error}`);
      
      // Update state to reflect failure
      const errorState = this.loadState();
      errorState.isRunning = false;
      errorState.pid = undefined;
      this.saveState(errorState);
      
      throw error;
    }
  }

  public async stopJob(): Promise<void> {
    const state = this.loadState();

    if (!state.isRunning) {
      this.log('ℹ️  No job is currently running.');
      return;
    }

    this.log('🛑 Stopping COMC job...');

    if (state.pid) {
      try {
        process.kill(state.pid, 'SIGTERM');
        this.log(`Sent SIGTERM to process ${state.pid}`);
        
        // Wait a bit for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Check if process is still running
        try {
          process.kill(state.pid, 0); // Check if process exists
          this.log(`Process ${state.pid} still running, sending SIGKILL...`);
          process.kill(state.pid, 'SIGKILL');
        } catch {
          // Process already terminated
        }
      } catch (error) {
        this.log(`Error stopping process: ${error}`);
      }
    }

    // Update state
    state.isRunning = false;
    state.pid = undefined;
    this.saveState(state);

    this.log('✅ Job stopped.');
  }

  public async getStatus(): Promise<void> {
    const state = this.loadState();
    const monitor = new COMCProgressMonitor();

    console.log(`
🏪 COMC JOB MANAGER STATUS
========================

📊 JOB STATE:
   Status: ${state.isRunning ? '🟢 RUNNING' : '🔴 STOPPED'}
   PID: ${state.pid || 'N/A'}
   Start Time: ${state.startTime ? state.startTime.toISOString() : 'N/A'}
   Last Processed ID: ${state.lastProcessedId}
   
📈 PROGRESS:
   Total Processed: ${state.totalProcessed.toLocaleString()}
   Successful: ${state.successCount.toLocaleString()}
   Failed: ${state.failureCount.toLocaleString()}
   Batch Size: ${state.batchSize}
   
⏰ ESTIMATES:
   Est. Completion: ${state.estimatedCompletion ? state.estimatedCompletion.toISOString() : 'Calculating...'}
`);

    console.log('📊 CURRENT PROGRESS:');
    await monitor.printProgressReport();
  }

  public async resetState(): Promise<void> {
    this.log('🔄 Resetting job state...');
    
    const defaultState: JobState = {
      isRunning: false,
      lastProcessedId: 0,
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      batchSize: 150
    };
    
    this.saveState(defaultState);
    this.log('✅ Job state reset.');
  }
}

// CLI execution
async function main() {
  const manager = new COMCJobManager();
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'start':
        const batchSize = args.includes('--batch-size') ? 
          parseInt(args[args.indexOf('--batch-size') + 1]) : undefined;
        const maxCards = args.includes('--max-cards') ? 
          parseInt(args[args.indexOf('--max-cards') + 1]) : undefined;
        const resumeFromId = args.includes('--resume-from') ? 
          parseInt(args[args.indexOf('--resume-from') + 1]) : undefined;
        const forceRestart = args.includes('--force');

        await manager.startJob({ batchSize, maxCards, resumeFromId, forceRestart });
        break;

      case 'stop':
        await manager.stopJob();
        break;

      case 'status':
        await manager.getStatus();
        break;

      case 'reset':
        await manager.resetState();
        break;

      default:
        console.log(`
🏪 COMC Job Manager

Usage: npx tsx scripts/comc-job-manager.ts <command> [options]

Commands:
  start                 Start the massive image processing job
    --batch-size N      Set batch size (default: 150)
    --max-cards N       Limit total cards to process
    --resume-from ID    Resume from specific card ID
    --force             Force restart if job is already running
    
  stop                  Stop the running job
  status                Show current job status and progress
  reset                 Reset job state (use with caution)

Examples:
  npx tsx scripts/comc-job-manager.ts start
  npx tsx scripts/comc-job-manager.ts start --batch-size 200 --max-cards 5000
  npx tsx scripts/comc-job-manager.ts start --resume-from 12500 --force
  npx tsx scripts/comc-job-manager.ts status
  npx tsx scripts/comc-job-manager.ts stop
        `);
        break;
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { COMCJobManager };