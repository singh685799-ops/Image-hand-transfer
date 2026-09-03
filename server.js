const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Increase JSON body size limit (images are sent as base64)
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory queue for pending transfers
let pendingTransfers = [];
const TTL_MS = 60 * 1000; // 60 seconds

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  pendingTransfers = pendingTransfers.filter(item => now - item.timestamp < TTL_MS);
}, 1000);

// POST /api/transfer – store an image payload
app.post('/api/transfer', (req, res) => {
  const { imageData } = req.body;
  if (!imageData || typeof imageData !== 'string') {
    return res.status(400).json({ error: 'Missing imageData (base64 string)' });
  }

  const transfer = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    imageData,
    timestamp: Date.now(),
    consumed: false,
  };
  pendingTransfers.push(transfer);
  console.log(`[${new Date().toISOString()}] Payload queued (id: ${transfer.id})`);
  res.status(201).json({ message: 'Payload stored', id: transfer.id });
});

// GET /api/receive – fetch and consume the latest unconsumed, non-expired payload
app.get('/api/receive', (req, res) => {
  const now = Date.now();
  // Remove expired items
  pendingTransfers = pendingTransfers.filter(item => now - item.timestamp < TTL_MS);

  // Find first unconsumed item
  const itemIndex = pendingTransfers.findIndex(item => !item.consumed);
  if (itemIndex === -1) {
    return res.status(404).json({ message: 'No pending payload' });
  }

  const item = pendingTransfers[itemIndex];
  item.consumed = true;
  console.log(`[${new Date().toISOString()}] Payload claimed (id: ${item.id})`);
  res.json({ imageData: item.imageData, id: item.id });
});

// Root route – serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
