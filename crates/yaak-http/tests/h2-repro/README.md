# HTTP/2 Reproduction Server

Minimal Vite dev server with HTTPS enabled (HTTP/2) for reproducing
the "HTTP/1 specific headers are forbidden" bug.

## Setup

```
npm install
npm run dev
```

Then send a GET request to https://localhost:5173/ from Yaak with
certificate validation disabled.
