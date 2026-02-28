# Use Node 18 on Bullseye (Debian 11) which has modern GLIBC
FROM node:18-bullseye

# Set working directory
WORKDIR /app

# Install system dependencies for better-sqlite3 build
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Build the frontend
RUN npm run build

# Expose the application port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
