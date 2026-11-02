import { createApiServer, drainServer, readServerConfig } from './http';

try {
  const { host, port } = readServerConfig();
  const server = createApiServer();

  server.on('error', (error: Error) => {
    console.error(`ComposeLens API failed: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`ComposeLens API listening on ${host}:${port}`);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void drainServer(server).catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'ComposeLens API failed to start.');
  process.exitCode = 1;
}
