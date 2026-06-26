#!/usr/bin/env node

/**
 * Ramped concurrency test for the middleware stack.
 *
 * Scenarios:
 *   login       - concurrent independent logins (measures Gateway/Auth/Auth DB)
 *   service     - concurrent GETs sharing one valid token (measures one service)
 *   end-to-end  - each worker logs in, uses the service, then logs out
 *   all         - runs all three scenarios independently
 *
 * The runner stops each scenario at the first degraded stage and writes a JSON
 * report under load-results/. Remote targets require LOAD_ALLOW_REMOTE=true.
 */

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...parts] = arg.slice(2).split('=');
    result[key] = parts.length ? parts.join('=') : 'true';
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const numberValue = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const booleanValue = value => String(value || '').toLowerCase() === 'true';
const normalizeBase = value => String(value || 'http://127.0.0.1').replace(/\/+$/, '');
const parseLevels = value => [...new Set(String(value || '1,5,10,25,50')
  .split(',').map(item => Number.parseInt(item.trim(), 10))
  .filter(item => Number.isInteger(item) && item > 0 && item <= 1000))];

const config = {
  baseUrl: normalizeBase(args.base || process.env.LOAD_BASE_URL),
  scenario: String(args.scenario || process.env.LOAD_SCENARIO || 'all').toLowerCase(),
  levels: parseLevels(args.levels || process.env.LOAD_LEVELS),
  requestsPerWorker: numberValue(args.requests || process.env.LOAD_REQUESTS_PER_WORKER, 10),
  requestTimeoutMs: numberValue(args.timeout || process.env.LOAD_REQUEST_TIMEOUT_MS, 5000),
  stagePauseMs: numberValue(args.pause || process.env.LOAD_STAGE_PAUSE_MS, 2000),
  maxErrorRate: numberValue(args['max-error-rate'] || process.env.LOAD_MAX_ERROR_RATE, 0.05),
  maxP95Ms: numberValue(args['max-p95'] || process.env.LOAD_MAX_P95_MS, 2000),
  targetPath: String(args.target || process.env.LOAD_TARGET_PATH || '/defectdojo/api/dashboard/summary'),
  targetHealthPath: String(process.env.LOAD_TARGET_HEALTH_PATH || '/defectdojo/api/health'),
  username: String(process.env.LOAD_USERNAME || 'admin'),
  password: String(process.env.LOAD_PASSWORD || 'admin'),
  usersFile: String(process.env.LOAD_USERS_FILE || ''),
  allowRemote: booleanValue(process.env.LOAD_ALLOW_REMOTE),
  dockerStats: booleanValue(process.env.LOAD_DOCKER_STATS),
};

const validScenarios = new Set(['all', 'login', 'service', 'end-to-end']);
if (!validScenarios.has(config.scenario)) throw new Error(`Unknown scenario: ${config.scenario}`);
if (config.levels.length === 0) throw new Error('At least one valid concurrency level is required');
if (config.maxErrorRate > 1) throw new Error('LOAD_MAX_ERROR_RATE must be between 0 and 1');

const targetUrl = new URL(config.baseUrl);
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
if (!localHosts.has(targetUrl.hostname) && !config.allowRemote) {
  throw new Error('Refusing to load-test a remote host. Set LOAD_ALLOW_REMOTE=true only with explicit authorization.');
}

function loadUsers() {
  if (!config.usersFile) return [{ username: config.username, password: config.password }];
  const parsed = JSON.parse(fs.readFileSync(path.resolve(config.usersFile), 'utf8'));
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('LOAD_USERS_FILE must contain a non-empty JSON array');
  return parsed.map((user, index) => {
    const username = String(user?.username || '').trim();
    const password = String(user?.password || '');
    if (!username || !password) throw new Error(`Invalid credential entry at index ${index}`);
    return { username, password };
  });
}

const users = loadUsers();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, fraction) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};

function classifyResponse(operation, status, body) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 429) return 'rate-limited';
  if (status === 401 || status === 403) return 'auth-rejected';
  if (status === 503 && body.includes('Authentication service temporarily unavailable')) return 'auth-unavailable';
  if (status >= 500) return operation === 'login' ? 'login-server-error' : 'service-server-error';
  return `http-${status}`;
}

