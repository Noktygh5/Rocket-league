import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { NET, PHYSICS } from '@turboball/shared';

// Phase 1 stub: HTTP /health plus a WebSocket endpoint. Rooms and netcode arrive in phase 9.
const port = Number(process.env.PORT ?? 8080);

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, tickRate: PHYSICS.tickRate, protocol: NET.protocolVersion }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http });
wss.on('connection', (ws) => ws.close(1000, 'not implemented yet'));

http.listen(port, () => console.log(`server listening on :${port}`));
