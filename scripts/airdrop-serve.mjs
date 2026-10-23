#!/usr/bin/env node
/**
 * Serves the refund airdrop page on http://localhost:5555 (only on this computer). Open it in the browser where
 * your wallet extension lives; the page sends refunds-out/airdrop.json through that wallet, which signs every
 * payment. Nothing here holds a key. Stop with Ctrl+C.
 *
 *   node scripts/airdrop-serve.mjs
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'

const PORT = 5555
const page = new URL('./airdrop/index.html', import.meta.url)
const list = 'refunds-out/airdrop.json'

createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  if (path === '/' || path === '/index.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(readFileSync(page))
  } else if (path === '/airdrop.json' && existsSync(list)) {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(readFileSync(list))
  } else {
    response.writeHead(404)
    response.end('not found')
  }
}).listen(PORT, '127.0.0.1', () =>
  console.log(`refund airdrop page: http://localhost:${PORT}  (Ctrl+C to stop)`),
)
