#!/bin/sh

# Build deno command with appropriate TLS handling
DENO_ARGS="--allow-net --allow-read --allow-write --allow-env --allow-run"

if [ -n "$CA_CERT" ] && [ -f "$CA_CERT" ]; then
    echo "Using CA certificate: $CA_CERT"
    DENO_ARGS="--cert=$CA_CERT $DENO_ARGS"
else
    echo "No CA certificate provided, skipping TLS verification"
    DENO_ARGS="--unsafely-ignore-certificate-errors $DENO_ARGS"
fi

exec deno run $DENO_ARGS src/main.ts
