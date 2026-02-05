FROM denoland/deno:alpine-2.1.4

WORKDIR /app

# Install zip utility
RUN apk add --no-cache zip

# Copy source files
COPY deno.json .
COPY src/ src/
COPY entrypoint.sh .

# Cache dependencies
RUN deno cache src/main.ts

# Run as the existing deno user (uid 1000)
USER deno

ENTRYPOINT ["/app/entrypoint.sh"]
