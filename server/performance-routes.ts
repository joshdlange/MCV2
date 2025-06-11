/**
 * Performance-optimized API routes for large datasets
 * Implements pagination, caching, and background job management
 */

import type { Express } from "express";
import { optimizedStorage, type PaginatedResult, type LightweightCard } from './optimized-storage';
import { backgroundJobManager } from './background-jobs';

// In-memory cache for frequently accessed data
const cache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | null {
  const cached = cache.get(key);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }
  cache.delete(key);
  return null;
}

function setCache<T>(key: string, data: T, ttl: number = CACHE_TTL): void {
  cache.set(key, { data, expiry: Date.now() + ttl });
}

export function registerPerformanceRoutes(app: Express) {
  
  // Paginated cards endpoint with caching
  app.get("/api/v2/cards", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100); // Max 100 per page
      const setId = req.query.setId ? parseInt(req.query.setId as string) : undefined;
      const search = req.query.search as string;
      const hasImage = req.query.hasImage === 'true' ? true : req.query.hasImage === 'false' ? false : undefined;

      const cacheKey = `cards:${page}:${pageSize}:${setId || 'all'}:${search || 'none'}:${hasImage}`;
      
      // Check cache first
      let result = getCached<PaginatedResult<LightweightCard>>(cacheKey);
      
      if (!result) {
        result = await optimizedStorage.getCardsPaginated(page, pageSize, {
          setId,
          search,
          hasImage
        });
        
        // Cache for 2 minutes (shorter for search results)
        setCache(cacheKey, result, search ? 2 * 60 * 1000 : CACHE_TTL);
      }

      res.json(result);
    } catch (error) {
      console.error('Error in paginated cards endpoint:', error);
      res.status(500).json({ error: 'Failed to fetch cards' });
    }
  });

  // Optimized card sets endpoint
  app.get("/api/v2/card-sets", async (req, res) => {
    try {
      const cacheKey = 'card-sets-optimized';
      let cardSets = getCached<any[]>(cacheKey);
      
      if (!cardSets) {
        cardSets = await optimizedStorage.getCardSetsOptimized();
        setCache(cacheKey, cardSets, 10 * 60 * 1000); // Cache for 10 minutes
      }

      res.json(cardSets);
    } catch (error) {
      console.error('Error in card sets endpoint:', error);
      res.status(500).json({ error: 'Failed to fetch card sets' });
    }
  });

  // Paginated user collection endpoint
  app.get("/api/v2/collection", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
      const userId = req.user.id;

      const result = await optimizedStorage.getUserCollectionPaginated(userId, page, pageSize);
      res.json(result);
    } catch (error) {
      console.error('Error in paginated collection endpoint:', error);
      res.status(500).json({ error: 'Failed to fetch collection' });
    }
  });

  // Optimized stats endpoint
  app.get("/api/v2/stats", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const userId = req.user.id;
      const cacheKey = `stats:${userId}`;
      
      let stats = getCached<any>(cacheKey);
      
      if (!stats) {
        stats = await optimizedStorage.getCollectionStatsOptimized(userId);
        setCache(cacheKey, stats, 2 * 60 * 1000); // Cache for 2 minutes
      }

      res.json(stats);
    } catch (error) {
      console.error('Error in optimized stats endpoint:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // Fast search endpoint
  app.get("/api/v2/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      
      if (!query || query.length < 2) {
        return res.json([]);
      }

      const cacheKey = `search:${query}:${limit}`;
      let results = getCached<LightweightCard[]>(cacheKey);
      
      if (!results) {
        results = await optimizedStorage.searchCards(query, limit);
        setCache(cacheKey, results, 5 * 60 * 1000); // Cache search results for 5 minutes
      }

      res.json(results);
    } catch (error) {
      console.error('Error in search endpoint:', error);
      res.status(500).json({ error: 'Failed to search cards' });
    }
  });

  // Background job management endpoints
  app.post("/api/admin/jobs/image-processing", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.sendStatus(403);
    }

    try {
      const maxCards = Math.min(parseInt(req.body.maxCards) || 100, 500); // Max 500 cards per job
      const jobId = await backgroundJobManager.startImageProcessingJob(maxCards);
      
      res.json({ 
        success: true, 
        jobId,
        message: `Image processing job started for up to ${maxCards} cards`
      });
    } catch (error: any) {
      res.status(400).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  app.get("/api/admin/jobs", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.sendStatus(403);
    }

    try {
      const jobs = backgroundJobManager.getAllJobs();
      res.json(jobs);
    } catch (error) {
      console.error('Error fetching jobs:', error);
      res.status(500).json({ error: 'Failed to fetch jobs' });
    }
  });

  app.get("/api/admin/jobs/:jobId", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.sendStatus(403);
    }

    try {
      const job = backgroundJobManager.getJob(req.params.jobId);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
      res.json(job);
    } catch (error) {
      console.error('Error fetching job:', error);
      res.status(500).json({ error: 'Failed to fetch job' });
    }
  });

  app.post("/api/admin/jobs/:jobId/resume", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.sendStatus(403);
    }

    try {
      await backgroundJobManager.resumeImageProcessingJob(req.params.jobId);
      res.json({ success: true, message: 'Job resumed' });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post("/api/admin/jobs/:jobId/cancel", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.sendStatus(403);
    }

    try {
      backgroundJobManager.cancelJob(req.params.jobId);
      res.json({ success: true, message: 'Job cancelled' });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Cache management endpoints
  app.post("/api/admin/cache/clear", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.sendStatus(403);
    }

    try {
      cache.clear();
      res.json({ success: true, message: 'Cache cleared' });
    } catch (error) {
      console.error('Error clearing cache:', error);
      res.status(500).json({ error: 'Failed to clear cache' });
    }
  });

  app.get("/api/admin/cache/stats", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.sendStatus(403);
    }

    try {
      const now = Date.now();
      const cacheStats = {
        totalEntries: cache.size,
        activeEntries: Array.from(cache.values()).filter(item => item.expiry > now).length,
        expiredEntries: Array.from(cache.values()).filter(item => item.expiry <= now).length
      };
      
      res.json(cacheStats);
    } catch (error) {
      console.error('Error getting cache stats:', error);
      res.status(500).json({ error: 'Failed to get cache stats' });
    }
  });

  // Performance monitoring endpoint
  app.get("/api/admin/performance", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.sendStatus(403);
    }

    try {
      const memoryUsage = process.memoryUsage();
      const activeJobs = backgroundJobManager.getAllJobs().filter(job => job.status === 'running').length;
      
      res.json({
        memoryUsage: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB'
        },
        cacheSize: cache.size,
        activeJobs,
        uptime: Math.round(process.uptime()) + ' seconds'
      });
    } catch (error) {
      console.error('Error getting performance stats:', error);
      res.status(500).json({ error: 'Failed to get performance stats' });
    }
  });

  // Cleanup expired cache entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
      if (value.expiry <= now) {
        cache.delete(key);
      }
    }
    
    // Clean up old background jobs
    backgroundJobManager.cleanupOldJobs();
  }, 5 * 60 * 1000); // Every 5 minutes
}