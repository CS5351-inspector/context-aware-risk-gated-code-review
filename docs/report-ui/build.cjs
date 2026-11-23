const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'report-data.js', 'report-parser.js', 'favicon.ico']) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}
fs.copyFileSync(path.join(root, '..', 'SPRINT2_REPORT_EXAMPLES.md'), path.join(dist, 'SPRINT2_REPORT_EXAMPLES.md'));
fs.cpSync(path.join(root, '..', 'report-examples'), path.join(dist, 'report-examples'), { recursive: true });
console.log('Built static report explorer to dist/');
