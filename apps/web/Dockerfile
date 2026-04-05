FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY app ./app
COPY components ./components
COPY next.config.mjs ./
COPY postcss.config.cjs ./
COPY tailwind.config.ts ./
COPY tsconfig.json ./
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
