import http from 'http';
import { assertSafeExecutionEnvironment } from '../utils/environmentGuard';

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
  console.log(' MEDITRACK – CORS, ENVIRONMENT GUARD & RATE LIMIT SECURITY TEST SUITE');
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
  // 1. CORS Allowlist Tests
  // -------------------------------------------------------------------------
  console.log('--- 1. TESTING CORS ALLOWLIST & CREDENTIALS ---');

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
  console.log('\n--- 2. TESTING CORS REJECTION OF UNTRUSTED ORIGIN ---');
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
  // 3. Environment Guard Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 3. TESTING ENVIRONMENT GUARD SAFETY ENFORCEMENT ---');
  const prevEnv = process.env.NODE_ENV;

  try {
    // Test 3.1: Guard passes in development/test
    process.env.NODE_ENV = 'development';
    let devPassed = false;
    try {
      assertSafeExecutionEnvironment('Unit Test Guard');
      devPassed = true;
    } catch {
      devPassed = false;
    }
    assert('assertSafeExecutionEnvironment allows execution in development', devPassed);

    // Test 3.2: Guard throws and blocks in production
    process.env.NODE_ENV = 'production';
    let prodBlocked = false;
    let prodError = '';
    try {
      assertSafeExecutionEnvironment('Dangerous Production Wipe');
    } catch (err: any) {
      prodBlocked = true;
      prodError = err.message;
    }
    assert(
      'assertSafeExecutionEnvironment strictly throws in NODE_ENV=production',
      prodBlocked && prodError.includes('Dangerous Production Wipe') && prodError.includes('blocked'),
      `Error: ${prodError}`
    );
  } finally {
    process.env.NODE_ENV = prevEnv;
  }

  // -------------------------------------------------------------------------
  // 4. Rate Limiting Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 4. TESTING AUTH RATE LIMITER ENFORCEMENT ---');
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
