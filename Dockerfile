# Multi-runtime Dockerfile for TikTok Live AI Studio (Node.js + Python 3)
FROM node:20-bookworm-slim

# Install system dependencies: Python 3, pip, audio libraries & ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python-is-python3 \
    libasound2 \
    libasound2-plugins \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first for caching
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Install Node.js dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files
COPY . .

# Environment configuration for Render & headless Python audio
ENV NODE_ENV=production \
    PORT=3000 \
    SDL_AUDIODRIVER=dummy \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8

EXPOSE 3000

CMD ["npm", "start"]
