# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json and package-lock.json (if exists)
COPY package.json yarn.lock .yarnrc.yml ./

RUN corepack enable yarn

# Install dependencies
RUN yarn install

# Copy the rest of the application code
COPY . .

# Build the application
RUN yarn build

# Production stage
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Copy built assets from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json /app/yarn.lock /app/.yarnrc.yml ./

RUN corepack enable yarn

# Install only production dependencies
RUN yarn install

# Expose the port your app runs on
EXPOSE 3000

# Start the application
CMD ["yarn", "start"]
