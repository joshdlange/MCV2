import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from "../shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Create optimized PostgreSQL connection pool for Replit
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 15000,
  acquireTimeoutMillis: 20000,
  allowExitOnIdle: false,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export const db = drizzle(pool, { schema });

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

pool.on('connect', () => {
  console.log('Database connection established');
});

pool.on('remove', () => {
  console.log('Database connection removed from pool');
});

export async function warmPool() {
  const startTime = Date.now();
  try {
    const clients = await Promise.all(
      Array.from({ length: 3 }, () => pool.connect())
    );
    await Promise.all(clients.map(c => c.query('SELECT 1')));
    clients.forEach(c => c.release());
    console.log(`Database pool warmed (3 connections) in ${Date.now() - startTime}ms`);
  } catch (err) {
    console.error('Pool warm-up failed (non-fatal):', err);
  }
}

// Database connection retry utility
export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      console.log(`Database operation failed (attempt ${attempt}/${maxRetries}):`, error);
      
      // Don't wait after the last attempt
      if (attempt < maxRetries) {
        console.log(`Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2; // Exponential backoff
      }
    }
  }
  
  throw new Error(`Database operation failed after ${maxRetries} attempts: ${lastError.message}`);
}