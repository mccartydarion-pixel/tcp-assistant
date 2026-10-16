import { createServer, type IncomingMessage } from 'node:http';
import { logger } from '../utils/logger.js';
import { handleStripeWebhook } from '../payments/stripeBilling.js';

// A small web server for what has to reach the bot from outside Discord: Stripe's payment events at
// POST /stripe/webhook, and GET /health for checks. Railway gives it a public address.
const MAX_BODY_BYTES = 1_000_000;

async function readBody(request: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function startHttpServer(port: number): void {
  const server = createServer(async (request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    try {
      if (request.method === 'GET' && (path === '/' || path === '/health')) {
        response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
        return;
      }
      if (request.method === 'POST' && path === '/stripe/webhook') {
        // Stripe signs the exact bytes it sends, so the body is kept raw for the signature check.
        const body = await readBody(request);
        if (!body) {
          response.writeHead(413).end();
          return;
        }
        const signature = request.headers['stripe-signature'];
        const result = await handleStripeWebhook(body, Array.isArray(signature) ? signature[0] : signature);
        response.writeHead(result.status, { 'content-type': 'text/plain' }).end(result.body);
        return;
      }
      response.writeHead(404).end();
    } catch (error) {
      logger.error({ err: error }, '[TCP Web ERROR] Request failed');
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  server.on('error', (error) => logger.error({ err: error }, '[TCP Web ERROR] The web server stopped'));
  server.listen(port, () => logger.info(`[TCP Web] Listening on port ${port} for Stripe events.`));
}
