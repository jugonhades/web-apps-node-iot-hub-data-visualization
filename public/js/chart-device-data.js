/* eslint-disable max-classes-per-file */
/* eslint-disable no-restricted-globals */
/* eslint-disable no-undef */
$(document).ready(() => {
  // Selecciona wss:// en HTTPS
  const protocol = document.location.protocol.startsWith('https') ? 'wss://' : 'ws://';
  const webSocket = new WebSocket(protocol + location.host);

  // Verificación defensiva de Moment para escala 'time' de Chart.js v2
  if (typeof moment === 'undefined') {
    console.error('Moment.js no está cargado: la escala temporal de Chart.js 2.x lo requiere.');
  }

  // Clase para mantener una ventana deslizante y datasets por dron
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
          console.warn('Máximo de drones alcanzado, ignorando:', droneId);
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
      // Nueva etiqueta temporal
      this.labels.push(isoTimestamp);

      // Alinea todos los datasets existentes con la nueva etiqueta
      this.datasetsMap.forEach(ds => ds.data.push(null));

      // Registra la velocidad del dron en el último índice
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

  // Normaliza mensajes de dos esquemas posibles:
  // 1) Nuevo: { droneId, timestamp, velocity:{ speed_mps } }
  // 2) Sample original: { DeviceId, MessageDate, IotData:{ ... (opcional speed) } }
  function normalizeMessage(msg) {
    // Preferencia: nuevo esquema
    let droneId = msg.droneId || msg.deviceId || msg.DeviceId;
    let timestamp = msg.timestamp || msg.MessageDate || msg.EnqueuedTimeUtc || msg.enqueuedTimeUtc;
    let speed = undefined;

    if (msg.velocity && typeof msg.velocity.speed_mps !== 'undefined') {
      speed = msg.velocity.speed_mps;
    } else if (msg.IotData) {
      const d = msg.IotData;
      if (d.velocity && typeof d.velocity.speed_mps !== 'undefined') speed = d.velocity.speed_mps;
      else if (typeof d.speed_mps !== 'undefined') speed = d.speed_mps;
      else if (typeof d.speed !== 'undefined') speed = d.speed;
    }

    // Devuelve undefined si falta lo esencial
    if (!droneId || !timestamp || typeof speed === 'undefined' || speed === null) return undefined;

    // Asegura número
    const speedNum = Number(speed);
    if (Number.isNaN(speedNum)) return undefined;

    return { droneId, timestamp, speed: speedNum };
  }

  const multiData = new MultiDroneData(50);

  // Datos y opciones del chart (Chart.js v2)
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
        scaleLabel: { labelString: 'Speed (m/s)', display: true },
        position: 'left'
      }],
      xAxes: [{
        type: 'time',
        distribution: 'series',
        time: {
          parser: true, // Delega parseo a Moment con ISO 8601
          tooltipFormat: 'YYYY-MM-DD HH:mm:ss',
          displayFormats: {
            millisecond: 'HH:mm:ss',
            second: 'HH:mm:ss',
            minute: 'HH:mm',
            hour: 'HH:mm'
          }
        },
        scaleLabel: { labelString: 'Timestamp (UTC)', display: true }
      }]
    },
    tooltips: { mode: 'nearest', intersect: false },
    elements: { line: { tension: 0 } }
  };

  // Contexto del canvas y creación del gráfico
  const canvas = document.getElementById('iotChart');
  if (!canvas) {
    console.error('No se encontró el canvas #iotChart en el DOM');
    return;
  }
  const ctx = canvas.getContext('2d');
  const myLineChart = new Chart(ctx, { type: 'line', data: chartData, options: chartOptions });

  // WebSocket
  webSocket.onopen = () => console.log('WS abierto');
  webSocket.onerror = (e) => console.error('WS error', e);
  webSocket.onclose = () => console.warn('WS cerrado');

  webSocket.onmessage = function onMessage(message) {
    try {
      const msg = JSON.parse(message.data);
      const normalized = normalizeMessage(msg);

      if (!normalized) {
        // Visibiliza por qué no se grafica cuando llega telemetría de otro esquema
        console.debug('Mensaje ignorado (sin speed/droneId/timestamp):', msg);
        return;
      }

      const { droneId, timestamp, speed } = normalized;

      // Registrar y actualizar
      multiData.pushSample(timestamp, droneId, speed);
      myLineChart.data.labels = multiData.labels;
      myLineChart.data.datasets = multiData.getDatasets();
      myLineChart.update();
    } catch (err) {
      console.error('Error procesando mensaje WS:', err);
    }
  };
});
