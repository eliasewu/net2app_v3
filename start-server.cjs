/**
 * Systemd production entry point for Net2App Hub.
 *
 * Express 5 under systemd (Type=simple) may drain the event loop immediately
 * after app.listen() fires its callback if no other async handles are active.
 * A minimal keep-alive interval prevents this without any overhead.
 */
require('./server.cjs');

// Keep-alive: a no-op recurring timer ensures the event loop never drains.
// This is transparent — it does no work but prevents premature process exit.
//
// TODO: Investigate root cause — Express 5 app.listen() under systemd Type=simple
// drains the event loop immediately after the listen callback fires (~20ms).
// A simple http.createServer().listen() does NOT exhibit this behavior,
// so something in server.cjs (or a dependency) is closing the socket or
// calling process.exit(0). Until found, this timer keeps us alive.
// To reproduce: systemctl start net2app-hub without this setInterval.
setInterval(() => {}, 600_000); // every 10 minutes, effectively infinite
