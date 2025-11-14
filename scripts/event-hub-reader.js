'use strict';

const { EventHubConsumerClient } = require('@azure/event-hubs');

// Wrapper mínimo basado en el tutorial de Azure
class EventHubReader {
  constructor(connectionString, consumerGroup) {
    if (!connectionString) throw new Error('IotHubConnectionString is required');
    this.consumerClient = new EventHubConsumerClient(consumerGroup, connectionString);
    this.subscription = null;
  }

  async startReadMessage(onMessage) {
    this.subscription = this.consumerClient.subscribe({
      processEvents: async (events, context) => {
        for (const event of events) {
          try {
            const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

            // Construir el objeto de salida según el front
            let out = body;

            // Si por cualquier motivo el body no trae los campos esperados, intenta mapearlos
            if (!body?.droneId || !body?.timestamp || !body?.velocity?.speed_mps) {
              const deviceId =
                body?.droneId ||
                event.systemProperties?.['iothub-connection-device-id'] ||
                event.enqueuedTimeUtc?.toString?.() ||
                'unknown';

              const timestamp =
                body?.timestamp ||
                event.enqueuedTimeUtc?.toISOString?.() ||
                new Date().toISOString();

              const speed =
                body?.velocity?.speed_mps ??
                body?.speed_mps ??
                null;

              out = {
                droneId: deviceId,
                timestamp,
                velocity: { speed_mps: speed }
              };
            }

            await onMessage(out);
          } catch (err) {
            console.error('Error processing event:', err);
          }
        }
      },
      processError: async (err, context) => {
        console.error('Event Hubs processing error:', err);
      }
    });

    return this.subscription;
  }

  async stop() {
    if (this.subscription) await this.subscription.close();
    if (this.consumerClient) await this.consumerClient.close();
  }
}

module.exports = EventHubReader;
