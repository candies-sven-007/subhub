FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
VOLUME /data
EXPOSE 8787
CMD ["node", "server/index.js"]
