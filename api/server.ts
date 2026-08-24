/**
 * local server entry file, for local development
 */
import app from './app.js';

/**
 * start server with port
 * SMOKE_PORT tiene la prioridad más alta para pruebas locales sin afectar .env.local.
 */
const PORT = process.env.SMOKE_PORT || process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
});

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