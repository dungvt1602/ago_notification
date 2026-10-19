import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildChildEnv, LOG_DIR, NEST_DIR, NEST_PORT, NEXT_DIR, NEXT_PORT } from './config';

export type ServerName = 'next' | 'nest';

export interface ServerHandle {
  name: ServerName;
  port: number;
  base: string;
  proc: ChildProcess;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ps(cmd: string): string {
  try {
    return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 30_000 });
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? '');
  }
}

export function listenersOnPort(port: number): number[] {
  const out = ps(
    `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
  );
  return out.split(/\r?\n/).map((s) => Number(s.trim())).filter((n) => n > 0);
}

/** Dừng mọi tiến trình đang LISTEN ở cổng (chỉ dùng cho cổng harness tự mở). */
export function killByPort(port: number): void {
  for (const pid of listenersOnPort(port)) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* đã chết */
    }
  }
}

export function assertPortsFree(): void {
  for (const p of [NEXT_PORT, NEST_PORT]) {
    const l = listenersOnPort(p);
    if (l.length) throw new Error(`PARITY ABORT: cổng ${p} đang bị tiến trình ${l.join(',')} chiếm (không phải của harness) — không kill, dừng.`);
  }
}

async function waitReady(base: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(base + '/api/health', { signal: AbortSignal.timeout(60_000) });
      if (r.status === 200) return;
      last = 'status ' + r.status;
    } catch (e) {
      last = (e as Error).message;
    }
    await sleep(1500);
  }
  throw new Error(`server ${base} không sẵn sàng sau ${timeoutMs}ms (${last})`);
}

export async function startServer(name: ServerName): Promise<ServerHandle> {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const port = name === 'next' ? NEXT_PORT : NEST_PORT;
  const out = fs.openSync(path.join(LOG_DIR, `${name}.log`), 'w');
  const env = buildChildEnv(port);
  let proc: ChildProcess;
  if (name === 'next') {
    const nextBin = path.join(NEXT_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
    proc = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], { cwd: NEXT_DIR, env, stdio: ['ignore', out, out], windowsHide: true });
  } else {
    proc = spawn(process.execPath, ['dist/src/main.js'], { cwd: NEST_DIR, env, stdio: ['ignore', out, out], windowsHide: true });
  }
  const base = `http://127.0.0.1:${port}`;
  await waitReady(base, name === 'next' ? 120_000 : 60_000);
  return { name, port, base, proc };
}

export function stopServer(h: ServerHandle | null | undefined): void {
  if (!h) return;
  try {
    execFileSync('taskkill', ['/PID', String(h.proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  killByPort(h.port);
}
