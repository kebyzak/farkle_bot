# --- Build Stage ---
FROM node:18-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# --- production Stage ---
FROM node:18-slim

WORKDIR /app

# Copy package.json and install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy compiled code from builder stage
COPY --from=builder /app/dist ./dist

# Command to run the bot
CMD ["npm", "start"]
