/**
 * local server entry file, for local development
 */
import app from './app.js';
import { ingestAllDbTenants } from './lib/dbWorkspace.js';

/**
 * start server with port
 * SMOKE_PORT tiene la prioridad más alta para pruebas locales sin afectar .env.local.
 */
const PORT = process.env.SMOKE_PORT || process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
});

let ingestionRunning = false;
async function runDailyDocumentIngestion() {
  if (ingestionRunning) return;
  ingestionRunning = true;

  try {
    const result = await ingestAllDbTenants();
    console.info('[document-ingestion] daily run completed', {
      tenantCount: result.tenantCount,
      successCount: result.successCount,
      failedCount: result.failures.length,
    });
    for (const failure of result.failures) {
      console.error('[document-ingestion] tenant refresh failed', failure);
    }
  } catch (error) {
    console.error(
      '[document-ingestion] daily run failed',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    ingestionRunning = false;
  }
}

setTimeout(() => void runDailyDocumentIngestion(), 90_000).unref();
setInterval(() => void runDailyDocumentIngestion(), 24 * 60 * 60 * 1000).unref();

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;