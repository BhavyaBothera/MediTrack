import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Client } from 'pg';
import dotenv from 'dotenv';
import { assertSafeExecutionEnvironment, extractProjectRef } from '../utils/environmentGuard';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface MigrationTargetOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | object;
  approvedProjectRef?: string;
}

export interface ValidatedDatabaseConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  ssl: boolean | object;
  projectRef: string;
  sanitizedTarget: string;
}

export interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
  applied_at: string;
}

export interface MigrationSummary {
  total: number;
  applied: number;
  skipped: number;
  appliedVersions: string[];
  skippedVersions: string[];
}

/**
 * Sanitizes connection strings, passwords, and sensitive parameters from error messages.
 */
export function sanitizeErrorMessage(msg: string): string {
  if (!msg) return '';
  return msg
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi, '$1***REDACTED***$3')
    .replace(/password\s*=\s*['"]?[^'"\s]+['"]?/gi, 'password=***REDACTED***')
    .replace(/pwd\s*=\s*['"]?[^'"\s]+['"]?/gi, 'pwd=***REDACTED***');
}

/**
 * Strips SQL comments (both block /* ... *\/ and line -- ...) before parsing.
 */
export function removeSqlComments(sql: string): string {
  const noBlock = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock.replace(/--.*$/gm, '');
}

/**
 * Enforces non-destructive SQL policy.
 * Disallows DROP DATABASE, DROP SCHEMA, DROP TABLE, TRUNCATE, and user/role deletion.
 */
export function assertNonDestructiveSql(sql: string, filename: string = 'migration'): void {
  const cleaned = removeSqlComments(sql);
  const destructiveRegex = /\b(DROP\s+DATABASE|DROP\s+SCHEMA|DROP\s+TABLE|TRUNCATE|DROP\s+ROLE|DROP\s+USER)\b/i;
  const match = cleaned.match(destructiveRegex);
  if (match) {
    const errorMsg = `[DESTRUCTIVE MIGRATION BLOCKED] Migration "${filename}" contains destructive SQL statement "${match[0]}". Execution blocked by MediTrack migration safety policy.`;
    throw new Error(errorMsg);
  }
}

/**
 * Derives and validates the PostgreSQL database connection target against the approved project reference.
 * Prevents targeting mismatched databases, production databases, or unvalidated external hosts.
 */
