import { createApp } from './app.factory.js';
import { loadConfig } from './config.js';

async function bootstrap() {
  const config = loadConfig();
  const app = await createApp(config);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' });
  await app.listen(config.PORT);
  console.log(`API listening on :${config.PORT}`);
}
bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
