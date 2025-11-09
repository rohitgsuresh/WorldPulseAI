# ---------- Stage 1: build the React app with Vite 5 ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy only package manifests first
COPY package.json package-lock.json ./

# Install EXACT versions from lockfile
RUN npm ci

# Copy the rest of the source code
COPY . .

# Build the static production bundle
RUN npm run build

# ---------- Stage 2: serve with nginx on port 8080 ----------
FROM nginx:alpine AS runner

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Minimal nginx config for single-page app + listen on 8080
RUN printf 'server {\n\
    listen 8080;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    location / {\n\
        try_files $uri /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
