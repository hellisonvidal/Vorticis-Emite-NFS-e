// Gera o pacote web do app Android em mobile/www (frontend + núcleo + sql.js num único bundle).
// Uso: node mobile/build.js
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(dir, '..');
const www = path.join(dir, 'www');
const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(path.join(www, 'vendor', 'chart.js'), { recursive: true });
fs.cpSync(path.join(raiz, 'public', 'css'), path.join(www, 'css'), { recursive: true });
fs.cpSync(path.join(raiz, 'public', 'img'), path.join(www, 'img'), { recursive: true });
fs.copyFileSync(path.join(raiz, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js'), path.join(www, 'vendor', 'chart.js', 'chart.umd.min.js'));
for (const f of ['sql-wasm.wasm', 'sql-wasm-browser.wasm']) fs.copyFileSync(path.join(raiz, 'node_modules', 'sql.js', 'dist', f), path.join(www, f));

// Entrada: inicialização nativa primeiro, depois a interface
fs.writeFileSync(path.join(dir, 'src', 'entrada.js'), "import './main.js';\nimport '../../public/js/app.js';\n");

// Módulos de Node referenciados opcionalmente por bibliotecas (node-forge, sql.js) não existem no WebView
const semNode = {
  name: 'sem-node',
  setup(b) {
    b.onResolve({ filter: /^(crypto|fs|path|url|child_process|os|node:.*)$/ }, a => ({ path: a.path, namespace: 'vazio' }));
    b.onLoad({ filter: /.*/, namespace: 'vazio' }, () => ({ contents: 'export default {};', loader: 'js' }));
  },
};

await build({
  entryPoints: [path.join(dir, 'src', 'entrada.js')],
  outfile: path.join(www, 'app.bundle.js'),
  bundle: true, format: 'esm', platform: 'browser', target: ['chrome89'], minify: true, sourcemap: false,
  define: { __VERSAO__: JSON.stringify(pkg.version), 'process.env.NODE_ENV': '"production"' },
  plugins: [semNode], legalComments: 'none', logLevel: 'warning',
});

const html = fs.readFileSync(path.join(raiz, 'public', 'index.html'), 'utf8')
  .replace('<script type="module" src="/js/app.js"></script>', '<script type="module" src="/app.bundle.js"></script>')
  .replace('<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
fs.writeFileSync(path.join(www, 'index.html'), html);
const kb = Math.round(fs.statSync(path.join(www, 'app.bundle.js')).size / 1024);
console.log(`mobile/www gerado (bundle ${kb} KB, versão ${pkg.version}).`);
