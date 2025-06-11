/**
 * Background job system for heavy operations
 * Prevents blocking the main thread during large batch operations
 */

import { optimizedStorage } from './optimized-storage';
import { findAndUpdateCardImage } from './ebay-image-finder';

export interface JobStatus {
  id: string;
  type: 'image_processing' | 'pricing_update' | 'data_import';
  status: 'running' | 'completed' | 'failed' | 'paused';
  progress: number;
  total: number;
  startTime: Date;
  endTime?: Date;
  error?: string;
  results?: any;
}

class BackgroundJobManager {
  private jobs = new Map<string, JobStatus>();
  private activeJobs = new Set<string>();
  private maxConcurrentJobs = 2;

  generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getJob(jobId: string): JobStatus | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): JobStatus[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }

  canStartNewJob(): boolean {
    return this.activeJobs.size < this.maxConcurrentJobs;
  }

  /**
   * Process images in batches with controlled concurrency
   */
  async startImageProcessingJob(maxCards: number = 100): Promise<string> {
    if (!this.canStartNewJob()) {
      throw new Error('Maximum concurrent jobs reached. Please wait for current jobs to complete.');
    }

    const jobId = this.generateJobId();
    const job: JobStatus = {
      id: jobId,
      type: 'image_processing',
      status: 'running',
      progress: 0,
      total: maxCards,
      startTime: new Date()
    };

    this.jobs.set(jobId, job);
    this.activeJobs.add(jobId);

    // Run in background
    this.processImagesBackground(jobId, maxCards).catch(error => {
      const currentJob = this.jobs.get(jobId);
      if (currentJob) {
        currentJob.status = 'failed';
        currentJob.error = error.message;
        currentJob.endTime = new Date();
      }
      this.activeJobs.delete(jobId);
    });

    return jobId;
  }

  private async processImagesBackground(jobId: string, maxCards: number): Promise<void> {
    const job = this.jobs.get(jobId)!;
    const batchSize = 10;
    let processedCount = 0;
    const results: any[] = [];

    try {
      // Get cards without images in batches
      let offset = 0;
      let hasMoreCards = true;

      while (hasMoreCards && processedCount < maxCards && job.status === 'running') {
        const cardsWithoutImages = await optimizedStorage.getCardsWithoutImagesBatch(batchSize, offset);
        
        if (cardsWithoutImages.length === 0) {
          hasMoreCards = false;
          break;
        }

        // Process each card in the batch
        for (const card of cardsWithoutImages) {
          if (processedCount >= maxCards || job.status !== 'running') {
            break;
          }

          try {
            const result = await findAndUpdateCardImage(
              card.id,
              card.set.name || '',
              card.name,
              card.cardNumber,
              card.description || undefined
            );

            results.push(result);
            processedCount++;

            // Update job progress
            job.progress = processedCount;
            
            // If we hit rate limit, pause the job
            if (result.error?.includes('rate limit') || result.error?.includes('EBAY_API_ERROR')) {
              job.status = 'paused';
              job.error = 'Rate limit reached. Job paused.';
              break;
            }

            // Rate limiting between requests
            await new Promise(resolve => setTimeout(resolve, 1000));

          } catch (error: any) {
            console.error(`Background job ${jobId} - Error processing card ${card.id}:`, error);
            
            if (error.message.includes('EBAY_API_ERROR') || error.message === 'RATE_LIMIT_EXCEEDED') {
              job.status = 'paused';
              job.error = 'Rate limit reached. Job paused.';
              break;
            }
          }
        }

        offset += batchSize;
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Complete the job
      if (job.status === 'running') {
        job.status = 'completed';
      }
      job.endTime = new Date();
      job.results = {
        totalProcessed: processedCount,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        details: results
      };

    } catch (error: any) {
      job.status = 'failed';
      job.error = error.message;
      job.endTime = new Date();
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  /**
   * Resume a paused image processing job
   */
  async resumeImageProcessingJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.type !== 'image_processing' || job.status !== 'paused') {
      throw new Error('Job not found or cannot be resumed');
    }

    if (!this.canStartNewJob()) {
      throw new Error('Maximum concurrent jobs reached. Please wait for current jobs to complete.');
    }

    job.status = 'running';
    job.error = undefined;
    this.activeJobs.add(jobId);

    const remainingCards = job.total - job.progress;
    this.processImagesBackground(jobId, remainingCards).catch(error => {
      job.status = 'failed';
      job.error = error.message;
      job.endTime = new Date();
      this.activeJobs.delete(jobId);
    });
  }

  /**
   * Cancel a running job
   */
  cancelJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job && (job.status === 'running' || job.status === 'paused')) {
      job.status = 'failed';
      job.error = 'Job cancelled by user';
      job.endTime = new Date();
      this.activeJobs.delete(jobId);
    }
  }

  /**
   * Clean up old completed jobs (keep last 10)
   */
  cleanupOldJobs(): void {
    const allJobs = this.getAllJobs();
    const completedJobs = allJobs.filter(job => job.status === 'completed' || job.status === 'failed');
    
    if (completedJobs.length > 10) {
      const jobsToRemove = completedJobs.slice(10);
      jobsToRemove.forEach(job => this.jobs.delete(job.id));
    }
  }
}

export const backgroundJobManager = new BackgroundJobManager();