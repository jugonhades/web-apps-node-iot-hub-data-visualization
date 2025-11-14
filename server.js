'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const EventHubReader = require('./scripts/event-hub-reader');

// Variables de entorno necesarias
// IotHubConnectionString: "Endpoint=sb://...;SharedAccessKeyName=iothubowner;SharedAccessKey=...;EntityPath=<your-hub-name>"
// EventHubConsumerGroup: "$Default" (u otro)
const iotHubConnectionString = process.env.IotHubConnectionString;
const eventHubConsumerGroup = process.env.EventHubConsumerGroup || '$Default';
const port = process.env.PORT || 3000;

const app = express();
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Gestiona conexiones WS
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ info: 'WebSocket connected' }));
});

// Inicia lector de Event Hub y reexpide mensajes al WS
const eventHubReader = new EventHubReader(iotHubConnectionString, eventHubConsumerGroup);

(async () => {
  await eventHubReader.startReadMessage(async (out) => {
    // out ya es {droneId, timestamp, velocity:{speed_mps,...}, ...}
    const payload = JSON.stringify(out);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  });
})().catch(err => {
  console.error('Error starting EventHubReader:', err);
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
