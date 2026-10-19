/*
 * Harness PARITY black-box: Next.js (gốc) vs NestJS (mới) — cùng request, cùng DB khởi đầu => cùng HTTP + cùng DB cuối.
 *
 * Chạy:  npm run parity            (tất cả)
 *        npm run parity -- --only=auth-login,users
 *        npm run parity -- --list
 *
 * CHỈ chạm DB throwaway 127.0.0.1:55432/baogia_parity (xem config.ts). KHÔNG đọc giá trị .env của app Next.
 */
import fs from 'node:fs';
import path from 'node:path';
import { assertSafeDbUrl, DATABASE_URL, NEST_PORT, NEXT_PORT } from './config';
import { Db } from './db';
import { doRequest, type RawResult, type StepSpec, type Vars } from './http';
import { deepDiff, dumpDiff, normalizeDump, viewOf, type Diff, type Dump, type StepView } from './normalize';
import { SCENARIOS, type Scenario } from './scenarios';
import { prepareHashes, seed } from './seed';
import { assertPortsFree, killByPort, startServer, stopServer, type ServerHandle, type ServerName } from './servers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface StepRun {
  name: string;
  view: StepView;
  ms: number;
}
interface SideRun {
  steps: StepRun[];
  dump: Dump;
  rawDump: Dump;
  /** Chỉ scenario isolated: dump (đã chuẩn hoá) sau TỪNG bước. */
  stepDumps: Dump[];
  crashed?: string;
  dryRunJobs: number;
}

interface StepResult {
  name: string;
  pass: boolean;
  diffs: Diff[];
  dbDiff?: string[];
  next?: StepView;
  nest?: StepView;
}
interface ScenarioResult {
  name: string;
  steps: StepResult[];
  dbDiff: string[];
  status: 'PASS' | 'DIFF' | 'CRASH';
  crash?: string;
  dryRunJobs: { next: number; nest: number };
  rows: { next: Record<string, number>; nest: Record<string, number> };
  seconds: number;
}

class SafetyAbort extends Error {}

// Next dev compile lười: lần đầu chạm route 4+ đoạn từng trả 404 trong lần chạy nguội đầu tiên. OPTIONS không chạy handler
// của app (Next tự trả Allow) nhưng buộc compile route. Chỉ để làm nóng, kết quả bị bỏ.
const WARM_PATHS = [
  '/health', '/hello', '/auth/login', '/channels', '/channels/1', '/receive-channels', '/receive-channels/1', '/customers', '/customers/1',
  '/customers/search', '/customers/markets', '/customers/import', '/customers/bulk-delete', '/quotations', '/quotations/1', '/quotations/1/items',
  '/quotations/1/templates', '/templates', '/templates/1', '/templates/sync-meta', '/templates/1/customers', '/templates/1/customers/link',
  '/templates/1/customers/unlink', '/templates/1/customers/2', '/templates/1/image', '/users', '/users/1', '/users/1/zalo', '/users/1/zalo/link-code',
  '/send/preview', '/send/confirm', '/send/cancel', '/send/process', '/send/batches', '/send/batches/1', '/send-jobs', '/cron/process-sends',
  '/cron/zalo-token', '/cron/cleanup-logs', '/activity', '/inbound', '/dashboard', '/webhooks/whatsapp', '/webhooks/zalo', '/zalo/status',
  '/zalo/check', '/zalo/disconnect', '/zalo/refresh', '/zalo/test', '/zalo/oauth/start', '/zalo/oauth/exchange', '/zalo/oauth/callback',
  '/zalo/senders', '/zalo/shared-users',
];
async function warmUp(srv: ServerHandle): Promise<void> {
  let bad = 0;
  for (const p of WARM_PATHS) {
    const r = await doRequest(srv.base, { name: 'warm', method: 'OPTIONS', path: p, noActor: true });
    if (r.status === 404 || r.status < 0) bad++;
  }
  console.log('  warm-up xong, route không khớp (404/lỗi): ' + bad);
}

function safetyCheck(raw: Dump): number {
  let dry = 0;
  for (const j of raw['send_jobs'] ?? []) {
    const mid = j['message_id'];
    if (mid == null) continue;
    if (typeof mid === 'string' && mid.startsWith('DRYRUN-')) dry++;
    else if (!(typeof mid === 'string' && mid.startsWith('wamid.PARITY'))) {
      throw new SafetyAbort(`PARITY ABORT: send_job ${String(j['id'])} có message_id "${String(mid)}" không phải DRYRUN-* — có thể đã gửi thật!`);
    }
  }
  return dry;
}

