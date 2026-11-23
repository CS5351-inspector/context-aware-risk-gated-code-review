const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const args = process.argv.slice(2);
function option(name, fallback) {
  const inline = args.find(arg => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}
const host = option('host', '127.0.0.1');
const port = Number(option('port', process.env.PORT || '7100'));
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid preview port');
const appRoot = __dirname;
const docsRoot = path.resolve(appRoot, '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon' };

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidates = [path.resolve(appRoot, relative), path.resolve(docsRoot, relative)];
  const file = candidates.find(candidate => (candidate.startsWith(appRoot + path.sep) || candidate.startsWith(docsRoot + path.sep))
    && fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  fs.createReadStream(file).pipe(response);
});
server.listen(port, host, () => console.log(`Inspector Report Explorer: http://${host}:${port}/`));
