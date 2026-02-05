import { WebSocketServer } from 'ws';

class WorkflowWebSocket {
  constructor(port) {
    try {
      this.wss = new WebSocketServer({ port });

      this.wss.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`[WebSocket] Port ${port} is already in use. Retrying in 1s...`);
          setTimeout(() => {
            this.wss.close();
            this.wss = new WebSocketServer({ port });
          }, 1000);
        } else {
          console.error('[WebSocket] Server error:', error);
        }
      });
    } catch (err) {
      console.error('[WebSocket] Failed to start server:', err);
    }

    this.clients = new Set();

    this.wss.on('connection', (ws) => {
      console.log('[WebSocket] Client connected');
      this.clients.add(ws);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          console.log('[WebSocket] Received:', data);

          // Handle client messages if needed
          if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          } else if (data.type === 'pong') {
            ws.isAlive = true;
          }
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      });



      ws.on('error', (error) => {
        console.error('[WebSocket] Error:', error);
        this.clients.delete(ws);
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        message: 'WebSocket connection established'
      }));

      // Setup Heartbeat
      ws.isAlive = true;
      const pingInterval = setInterval(() => {
        if (ws.isAlive === false) {
          console.warn('[WebSocket] Heartbeat failed: Terminating inactive client');
          return ws.terminate();
        }

        ws.isAlive = false;
        if (ws.readyState === 1) { // WebSocket.OPEN
          // console.log('[WebSocket] Sending Ping');
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 45000); // 45s heartbeat

      ws.on('close', (code, reason) => {
        clearInterval(pingInterval);
        // Only log "error" codes if needed, otherwise just info
        if (code !== 1000 && code !== 1001 && code !== 1005 && code !== 1006) {
          console.log(`[WebSocket] Client disconnected (Code: ${code}). Auto-cleaning up.`);
        } else {
          // Normal closure or page reload
          // console.log('[WebSocket] Client disconnected normally');
        }
        this.clients.delete(ws);
      });
    });

    console.log(`[WebSocket] Server started on port ${port}`);
  }

  broadcast(message) {
    let data;
    try {
      data = typeof message === 'string' ? message : JSON.stringify(message);
      if (data.length > 1024 * 10) {
        console.warn(`[WebSocket] Warning: Broadcasting large message (${data.length} bytes)`);
      }
    } catch (e) {
      console.error('[WebSocket] Failed to stringify message:', e);
      return;
    }

    this.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(data);
        } catch (error) {
          console.error('[WebSocket] Error sending to client:', error);
        }
      }
    });
  }

  close() {
    this.wss.close();
  }
}

export default WorkflowWebSocket;