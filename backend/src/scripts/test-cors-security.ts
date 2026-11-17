import http from 'http';
import { assertSafeExecutionEnvironment } from '../utils/environmentGuard';
import { isOriginAllowed, getTrustedOrigins } from '../server';
import { getClientIp } from '../middleware/rateLimiter';
import { env } from '../config/env';

interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function makeRequest(
  urlStr: string,
  method = 'GET',
  headers: Record<string, string> = {},
  body?: string
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        ...headers,
        ...(body ? { 'Content-Length': Buffer.byteLength(body).toString(), 'Content-Type': 'application/json' } : {})
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', (err) => reject(err));
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function runCorsAndSecurityTests() {
  console.log('========================================================================');
  console.log(' MEDITRACK – P0 SECURITY AUDIT: CORS, ENVIRONMENT ISOLATION & PROXY TRUST');
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

  const serverUrl = 'http://localhost:5000';

  // -------------------------------------------------------------------------
  // 1. Live Server CORS Tests (Development Mode)
  // -------------------------------------------------------------------------
  console.log('--- 1. TESTING LIVE CORS ALLOWLIST & CREDENTIALS ---');

  // Test 1.1: Localhost allowed origin
  const resLocalhost = await makeRequest(`${serverUrl}/api/health`, 'GET', {
    Origin: 'http://localhost:5000'
  });
  assert(
    'Trusted origin (http://localhost:5000) allowed with status 200',
    resLocalhost.statusCode === 200,
    `Status: ${resLocalhost.statusCode}`
  );
  assert(
    'CORS header Access-Control-Allow-Origin returned for trusted localhost',
    resLocalhost.headers['access-control-allow-origin'] === 'http://localhost:5000'
  );
  assert(
    'CORS header Access-Control-Allow-Credentials returned as true',
    resLocalhost.headers['access-control-allow-credentials'] === 'true'
  );

  // Test 1.2: 127.0.0.1 allowed origin
  const res127 = await makeRequest(`${serverUrl}/api/health`, 'GET', {
    Origin: 'http://127.0.0.1:5000'
  });
  assert(
    'Trusted loopback origin (http://127.0.0.1:5000) allowed with status 200',
    res127.statusCode === 200,
    `Status: ${res127.statusCode}`
  );
  assert(
    'CORS header Access-Control-Allow-Origin returned for 127.0.0.1',
    res127.headers['access-control-allow-origin'] === 'http://127.0.0.1:5000'
  );

  // Test 1.3: Direct / Server-to-server request (no Origin header)
  const resNoOrigin = await makeRequest(`${serverUrl}/api/health`, 'GET');
  assert(
    'Non-browser request (no Origin header) allowed with status 200',
    resNoOrigin.statusCode === 200
  );

  // Test 1.4: Reject untrusted origin
  const untrustedOrigin = 'https://evil-phishing-site.com';
  const resUntrusted = await makeRequest(`${serverUrl}/api/health`, 'GET', {
    Origin: untrustedOrigin
  });
  assert(
    'Untrusted origin rejected with HTTP 403 Forbidden',
    resUntrusted.statusCode === 403,
    `Received status: ${resUntrusted.statusCode}`
  );
  assert(
    'Untrusted origin response contains explicit CORS rejection message',
    resUntrusted.body.includes('CORS Security Policy') && resUntrusted.body.includes('evil-phishing-site.com'),
    `Body: ${resUntrusted.body}`
  );
  assert(
    'Access-Control-Allow-Origin is NOT set for untrusted origin',
    resUntrusted.headers['access-control-allow-origin'] === undefined
  );

  // -------------------------------------------------------------------------
  // 2. Production CORS Verification (P0.5)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. PRODUCTION CORS POLICY ENFORCEMENT (P0.5) ---');
  const prodFrontend = 'https://meditrack-app.vercel.app';
  const prodOriginsConfig = [prodFrontend, 'http://localhost:5000', 'http://127.0.0.1:5000'];

  // Test 2.1: Production frontend accepted
  const prodAllowed = isOriginAllowed(prodFrontend, 'production', prodOriginsConfig);
  assert(
    'Configured production frontend origin is accepted in NODE_ENV=production',
    prodAllowed === true
  );

  // Test 2.2: Localhost rejected in production even if misconfigured in origin list
  const prodLocalhostAllowed = isOriginAllowed('http://localhost:5000', 'production', prodOriginsConfig);
  assert(
    'Localhost origin is strictly REJECTED in NODE_ENV=production even if configured in origin list',
    prodLocalhostAllowed === false
  );

  // Test 2.3: 127.0.0.1 rejected in production
  const prod127Allowed = isOriginAllowed('http://127.0.0.1:5000', 'production', prodOriginsConfig);
  assert(
    '127.0.0.1 origin is strictly REJECTED in NODE_ENV=production',
    prod127Allowed === false
  );

  // Test 2.4: Untrusted domain rejected in production
  const prodUntrustedAllowed = isOriginAllowed('https://malicious-site.com', 'production', prodOriginsConfig);
  assert(
    'Untrusted external domain is strictly REJECTED in NODE_ENV=production',
    prodUntrustedAllowed === false
  );

  // Test 2.5: Missing / empty production origin configuration fails safely
  const emptyProdAllowed = isOriginAllowed(prodFrontend, 'production', []);
  assert(
    'Empty production origin configuration fails safely (rejects all browser origins)',
    emptyProdAllowed === false
  );

  // Test 2.6: Direct request (no origin) allowed in production
  const prodDirectAllowed = isOriginAllowed(undefined, 'production', prodOriginsConfig);
  assert(
    'Direct server-to-server request (no origin header) allowed in production',
    prodDirectAllowed === true
  );

  // -------------------------------------------------------------------------
  // 3. Database Environment Isolation Guard (P0.1)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. DATABASE ENVIRONMENT ISOLATION ENFORCEMENT (P0.1) ---');
  const savedNodeEnv = process.env.NODE_ENV;
  const savedUrl = process.env.SUPABASE_URL;
  const savedTestAuth = process.env.TEST_EXECUTION_AUTHORIZED;
  const savedProdRef = process.env.PRODUCTION_PROJECT_REF;
  const savedTestRef = process.env.APPROVED_TEST_PROJECT_REF;

  try {
    // Test 3.1: Approved test database with authorization passes in development
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_URL = 'https://zadepztpubocvhjivlvj.supabase.co';
    process.env.APPROVED_TEST_PROJECT_REF = 'zadepztpubocvhjivlvj';
    process.env.PRODUCTION_PROJECT_REF = 'meditrack-prod-cluster';
    process.env.TEST_EXECUTION_AUTHORIZED = 'true';

    let authorizedPassed = false;
    try {
      assertSafeExecutionEnvironment('Approved Test Operation');
      authorizedPassed = true;
    } catch {
      authorizedPassed = false;
    }
    assert(
      'assertSafeExecutionEnvironment permits execution when database matches APPROVED_TEST_PROJECT_REF and authorized',
      authorizedPassed
    );

    // Test 3.2: NODE_ENV=development CANNOT bypass the production database guard!
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_URL = 'https://meditrack-prod-cluster.supabase.co';
    process.env.PRODUCTION_PROJECT_REF = 'meditrack-prod-cluster';
    process.env.TEST_EXECUTION_AUTHORIZED = 'true';

    let prodDbBlockedInDev = false;
    let prodDbError = '';
    try {
      assertSafeExecutionEnvironment('Attempted Dev Wipe on Prod DB');
    } catch (err: any) {
      prodDbBlockedInDev = true;
      prodDbError = err.message;
    }
    assert(
      'NODE_ENV=development CANNOT bypass production database guard: target matching PRODUCTION_PROJECT_REF is blocked',
      prodDbBlockedInDev && prodDbError.includes('explicitly designated as PRODUCTION'),
      `Error: ${prodDbError}`
    );

    // Test 3.3: Unknown unapproved project reference is blocked
    process.env.SUPABASE_URL = 'https://random-unapproved-ref.supabase.co';
    let unapprovedDbBlocked = false;
    let unapprovedDbError = '';
    try {
      assertSafeExecutionEnvironment('Attempted Dev Wipe on Unknown DB');
    } catch (err: any) {
      unapprovedDbBlocked = true;
      unapprovedDbError = err.message;
    }
    assert(
      'Unapproved database project reference is blocked (does not match APPROVED_TEST_PROJECT_REF)',
      unapprovedDbBlocked && unapprovedDbError.includes('NOT in the approved test database list'),
      `Error: ${unapprovedDbError}`
    );

    // Test 3.4: Missing test authorization flag is blocked
    process.env.SUPABASE_URL = 'https://zadepztpubocvhjivlvj.supabase.co';
    delete process.env.TEST_EXECUTION_AUTHORIZED;
    // ensure command line arguments don't contain --authorized
    const origArgv = [...process.argv];
    process.argv = process.argv.filter(arg => arg !== '--authorized');

    let unauthorizedBlocked = false;
    let unauthorizedError = '';
    try {
      assertSafeExecutionEnvironment('Unauthorized Mutation');
    } catch (err: any) {
      unauthorizedBlocked = true;
      unauthorizedError = err.message;
    }
    assert(
      'Missing TEST_EXECUTION_AUTHORIZED flag and missing --authorized CLI flag is strictly blocked',
      unauthorizedBlocked && unauthorizedError.includes('require an explicit authorization flag'),
      `Error: ${unauthorizedError}`
    );
    process.argv = origArgv;

    // Test 3.5: NODE_ENV=production is strictly blocked
    process.env.NODE_ENV = 'production';
    process.env.TEST_EXECUTION_AUTHORIZED = 'true';
    let prodEnvBlocked = false;
    let prodEnvError = '';
    try {
      assertSafeExecutionEnvironment('Destructive Action');
    } catch (err: any) {
      prodEnvBlocked = true;
      prodEnvError = err.message;
    }
    assert(
      'NODE_ENV=production is strictly blocked regardless of flags or project reference',
      prodEnvBlocked && prodEnvError.includes('NODE_ENV=production'),
      `Error: ${prodEnvError}`
    );
  } finally {
    process.env.NODE_ENV = savedNodeEnv;
    process.env.SUPABASE_URL = savedUrl;
    process.env.TEST_EXECUTION_AUTHORIZED = savedTestAuth;
    process.env.PRODUCTION_PROJECT_REF = savedProdRef;
    process.env.APPROVED_TEST_PROJECT_REF = savedTestRef;
  }

  // -------------------------------------------------------------------------
  // 4. Reverse Proxy Trust & IP Spoofing Tests (P0.4)
  // -------------------------------------------------------------------------
  console.log('\n--- 4. REVERSE PROXY TRUST & IP SPOOFING DEFENSE (P0.4) ---');

  // Test 4.1: Direct connection: trust proxy is disabled, spoofed X-Forwarded-For is IGNORED
  const mockReqDirect: any = {
    app: { get: (key: string) => (key === 'trust proxy' ? false : undefined) },
    socket: { remoteAddress: '198.51.100.12' },
    ip: '198.51.100.12',
    headers: { 'x-forwarded-for': '203.0.113.195' }, // Attacker trying to spoof IP
  };
  const resolvedDirectIp = getClientIp(mockReqDirect);
  assert(
    'Direct connection (trust proxy = false) ignores spoofed X-Forwarded-For and resolves socket address',
    resolvedDirectIp === '198.51.100.12',
    `Resolved IP: ${resolvedDirectIp}`
  );

  // Test 4.2: Trusted reverse proxy: trust proxy is enabled, verified upstream client IP is resolved
  const mockReqProxied: any = {
    app: { get: (key: string) => (key === 'trust proxy' ? 1 : undefined) },
    socket: { remoteAddress: '10.0.0.1' }, // Load balancer internal address
    ip: '203.0.113.50',                   // Express-verified client IP after 1 trusted hop
    headers: { 'x-forwarded-for': '203.0.113.50' },
  };
  const resolvedProxiedIp = getClientIp(mockReqProxied);
  assert(
    'Configured reverse proxy deployment (trust proxy = 1) uses Express-verified req.ip',
    resolvedProxiedIp === '203.0.113.50',
    `Resolved IP: ${resolvedProxiedIp}`
  );

  // -------------------------------------------------------------------------
  // 5. Rate Limiting Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 5. TESTING AUTH RATE LIMITER ENFORCEMENT ---');
  console.log('Sending burst of 20 rapid login attempts to trigger 15-request limit...');

  let rateLimitTriggered = false;
  let rateLimitStatus = 0;
  let retryAfterHeader: string | undefined;

  for (let i = 1; i <= 20; i++) {
    const res = await makeRequest(
      `${serverUrl}/api/auth/login`,
      'POST',
      { Origin: 'http://localhost:5000' },
      JSON.stringify({ email: `ratelimit_probe_${i}@test.com`, password: 'wrongpassword' })
    );

    if (res.statusCode === 429) {
      rateLimitTriggered = true;
      rateLimitStatus = res.statusCode;
      retryAfterHeader = res.headers['retry-after'] as string;
      break;
    }
  }

  assert(
    'Auth rate limiter triggers HTTP 429 Too Many Requests after exceeding threshold',
    rateLimitTriggered && rateLimitStatus === 429,
    `Status: ${rateLimitStatus}`
  );
  assert(
    'Auth rate limiter returns Retry-After response header',
    Boolean(retryAfterHeader),
    `Retry-After: ${retryAfterHeader}`
  );

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(' CORS & SECURITY AUDIT SUMMARY');
  console.log('========================================================================');
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log(`Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runCorsAndSecurityTests().catch((err) => {
  console.error('Fatal CORS/Security test error:', err);
  process.exit(1);
});