async function runSide(db: Db, srv: ServerHandle, sc: Scenario): Promise<SideRun> {
  assertSafeDbUrl(DATABASE_URL);
  const fresh = async () => {
    await db.reset();
    await seed(db);
    if (sc.setup) await sc.setup(db);
  };
  await fresh();
  const vars: Vars = {};
  const steps: StepRun[] = [];
  const stepDumps: Dump[] = [];
  let crashed: string | undefined;
  try {
    for (const s of sc.steps) {
      const spec: StepSpec = typeof s === 'function' ? s(vars) : s;
      const reps = spec.repeat?.max ?? 1;
      for (let i = 0; i < reps; i++) {
        if (sc.isolated) await fresh();
        const r: RawResult = await doRequest(srv.base, spec);
        steps.push({ name: spec.repeat ? `${spec.name} #${i + 1}` : spec.name, view: viewOf(r, spec.maskKeys, spec.sortArrays), ms: r.ms });
        if (sc.isolated) {
          const d = await db.dumpAll();
          safetyCheck(d);
          stepDumps.push(normalizeDump(d));
        }
        spec.capture?.(r, vars);
        if (spec.repeat && spec.repeat.until(r)) break;
      }
      if (spec.sleepAfter) await sleep(spec.sleepAfter);
    }
  } catch (e) {
    crashed = (e as Error).stack ?? String(e);
  }
  const rawDump = await db.dumpAll();
  const dryRunJobs = safetyCheck(rawDump);
  if (sc.cooldownMs) await sleep(sc.cooldownMs);
  return { steps, dump: normalizeDump(rawDump), rawDump, stepDumps, crashed, dryRunJobs };
}

const counts = (d: Dump) => Object.fromEntries(Object.entries(d).map(([t, r]) => [t, r.length]));

function compareSides(sc: Scenario, a: SideRun, b: SideRun, db: Db, seconds: number): ScenarioResult {
  const steps: StepResult[] = [];
  const n = Math.max(a.steps.length, b.steps.length);
  for (let i = 0; i < n; i++) {
    const sa = a.steps[i];
    const sb = b.steps[i];
    if (!sa || !sb) {
      steps.push({ name: (sa ?? sb)!.name, pass: false, diffs: [{ path: '(step missing)', next: sa ? 'present' : 'absent', nest: sb ? 'present' : 'absent' }] });
      continue;
    }
    const diffs = deepDiff({ status: sa.view.status, media: sa.view.media, headers: sa.view.headers, body: sa.view.body }, { status: sb.view.status, media: sb.view.media, headers: sb.view.headers, body: sb.view.body });
    let stepDb: string[] | undefined;
    if (sc.isolated && a.stepDumps[i] && b.stepDumps[i]) stepDb = dumpDiff(a.stepDumps[i], b.stepDumps[i], (t) => db.pkOf(t), 20);
    const failed = diffs.length > 0 || (stepDb?.length ?? 0) > 0;
    steps.push({ name: sa.name, pass: !failed, diffs, dbDiff: stepDb?.length ? stepDb : undefined, next: failed ? sa.view : undefined, nest: failed ? sb.view : undefined });
  }
  const dbDiff = sc.isolated
    ? steps.flatMap((s) => (s.dbDiff ?? []).map((l) => `[${s.name}] ${l}`))
    : dumpDiff(a.dump, b.dump, (t) => db.pkOf(t));
  const crash = a.crashed || b.crashed;
  const bad = steps.some((s) => !s.pass) || dbDiff.length > 0;
  return {
    name: sc.name,
    steps,
    dbDiff,
    status: crash ? 'CRASH' : bad ? 'DIFF' : 'PASS',
    crash: crash ? `next: ${a.crashed ?? '-'}\nnest: ${b.crashed ?? '-'}` : undefined,
    dryRunJobs: { next: a.dryRunJobs, nest: b.dryRunJobs },
    rows: { next: counts(a.rawDump), nest: counts(b.rawDump) },
    seconds,
  };
}

const short = (v: unknown, n = 160) => {
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + '…' : String(s);
};

