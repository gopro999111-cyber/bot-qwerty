FROM mcr.microsoft.com/playwright:1.58.1-bullseye

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "monitor.js"]