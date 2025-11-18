# Lightweight production image for the backend
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package manifests first to leverage Docker cache
COPY package*.json ./
COPY package-lock*.json ./

# Install dependencies: prefer package-lock (npm ci) when present, otherwise npm install
RUN if [ -f package-lock.json ]; then \
      npm ci --only=production --silent; \
    else \
      npm install --production --silent; \
    fi

# Copy application source
COPY . .

# Create and use a non-root user for improved security
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /usr/src/app
USER app

ENV NODE_ENV=production

# Expose a default port. The app may use process.env.PORT at runtime.
EXPOSE 3000

# Start the server
CMD ["node", "src/server.js"]