function writeReports(results: ScenarioResult[], outDir: string, meta: Record<string, unknown>) {
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ meta, results }, null, 2));
  const total = results.reduce((a, r) => a + r.steps.length, 0);
  const failedSteps = results.reduce((a, r) => a + r.steps.filter((s) => !s.pass).length, 0);
  const lines: string[] = [];
  lines.push('# Parity report: Next (3999) vs Nest (4455)', '');
  lines.push(`Generated: ${new Date().toISOString()}`, '');
  lines.push(`Scenarios: ${results.length} | steps: ${total} | steps differing: ${failedSteps} | PASS scenarios: ${results.filter((r) => r.status === 'PASS').length} | DIFF: ${results.filter((r) => r.status === 'DIFF').length} | CRASH: ${results.filter((r) => r.status === 'CRASH').length}`, '');
  lines.push('| scenario | steps | differing steps | DB diff lines | dry-run jobs (next/nest) | result |', '|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(`| ${r.name} | ${r.steps.length} | ${r.steps.filter((s) => !s.pass).length} | ${r.dbDiff.length} | ${r.dryRunJobs.next}/${r.dryRunJobs.nest} | ${r.status} |`);
  }
  lines.push('');
  for (const r of results.filter((x) => x.status !== 'PASS')) {
    lines.push(`## ${r.status}: ${r.name}`, '');
    if (r.crash) lines.push('```', r.crash.slice(0, 1500), '```', '');
    for (const s of r.steps.filter((x) => !x.pass).slice(0, 400)) {
      lines.push(`- **${s.name}**`);
      for (const d of s.diffs.slice(0, 8)) lines.push(`  - \`${d.path}\`: next=${short(d.next)} | nest=${short(d.nest)}`);
      if (s.diffs.length > 8) lines.push(`  - … +${s.diffs.length - 8} more`);
      for (const l of (s.dbDiff ?? []).slice(0, 4)) lines.push(`  - DB: ${l}`);
    }
    if (r.dbDiff.length) {
      lines.push('', 'DB diff:', '```');
      lines.push(...r.dbDiff.slice(0, 60));
      lines.push('```');
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(outDir, 'REPORT.md'), lines.join('\n'));
}

async function main() {
  assertSafeDbUrl(DATABASE_URL);
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const s of SCENARIOS) console.log(s.name, s.steps.length);
    return;
  }
  const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
  const list = only.length ? SCENARIOS.filter((s) => only.includes(s.name)) : SCENARIOS;
  if (!list.length) throw new Error('Không có scenario nào khớp --only');

  const outDir = __dirname;
  const db = new Db();
  await db.connect();
  await prepareHashes();
  assertPortsFree();

  const servers: Partial<Record<ServerName, ServerHandle>> = {};
  const cleanup = () => {
    stopServer(servers.next);
    stopServer(servers.nest);
    killByPort(NEXT_PORT);
    killByPort(NEST_PORT);
  };
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  const results: ScenarioResult[] = [];
  try {
    console.log('Khởi động Nest (4455)…');
    servers.nest = await startServer('nest');
    console.log('Khởi động Next dev (3999) — lần đầu compile chậm…');
    servers.next = await startServer('next');
    console.log('Warm-up Next (OPTIONS từng route để compile trước)…');
    await warmUp(servers.next);

    for (const sc of list) {
      const t0 = Date.now();
      process.stdout.write(`▶ ${sc.name} (${sc.steps.length} steps) … `);
      let res: ScenarioResult;
      try {
        const a = await runSide(db, servers.next, sc);
        const b = await runSide(db, servers.nest, sc);
        res = compareSides(sc, a, b, db, Math.round((Date.now() - t0) / 1000));
      } catch (e) {
        if (e instanceof SafetyAbort) throw e;
        res = { name: sc.name, steps: [], dbDiff: [], status: 'CRASH', crash: (e as Error).stack ?? String(e), dryRunJobs: { next: 0, nest: 0 }, rows: { next: {}, nest: {} }, seconds: Math.round((Date.now() - t0) / 1000) };
      }
      results.push(res);
      const bad = res.steps.filter((s) => !s.pass).length;
      console.log(`${res.status} (${res.steps.length} steps, ${bad} differing, ${res.dbDiff.length} db diff lines, ${res.seconds}s)`);
      writeReports(results, outDir, { startedAt: new Date().toISOString(), db: 'baogia_parity@127.0.0.1:55432', partial: true });
    }
  } finally {
    cleanup();
    await db.end().catch(() => undefined);
  }

  writeReports(results, outDir, { finishedAt: new Date().toISOString(), db: 'baogia_parity@127.0.0.1:55432', partial: false });
  console.log('\nScenario'.padEnd(46) + 'Result');
  for (const r of results) console.log(r.name.padEnd(45) + r.status);
  const diffs = results.filter((r) => r.status !== 'PASS');
  if (diffs.length) {
    console.log('\nChi tiết DIFF: xem test/parity/REPORT.md');
    for (const r of diffs) {
      console.log(`\n--- ${r.status} ${r.name}`);
      for (const s of r.steps.filter((x) => !x.pass).slice(0, 6)) {
        console.log(`  * ${s.name}`);
        for (const d of s.diffs.slice(0, 3)) console.log(`      ${d.path}: next=${short(d.next, 90)} nest=${short(d.nest, 90)}`);
      }
      for (const l of r.dbDiff.slice(0, 6)) console.log('  db: ' + l);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
