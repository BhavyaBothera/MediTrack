import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { assertSafeExecutionEnvironment, extractProjectRef } from '../utils/environmentGuard';
import { supabaseAdmin } from '../config/supabase';
import {
  deriveAndValidateDatabaseTarget,
  assertNonDestructiveSql,
  removeSqlComments,
  sanitizeErrorMessage,
  ensureSchemaMigrationsTable,
  getAppliedMigrationVersions,
  runMigrations,
  AppliedMigration
} from './migrate';

assertSafeExecutionEnvironment('Migration Safety & Target Validation Test Suite');

async function runMigrationSafetyTests() {
  console.log('========================================================================');
  console.log(' MEDITRACK – DATABASE MIGRATION SAFETY & TARGET VALIDATION TEST SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(title: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`[PASS] ${title}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title}${details ? ` -> ${details}` : ''}`);
      failed++;
    }
  }

  const approvedRef = process.env.APPROVED_TEST_PROJECT_REF || extractProjectRef(process.env.SUPABASE_URL || '') || 'zadepztpubocvhjivlvj';

  // =========================================================================
  // SUITE 1: Connection Target Derivation & Anti-Mismatch Guards
  // =========================================================================
  console.log('\n--- SUITE 1: Connection Target Derivation & Anti-Mismatch Guards ---');

  // Test 1: Wrong database hostname in discrete options rejected with [DATABASE TARGET MISMATCH]
  try {
    deriveAndValidateDatabaseTarget({
      approvedProjectRef: approvedRef,
      host: 'db.unauthorized-other-ref.supabase.co',
      password: 'test-password-123'
    });
    assert('Test 1: Reject mismatched direct Supabase host', false, 'Expected mismatch error but call succeeded');
  } catch (err: any) {
    assert(
      'Test 1: Reject mismatched direct Supabase host with [DATABASE TARGET MISMATCH]',
      err.message.includes('[DATABASE TARGET MISMATCH]') && err.message.includes('unauthorized-other-ref'),
      `Received error: ${err.message}`
    );
  }

  // Test 2: Wrong database hostname in DATABASE_URL connection string rejected with [DATABASE TARGET MISMATCH]
  try {
    deriveAndValidateDatabaseTarget({
      approvedProjectRef: approvedRef,
      connectionString: 'postgresql://postgres:secret123@db.mismatched-target.supabase.co:5432/postgres'
    });
    assert('Test 2: Reject mismatched DATABASE_URL connection string', false, 'Expected mismatch error but call succeeded');
  } catch (err: any) {
    assert(
      'Test 2: Reject mismatched DATABASE_URL connection string with [DATABASE TARGET MISMATCH]',
      err.message.includes('[DATABASE TARGET MISMATCH]') && err.message.includes('mismatched-target'),
      `Received error: ${err.message}`
    );
  }

  // Test 3: Mismatched project user on Supabase pooler rejected with [DATABASE TARGET MISMATCH]
  try {
    deriveAndValidateDatabaseTarget({
      approvedProjectRef: approvedRef,
      connectionString: 'postgresql://postgres.rogueproject:secret123@aws-0-eu-west-1.pooler.supabase.com:6543/postgres'
    });
    assert('Test 3: Reject mismatched pooler user project reference', false, 'Expected mismatch error but call succeeded');
  } catch (err: any) {
    assert(
      'Test 3: Reject mismatched pooler user project reference with [DATABASE TARGET MISMATCH]',
      err.message.includes('[DATABASE TARGET MISMATCH]') && err.message.includes('rogueproject'),
      `Received error: ${err.message}`
    );
  }

  // Test 4: Unapproved external hostname rejected
  try {
    deriveAndValidateDatabaseTarget({
      approvedProjectRef: approvedRef,
      host: 'external-arbitrary-database.net',
      password: 'test-password-123'
    });
    assert('Test 4: Reject unapproved external hostname', false, 'Expected mismatch error but call succeeded');
  } catch (err: any) {
    assert(
      'Test 4: Reject unapproved external hostname with [DATABASE TARGET MISMATCH]',
      err.message.includes('[DATABASE TARGET MISMATCH]'),
      `Received error: ${err.message}`
    );
  }

  // Test 5: Production target hostname strictly rejected regardless of environment
  const originalProdRef = process.env.PRODUCTION_PROJECT_REF;
  try {
    process.env.PRODUCTION_PROJECT_REF = 'meditrack-prod-live';
    deriveAndValidateDatabaseTarget({
      approvedProjectRef: approvedRef,
      host: 'db.meditrack-prod-live.supabase.co',
      password: 'test-password-123'
    });
    assert('Test 5: Block production target host', false, 'Expected production rejection but call succeeded');
  } catch (err: any) {
    assert(
      'Test 5: Block production target host with [CRITICAL DATABASE GUARD REJECTION]',
      err.message.includes('[CRITICAL DATABASE GUARD REJECTION]'),
      `Received error: ${err.message}`
    );
  } finally {
    process.env.PRODUCTION_PROJECT_REF = originalProdRef;
  }

  // Test 6: Missing database credentials fails closed with [CONFIGURATION REQUIRED]
  try {
    deriveAndValidateDatabaseTarget({
      approvedProjectRef: approvedRef,
      host: `db.${approvedRef}.supabase.co`,
      password: '' // empty password
    });
    assert('Test 6: Missing credentials fails closed', false, 'Expected configuration required error but call succeeded');
  } catch (err: any) {
    assert(
      'Test 6: Missing credentials fails closed with [CONFIGURATION REQUIRED]',
      err.message.includes('[CONFIGURATION REQUIRED]'),
      `Received error: ${err.message}`
    );
  }

  // Test 7: Correct matching approved configuration derives deterministic target and sanitizes secrets
  try {
    const config = deriveAndValidateDatabaseTarget({
      approvedProjectRef: approvedRef,
      password: 'SuperSecretDatabasePassword123'
    });
    assert(
      'Test 7a: Deterministically derives approved project host',
      config.host === `db.${approvedRef}.supabase.co` && config.projectRef === approvedRef,
      `Derived host: ${config.host}`
    );
    assert(
      'Test 7b: Sanitized target does not leak password',
      !config.sanitizedTarget.includes('SuperSecretDatabasePassword123') &&
        config.sanitizedTarget === `postgres@db.${approvedRef}.supabase.co:5432/postgres`,
      `Sanitized target: ${config.sanitizedTarget}`
    );
  } catch (err: any) {
    assert('Test 7: Correct approved configuration derivation', false, err.message);
  }

  // Test 8: Error message sanitizer redacts postgres:// password URLs
  const rawLeak = 'Error connecting to postgresql://postgres:SuperSecret%23456@db.zadepztpubocvhjivlvj.supabase.co:5432/postgres';
  const sanitized = sanitizeErrorMessage(rawLeak);
  assert(
    'Test 8: sanitizeErrorMessage masks connection credentials',
    !sanitized.includes('SuperSecret%23456') && sanitized.includes('***REDACTED***'),
    `Sanitized: ${sanitized}`
  );

  // =========================================================================
  // SUITE 2: Destructive SQL Safeguards
  // =========================================================================
  console.log('\n--- SUITE 2: Destructive SQL Safeguards ---');

  // Test 9: Block DROP TABLE
  try {
    assertNonDestructiveSql('DROP TABLE public.medicines CASCADE;', 'test_drop_table.sql');
    assert('Test 9: Block DROP TABLE', false, 'Expected destructive error');
  } catch (err: any) {
    assert(
      'Test 9: Block DROP TABLE with [DESTRUCTIVE MIGRATION BLOCKED]',
      err.message.includes('[DESTRUCTIVE MIGRATION BLOCKED]') && err.message.includes('DROP TABLE'),
      `Received error: ${err.message}`
    );
  }

  // Test 10: Block TRUNCATE
  try {
    assertNonDestructiveSql('TRUNCATE TABLE public.dose_logs;', 'test_truncate.sql');
    assert('Test 10: Block TRUNCATE', false, 'Expected destructive error');
  } catch (err: any) {
    assert(
      'Test 10: Block TRUNCATE with [DESTRUCTIVE MIGRATION BLOCKED]',
      err.message.includes('[DESTRUCTIVE MIGRATION BLOCKED]') && err.message.includes('TRUNCATE'),
      `Received error: ${err.message}`
    );
  }

  // Test 11: Block DROP DATABASE
  try {
    assertNonDestructiveSql('DROP DATABASE postgres;', 'test_drop_db.sql');
    assert('Test 11: Block DROP DATABASE', false, 'Expected destructive error');
  } catch (err: any) {
    assert(
      'Test 11: Block DROP DATABASE with [DESTRUCTIVE MIGRATION BLOCKED]',
      err.message.includes('[DESTRUCTIVE MIGRATION BLOCKED]') && err.message.includes('DROP DATABASE'),
      `Received error: ${err.message}`
    );
  }

  // Test 12: Block DROP SCHEMA
  try {
    assertNonDestructiveSql('DROP SCHEMA public CASCADE;', 'test_drop_schema.sql');
    assert('Test 12: Block DROP SCHEMA', false, 'Expected destructive error');
  } catch (err: any) {
    assert(
      'Test 12: Block DROP SCHEMA with [DESTRUCTIVE MIGRATION BLOCKED]',
      err.message.includes('[DESTRUCTIVE MIGRATION BLOCKED]') && err.message.includes('DROP SCHEMA'),
      `Received error: ${err.message}`
    );
  }

  // Test 13: Comments mentioning destructive commands are not falsely blocked
  try {
    const commentedSql = `
      -- Note: Never run DROP TABLE in production
      /* Also avoid TRUNCATE on critical tables */
      CREATE TABLE IF NOT EXISTS public.demo_table (id UUID PRIMARY KEY);
    `;
    assertNonDestructiveSql(commentedSql, 'commented_migration.sql');
    assert('Test 13: Comments mentioning DROP/TRUNCATE are stripped and not falsely rejected', true);
  } catch (err: any) {
    assert('Test 13: Comments not falsely rejected', false, err.message);
  }

  // Test 14: Actual project migration files 001 and 002 are confirmed non-destructive
  const migrationsDir = path.resolve(__dirname, '../../migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  assert(
    'Test 14a: Migrations directory contains 001 and 002',
    files.includes('001_initial_schema.sql') && files.includes('002_outbox_idempotency.sql'),
    `Found files: ${files.join(', ')}`
  );

  for (const file of files) {
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    try {
      assertNonDestructiveSql(content, file);
      assert(`Test 14b: Migration ${file} passes non-destructive SQL verification`, true);
    } catch (err: any) {
      assert(`Test 14b: Migration ${file} passes non-destructive SQL verification`, false, err.message);
    }
  }

  // =========================================================================
  // SUITE 3: Deterministic Version-Tracked Migration Sequencing
  // =========================================================================
  console.log('\n--- SUITE 3: Deterministic Version-Tracked Migration Sequencing ---');

  // We test the migration sequencing engine using an in-memory mock client that mirrors pg.Client
  class MockPgClient {
    public queries: { sql: string; params?: any[] }[] = [];
    public inTransaction: boolean = false;
    public schemaMigrations: Map<string, { version: string; name: string; checksum: string; applied_at: Date }> =
      new Map();

    async query(sql: string, params?: any[]): Promise<any> {
      this.queries.push({ sql, params });

      const trimmed = sql.trim().toUpperCase();

      if (trimmed.startsWith('BEGIN')) {
        this.inTransaction = true;
        return { rowCount: 0, rows: [] };
      }
      if (trimmed.startsWith('COMMIT')) {
        this.inTransaction = false;
        return { rowCount: 0, rows: [] };
      }
      if (trimmed.startsWith('ROLLBACK')) {
        this.inTransaction = false;
        return { rowCount: 0, rows: [] };
      }

      if (trimmed.includes('CREATE TABLE IF NOT EXISTS PUBLIC.SCHEMA_MIGRATIONS')) {
        return { rowCount: 0, rows: [] };
      }

      if (trimmed.includes('SELECT VERSION, NAME, CHECKSUM, APPLIED_AT FROM PUBLIC.SCHEMA_MIGRATIONS')) {
        const rows = Array.from(this.schemaMigrations.values()).map(m => ({
          version: m.version,
          name: m.name,
          checksum: m.checksum,
          applied_at: m.applied_at.toISOString()
        }));
        return { rowCount: rows.length, rows };
      }

      if (trimmed.startsWith('INSERT INTO PUBLIC.SCHEMA_MIGRATIONS')) {
        const [version, name, checksum] = params || [];
        this.schemaMigrations.set(String(version), {
          version: String(version),
          name: String(name),
          checksum: String(checksum),
          applied_at: new Date()
        });
        return { rowCount: 1, rows: [] };
      }

      // Execute migration DDL
      return { rowCount: 0, rows: [] };
    }
  }

  const mockClient = new MockPgClient();

  // Test 15: Initial run executes 001 and 002 deterministically and records them
  const initialSummary = await runMigrations(mockClient, migrationsDir);
  assert(
    'Test 15a: Initial run applies both 001 and 002 migrations',
    initialSummary.applied === 2 &&
      initialSummary.appliedVersions.includes('001') &&
      initialSummary.appliedVersions.includes('002'),
    `Applied: ${initialSummary.appliedVersions.join(', ')}, total: ${initialSummary.total}`
  );

  assert(
    'Test 15b: public.schema_migrations recorded both versions with checksums',
    mockClient.schemaMigrations.has('001') && mockClient.schemaMigrations.has('002'),
    `Recorded versions: ${Array.from(mockClient.schemaMigrations.keys()).join(', ')}`
  );

  // Verify SHA-256 checksums are valid 64-char hex strings
  const checksum001 = mockClient.schemaMigrations.get('001')?.checksum || '';
  const checksum002 = mockClient.schemaMigrations.get('002')?.checksum || '';
  assert(
    'Test 15c: SHA-256 checksums recorded for migrations',
    checksum001.length === 64 && checksum002.length === 64,
    `001: ${checksum001.substring(0, 16)}..., 002: ${checksum002.substring(0, 16)}...`
  );

  // Test 16: Safe repeated migration execution (idempotency) skips already applied versions
  const repeatedSummary = await runMigrations(mockClient, migrationsDir);
  assert(
    'Test 16: Repeated migration run is strictly idempotent (0 applied, 2 skipped)',
    repeatedSummary.applied === 0 &&
      repeatedSummary.skipped === 2 &&
      repeatedSummary.skippedVersions.includes('001') &&
      repeatedSummary.skippedVersions.includes('002'),
    `Applied: ${repeatedSummary.applied}, Skipped: ${repeatedSummary.skipped}`
  );

  // Test 17: Transaction rollback on failure
  class FailingMockPgClient extends MockPgClient {
    async query(sql: string, params?: any[]): Promise<any> {
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith('ALTER TABLE') || trimmed.includes('CREATE TABLE')) {
        if (!trimmed.includes('SCHEMA_MIGRATIONS')) {
          throw new Error('Simulated DDL syntax failure');
        }
      }
      return super.query(sql, params);
    }
  }

  const failingClient = new FailingMockPgClient();
  try {
    await runMigrations(failingClient, migrationsDir);
    assert('Test 17: Rollback on DDL failure', false, 'Expected migration failure but call succeeded');
  } catch (err: any) {
    const rollbackExecuted = failingClient.queries.some(q => q.sql.trim().toUpperCase() === 'ROLLBACK');
    assert(
      'Test 17: Migration failure safely executes ROLLBACK and aborts',
      rollbackExecuted && err.message.includes('Simulated DDL syntax failure'),
      `Rollback executed: ${rollbackExecuted}, Error: ${err.message}`
    );
  }

  // =========================================================================
  // SUITE 4: Live Approved Supabase Test Database Verification
  // =========================================================================
  console.log('\n--- SUITE 4: Live Approved Supabase Test Database Verification ---');

  // Verify that the live target is the approved test database
  const liveTargetUrl = process.env.SUPABASE_URL || '';
  const liveProjectRef = extractProjectRef(liveTargetUrl);
  assert(
    'Test 18: Live database matches explicitly approved test project',
    liveProjectRef === approvedRef && liveProjectRef === 'zadepztpubocvhjivlvj',
    `Live project ref: ${liveProjectRef}, Approved ref: ${approvedRef}`
  );

  // Test 19: Confirm notification_delivery_logs.idempotency_key column exists
  // Query 1 row from notification_delivery_logs selecting idempotency_key
  const { data: columnCheck, error: colErr } = await supabaseAdmin
    .from('notification_delivery_logs')
    .select('id, idempotency_key')
    .limit(1);

  assert(
    'Test 19: Column notification_delivery_logs.idempotency_key exists and is queryable',
    !colErr,
    colErr ? colErr.message : 'Column successfully resolved by Supabase client'
  );

  // Test 20: Verify PostgreSQL database constraint rejects duplicate idempotency_key with code 23505
  // We provision a test notification record, then attempt two insertions with the identical idempotency_key
  const testKey = `test_migration_safety_unique_${Date.now()}_${crypto.randomUUID()}`;
  let testNotificationId = '';
  let firstLogId = '';
  let createdUserId = '';

  try {
    // 20a: Fetch or create a test notification parent row
    let recipientId = '';
    const { data: sampleProfile } = await supabaseAdmin.from('profiles').select('id').limit(1).maybeSingle();
    if (sampleProfile?.id) {
      recipientId = sampleProfile.id;
    } else {
      const testEmail = `mig_test_${Date.now()}@meditrack.test`;
      const { data: userAuth, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: testEmail,
        password: 'Password@123',
        email_confirm: true,
        user_metadata: { full_name: 'Migration Safety User', role: 'patient' }
      });
      if (authErr || !userAuth?.user?.id) {
        throw new Error(`Failed to create test user: ${authErr?.message}`);
      }
      createdUserId = userAuth.user.id;
      recipientId = createdUserId;
      await supabaseAdmin.from('profiles').insert({
        id: createdUserId,
        email: testEmail,
        full_name: 'Migration Safety User',
        role: 'patient',
        timezone: 'Asia/Kolkata'
      });
    }

    const { data: notifRow, error: notifErr } = await supabaseAdmin
      .from('notifications')
      .insert({
        recipient_id: recipientId,
        patient_id: recipientId,
        type: 'initial_reminder',
        title: 'Migration Safety Test',
        message: 'Constraint verification',
        severity: 'info',
        status: 'queued',
        scheduled_for: new Date().toISOString()
      })
      .select('id')
      .single();

    if (notifErr || !notifRow) {
      throw new Error(`Failed to create test notification: ${notifErr?.message}`);
    }
    testNotificationId = notifRow.id;

    // 20b: First insertion with testKey - MUST SUCCEED
    const { data: firstLog, error: firstErr } = await supabaseAdmin
      .from('notification_delivery_logs')
      .insert({
        notification_id: testNotificationId,
        channel: 'email',
        status: 'pending',
        idempotency_key: testKey,
        provider_response: { test: true }
      })
      .select('id')
      .single();

    assert(
      'Test 20a: First insert with unique idempotency_key succeeds',
      !firstErr && !!firstLog?.id,
      firstErr ? firstErr.message : `Log ID: ${firstLog?.id}`
    );
    if (firstLog) firstLogId = firstLog.id;

    // 20c: Second insertion with IDENTICAL testKey - MUST BE REJECTED by PostgreSQL unique constraint
    const { data: secondLog, error: secondErr } = await supabaseAdmin
      .from('notification_delivery_logs')
      .insert({
        notification_id: testNotificationId,
        channel: 'email',
        status: 'pending',
        idempotency_key: testKey,
        provider_response: { test: true, duplicate: true }
      })
      .select('id')
      .single();

    const isUniqueViolation =
      secondErr &&
      (secondErr.code === '23505' ||
        secondErr.message.includes('duplicate key') ||
        secondErr.message.includes('violates unique constraint') ||
        secondErr.details?.includes('already exists'));

    assert(
      'Test 20b: PostgreSQL strictly rejects duplicate idempotency_key with code 23505',
      Boolean(isUniqueViolation),
      secondErr
        ? `Code: ${secondErr.code}, Message: ${secondErr.message}`
        : 'Second insert unexpectedly succeeded without error!'
    );
  } finally {
    // Clean up test rows
    if (firstLogId) {
      await supabaseAdmin.from('notification_delivery_logs').delete().eq('id', firstLogId);
    }
    if (testNotificationId) {
      await supabaseAdmin.from('notifications').delete().eq('id', testNotificationId);
    }
    if (createdUserId) {
      await supabaseAdmin.from('profiles').delete().eq('id', createdUserId);
      await supabaseAdmin.auth.admin.deleteUser(createdUserId);
    }
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n========================================================================');
  console.log(` MIGRATION SAFETY TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');

  if (failed > 0) {
    console.error(`\n❌ Migration safety verification failed with ${failed} failure(s).\n`);
    process.exit(1);
  } else {
    console.log(`\n✅ All ${passed} migration safety checks passed successfully.\n`);
    process.exit(0);
  }
}

runMigrationSafetyTests().catch(err => {
  console.error('Unhandled failure in migration safety test suite:', err);
  process.exit(1);
});

