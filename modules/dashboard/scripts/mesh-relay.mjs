import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;
const HOST = process.env.HOST || '0.0.0.0';

const wss = new WebSocketServer({ port: PORT, host: HOST }, () => {
  console.log(`[Mesh Relay] HighWater local mesh relay listening on ws://${HOST}:${PORT}`);
  console.log(`[Mesh Relay] In-memory mode active. Zero external dependencies / no internet required.`);
});

// In-memory update store
const updates = [];

function broadcast(data, excludeWs = null) {
  const message = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (err) {
        console.error('[Mesh Relay] Broadcast error:', err.message);
      }
    }
  }
}

function broadcastPeerCount() {
  const count = wss.clients.size;
  broadcast({ type: 'peer_count', count });
}

wss.on('connection', (ws, req) => {
  const remoteIp = req.socket.remoteAddress;
  console.log(`[Mesh Relay] Peer connected from ${remoteIp}. Total peers: ${wss.clients.size}`);

  // 1. Send existing updates to newly connected peer
  try {
    ws.send(JSON.stringify({ type: 'init', updates }));
  } catch (err) {
    console.error('[Mesh Relay] Failed to send init:', err.message);
  }

  // 2. Broadcast updated peer count to all connected peers
  broadcastPeerCount();

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === 'update' && data.update && data.update.id) {
        const update = data.update;
        // Ignore duplicate by ID
        const exists = updates.some((u) => u.id === update.id);
        if (!exists) {
          updates.push(update);
          console.log(`[Mesh Relay] Update added [${update.id}] zone=${update.zoneId} status=${update.surveyStatus} (total: ${updates.length})`);
        }
        // Broadcast new update to all peers (including sender for confirmation / or to all)
        broadcast({ type: 'update', update });
      }
    } catch (err) {
      console.warn('[Mesh Relay] Invalid message received:', err.message);
    }
  });

  ws.on('close', () => {
    console.log(`[Mesh Relay] Peer disconnected. Total peers: ${wss.clients.size}`);
    broadcastPeerCount();
  });

  ws.on('error', (err) => {
    console.warn(`[Mesh Relay] Peer error:`, err.message);
  });
});

wss.on('error', (err) => {
  console.error('[Mesh Relay] Server error:', err.message);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Mesh Relay] Shutting down WebSocket relay...');
  wss.close(() => {
    process.exit(0);
  });
});