async function request(operation, pathname, options = {}) {
  const started = performance.now();
  try {
    const response = await fetch(new URL(pathname, config.baseUrl), {
      ...options,
      headers: { accept: 'application/json', ...(options.headers || {}) },
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
    const body = await response.text();
    let data = null;
    try { data = JSON.parse(body); } catch { /* response need not be JSON */ }
    return {
      operation,
      ok: response.ok,
      status: response.status,
      latencyMs: performance.now() - started,
      classification: classifyResponse(operation, response.status, body),
      data,
    };
  } catch (error) {
    return {
      operation,
      ok: false,
      status: 0,
      latencyMs: performance.now() - started,
      classification: error?.name === 'TimeoutError' ? 'timeout' : 'network-error',
      error: error?.message || String(error),
    };
  }
}

async function login(user) {
  return request('login', '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(user),
  });
}

async function logout(token) {
  if (!token) return;
  await request('cleanup-logout', '/api/logout', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
}

async function useService(token) {
  return request('service', config.targetPath, {
    headers: { authorization: `Bearer ${token}` },
  });
}

const healthChecks = [
  ['gateway', '/gateway-health'],
  ['auth', '/api/auth/health/ready'],
  ['target-service', config.targetHealthPath],
];

async function checkHealth() {
  const results = await Promise.all(healthChecks.map(async ([name, pathname]) => {
    const result = await request(`health:${name}`, pathname);
    return { name, status: result.status, ok: result.ok, latencyMs: result.latencyMs, classification: result.classification };
  }));
  return results;
}

function readDockerStats() {
  if (!config.dockerStats) return [];
  try {
    const output = execFileSync('docker', [
      'stats', '--no-stream', '--format', '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}',
    ], { encoding: 'utf8', timeout: 15000 });
    return output.trim().split(/\r?\n/).filter(Boolean).map(line => {
      const [name, cpu, memory] = line.split('\t');
      return { name, cpu, memory };
    }).filter(row => row.name.startsWith('internal-security-middleware-'));
  } catch (error) {
    return [{ error: error.message }];
  }
}

function summarizeResults(results, durationMs, health) {
  const latencies = results.map(result => result.latencyMs);
  const failures = results.filter(result => !result.ok);
  const counts = {};
  for (const result of results) counts[result.classification] = (counts[result.classification] || 0) + 1;
  const unhealthy = health.filter(item => !item.ok).map(item => item.name);
  const errorRate = results.length ? failures.length / results.length : 1;
  const p95Ms = percentile(latencies, 0.95);
  let state = 'healthy';
  let reason = '';
  if (unhealthy.length) {
    state = 'down';
    reason = `health failed: ${unhealthy.join(', ')}`;
  } else if (counts['network-error'] || counts.timeout || counts['auth-unavailable'] || counts['service-server-error'] || counts['login-server-error']) {
    state = 'degraded';
    reason = 'transport or server errors observed';
  } else if (errorRate > config.maxErrorRate) {
    state = counts['rate-limited'] === failures.length ? 'rate-limited' : 'degraded';
    reason = state === 'rate-limited' ? 'login protection limit reached' : `error rate ${(errorRate * 100).toFixed(1)}%`;
  } else if (p95Ms > config.maxP95Ms) {
    state = 'degraded';
    reason = `p95 ${p95Ms.toFixed(0)}ms exceeded ${config.maxP95Ms}ms`;
  }
  return {
    state,
    reason,
    requests: results.length,
    successes: results.length - failures.length,
    failures: failures.length,
    errorRate,
    rps: durationMs > 0 ? results.length / (durationMs / 1000) : 0,
    latencyMs: {
      min: latencies.length ? Math.min(...latencies) : 0,
      p50: percentile(latencies, 0.50),
      p95: p95Ms,
      p99: percentile(latencies, 0.99),
      max: latencies.length ? Math.max(...latencies) : 0,
    },
    classifications: counts,
    health,
  };
}

async function runLoginStage(concurrency) {
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: concurrency }, (_, index) => login(users[index % users.length])));
  const durationMs = performance.now() - started;
  await Promise.all(results.map(result => logout(result.data?.token)));
  return { results, durationMs };
}

async function runServiceStage(concurrency, token) {
  const started = performance.now();
  const workers = Array.from({ length: concurrency }, async () => {
    const results = [];
    for (let index = 0; index < config.requestsPerWorker; index += 1) results.push(await useService(token));
    return results;
  });
  return { results: (await Promise.all(workers)).flat(), durationMs: performance.now() - started };
}

