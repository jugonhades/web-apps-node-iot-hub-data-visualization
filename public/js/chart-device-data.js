/* eslint-disable max-classes-per-file */
/* eslint-disable no-restricted-globals */
/* eslint-disable no-undef */
$(document).ready(() => {
  // if deployed to a site supporting SSL, use wss://
  const protocol = document.location.protocol.startsWith('https') ? 'wss://' : 'ws://';
  const webSocket = new WebSocket(protocol + location.host);

  // Clase para mantener una ventana deslizante de tiempos y datasets por dron
  class MultiDroneData {
    constructor(maxLen = 50) {
      this.maxLen = maxLen;
      this.labels = [];
      this.datasetsMap = new Map();
      this.colorPalette = [
        'rgba(230, 25, 75, 1)',   // Rojo
        'rgba(60, 180, 75, 1)',   // Verde
        'rgba(0, 130, 200, 1)',   // Azul
        'rgba(245, 130, 48, 1)',  // Naranja
        'rgba(145, 30, 180, 1)'   // Morado
      ];
      this.maxDrones = 5;
    }

    ensureDataset(droneId) {
      if (!this.datasetsMap.has(droneId)) {
        if (this.datasetsMap.size >= this.maxDrones) {
          // Si llegan más de 5 drones, ignoramos los adicionales
          return null;
        }
        const color = this.colorPalette[this.datasetsMap.size % this.colorPalette.length];
        const ds = {
          label: droneId,
          fill: false,
          yAxisID: 'Speed',
          borderColor: color,
          backgroundColor: color.replace(', 1)', ', 0.2)'),
          pointRadius: 0,
          spanGaps: true,
          data: new Array(this.labels.length).fill(null)
        };
        this.datasetsMap.set(droneId, ds);
      }
      return this.datasetsMap.get(droneId);
    }

    pushSample(isoTimestamp, droneId, speed) {
      // Añadir etiqueta temporal
      this.labels.push(isoTimestamp);

      // Empujar null a todos los datasets existentes para alinear con la nueva etiqueta
      this.datasetsMap.forEach(ds => ds.data.push(null));

      // Asegurar dataset del dron y registrar su velocidad en el último índice
      const ds = this.ensureDataset(droneId);
      if (ds) {
        ds.data[ds.data.length - 1] = speed;
      }

      // Ventana deslizante
      if (this.labels.length > this.maxLen) {
        this.labels.shift();
        this.datasetsMap.forEach(ds => ds.data.shift());
      }
    }

    getDatasets() {
      return Array.from(this.datasetsMap.values());
    }
  }

  const multiData = new MultiDroneData(50);

  // Definir datos y opciones del chart (Chart.js v2-style)
  const chartData = {
    labels: multiData.labels,
    datasets: multiData.getDatasets()
  };

  const chartOptions = {
    animation: false,
    maintainAspectRatio: false,
    scales: {
      yAxes: [{
        id: 'Speed',
        type: 'linear',
        scaleLabel: {
          labelString: 'Speed (m/s)',
          display: true
        },
        position: 'left'
      }],
      xAxes: [{
        type: 'time',
        distribution: 'series',
        time: {
          parser: true,
          tooltipFormat: 'YYYY-MM-DD HH:mm:ss',
          displayFormats: {
            millisecond: 'HH:mm:ss',
            second: 'HH:mm:ss',
            minute: 'HH:mm',
            hour: 'HH:mm'
          }
        },
        scaleLabel: {
          labelString: 'Timestamp (UTC)',
          display: true
        }
      }]
    },
    tooltips: {
      mode: 'nearest',
      intersect: false
    },
    elements: {
      line: { tension: 0 }
    }
  };

  // Contexto del canvas
  const ctx = document.getElementById('iotChart').getContext('2d');
  const myLineChart = new Chart(ctx, {
    type: 'line',
    data: chartData,
    options: chartOptions
  });

  // WebSocket: parsea mensajes del simulador { droneId, timestamp, velocity.speed_mps, ... }
  webSocket.onmessage = function onMessage(message) {
    try {
      const msg = JSON.parse(message.data);

      // Validación básica para el nuevo esquema de telemetría
      const droneId = msg.droneId;
      const isoTimestamp = msg.timestamp; // ISO 8601
      const speed = msg?.velocity?.speed_mps;

      if (!droneId || !isoTimestamp || (speed === undefined || speed === null)) {
        // Mensaje no relevante para la gráfica de velocidad
        return;
      }

      // Registrar muestra
      multiData.pushSample(isoTimestamp, droneId, Number(speed));

      // Sincronizar chart con el buffer
      myLineChart.data.labels = multiData.labels;
      myLineChart.data.datasets = multiData.getDatasets();
      myLineChart.update();
    } catch (err) {
      console.error(err);
    }
  };
});
