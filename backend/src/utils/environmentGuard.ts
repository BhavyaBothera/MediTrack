import { env } from '../config/env';

/**
 * Asserts that dangerous, destructive, or bulk-reset operations
 * (e.g., database wipe, fictional medicine seed, mock user injection)
 * are strictly prohibited in a production environment.
 *
 * @param operationName The name of the script or action being guarded.
 */
export function assertSafeExecutionEnvironment(operationName: string): void {
  const isProduction =
    (env.NODE_ENV && env.NODE_ENV.toLowerCase() === 'production') ||
    (process.env.NODE_ENV && process.env.NODE_ENV.toLowerCase() === 'production');

  if (isProduction) {
    const errorMsg =
      `[CRITICAL SECURITY REJECTION] Dangerous operation "${operationName}" was blocked! ` +
      `Executing destructive scripts, resets, or mock seeds against a PRODUCTION environment ` +
      `(NODE_ENV=production) is strictly prohibited by MediTrack security policy.`;
    console.error(`\n🚨 ${errorMsg}\n`);
    throw new Error(errorMsg);
  }

  console.log(`[Environment Guard] Verified safe non-production environment for "${operationName}" (NODE_ENV=${env.NODE_ENV}).`);
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