export function deriveAndValidateDatabaseTarget(options?: MigrationTargetOptions): ValidatedDatabaseConfig {
  const envProjectRef = process.env.APPROVED_TEST_PROJECT_REF || extractProjectRef(process.env.SUPABASE_URL || '');
  const approvedProjectRef = (options?.approvedProjectRef || envProjectRef || '').trim().toLowerCase();

  if (!approvedProjectRef) {
    throw new Error(
      '[CONFIGURATION REJECTION] APPROVED_TEST_PROJECT_REF or SUPABASE_URL is required to derive database target.'
    );
  }

  // Reject production references immediately
  const prodRefs = (process.env.PRODUCTION_PROJECT_REF || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  if (prodRefs.includes(approvedProjectRef)) {
    throw new Error(
      `[CRITICAL DATABASE GUARD REJECTION] Target project "${approvedProjectRef}" is explicitly designated as PRODUCTION.`
    );
  }

  let targetHost = '';
  let targetPort = 5432;
  let targetUser = 'postgres';
  let targetPassword = '';
  let targetDatabase = 'postgres';
  let sslOption: boolean | object = options?.ssl ?? { rejectUnauthorized: false };

  // Parse connection string if provided
  const rawConnString = options?.connectionString || process.env.DATABASE_URL || '';
  if (rawConnString && rawConnString.trim() !== '') {
    try {
      const parsed = new URL(rawConnString);
      targetHost = parsed.hostname;
      if (parsed.port) {
        targetPort = parseInt(parsed.port, 10);
      }
      if (parsed.username) {
        targetUser = decodeURIComponent(parsed.username);
      }
      if (parsed.password) {
        targetPassword = decodeURIComponent(parsed.password);
      }
      if (parsed.pathname && parsed.pathname.length > 1) {
        targetDatabase = parsed.pathname.replace(/^\//, '');
      }
    } catch (parseErr: any) {
      throw new Error(
        `[CONFIGURATION REJECTION] Invalid DATABASE_URL connection string provided: ${sanitizeErrorMessage(parseErr.message || String(parseErr))}`
      );
    }
  } else {
    // Discrete options or environment variables
    targetHost = options?.host || process.env.DB_HOST || process.env.PGHOST || '';
    if (options?.port) {
      targetPort = options.port;
    } else if (process.env.DB_PORT || process.env.PGPORT) {
      targetPort = parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10);
    }
    targetUser = options?.user || process.env.DB_USER || process.env.PGUSER || 'postgres';
    targetPassword = options?.password || process.env.DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD || process.env.PGPASSWORD || '';
    targetDatabase = options?.database || process.env.DB_NAME || process.env.PGDATABASE || 'postgres';
  }

  // If host is not explicitly specified, derive it deterministically from approved project ref
  if (!targetHost || targetHost.trim() === '') {
    targetHost = `db.${approvedProjectRef}.supabase.co`;
  }

  const normalizedHost = targetHost.trim().toLowerCase();

  // Guard: Check if host or user targets any production project ref
  for (const prodRef of prodRefs) {
    if (normalizedHost.includes(prodRef) || targetUser.toLowerCase().includes(prodRef)) {
      throw new Error(
        `[CRITICAL DATABASE GUARD REJECTION] Target host "${targetHost}" targets production project reference "${prodRef}". Execution blocked.`
      );
    }
  }

  // Validate host against approved test project
  // Case 1: Supabase direct host db.<project_ref>.supabase.co
  const directMatch = normalizedHost.match(/^db\.([a-z0-9_-]+)\.supabase\.co$/);
  if (directMatch) {
    const hostRef = directMatch[1];
    if (hostRef !== approvedProjectRef) {
      throw new Error(
        `[DATABASE TARGET MISMATCH] Connection target host "${targetHost}" specifies project "${hostRef}", which does not match approved test project "${approvedProjectRef}".`
      );
    }
  } else {
    // Case 2: Supabase regional / shared pooler (e.g. aws-0-<region>.pooler.supabase.com)
    // where user is postgres.<project_ref>
    const isSharedPooler = /^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(normalizedHost);
    if (isSharedPooler) {
      const userParts = targetUser.split('.');
      if (userParts.length > 1) {
        const userRef = userParts[1].toLowerCase();
        if (userRef !== approvedProjectRef) {
          throw new Error(
            `[DATABASE TARGET MISMATCH] Connection user "${targetUser}" specifies project "${userRef}", which does not match approved test project "${approvedProjectRef}".`
          );
        }
      }
    } else {
      // Case 3: Supabase dedicated pooler host <project_ref>.pooler.supabase.com
      const poolerMatch = normalizedHost.match(/^([a-z0-9_-]+)\.pooler\.supabase\.com$/);
      if (poolerMatch) {
        const hostRef = poolerMatch[1];
        if (hostRef !== approvedProjectRef) {
          throw new Error(
            `[DATABASE TARGET MISMATCH] Connection target host "${targetHost}" specifies project "${hostRef}", which does not match approved test project "${approvedProjectRef}".`
          );
        }
      } else {
        // Case 4: Other non-localhost host
        const isLocal = ['localhost', '127.0.0.1', '::1'].includes(normalizedHost);
        if (!isLocal && !normalizedHost.includes(approvedProjectRef)) {
          throw new Error(
            `[DATABASE TARGET MISMATCH] Connection target host "${targetHost}" does not match approved test project "${approvedProjectRef}".`
          );
        }
      }
    }
  }

  // Verify credentials presence
  if (!targetPassword || targetPassword.trim() === '') {
    throw new Error(
      `[CONFIGURATION REQUIRED] Missing database credentials for approved project "${approvedProjectRef}". Direct migration requires DB_PASSWORD or validated DATABASE_URL.`
    );
  }

  const sanitizedTarget = `${targetUser}@${targetHost}:${targetPort}/${targetDatabase}`;

  return {
    host: targetHost,
    port: targetPort,
    user: targetUser,
    password: targetPassword,
    database: targetDatabase,
    ssl: sslOption,
    projectRef: approvedProjectRef,
    sanitizedTarget
  };
}

/**
 * Ensures public.schema_migrations tracking table exists.
 */
export async function ensureSchemaMigrationsTable(
  client: { query: (sql: string, params?: any[]) => Promise<any> }
): Promise<void> {
  const ddl = `
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await client.query(ddl);
}

/**
 * Retrieves map of already applied migration versions.
 */
export async function getAppliedMigrationVersions(
  client: { query: (sql: string, params?: any[]) => Promise<any> }
): Promise<Map<string, AppliedMigration>> {
  const result = await client.query(
    'SELECT version, name, checksum, applied_at FROM public.schema_migrations ORDER BY version ASC'
  );
  const map = new Map<string, AppliedMigration>();
  for (const row of result.rows || []) {
    map.set(row.version, {
      version: row.version,
      name: row.name,
      checksum: row.checksum,
      applied_at: String(row.applied_at)
    });
  }
  return map;
}

/**
 * Applies unapplied migrations sequentially in deterministic order.
 * Tracks applied migrations in public.schema_migrations with SHA-256 checksums.
 */
export async function runMigrations(
  client: { query: (sql: string, params?: any[]) => Promise<any> },
  migrationsDir: string = path.resolve(__dirname, '../../migrations')
): Promise<MigrationSummary> {
  await ensureSchemaMigrationsTable(client);
  const appliedMap = await getAppliedMigrationVersions(client);

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory does not exist: ${migrationsDir}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const summary: MigrationSummary = {
    total: files.length,
    applied: 0,
    skipped: 0,
    appliedVersions: [],
    skippedVersions: []
  };

  for (const file of files) {
    const versionMatch = file.match(/^([0-9]+)/);
    const version = versionMatch ? versionMatch[1] : file;

    if (appliedMap.has(version)) {
      const existing = appliedMap.get(version)!;
      console.log(`[Migration] Version ${version} (${file}) already applied at ${existing.applied_at}. Skipping.`);
      summary.skipped++;
      summary.skippedVersions.push(version);
      continue;
    }

    const fullPath = path.join(migrationsDir, file);
    const content = fs.readFileSync(fullPath, 'utf-8');

    assertNonDestructiveSql(content, file);

    const checksum = crypto.createHash('sha256').update(content, 'utf-8').digest('hex');

    console.log(`[Migration] Applying version ${version} (${file}, sha256: ${checksum.substring(0, 12)}...)...`);

    await client.query('BEGIN');
    try {
      await client.query(content);
      await client.query(
        'INSERT INTO public.schema_migrations (version, name, checksum, applied_at) VALUES ($1, $2, $3, NOW())',
        [version, file, checksum]
      );
      await client.query('COMMIT');
      console.log(`[Migration] Successfully applied version ${version} (${file}).`);
      summary.applied++;
      summary.appliedVersions.push(version);
    } catch (err: any) {
      await client.query('ROLLBACK');
      const sanitized = sanitizeErrorMessage(err.message || String(err));
      throw new Error(`Failed applying migration ${file}: ${sanitized}`);
    }
  }

  return summary;
}

/**
 * Main migration entry point.
 */
export async function run(): Promise<void> {
  assertSafeExecutionEnvironment('Database Migration');

  console.log('--- MediTrack Database Migration Runner ---');

  let config: ValidatedDatabaseConfig;
  try {
    config = deriveAndValidateDatabaseTarget();
  } catch (err: any) {
    if (err.message && err.message.includes('[CONFIGURATION REQUIRED]')) {
      const projectRef = process.env.APPROVED_TEST_PROJECT_REF || extractProjectRef(process.env.SUPABASE_URL || '') || 'unknown';
      console.warn(`\n⚠️  ${err.message}`);
      console.log('\n======================================================');
      console.log('ACTION REQUIRED: Database Migration (Direct Postgres Credentials Missing)');
      console.log('======================================================');
      console.log(`Target project: ${projectRef}`);
      console.log('Direct migration requires DB_PASSWORD or DATABASE_URL in .env.');
      console.log('Alternatively, you can apply migrations via the Supabase SQL editor:');
      console.log(`1. Go to your Supabase Dashboard: https://supabase.com/dashboard/project/${projectRef}/sql`);
      console.log('2. Click on "SQL Editor" -> "New query"');
      console.log('3. Run backend/migrations/001_initial_schema.sql');
      console.log('4. Run backend/migrations/002_outbox_idempotency.sql');
      console.log('======================================================\n');
      return;
    }
    throw err;
  }

  console.log(`Target: ${config.sanitizedTarget}`);
  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL successfully.');
    const summary = await runMigrations(client);
    console.log(`✓ Migration completed: ${summary.applied} applied, ${summary.skipped} skipped (total ${summary.total}).`);
  } catch (err: any) {
    const sanitized = sanitizeErrorMessage(err.message || String(err));
    console.error('Migration failed:', sanitized);
    throw new Error(`Migration execution failed: ${sanitized}`);
  } finally {
    try {
      await client.end();
    } catch {
      // Ignore disconnect errors
    }
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Migration aborted:', sanitizeErrorMessage(err.message || String(err)));
    process.exit(1);
  });
}
