const { WebSocketServer } = require('ws');

// Render sets the process.env.PORT variable dynamically. Default to 8080 if local.
const PORT = process.env.PORT || 8080;

// Create the WebSocket server
const wss = new WebSocketServer({ port: PORT });
console.log(`[Server] PluhShooter backend is running on port ${PORT}`);

// Map to track active client connections (clientId -> { ws, position, rotation })
const clients = new Map();
let clientIdSequence = 1;

wss.on('connection', (ws) => {
    // Generate a unique ID for this client session
    const clientId = `player_${clientIdSequence++}`;
    console.log(`[Server] Client connected: ${clientId}`);

    // 1. Send the initial game state (all existing player coordinates) to the new player
    const currentPlayers = [];
    for (const [id, clientData] of clients.entries()) {
        currentPlayers.push({
            id: id,
            position: clientData.position,
            rotation: clientData.rotation
        });
    }
    
    ws.send(JSON.stringify({
        type: 'game_state',
        players: currentPlayers
    }));

    // Register this client's position at the origin
    const clientInfo = {
        ws: ws,
        position: { x: 0, y: 0, z: 0 },
        rotation: { y: 0 }
    };
    clients.set(clientId, clientInfo);

    // 2. Notify all other players that this player has joined
    broadcast({
        type: 'player_join',
        id: clientId,
        position: clientInfo.position,
        rotation: clientInfo.rotation
    }, clientId);

    // Handle messages received from the client
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'position_update':
                    // Update this player's coordinates on the server
                    clientInfo.position = data.position;
                    clientInfo.rotation = data.rotation;

                    // Broadcast the coordinates to all other players
                    broadcast({
                        type: 'position_update',
                        id: clientId,
                        position: data.position,
                        rotation: data.rotation
                    }, clientId);
                    break;

                case 'shoot':
                    // Broadcast gunshots to all other players so they render tracer lines
                    broadcast({
                        type: 'shoot',
                        id: clientId,
                        origin: data.origin,
                        direction: data.direction
                    }, clientId);
                    break;

                case 'hit':
                    // Deliver damage directly to the targeted client
                    const targetClient = clients.get(data.targetId);
                    if (targetClient && targetClient.ws.readyState === 1) { // 1 = OPEN
                        targetClient.ws.send(JSON.stringify({
                            type: 'hit',
                            damage: data.damage
                        }));
                    }
                    break;

                default:
                    console.log(`[Server] Unknown message type from ${clientId}:`, data.type);
            }
        } catch (err) {
            console.error(`[Server] Error parsing message from ${clientId}:`, err.message);
        }
    });

    // Handle client disconnect
    ws.on('close', () => {
        console.log(`[Server] Client disconnected: ${clientId}`);
        clients.delete(clientId);

        // Notify other players that this player has left
        broadcast({
            type: 'player_leave',
            id: clientId
        });
    });

    ws.on('error', (err) => {
        console.error(`[Server] Connection error on ${clientId}:`, err.message);
    });
});

// Broadcasts JSON message to all clients except optionally the sender
function broadcast(data, skipClientId = null) {
    const payload = JSON.stringify(data);
    for (const [id, client] of clients.entries()) {
        if (id === skipClientId) continue;
        if (client.ws.readyState === 1) { // 1 = OPEN
            client.ws.send(payload);
        }
    }
}
