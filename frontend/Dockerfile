FROM node:20-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
