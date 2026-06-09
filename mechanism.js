// Deterministic, hermetic reproduction of the ROOT CAUSE (no Playwright, no msedge).
//
// A parent process exits immediately, but backgrounds a *detached* grandchild that
// inherits the parent's stdout/stderr pipe and outlives it. Node's ChildProcess
// 'close' event (stdio EOF) only fires once that grandchild releases the pipe — even
// though the parent's 'exit' event fired long before.
//
// This is exactly the shape of `chromium.launch({ channel: 'msedge' })`: the Edge
// browser spawns EdgeUpdater, which inherits the stdio pipe and runs an update check
// for ~20s after the browser process is gone. Playwright's launchProcess resolves its
// cleanup on 'close', so browser.close() stays blocked the whole time.
//
// Expected output:  exit  @ ~500ms ,  close @ ~5000ms
const { spawn } = require('child_process');

const grandchildMs = 5000;
const script = [
  `const cp = require('child_process');`,
  `const g = cp.spawn(process.execPath, ['-e', 'setTimeout(() => {}, ${grandchildMs})'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true });`,
  `g.unref();`,
  `process.on('SIGTERM', () => process.exit(0));`,
  `console.log('ready');`,
  `setInterval(() => {}, 1000);`,
].join('\n');

const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
child.stderr.on('data', () => {});

const start = Date.now();
child.once('exit', () => console.log(`exit  @ ${Date.now() - start}ms  (process is gone)`));
child.once('close', () => {
  console.log(`close @ ${Date.now() - start}ms  (stdio EOF — Playwright waits HERE)`);
  process.exit(0);
});

// Once the child is fully started (grandchild spawned, SIGTERM handler installed),
// ask it to exit gracefully.
let killed = false;
child.stdout.on('data', data => {
  if (!killed && data.toString().includes('ready')) {
    killed = true;
    child.kill('SIGTERM');
  }
});
