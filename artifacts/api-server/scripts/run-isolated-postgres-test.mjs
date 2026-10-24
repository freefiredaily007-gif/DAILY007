import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}.`);
  }
  return result;
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not allocate a local PostgreSQL port.');
  }
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

const bundlePath = process.argv[2];
if (!bundlePath) throw new Error('Pass the bundled PostgreSQL integration test path.');

const fixturesDirectory = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));
const schemaName = process.argv[3] ?? 'daily007-tournament-results-concurrency.sql';
if (path.basename(schemaName) !== schemaName || !schemaName.endsWith('.sql')) {
  throw new Error('Pass a SQL fixture filename from tests/fixtures.');
}
const schemaPath = path.join(fixturesDirectory, schemaName);
const directory = await mkdtemp(path.join(os.tmpdir(), 'daily007-isolated-postgres-'));
const dataDirectory = path.join(directory, 'data');
const logPath = path.join(directory, 'postgres.log');
let serverStarted = false;
let exitCode = 1;

try {
  const port = await availablePort();
  run('initdb', [
    '--no-locale',
    '--encoding=UTF8',
    '--auth-local=trust',
    '--auth-host=trust',
    '--username=postgres',
    '--pgdata',
    dataDirectory,
  ]);
  run('pg_ctl', [
    '-D', dataDirectory,
    '-l', logPath,
    '-o', `-h 127.0.0.1 -p ${port} -F -c unix_socket_directories=${directory}`,
    '-w', 'start',
  ]);
  serverStarted = true;

  run('psql', [
    '-h', '127.0.0.1',
    '-p', String(port),
    '-U', 'postgres',
    '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1',
    '-f', schemaPath,
  ]);

  const testProcess = spawnSync(
    process.execPath,
    [
      '--test',
      bundlePath,
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: `postgres://postgres@127.0.0.1:${port}/postgres`,
        DAILY007_ISOLATED_POSTGRES_TEST: '1',
        DAILY007_TEST_POSTGRES_PORT: String(port),
        NODE_ENV: 'production',
      },
    },
  );
  if (testProcess.error) throw testProcess.error;
  exitCode = testProcess.status ?? 1;
} catch (error) {
  try {
    const log = await readFile(logPath, 'utf8');
    if (log) process.stderr.write(`Isolated PostgreSQL startup log:\n${log}`);
  } catch {
    // initdb may fail before creating a PostgreSQL log.
  }
  throw error;
} finally {
  if (serverStarted) {
    run('pg_ctl', ['-D', dataDirectory, '-m', 'fast', '-w', 'stop']);
  }
  await rm(directory, { recursive: true, force: true });
}

process.exitCode = exitCode;