async function runEndToEndStage(concurrency) {
  const started = performance.now();
  const workers = Array.from({ length: concurrency }, async (_, workerIndex) => {
    const results = [];
    const loginResult = await login(users[workerIndex % users.length]);
    results.push(loginResult);
    const token = loginResult.data?.token;
    if (token) {
      for (let index = 0; index < config.requestsPerWorker; index += 1) results.push(await useService(token));
      await logout(token);
    }
    return results;
  });
  return { results: (await Promise.all(workers)).flat(), durationMs: performance.now() - started };
}

function printStage(name, concurrency, summary) {
  const latency = summary.latencyMs;
  console.log(
    `${name.padEnd(11)} c=${String(concurrency).padStart(4)}  state=${summary.state.padEnd(12)}` +
    ` req=${String(summary.requests).padStart(5)}  rps=${summary.rps.toFixed(1).padStart(7)}` +
    `  err=${(summary.errorRate * 100).toFixed(1).padStart(5)}%` +
    `  p50=${latency.p50.toFixed(0).padStart(5)}ms p95=${latency.p95.toFixed(0).padStart(5)}ms p99=${latency.p99.toFixed(0).padStart(5)}ms` +
    (summary.reason ? `  ${summary.reason}` : ''),
  );
}

async function runScenario(name, runner, sharedToken = null) {
  const stages = [];
  let lastHealthyConcurrency = 0;
  let firstDegradedConcurrency = null;
  console.log(`\nScenario: ${name}`);
  for (const concurrency of config.levels) {
    const healthBefore = await checkHealth();
    if (healthBefore.some(item => !item.ok)) throw new Error(`Pre-stage health failure: ${healthBefore.filter(item => !item.ok).map(item => item.name).join(', ')}`);
    const { results, durationMs } = await runner(concurrency, sharedToken);
    const healthAfter = await checkHealth();
    const summary = summarizeResults(results, durationMs, healthAfter);
    const stage = { concurrency, durationMs, ...summary, dockerStats: readDockerStats() };
    stages.push(stage);
    printStage(name, concurrency, summary);
    if (summary.state === 'healthy') {
      lastHealthyConcurrency = concurrency;
    } else {
      firstDegradedConcurrency = concurrency;
      break;
    }
    if (config.stagePauseMs) await sleep(config.stagePauseMs);
  }
  return { name, lastHealthyConcurrency, firstDegradedConcurrency, stages };
}

async function main() {
  console.log('Middleware concurrency load test');
  console.log(`Target: ${config.baseUrl}${config.targetPath}`);
  console.log(`Levels: ${config.levels.join(', ')} | requests/worker: ${config.requestsPerWorker}`);
  console.log(`Thresholds: errors <= ${(config.maxErrorRate * 100).toFixed(1)}%, p95 <= ${config.maxP95Ms}ms`);
  console.log(`Credentials: ${users.length} account(s) (secrets are never printed)`);

  const initialHealth = await checkHealth();
  const unavailable = initialHealth.filter(item => !item.ok);
  if (unavailable.length) throw new Error(`Initial health failure: ${unavailable.map(item => item.name).join(', ')}`);

  const selected = config.scenario === 'all' ? ['login', 'service', 'end-to-end'] : [config.scenario];
  const scenarios = [];
  for (const name of selected) {
    if (name === 'login') scenarios.push(await runScenario(name, runLoginStage));
    if (name === 'service') {
      const authResult = await login(users[0]);
      if (!authResult.ok || !authResult.data?.token) throw new Error(`Shared-session setup login failed (${authResult.status})`);
      try {
        scenarios.push(await runScenario(name, runServiceStage, authResult.data.token));
      } finally {
        await logout(authResult.data.token);
      }
    }
    if (name === 'end-to-end') scenarios.push(await runScenario(name, runEndToEndStage));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    config: { ...config, password: undefined, usersFile: config.usersFile ? path.basename(config.usersFile) : '' },
    initialHealth,
    scenarios,
  };
  const resultDir = path.resolve(__dirname, '..', 'load-results');
  fs.mkdirSync(resultDir, { recursive: true });
  const reportPath = path.join(resultDir, `concurrency-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\nCapacity boundaries');
  for (const scenario of scenarios) {
    console.log(`- ${scenario.name}: last healthy=${scenario.lastHealthyConcurrency || 'none'}, first non-healthy=${scenario.firstDegradedConcurrency || 'not reached'}`);
  }
  console.log(`Report: ${reportPath}`);

  if (scenarios.some(scenario => scenario.firstDegradedConcurrency !== null)) process.exitCode = 2;
}

main().catch(error => {
  console.error(`\nLoad test aborted: ${error.message}`);
  process.exitCode = 1;
});
