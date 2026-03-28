FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install

COPY . .

ENV FRONTEND_PORT=4173

EXPOSE 4173

CMD ["node", "server.js"]
