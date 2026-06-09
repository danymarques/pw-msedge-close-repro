// Real-world reproduction using Playwright + the msedge channel.
//
// browser.close() blocks for ~20s WHEN Microsoft's EdgeUpdater runs an update check
// during the close. EdgeUpdater is scheduled (on macOS via the hourly launchd agent
// com.microsoft.EdgeUpdater.wake) and also triggers on browser launch when a check is
// "due", so this is intermittent. It reproduces most reliably after the machine has
// been idle for a few hours (a check becomes overdue). Run it a few times.
//
// Tip: run with DEBUG=pw:browser to see `EdgeUpdater --wake-all/--wake` spawned as a
// child of the browser process, logging to the browser's stderr — its shutdown lines
// up exactly with when browser.close() finally returns.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  await browser.newPage();

  const start = Date.now();
  await browser.close();
  const elapsed = Date.now() - start;

  console.log(`browser.close() took ${elapsed}ms`);
  if (elapsed > 5000)
    console.log('REPRODUCED: close blocked far longer than the browser took to exit (EdgeUpdater held the stdio pipe).');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
