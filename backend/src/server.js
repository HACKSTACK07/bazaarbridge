const app = require('./app');
const path = require('path');
const dotenv = require('dotenv');
const { startExpiryCleanup } = require('./api/expiry');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`BazaarBridge backend server running on port ${PORT}`);
  startExpiryCleanup();
});
