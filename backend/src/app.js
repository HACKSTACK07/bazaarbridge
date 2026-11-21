const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const apiRoutes = require('./api/routes');
const { checkConnection } = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

// Health check endpoint with DB connectivity status
app.get('/health', async (req, res) => {
  const dbStatus = await checkConnection();
  res.json({
    status: 'ok',
    service: 'bazaarbridge-backend',
    timestamp: new Date().toISOString(),
    database: dbStatus
  });
});

app.get('/api/health', async (req, res) => {
  const dbStatus = await checkConnection();
  res.json({
    status: 'ok',
    service: 'bazaarbridge-backend',
    timestamp: new Date().toISOString(),
    database: dbStatus
  });
});

// Authoritative API routes under /api
app.use('/api', apiRoutes);

// 404 for unhandled API requests
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Cannot ${req.method} ${req.path}`
  });
});

// Serve frontend static build files (Unified single host)
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  // Fallback 404 handler if frontend dist not yet built
  app.use((req, res) => {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`
    });
  });
}

// Standardized error handler per api-contract.md: {"error": "CODE", "message": "..."}
app.use((err, req, res, next) => {
  console.error('Unhandled API Error:', err);

  const status = err.status || err.statusCode || 500;
  const errorCode = err.code || err.name || 'INTERNAL_ERROR';
  const message = err.message || 'An unexpected error occurred';

  res.status(status).json({
    error: errorCode,
    message
  });
});

module.exports = app;
