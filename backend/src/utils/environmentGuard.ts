import { env } from '../config/env';

/**
 * Extracts the Supabase project reference from a URL.
 * e.g., "https://zadepztpubocvhjivlvj.supabase.co" -> "zadepztpubocvhjivlvj"
 */
export function extractProjectRef(supabaseUrl?: string): string {
  if (!supabaseUrl) return '';
  try {
    const parsed = new URL(supabaseUrl);
    const parts = parsed.hostname.split('.');
    return parts[0] || '';
  } catch {
    return '';
  }
}

/**
 * Asserts that the current runtime environment and target database are
 * strictly verified and approved for destructive or test operations.
 *
 * Enforces:
 * 1. NODE_ENV must NOT be 'production'.
 * 2. Explicit test authorization flag must be present.
 * 3. Target database project ref must match an approved test project.
 * 4. Target database project ref must NOT match known production project identifiers.
 * 5. NODE_ENV=development CANNOT bypass the production-database guard.
 *
 * @param operationName The name of the script or action being guarded.
 */
export function assertSafeExecutionEnvironment(operationName: string): void {
  const currentEnv = (process.env.NODE_ENV || env.NODE_ENV || 'development').toLowerCase();

  // 1. Prohibit running in production mode
  if (currentEnv === 'production') {
    const errorMsg =
      `[CRITICAL SECURITY REJECTION] Dangerous operation "${operationName}" was blocked! ` +
      `Executing destructive scripts, resets, or mock seeds against a PRODUCTION environment ` +
      `(NODE_ENV=production) is strictly prohibited by MediTrack security policy.`;
    console.error(`\n🚨 ${errorMsg}\n`);
    throw new Error(errorMsg);
  }

  // 2. Require explicit test authorization flag
  const isExplicitlyAuthorized =
    process.env.TEST_EXECUTION_AUTHORIZED === 'true' ||
    process.env.ALLOW_TEST_MUTATIONS === 'true' ||
    process.argv.includes('--authorized');

  if (!isExplicitlyAuthorized) {
    const errorMsg =
      `[AUTHORIZATION REJECTION] Operation "${operationName}" was blocked! ` +
      `Test and destructive operations require an explicit authorization flag ` +
      `(TEST_EXECUTION_AUTHORIZED=true or --authorized).`;
    console.error(`\n🚨 ${errorMsg}\n`);
    throw new Error(errorMsg);
  }

  // 3 & 4. Validate target database configuration and project reference
  const targetUrl = process.env.SUPABASE_URL || env.SUPABASE_URL;
  if (!targetUrl || targetUrl.trim() === '') {
    const errorMsg =
      `[CONFIGURATION REJECTION] Operation "${operationName}" was blocked! ` +
      `SUPABASE_URL is not configured. Test and destructive operations require an explicit target database URL.`;
    console.error(`\n🚨 ${errorMsg}\n`);
    throw new Error(errorMsg);
  }

  const currentProjectRef = extractProjectRef(targetUrl);
  if (!currentProjectRef) {
    const errorMsg =
      `[CONFIGURATION REJECTION] Operation "${operationName}" was blocked! ` +
      `Unable to extract valid project reference from SUPABASE_URL ("${targetUrl}"). Execution blocked.`;
    console.error(`\n🚨 ${errorMsg}\n`);
    throw new Error(errorMsg);
  }

  const rawApprovedRefs = process.env.APPROVED_TEST_PROJECT_REF || env.APPROVED_TEST_PROJECT_REF || '';
  if (!rawApprovedRefs || rawApprovedRefs.trim() === '') {
    const errorMsg =
      `[CONFIGURATION REJECTION] Operation "${operationName}" was blocked! ` +
      `APPROVED_TEST_PROJECT_REF is not configured. Refusing to execute without an explicit approved test database identifier.`;
    console.error(`\n🚨 ${errorMsg}\n`);
    throw new Error(errorMsg);
  }

  const approvedRefs = rawApprovedRefs
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  if (approvedRefs.length === 0) {
    const errorMsg =
      `[CONFIGURATION REJECTION] Operation "${operationName}" was blocked! ` +
      `No valid project references found in APPROVED_TEST_PROJECT_REF. Execution blocked.`;
    console.error(`\n🚨 ${errorMsg}\n`);
    throw new Error(errorMsg);
  }

  const productionRefs = (process.env.PRODUCTION_PROJECT_REF || env.PRODUCTION_PROJECT_REF || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  // If matches production ref, reject IMMEDIATELY regardless of NODE_ENV!
  if (productionRefs.length > 0 && productionRefs.includes(currentProjectRef.toLowerCase())) {
    const errorMsg =
      `[CRITICAL DATABASE GUARD REJECTION] Operation "${operationName}" was blocked! ` +
      `Target database "${currentProjectRef}" is explicitly designated as PRODUCTION. ` +
      `NODE_ENV=${currentEnv} cannot bypass this guard.`;
    console.error(`\n🚨 ${errorMsg}\n`);
    throw new Error(errorMsg);
  }

  // Target must strictly match approved test list
  if (!approvedRefs.includes(currentProjectRef.toLowerCase())) {
    const errorMsg =
      `[DATABASE TARGET REJECTION] Operation "${operationName}" was blocked! ` +
      `Database project "${currentProjectRef || 'unknown'}" is NOT in the approved test database list ` +
      `([${approvedRefs.join(', ')}]). Refusing to execute against unapproved database.`;
    console.error(`\n🚨 ${errorMsg}\n`);
    throw new Error(errorMsg);
  }

  console.log(
    `[Environment Guard] Verified safe environment for "${operationName}" ` +
    `(NODE_ENV=${currentEnv}, DB Project=${currentProjectRef}).`
  );
}

/**
 * Returns true if currently running in production mode.
 */
export function isProduction(): boolean {
  return Boolean(
    (env.NODE_ENV && env.NODE_ENV.toLowerCase() === 'production') ||
    (process.env.NODE_ENV && process.env.NODE_ENV.toLowerCase() === 'production')
  );
}
