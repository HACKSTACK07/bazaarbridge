# Backend Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY src ./src

# Expose port
EXPOSE 11597

# Start server
CMD ["node", "src/api/index.js"]