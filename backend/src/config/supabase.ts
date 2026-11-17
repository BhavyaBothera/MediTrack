import { createClient } from '@supabase/supabase-js';
import { env } from './env';

const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;

// Security Invariant: The admin client must never silently fall back to the anonymous key.
// Missing service role credentials must immediately and safely halt initialization.
if (!serviceRoleKey) {
  throw new Error(
    '[Security Invariant Violation] SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) is required for ' +
    'administrative backend operations. Falling back to anonymous public key for admin client is strictly prohibited.'
  );
}

if (!env.SUPABASE_ANON_KEY) {
  throw new Error(
    '[Security Invariant Violation] SUPABASE_ANON_KEY is required for public authentication client initialization.'
  );
}

// Service role client strictly isolated for server-side business logic, RBAC enforcement and scheduling
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Public client strictly scoped with anon key for user-context operations (e.g. signInWithPassword)
export const supabasePublic = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

