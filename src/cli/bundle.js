'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Tiny CommonJS bundler: resolves relative requires recursively and
// wraps each module so the shared core runs unchanged in the browser.

function resolveModule(request, fromFile) {
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`cannot resolve ${request} from ${fromFile}`);
}

function collect(entryFile, seen = new Map()) {
  const normalized = path.normalize(entryFile);
  if (seen.has(normalized)) return seen;
  const source = fs.readFileSync(normalized, 'utf8');
  const requires = [];
  const requirePattern = /require\(\s*'([^']+)'\s*\)/g;
  let match;
  while ((match = requirePattern.exec(source)) !== null) {
    if (match[1].startsWith('.')) {
      requires.push({ request: match[1], resolved: resolveModule(match[1], normalized) });
    }
  }
  seen.set(normalized, { source, requires });
  for (const dependency of requires) collect(dependency.resolved, seen);
  return seen;
}

function bundle(entryFile) {
  const modules = collect(path.resolve(entryFile));
  const lines = [
    '(function (root) {',
    '  const cache = {};',
    '  function load(id) {',
    '    if (cache[id]) return cache[id].exports;',
    '    const module = { exports: {} };',
    '    cache[id] = module;',
    '    modules[id].call(module.exports, module, module.exports,',
    '      (req) => mapRequire(id, req));',
    '    return module.exports;',
    '  }',
    '  function mapRequire(id, req) {',
    '    const dep = moduleMap[id][req];',
    '    if (!dep) return require(req);',
    '    return load(dep);',
    '  }',
    '  const moduleMap = {',
  ];
  const moduleMap = {};
  for (const [id, { requires }] of modules) {
    moduleMap[id] = {};
    lines.push(`    ${JSON.stringify(id)}: {`);
    for (const { request, resolved } of requires) {
      moduleMap[id][request] = resolved;
      lines.push(`      ${JSON.stringify(request)}: ${JSON.stringify(resolved)},`);
    }
    lines.push('    },');
  }
  lines.push('  };');
  lines.push('  const modules = {');
  for (const [id, { source }] of modules) {
    lines.push(`    ${JSON.stringify(id)}: function (module, exports, require) {`);
    lines.push(source);
    lines.push('    },');
  }
  lines.push('  };');
  lines.push(`  root.SyncCore = load(${JSON.stringify(path.resolve(entryFile))});`);
  lines.push('})(typeof window !== "undefined" ? window : globalThis);');
  return lines.join('\n');
}

if (require.main === module) {
  const entry = process.argv[2] || path.join('src', 'core', 'index.js');
  const out = process.argv[3] || path.join('web', 'sync-core.bundle.js');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, bundle(entry));
  console.log(`bundled ${entry} -> ${out}`);
}

module.exports = { bundle };
