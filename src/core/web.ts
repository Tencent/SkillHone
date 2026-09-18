import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Catalog } from './catalog.js'

const assets = fileURLToPath(new URL('../web/', import.meta.url))
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }

function json(value: unknown): Buffer { return Buffer.from(JSON.stringify(value)) }

interface WebResponse { status: number; body: Buffer; contentType: string }

function response(status: number, body: Buffer, contentType = 'application/json'): WebResponse {
  return { status, body, contentType }
}

function send(target: ServerResponse, result: WebResponse): void {
  target.writeHead(result.status, {
    'Content-Type': `${result.contentType}; charset=utf-8`, 'Content-Length': result.body.length,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'",
  })
  target.end(result.body)
}

function collectionResponse(catalog: Catalog, path: string): WebResponse | undefined {
  const collections: Record<string, () => unknown> = {
    '/api/dashboard': () => catalog.dashboard(),
    '/api/skills': () => catalog.listSkills(),
    '/api/issues': () => catalog.dashboard().issues,
    '/api/pull-requests': () => catalog.dashboard().pull_requests,
    '/api/wiki': () => catalog.dashboard().wiki,
  }
  const load = collections[path]
  return load ? response(200, json(load())) : undefined
}

function skillResponse(catalog: Catalog, request: IncomingMessage, parts: string[]): WebResponse | undefined {
  if (parts[0] !== 'api' || parts[1] !== 'skills') return undefined
  const skill = parts[2] ?? ''
  if (parts.length === 3) return response(200, json(catalog.skill(skill, false, true)))
  if (parts.length === 6 && parts[3] === 'pull-requests' && parts[5] === 'merge') {
    if (request.method !== 'POST') return response(405, json({ error: 'merge requires POST' }))
    if (request.headers['x-skillhone-confirm'] !== 'merge') return response(403, json({ error: 'explicit merge confirmation is required' }))
    return response(200, json(catalog.mergePr(
      skill,
      Number(parts[4] ?? ''),
      request.headers['x-skillhone-sync'] === 'apply',
    )))
  }
  if (parts.length === 4 && parts[3] === 'sync') {
    if (request.method !== 'POST') return response(405, json({ error: 'sync requires POST' }))
    if (request.headers['x-skillhone-confirm'] !== 'sync') return response(403, json({ error: 'explicit sync confirmation is required' }))
    return response(200, json(catalog.applyToOriginsForWeb(skill)))
  }
  if (parts.length !== 5) return undefined
  const kind = parts[3] ?? '', reference = parts[4] ?? ''
  const detail: Record<string, () => unknown> = {
    issues: () => catalog.issueDetail(skill, Number(reference)),
    'pull-requests': () => catalog.prDetail(skill, Number(reference)),
    wiki: () => catalog.wikiDetail(skill, reference),
  }
  const load = detail[kind]
  return load ? response(200, json(load())) : undefined
}

function assetResponse(path: string): WebResponse {
  const asset = path === '/' || path === '/index.html' ? 'index.html' : path.replace(/^\/assets\//, '')
  if (!['index.html', 'app.js', 'styles.css'].includes(asset)) return response(404, Buffer.from('not found'), 'text/plain')
  return response(200, readFileSync(join(assets, asset)), mime[extname(asset)] ?? 'application/octet-stream')
}

function handleRequest(catalog: Catalog, host: string, request: IncomingMessage, target: ServerResponse): void {
  try {
    const path = new URL(request.url ?? '/', `http://${host}`).pathname
    const result = collectionResponse(catalog, path)
      ?? skillResponse(catalog, request, path.split('/').filter(Boolean).map(decodeURIComponent))
      ?? assetResponse(path)
    send(target, result)
  } catch (error) {
    send(target, response(404, json({ error: error instanceof Error ? error.message : String(error) })))
  }
}

export function makeServer(catalog: Catalog, host = '127.0.0.1', port = 8790): Server {
  const server = createServer((request, response) => handleRequest(catalog, host, request, response))
  server.listen(port, host)
  return server
}

function openBrowser(url: string): void {
  let executable: string
  let args: string[]
  if (process.platform === 'darwin') { executable = 'open'; args = [url] }
  else if (process.platform === 'win32') { executable = 'cmd'; args = ['/c', 'start', '', url] }
  else { executable = 'xdg-open'; args = [url] }
  const child = spawn(executable, args, { detached: true, stdio: 'ignore' })
  child.unref()
}

export async function serve(catalog: Catalog, host = '127.0.0.1', port = 8790, open = false): Promise<void> {
  const server = makeServer(catalog, host, port)
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => {
      const address = server.address()
      const actual = address && typeof address === 'object' ? address.port : port
      const url = `http://${host}:${actual}`
      console.log(`SkillHone: ${url}`)
      if (open) openBrowser(url)
    })
    server.once('error', reject)
    const stop = (): void => { server.close(() => resolve()) }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}
