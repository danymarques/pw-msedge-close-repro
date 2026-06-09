# pw-msedge-close-repro

Minimal reproduction for: **`browser.close()` with `channel: 'msedge'` can block ~20s while
Microsoft EdgeUpdater holds the inherited stdio pipe.**

## TL;DR

The msedge browser spawns **EdgeUpdater** as a child process. EdgeUpdater inherits the browser's
stdout/stderr pipe and keeps running an update check (~20s) after the browser itself has exited.
Playwright's `launchProcess` resolves its cleanup on the child process's **`'close'`** event (stdio
EOF), which only fires once EdgeUpdater releases that pipe — so `browser.close()` stays blocked the
whole time, even though the browser disconnected and its process exited within ~100ms.

## Setup

```bash
npm install
npx playwright install msedge   # or have Microsoft Edge installed
```

## 1. Deterministic root-cause repro (no Playwright, hermetic, all platforms)

```bash
npm run mechanism
```

Models the exact shape — a parent that exits immediately but backgrounds a detached grandchild that
inherits its stdio pipe:

```
exit  @ ~500ms   (process is gone)
close @ ~5000ms  (stdio EOF — Playwright waits HERE)
```

This shows the gap is real: Node's `'close'` waits for stdio EOF held by the grandchild, while
`'exit'` (the process actually terminating) fired ~4.5s earlier.

## 2. Real-world repro (Playwright + msedge)

```bash
npm test
# or, to see EdgeUpdater spawned as a child of the browser:
DEBUG=pw:browser npm test
```

```js
const browser = await chromium.launch({ channel: 'msedge' });
await browser.newPage();
const start = Date.now();
await browser.close();
console.log(`browser.close() took ${Date.now() - start}ms`); // ~20000ms when EdgeUpdater runs
```

This is **intermittent**: it only blocks when EdgeUpdater runs an update check during the close.
EdgeUpdater is scheduled (on macOS via the hourly launchd agent `com.microsoft.EdgeUpdater.wake`)
and also triggers on browser launch when a check is "due", so it reproduces most reliably after the
machine has been idle for a few hours. Run it a few times.

With `DEBUG=pw:browser` you can see `EdgeUpdater --wake-all/--wake` as a child of the browser pid,
logging to the browser's stderr; its `Shutdown: 0` lines up exactly with when `close()` returns.

## Observed timeline (instrumented)

```
+0ms     browserProcess.close() begin
+103ms   Disconnected emitted
+134ms   process 'exit'   (exitCode=0, signal=null)   <- process is gone
... ~20s, EdgeUpdater holds the inherited stderr pipe ...
~+20s    process 'close'                              <- Playwright was waiting here
```

## Suggested fix

In `packages/utils/processLauncher.ts`, resolve cleanup on the process **`'exit'`** event (process
terminated) instead of/in addition to `'close'` (stdio EOF). `'exit'` always precedes `'close'`, so
a detached grandchild holding an inherited pipe no longer delays `close()`.

## Environment where observed

- macOS 26.5.1 (EdgeUpdater also exists on Windows)
- Node.js v22.22.3
- Microsoft Edge (`channel: 'msedge'`) 149.0.4022.52
- Playwright 1.60.0 (also on `main`)
