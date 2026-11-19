import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { assertSafeExecutionEnvironment } from '../utils/environmentGuard';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DB_PASSWORD = process.env.DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD || '';

async function run() {
  assertSafeExecutionEnvironment('Database Migration');
  console.log('--- Checking Supabase Database Status ---');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Check if tables already exist via REST
  const { data: tables, error: testError } = await supabase
    .from('medicines')
    .select('id')
    .limit(1);

  if (!testError) {
    console.log('✓ Database tables are already created and accessible!');
    return;
  }

  console.log('Tables not yet found or returned error:', testError.message);

  if (DB_PASSWORD) {
    console.log('Attempting direct migration via Postgres connection...');
    const client = new Client({
      connectionString: `postgresql://postgres:${encodeURIComponent(DB_PASSWORD)}@db.zadepztpubocvhjivlvj.supabase.co:5432/postgres`,
      ssl: { rejectUnauthorized: false }
    });

    try {
      await client.connect();
      console.log('Connected to PostgreSQL successfully!');
      const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/001_initial_schema.sql'), 'utf-8');
      await client.query(sql);
      console.log('✓ Migration executed successfully!');
      await client.end();
      return;
    } catch (err: any) {
      console.error('Failed to run migration directly:', err.message);
    }
  }

  console.log('\n======================================================');
  console.log('ACTION REQUIRED: Database Migration');
  console.log('======================================================');
  console.log('To initialize the 16 tables in your Supabase project:');
  console.log('1. Go to your Supabase Dashboard: https://supabase.com/dashboard/project/zadepztpubocvhjivlvj/sql');
  console.log('2. Click on "SQL Editor" -> "New query"');
  console.log('3. Copy and paste the contents of backend/migrations/001_initial_schema.sql');
  console.log('4. Click "Run"');
  console.log('======================================================\n');
}

run().catch(console.error);

