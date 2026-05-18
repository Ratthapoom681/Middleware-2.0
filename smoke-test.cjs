/**
 * Smoke test — verifies every major API surface of the refactored server
 * against expected behaviour from the pre-refactor monolith.
 *
 * Run while the server is listening on http://localhost:3001
 *   node smoke-test.cjs
 */

const http = require('http');

const BASE = 'http://localhost:3001';
let token = null;
let passed = 0;
let failed = 0;
const failures = [];

// ─── helpers ────────────────────────────────────────────────────────
const request = (method, path, body = null, headers = {}) =>
    new Promise((resolve, reject) => {
        const url = new URL(path, BASE);
        const options = {
            method,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...headers,
            },
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(data); } catch { /* not json */ }
                resolve({ status: res.statusCode, data: json, raw: data });
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });

const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});

const assert = (label, condition, detail = '') => {
    if (condition) {
        passed++;
        console.log(`  ✅ ${label}`);
    } else {
        failed++;
        const msg = `  ❌ ${label}${detail ? ' — ' + detail : ''}`;
        console.log(msg);
        failures.push(msg);
    }
};

// ─── tests ──────────────────────────────────────────────────────────
async function run() {
    console.log('\n========================================');
    console.log('  SMOKE TEST — Refactored server.cjs');
    console.log('========================================\n');

    // 1. Health endpoint (no auth required)
    console.log('1. Health endpoint');
    {
        const res = await request('GET', '/api/health');
        assert('GET /api/health returns 200', res.status === 200);
        assert('  .ok === true', res.data?.ok === true);
        assert('  .storage is string', typeof res.data?.storage === 'string');
    }

    // 2. Login with default admin
    console.log('\n2. Authentication');
    {
        const res = await request('POST', '/api/login', { username: 'admin', password: 'admin' });
        assert('POST /api/login returns 200', res.status === 200, `got ${res.status}`);
        assert('  returns token', typeof res.data?.token === 'string' && res.data.token.length > 0);
        assert('  returns user.username', res.data?.user?.username === 'admin');
        assert('  returns user.role === admin', res.data?.user?.role === 'admin');
        token = res.data?.token;
    }

    // 2b. Bad login
    {
        const res = await request('POST', '/api/login', { username: 'admin', password: 'wrong' });
        assert('POST /api/login bad password returns 401', res.status === 401);
    }

    // 3. Protected route without token
    console.log('\n3. Auth protection');
    {
        const res = await request('GET', '/api/config');
        assert('GET /api/config without token returns 401', res.status === 401);
    }

    // 4. Config
    console.log('\n4. Configuration');
    let originalConfig = {};
    {
        const res = await request('GET', '/api/config', null, authHeaders());
        assert('GET /api/config returns 200', res.status === 200, `got ${res.status}`);
        assert('  has scanPath', typeof res.data?.scanPath === 'string');
        assert('  has defectDojoUrl', res.data?.defectDojoUrl !== undefined);
        assert('  has redmineUrl', res.data?.redmineUrl !== undefined);
        assert('  has pullFilters', typeof res.data?.pullFilters === 'object');
        originalConfig = res.data || {};
    }

    // 4b. Save config (with a test value)
    {
        const res = await request('POST', '/api/config', { ...originalConfig, redmineUrl: 'https://test-redmine.local' }, authHeaders());
        assert('POST /api/config returns 200', res.status === 200, `got ${res.status}: ${res.raw}`);
    }

    // 4c. Verify config was saved
    {
        const res = await request('GET', '/api/config', null, authHeaders());
        assert('  config persisted redmineUrl', res.data?.redmineUrl === 'https://test-redmine.local',
            `got ${res.data?.redmineUrl}`);
    }

    // 4d. Restore original config
    {
        await request('POST', '/api/config', originalConfig, authHeaders());
    }

    // 5. User management
    console.log('\n5. User management');
    {
        const res = await request('GET', '/api/users', null, authHeaders());
        assert('GET /api/users returns 200', res.status === 200, `got ${res.status}`);
        assert('  is array', Array.isArray(res.data));
        assert('  contains admin user', res.data?.some(u => u.username === 'admin'));
    }

    // 5b. Create a test user
    {
        const res = await request('POST', '/api/users', {
            username: 'smoke_tester',
            password: 'test123',
            role: 'viewer',
            products: ['TestProduct']
        }, authHeaders());
        assert('POST /api/users (create) returns 200', res.status === 200, `got ${res.status}: ${res.raw}`);
    }

    // 5c. Verify user was created
    {
        const res = await request('GET', '/api/users', null, authHeaders());
        const found = res.data?.find(u => u.username === 'smoke_tester');
        assert('  smoke_tester exists', !!found);
        assert('  smoke_tester role is viewer', found?.role === 'viewer');
        assert('  smoke_tester has products', Array.isArray(found?.products) && found.products.includes('TestProduct'));
    }

    // 5d. Login as test user
    {
        const res = await request('POST', '/api/login', { username: 'smoke_tester', password: 'test123' });
        assert('  smoke_tester can login', res.status === 200);
    }

    // 5e. Delete test user
    {
        const res = await request('DELETE', '/api/users/smoke_tester', null, authHeaders());
        assert('DELETE /api/users/smoke_tester returns 200', res.status === 200, `got ${res.status}`);
    }

    // 5f. Verify deleted
    {
        const res = await request('GET', '/api/users', null, authHeaders());
        const found = res.data?.find(u => u.username === 'smoke_tester');
        assert('  smoke_tester no longer exists', !found);
    }

    // 6. Findings
    console.log('\n6. Findings');
    {
        const res = await request('GET', '/api/findings', null, authHeaders());
        const noData = res.status === 404 && res.data?.error === 'Scan path does not exist';
        assert('GET /api/findings returns 200 or 404 (no data)', res.status === 200 || noData,
            `got ${res.status}: ${res.data?.error || ''}`);
        assert('  is array or no-data response', Array.isArray(res.data) || noData);
    }

    // 7. Logs
    console.log('\n7. Live log capture');
    {
        const res = await request('GET', '/api/logs', null, authHeaders());
        assert('GET /api/logs returns 200', res.status === 200, `got ${res.status}`);
        assert('  is array', Array.isArray(res.data));
        assert('  has log entries (server boot produced logs)', res.data?.length > 0,
            `got ${res.data?.length} entries`);
    }

    // 8. Config backup / export
    console.log('\n8. Config backup & export');
    {
        const res = await request('GET', '/api/config/export', null, authHeaders());
        assert('GET /api/config/export returns 200', res.status === 200, `got ${res.status}`);
        assert('  has config data', typeof res.data === 'object');
    }
    {
        const res = await request('GET', '/api/config/backups', null, authHeaders());
        assert('GET /api/config/backups returns 200', res.status === 200, `got ${res.status}`);
        assert('  is array', Array.isArray(res.data));
    }

    // 9. Dashboard sync SSE endpoint (just test it opens)
    console.log('\n9. Dashboard sync SSE');
    {
        const sseOk = await new Promise((resolve) => {
            const url = new URL('/api/sync/events', BASE);
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
            };
            const req = http.get(options, (res) => {
                // SSE returns 200 with text/event-stream
                if (res.statusCode === 200) {
                    res.destroy();
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
            req.on('error', () => resolve(false));
            setTimeout(() => { req.destroy(); resolve(false); }, 2000);
        });
        assert('GET /api/dashboard/sync returns 200 (SSE)', sseOk);
    }

    // 10. Redmine sync store
    console.log('\n10. Redmine sync state');
    {
        const res = await request('GET', '/api/redmine/sync/status', null, authHeaders());
        assert('GET /api/redmine/sync/status returns 200', res.status === 200, `got ${res.status}`);
        assert('  response is object', typeof res.data === 'object');
    }

    // 11. Logout
    console.log('\n11. Logout');
    {
        const res = await request('POST', '/api/logout', null, authHeaders());
        assert('POST /api/logout returns 200', res.status === 200, `got ${res.status}`);
    }
    {
        const res = await request('GET', '/api/config', null, authHeaders());
        assert('  token invalidated after logout', res.status === 401);
    }

    // ─── summary ────────────────────────────────────────────────────
    console.log('\n========================================');
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
    console.log('========================================');
    if (failures.length > 0) {
        console.log('\nFailures:');
        failures.forEach(f => console.log(f));
    }
    console.log('');
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
    console.error('Smoke test crashed:', err);
    process.exit(1);
});
