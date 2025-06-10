import { Pool } from '@neondatabase/serverless';
import ws from 'ws';

// Simple restart mechanism for bulk import processing
async function restartBulkProcessing() {
  const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL,
    webSocketConstructor: ws
  });
  
  try {
    // Check current state
    const result = await pool.query('SELECT COUNT(*) as count FROM cards');
    const currentCount = parseInt(result.rows[0].count);
    
    console.log(`Current cards in database: ${currentCount}`);
    
    if (currentCount >= 60000) {
      console.log('Import appears complete');
      return;
    }
    
    // Check for any upload sessions that may have stalled
    const uploadResult = await pool.query(`
      SELECT * FROM upload_sessions 
      WHERE status = 'processing' 
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    
    if (uploadResult.rows.length > 0) {
      const session = uploadResult.rows[0];
      console.log(`Found stalled upload session: ${session.session_id}`);
      console.log(`Progress: ${session.processed_rows}/${session.total_rows}`);
      
      // Mark as failed so user can restart
      await pool.query(`
        UPDATE upload_sessions 
        SET status = 'failed', 
            error_message = 'Processing stalled - restart required'
        WHERE session_id = $1
      `, [session.session_id]);
      
      console.log('Marked stalled session as failed. User should re-upload CSV.');
    } else {
      console.log('No active upload sessions found');
    }
    
  } catch (error) {
    console.error('Error checking bulk processing status:', error);
  } finally {
    await pool.end();
  }
}

restartBulkProcessing();