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
  '.js': 'text/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.ico': 'image/x-icon' };

const routes = new Map([['/', path.join(appRoot, 'index.html')]]);
for (const file of ['index.html', 'styles.css', 'app.js', 'report-data.js', 'report-parser.js', 'favicon.ico']) {
  routes.set(`/${file}`, path.join(appRoot, file));
}
routes.set('/SPRINT2_REPORT_EXAMPLES.md', path.join(docsRoot, 'SPRINT2_REPORT_EXAMPLES.md'));
for (const name of ['normal', 'partial', 'failed', 'publication-failure']) {
  routes.set(`/report-examples/${name}.md`, path.join(docsRoot, 'report-examples', `${name}.md`));
}

function reply(response, status, message) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(message);
}

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('allow', 'GET, HEAD');
    reply(response, 405, 'Method not allowed');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    reply(response, 400, 'Invalid request target');
    return;
  }
  const file = routes.get(pathname);
  if (!file) {
    reply(response, 404, 'Not found');
    return;
  }

  fs.readFile(file, (error, contents) => {
    if (error) {
      if (error.code === 'ENOENT') reply(response, 404, 'Not found');
      else reply(response, 500, 'Could not read preview file');
      return;
    }
    response.writeHead(200, { 'content-type': types[path.extname(file)], 'content-length': contents.length,
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : contents);
  });
});
server.listen(port, host, () => console.log(`Inspector Report Explorer: http://${host}:${port}/`));
