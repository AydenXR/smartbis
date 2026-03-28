FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN apt-get update && apt-get install -y \
    chromium \
    git \
    openssh-client \
    ca-certificates \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*
RUN git config --global url."https://github.com/".insteadOf git@github.com:
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN npm install
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
