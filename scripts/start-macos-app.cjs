const {spawnSync} = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

if (process.platform !== 'darwin') {
  const electron = path.join(root, 'node_modules/.bin/electron');
  const result = spawnSync(electron, [root], {stdio: 'inherit'});
  process.exit(result.status ?? 1);
}

const ensure = spawnSync(process.execPath, [path.join(__dirname, 'ensure-macos-app.cjs')], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

if (ensure.status !== 0) {
  process.exit(ensure.status ?? 1);
}

const appPath = ensure.stdout.trim().split(/\r?\n/).at(-1);
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync('/usr/bin/open', ['-na', appPath, '--args', root], {
  env,
  stdio: 'inherit',
});

process.exit(result.status ?? 0);
