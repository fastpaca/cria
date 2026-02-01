# Summary with Redis

Progressive conversation summarization with Redis-backed cache.

## Prerequisites

Start Redis locally:

```bash
docker run -p 6379:6379 redis
```

## Run

```bash
pnpm install
pnpm start
```

The summary is cached in Redis. Run multiple times to see cached summaries reused.
