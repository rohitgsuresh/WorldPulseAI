# ========== Stage 1: just copy static files ==========
FROM nginx:alpine

# Copy your static site (index.html, app.js, etc.) into Nginx's web root
COPY index.html /usr/share/nginx/html/index.html
COPY app.js /usr/share/nginx/html/app.js

# (Optional) if you have other assets like images, css, etc:
# COPY assets/ /usr/share/nginx/html/assets/

# Expose the port Cloud Run expects
EXPOSE 8080

# Nginx by default listens on 80, but Cloud Run wants 8080.
# We'll override nginx config so it listens on $PORT (which is 8080 in Cloud Run).
# Create a tiny nginx.conf inline here:
RUN printf 'server {\n\
    listen 8080;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    location / {\n\
        try_files $uri /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

CMD ["nginx", "-g", "daemon off;"]
