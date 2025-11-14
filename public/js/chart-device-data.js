/* eslint-disable max-classes-per-file */
/* eslint-disable no-restricted-globals */
/* eslint-disable no-undef */
$(document).ready(() => {
  // if deployed to a site supporting SSL, use wss://
  const protocol = document.location.protocol.startsWith('https') ? 'wss://' : 'ws://';
  const webSocket = new WebSocket(protocol + location.host);

  // Clase para un dispositivo/dron: mantiene últimos N puntos (tiempo/velocidad)
  class DeviceData {
    constructor(deviceId) {
      this.deviceId = deviceId;
      this.maxLen = 50;
      this.timeData = [];
      this.speedData = [];
    }

    addData(time, speed) {
      this.timeData.push(time);
      this.speedData.push(speed);

      if (this.timeData.length > this.maxLen) {
        this.timeData.shift();
        this.speedData.shift();
      }
    }
  }

  // Lista de dispositivos rastreados (igual que en el sample)
  class TrackedDevices {
    constructor() {
      this.devices = [];
    }

    findDevice(deviceId) {
      for (let i = 0; i < this.devices.length; ++i) {
        if (this.devices[i].deviceId === deviceId) {
          return this.devices[i];
        }
      }
      return undefined;
    }

    getDevicesCount() {
      return this.devices.length;
    }
  }

  const trackedDevices = new TrackedDevices();

  // Paleta para hasta 5 drones
  const colorPalette = [
    'rgba(230, 25, 75, 1)',
    'rgba(60, 180, 75, 1)',
    'rgba(0, 130, 200, 1)',
    'rgba(245, 130, 48, 1)',
    'rgba(145, 30, 180, 1)'
  ];

  // Datos del chart: un dataset por dispositivo lógico (dron)
  const chartData = {
    labels: [],
    datasets: []
  };

  const chartOptions = {
    responsive: true,
    animation: false,
    maintainAspectRatio: false, // tamaño lo controla el CSS del contenedor
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
          parser: true, // Moment parsea ISO 8601
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

  // Canvas y chart
  const canvas = document.getElementById('iotChart');
  const ctx = canvas.getContext('2d');
  const myLineChart = new Chart(ctx, {
    type: 'line',
    data: chartData,
    options: chartOptions
  });

  // Elementos UI (como en el original)
  let needsAutoSelect = true;
  const deviceCount = document.getElementById('deviceCount');
  const listOfDevices = document.getElementById('listOfDevices');

  // Selección de dispositivo: resalta el dron seleccionado
  function OnSelectionChange() {
    if (listOfDevices.selectedIndex < 0) return;

    const selectedId = listOfDevices[listOfDevices.selectedIndex].text;

    chartData.datasets.forEach((ds) => {
      if (ds.label === selectedId) {
        ds.borderWidth = 3;
        ds.pointRadius = 2;
      } else {
        ds.borderWidth = 1;
        ds.pointRadius = 0;
      }
    });

    myLineChart.update();
  }
  listOfDevices.addEventListener('change', OnSelectionChange, false);

  // Construye/actualiza los datasets del chart a partir de trackedDevices
  function refreshDatasets() {
    chartData.datasets = trackedDevices.devices.slice(0, 5).map((device, index) => {
      const color = colorPalette[index % colorPalette.length];
      return {
        label: device.deviceId,
        fill: false,
        yAxisID: 'Speed',
        borderColor: color,
        backgroundColor: color.replace(', 1)', ', 0.2)'),
        pointRadius: 0,
        spanGaps: true,
        data: device.timeData.map((t, i) => ({
          x: t,
          y: device.speedData[i]
        }))
      };
    });
  }

  // Extrae velocidad y "device" lógico (dron) de los mensajes que llegan del backend:
  // - Sample original: { DeviceId, MessageDate, IotData: { droneId, timestamp, velocity:{speed_mps}, ... } }
  // - Variante directa: { droneId, timestamp, velocity:{speed_mps}, ... }
  function extractTelemetry(messageData) {
    // Clave de serie = droneId si está; si no, DeviceId del IoT Hub
    let deviceId =
      (messageData.IotData && messageData.IotData.droneId) ||
      messageData.droneId ||
      messageData.DeviceId ||
      messageData.deviceId;

    // Marca de tiempo: prioriza la del payload de dron
    let time =
      (messageData.IotData && messageData.IotData.timestamp) ||
      messageData.timestamp ||
      messageData.MessageDate;

    let speed;

    if (messageData.IotData) {
      const d = messageData.IotData;
      if (d.velocity && typeof d.velocity.speed_mps !== 'undefined') {
        speed = d.velocity.speed_mps;
      } else if (typeof d.speed_mps !== 'undefined') {
        speed = d.speed_mps;
      } else if (typeof d.speed !== 'undefined') {
        speed = d.speed;
      }
    } else if (messageData.velocity) {
      if (typeof messageData.velocity.speed_mps !== 'undefined') {
        speed = messageData.velocity.speed_mps;
      }
    }

    if (!deviceId || !time || typeof speed === 'undefined' || speed === null) {
      return undefined;
    }

    const speedNum = Number(speed);
    if (Number.isNaN(speedNum)) return undefined;

    return { deviceId, time, speed: speedNum };
  }

  // WebSocket: recibe mensajes del backend (Event Hub -> server.js) y actualiza la gráfica
  webSocket.onmessage = function onMessage(message) {
    try {
      const messageData = JSON.parse(message.data);
      console.log('WS message:', messageData);

      const telemetry = extractTelemetry(messageData);
      if (!telemetry) {
        // Mensaje sin info de velocidad/dron
        return;
      }

      const { deviceId, time, speed } = telemetry;

      // Buscar o crear DeviceData para ese dron
      let deviceData = trackedDevices.findDevice(deviceId);
      if (!deviceData) {
        deviceData = new DeviceData(deviceId);
        trackedDevices.devices.push(deviceData);

        const numDevices = trackedDevices.getDevicesCount();
        deviceCount.innerText = numDevices === 1 ? `${numDevices} device` : `${numDevices} devices`;

        // Añadir a la lista UI
        const node = document.createElement('option');
        node.appendChild(document.createTextNode(deviceId));
        listOfDevices.appendChild(node);

        if (needsAutoSelect) {
          needsAutoSelect = false;
          listOfDevices.selectedIndex = 0;
        }
      }

      // Añadir punto de telemetría
      deviceData.addData(time, speed);

      // Reconstruir datasets y actualizar chart
      refreshDatasets();
      OnSelectionChange(); // re-aplica resaltado según selección
    } catch (err) {
      console.error('Error al procesar mensaje WS:', err);
    }
  };
});
