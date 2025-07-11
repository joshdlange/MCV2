// Simple database connection test
import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});

async function testConnection() {
  try {
    console.log('Testing database connection...');
    const client = await pool.connect();
    console.log('Connection successful');
    
    const result = await client.query('SELECT COUNT(*) as count FROM cards LIMIT 1');
    console.log('Card count query result:', result.rows[0]);
    
    client.release();
    console.log('Connection test completed successfully');
  } catch (error) {
    console.error('Database connection failed:', error);
  } finally {
    await pool.end();
  }
}

testConnection();