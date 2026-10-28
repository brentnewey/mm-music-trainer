import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const DEFAULT_EXE = 'C:/Program Files (x86)/Steam/steamapps/common/Suzy/Proteus.exe';

/**
 * Serves the local Legacy Collection executable at /proteus.exe during dev,
 * so the app can load it without a file picker. Override with MMLC_EXE.
 */
function localProteus(): Plugin {
  const exePath = process.env.MMLC_EXE ?? DEFAULT_EXE;
  return {
    name: 'local-proteus',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/proteus.exe', (_req, res) => {
        if (!fs.existsSync(exePath)) {
          res.statusCode = 404;
          res.end(`Not found: ${exePath}`);
          return;
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        fs.createReadStream(exePath).pipe(res);
      });
    },
  };
}

/**
 * Persists app data (track names, track edits, score records) to JSON files in the project,
 * so it survives clearing browser data or changing ports.
 */
function projectDataFiles(): Plugin {
  const allowed = new Set(['track-names', 'track-edits', 'scores']);
  return {
    name: 'project-data-files',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/data', (req, res) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0];
        if (!allowed.has(name)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const file = path.resolve(`${name}.json`);
        if (req.method === 'PUT') {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
              fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
              res.statusCode = 204;
            } catch {
              res.statusCode = 400;
            }
            res.end();
          });
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(fs.existsSync(file) ? fs.readFileSync(file) : '{}');
      });
    },
  };
}

export default defineConfig({
  plugins: [localProteus(), projectDataFiles()],
});
