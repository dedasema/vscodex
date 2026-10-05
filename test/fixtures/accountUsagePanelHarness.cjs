'use strict';

const Module = require('node:module');
const path = require('node:path');
const { buildSync } = require('esbuild');

const repositoryRoot = path.resolve(__dirname, '../..');

function loadTypeScript(relativePath, vscodeStub) {
  const entryPoint = path.join(repositoryRoot, relativePath);
  const output = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    external: vscodeStub ? ['vscode'] : [],
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    write: false
  }).outputFiles[0].text;
  const bundlePath = path.join(repositoryRoot, `${path.basename(entryPoint, '.ts')}.test-bundle.cjs`);
  const bundle = new Module(bundlePath, module);
  bundle.filename = bundlePath;
  bundle.paths = Module._nodeModulePaths(repositoryRoot);
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    return request === 'vscode' && vscodeStub ? vscodeStub : originalLoad.call(this, request, parent, isMain);
  };
  try {
    bundle._compile(output, bundlePath);
    return bundle.exports;
  } finally {
    Module._load = originalLoad;
  }
}

module.exports = { loadTypeScript };
