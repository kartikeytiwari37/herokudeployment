FROM node:18-alpine@sha256:02376a266c84acbf45bd19440e08e48b1c8b98037417334046029ab585de03e2
 
WORKDIR /app
 
# Install dependencies
COPY package*.json ./
RUN npm ci
 
# Copy source code
COPY . .
 
# Build TypeScript code
RUN npm run build
 
# Expose the port
EXPOSE 8081
 
# Set environment variables
ENV NODE_ENV=production
 
# Start the server
CMD ["node", "dist/server.js"]