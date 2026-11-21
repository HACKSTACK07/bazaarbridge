const express = require('express');
const cors = require('cors');
const apiRoutes = require('./api/routes');

const app = express();

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'bazaarbridge-backend' });
});

// Authoritative API routes under /api
app.use('/api', apiRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Cannot ${req.method} ${req.path}`
  });
});

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
