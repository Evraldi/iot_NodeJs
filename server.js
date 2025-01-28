const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const { Telegraf } = require('telegraf');

const app = express();
const port = 3000;
const wsPort = 4000;

const bot = new Telegraf('7607016806:AAEbaA_eq7T_3MTorx3DR2dUSO-XN-xDNgI');

app.use(express.json());
app.use(cors());

mongoose.connect('mongodb://localhost:27017/sensorData', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.log('Error connecting to MongoDB:', err));

const sensorSchema = new mongoose.Schema({
  temperature: Number,
  humidity: Number,
  lightLevel: Number,
  timestamp: { type: Date, default: Date.now },
});

const Sensor = mongoose.model('Sensor', sensorSchema);

let lastUpdate = new Date();
let sensorStatus = 'inactive';

app.post('/update', async (req, res) => {
  try {
    const { temperature, humidity, lightLevel, status } = req.body;

    if (temperature < -50 || temperature > 100) {
      return res.status(400).json({ message: 'Temperature out of range' });
    }
    if (humidity < 0 || humidity > 100) {
      return res.status(400).json({ message: 'Humidity out of range' });
    }
    if (lightLevel < 0 || lightLevel > 1023) {
      return res.status(400).json({ message: 'Light level out of range' });
    }

    lastUpdate = new Date();
    sensorStatus = 'active';

    const newSensorData = new Sensor({ temperature, humidity, lightLevel });
    await newSensorData.save();

    broadcastData({
      temperature,
      humidity,
      lightLevel,
      timestamp: newSensorData.timestamp,
      sensorStatus,
      status,
    });

    if (temperature < 18 || temperature > 32) {
      sendTelegramNotification(
        `temperature lebih dari batas normal!\nTemperature: ${temperature}°C\nHumidity: ${humidity}%\nLight Level: ${lightLevel}`
      );
    }

    res.json({ message: 'Data updated successfully', sensorData: newSensorData });
  } catch (error) {
    res.status(500).json({ message: 'Error updating data', error });
  }
});

app.get('/history', async (req, res) => {
  try {
    const data = await Sensor.find().sort({ timestamp: 1 });
    if (!data || data.length === 0) {
      return res.status(404).json({ message: 'No historical data found' });
    }
    res.json({ history: data, sensorStatus });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching history', error });
  }
});

setInterval(() => {
  const now = new Date();
  if (now - lastUpdate > 15000) {
    if (sensorStatus !== 'inactive') {
      sensorStatus = 'inactive';
      console.log('Sensor marked as inactive');
      broadcastData({ sensorStatus });
    }
  }
}, 5000);

const server = http.createServer(app);
server.listen(port, () => console.log(`HTTP server running on http://localhost:${port}`));

const wss = new WebSocket.Server({ port: wsPort });

function broadcastData(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  Sensor.find().sort({ timestamp: 1 }).then(data => {
    if (data.length > 0) {
      ws.send(JSON.stringify({ history: data, sensorStatus }));
    } else {
      ws.send(JSON.stringify({ message: 'No historical data found', sensorStatus }));
    }
  }).catch(err => {
    console.error('Error retrieving historical data:', err);
    ws.send(JSON.stringify({ message: 'Error retrieving data', sensorStatus }));
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

console.log(`WebSocket server running on ws://localhost:${wsPort}`);

function sendTelegramNotification(message) {
  bot.telegram.sendMessage('5891074615', message);
}
