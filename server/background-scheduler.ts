import { CronJob } from 'cron';
import { bulkUpdateMissingImages } from './bulk-image-updater';
// Simple logger for background scheduler
const logger = {
  info: (message: string, ...args: any[]) => console.log(`[SCHEDULER] ${message}`, ...args),
  error: (message: string, ...args: any[]) => console.error(`[SCHEDULER ERROR] ${message}`, ...args),
  warn: (message: string, ...args: any[]) => console.warn(`[SCHEDULER WARN] ${message}`, ...args),
};

interface SchedulerConfig {
  enabled: boolean;
  dailyImageUpdates: {
    enabled: boolean;
    schedule: string; // cron format
    batchSize: number;
    maxPerDay: number;
  };
  weeklyMaintenance: {
    enabled: boolean;
    schedule: string; // cron format
    batchSize: number;
  };
}

class BackgroundScheduler {
  private config: SchedulerConfig;
  private jobs: Map<string, CronJob> = new Map();
  private dailyProcessedCount = 0;
  private lastResetDate = new Date().toDateString();

  constructor(config: SchedulerConfig) {
    this.config = config;
    this.setupJobs();
  }

  private setupJobs() {
    if (!this.config.enabled) {
      logger.info('Background scheduler disabled');
      return;
    }

    // Daily image updates (until all images are processed)
    if (this.config.dailyImageUpdates.enabled) {
      const dailyJob = new CronJob(
        this.config.dailyImageUpdates.schedule,
        async () => {
          await this.runDailyImageUpdate();
        },
        null,
        false,
        'America/New_York'
      );
      
      this.jobs.set('daily-images', dailyJob);
      dailyJob.start();
      logger.info(`Daily image updates scheduled: ${this.config.dailyImageUpdates.schedule}`);
    }

    // Weekly maintenance (after daily is complete)
    if (this.config.weeklyMaintenance.enabled) {
      const weeklyJob = new CronJob(
        this.config.weeklyMaintenance.schedule,
        async () => {
          await this.runWeeklyMaintenance();
        },
        null,
        false,
        'America/New_York'
      );
      
      this.jobs.set('weekly-maintenance', weeklyJob);
      weeklyJob.start();
      logger.info(`Weekly maintenance scheduled: ${this.config.weeklyMaintenance.schedule}`);
    }
  }

  private async runDailyImageUpdate() {
    try {
      // Reset daily counter if it's a new day
      const currentDate = new Date().toDateString();
      if (currentDate !== this.lastResetDate) {
        this.dailyProcessedCount = 0;
        this.lastResetDate = currentDate;
      }

      // Check if we've hit the daily limit
      if (this.dailyProcessedCount >= this.config.dailyImageUpdates.maxPerDay) {
        logger.info(`Daily image update limit reached (${this.config.dailyImageUpdates.maxPerDay})`);
        return;
      }

      const remainingLimit = this.config.dailyImageUpdates.maxPerDay - this.dailyProcessedCount;
      const batchSize = Math.min(this.config.dailyImageUpdates.batchSize, remainingLimit);

      logger.info(`Starting daily image update batch: ${batchSize} cards`);
      
      const result = await bulkUpdateMissingImages({
        limit: batchSize,
        rateLimitMs: 3000, // 3 seconds between requests for reliability
        onProgress: (progress) => {
          if (progress.current % 10 === 0) {
            logger.info(`Processing progress: ${progress.current}/${progress.total} (${progress.status})`);
          }
        }
      });

      this.dailyProcessedCount += result.successCount;
      
      logger.info(`Daily image update completed: ${result.successCount}/${result.totalProcessed} successful`);
      
      // If no cards were processed, consider switching to weekly mode
      if (result.totalProcessed === 0) {
        logger.info('No cards needing images found - consider switching to weekly maintenance mode');
      }

    } catch (error) {
      logger.error('Daily image update failed:', error);
    }
  }

  private async runWeeklyMaintenance() {
    try {
      logger.info('Starting weekly maintenance image update');
      
      const result = await bulkUpdateMissingImages({
        limit: this.config.weeklyMaintenance.batchSize,
        rateLimitMs: 3000, // 3 seconds between requests for reliability
        onProgress: (progress) => {
          if (progress.current % 10 === 0) {
            logger.info(`Weekly maintenance progress: ${progress.current}/${progress.total} (${progress.status})`);
          }
        }
      });

      logger.info(`Weekly maintenance completed: ${result.successCount}/${result.totalProcessed} successful`);
      
    } catch (error) {
      logger.error('Weekly maintenance failed:', error);
    }
  }

  public updateConfig(newConfig: Partial<SchedulerConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.stopAllJobs();
    this.setupJobs();
  }

  public stopAllJobs() {
    for (const [name, job] of this.jobs) {
      job.stop();
      logger.info(`Stopped job: ${name}`);
    }
    this.jobs.clear();
  }

  public getStatus() {
    return {
      enabled: this.config.enabled,
      activeJobs: Array.from(this.jobs.keys()),
      dailyProcessedCount: this.dailyProcessedCount,
      lastResetDate: this.lastResetDate,
      config: this.config
    };
  }
}

// Default configuration
const defaultConfig: SchedulerConfig = {
  enabled: true, // Enable scheduler in all environments for now
  dailyImageUpdates: {
    enabled: true,
    schedule: '0 2 * * *', // 2 AM daily
    batchSize: 1000,
    maxPerDay: 5000
  },
  weeklyMaintenance: {
    enabled: true,
    schedule: '0 3 * * 0', // 3 AM on Sundays
    batchSize: 500
  }
};

export const backgroundScheduler = new BackgroundScheduler(defaultConfig);
export { BackgroundScheduler, SchedulerConfig };