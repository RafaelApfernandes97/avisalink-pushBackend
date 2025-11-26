# ============================================
# Backend Production Dockerfile
# Multi-stage build for optimized image size
# ============================================

FROM node:18-alpine AS base

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# ============================================
# Production Stage
# ============================================
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy package.json for reference
COPY package*.json ./

# Copy node_modules from base stage
COPY --from=base /app/node_modules ./node_modules

# Copy application source
COPY src ./src

# Create logs directory
RUN mkdir -p logs && chmod 755 logs

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start the server
CMD ["node", "src/server.js"]
