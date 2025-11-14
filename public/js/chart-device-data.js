/* eslint-disable max-classes-per-file */
/* eslint-disable no-restricted-globals */
/* eslint-disable no-undef */
$(document).ready(() => {
  const protocol = document.location.protocol.startsWith('https') ? 'wss://' : 'ws://';
  const webSocket = new WebSocket(protocol + location.host);

  class MultiDroneData {
    constructor(maxLen = 50) {
      this.maxLen = maxLen;
      this.labels = [];
      this.datasetsMap = new Map();
      this.colorPalette = [
        'rgba(230, 25, 75, 1)',
        'rgba(60, 180, 75, 1)',
        'rgba(0, 130, 200, 1)',
        'rgba(245, 130, 48, 1)',
        'rgba(145, 30, 180, 1)'
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
      this.labels.push(isoTimestamp);
      this.datasetsMap.forEach(ds => ds.data.push(null));
      const ds = this.ensureDataset(droneId);
      if (ds) ds.data[ds.data.length - 1] = speed;
      if (this.labels.length > this.maxLen) {
        this.labels.shift();
        this.datasetsMap.forEach(ds2 => ds2.data.shift());
      }
    }
    getDatasets() {
      return Array.from(this.datasetsMap.values());
    }
  }

  function normalizeMessage(msg) {
    let droneId = msg.droneId || msg.deviceId || msg.DeviceId;
    let timestamp = msg.timestamp || msg.MessageDate || msg.EnqueuedTimeUtc || msg.enqueuedTimeUtc;
    let speed;
    if (msg.velocity && typeof msg.velocity.speed_mps !== 'undefined') {
      speed = msg.velocity.speed_mps;
    } else if (msg.IotData) {
      const d = msg.IotData;
      if (d.velocity && typeof d.velocity.speed_mps !== 'undefined') speed = d.velocity.speed_mps;
      else if (typeof d.speed_mps !== 'undefined') speed = d.speed_mps;
      else if (typeof d.speed !== 'undefined') speed = d.speed;
    }
    if (!droneId || !timestamp || typeof speed === 'undefined' || speed === null) return undefined;
    const speedNum = Number(speed);
    if (Number.isNaN(speedNum)) return undefined;
    return { droneId, timestamp, speed: speedNum };
  }

  const multiData = new MultiDroneData(50);

  const chartData = {
    labels: multiData.labels,
    datasets: multiData.getDatasets()
  };

  const chartOptions = {
    responsive: true,
    animation: false,
    maintainAspectRatio: false,
    scales: {
      yAxes: [{
        id: 'Speed',
        type: 'linear',
        ticks: {
          beginAtZero: true,
          min: 0,
          max: 300,
          stepSize: 20
        },
        scaleLabel: { labelString: 'Speed (m/s)', display: true },
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
        scaleLabel: { labelString: 'Timestamp (UTC)', display: true }
      }]
    },
    tooltips: { mode: 'nearest', intersect: false },
    elements: { line: { tension: 0 } }
  };

  const canvas = document.getElementById('iotChart');
  if (!canvas) {
    console.error('No se encontró el canvas #iotChart en el DOM');
    return;
  }
  const ctx = canvas.getContext('2d');
  const myLineChart = new Chart(ctx, { type: 'line', data: chartData, options: chartOptions });

  webSocket.onopen = () => console.log('WS abierto');
  webSocket.onerror = (e) => console.error('WS error', e);
  webSocket.onclose = () => console.warn('WS cerrado');

  webSocket.onmessage = function onMessage(message) {
    try {
      const msg = JSON.parse(message.data);
      const normalized = normalizeMessage(msg);
      if (!normalized) {
        console.debug('Mensaje ignorado (sin speed/droneId/timestamp):', msg);
        return;
      }
      const { droneId, timestamp, speed } = normalized;
      multiData.pushSample(timestamp, droneId, speed);
      myLineChart.data.labels = multiData.labels;
      myLineChart.data.datasets = multiData.getDatasets();
      myLineChart.update();
    } catch (err) {
      console.error('Error procesando mensaje WS:', err);
    }
  };
});
