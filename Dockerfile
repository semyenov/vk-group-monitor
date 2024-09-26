# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json and package-lock.json (if exists)
COPY package.json yarn.lock .yarn* tsconfig.json ./

# Install dependencies
RUN corepack enable yarn
RUN yarn install

# Copy the rest of the application code
COPY ./src ./src
COPY ./public ./public

# Build the application
RUN yarn build

# Production stage
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Copy built assets from the builder stage
COPY --from=builder /app/package.json /app/yarn.lock /app/.yarn* ./

# Install only production dependencies
RUN corepack enable yarn
RUN yarn workspaces focus --production

# Copy public and dist directories from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Expose the port your app runs on
EXPOSE 3000

# Start the application
CMD ["yarn", "start"]
