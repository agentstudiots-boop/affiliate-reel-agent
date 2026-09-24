const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Execute the actual handler source. Only its explicit I/O dependencies are
// replaced; repositories, validation, claims and transitions remain real.
module.exports = function loadRoute(file, overrides = {}) {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  });
  const route = { exports: {} };
  const resolve = name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith('@/')) return require(path.resolve('.test-build', name.slice(2)));
    return require(name);
  };
  new Function('require', 'exports', 'module', outputText)(resolve, route.exports, route);
  return route.exports;
};
