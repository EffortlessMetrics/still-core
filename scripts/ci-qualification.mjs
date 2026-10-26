import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checkoutRoot = fileURLToPath(new URL('../', import.meta.url));
const still = '@effortlessmetrics/still';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = value => {
  assert.match(value ?? '', /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, 'Expected a full Git object ID');
  return value;
};
const required = (env, name) => {
  assert(env[name], `${name} is required`);
  return env[name];
};
function checkout(root) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  return {
    commit: sha(git(['rev-parse', 'HEAD'])),
    tree: sha(git(['rev-parse', 'HEAD^{tree}'])),
    dirty: git(['status', '--porcelain=v1', '--untracked-files=all']).length > 0,
  };
}

// This records identity after the workflow's successful checks. It does not run
// those checks or establish qualification when invoked independently of CI.
export async function writeQualification({ delivery, root = checkoutRoot, env = process.env }) {
  const source = checkout(root);
  assert(!source.dirty, 'CI qualification requires a clean checkout; dirty source is not exact committed-tree proof');
  const eventName = required(env, 'GITHUB_EVENT_NAME');
  assert(['pull_request', 'push'].includes(eventName), 'Only PR-head and main-push qualification is supported');
  const event = JSON.parse(await readFile(required(env, 'GITHUB_EVENT_PATH'), 'utf8'));
  const repository = required(env, 'GITHUB_REPOSITORY');
  assert.equal(repository, 'EffortlessMetrics/still-core');
  assert.equal(event.repository.full_name, repository, 'Event repository must match the workflow repository');
  const eventCandidate = { commit: sha(required(env, 'GITHUB_SHA')), ref: required(env, 'GITHUB_REF') };
  let pullRequest = null;
  let subject;
  if (eventName === 'pull_request') {
    const pr = event.pull_request;
    assert(Number.isSafeInteger(event.number) && event.number > 0, 'PR number is required');
    assert.equal(pr.base.ref, 'main', 'PR must target main');
    pullRequest = {
      number: event.number,
      head: { commit: sha(pr.head.sha), ref: pr.head.ref },
      base: { commit: sha(pr.base.sha), ref: pr.base.ref },
    };
    subject = { kind: 'pull-request-head', commit: pullRequest.head.commit };
  } else {
    assert.equal(eventCandidate.ref, 'refs/heads/main', 'Push must target main');
    assert.equal(event.ref, eventCandidate.ref, 'Push event ref must match');
    assert.equal(event.after, eventCandidate.commit, 'Push event candidate must match');
    assert(!event.deleted, 'A deleted branch cannot be qualified');
    subject = { kind: 'main-push', commit: eventCandidate.commit };
  }
  assert.equal(source.commit, subject.commit, 'Actual checkout must match the qualification subject');
  const run = {
    repository,
    id: required(env, 'GITHUB_RUN_ID'),
    attempt: required(env, 'GITHUB_RUN_ATTEMPT'),
    workflow: required(env, 'GITHUB_WORKFLOW'),
    job: required(env, 'GITHUB_JOB'),
  };
  assert.match(run.id, /^[1-9][0-9]*$/, 'Expected a run ID');
  assert.match(run.attempt, /^[1-9][0-9]*$/, 'Expected a run attempt');

  const destination = await realpath(delivery);
  const relative = path.relative(await realpath(root), destination);
  assert(relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Delivery must be outside the source checkout');
  async function delivered(file) {
    const location = path.join(destination, file);
    assert.equal(await realpath(location), location, 'Delivered files must not traverse symlinks');
    assert((await lstat(location)).isFile(), 'Delivered inputs must be regular files');
    const bytes = await readFile(location);
    return { bytes, record: { path: file, bytes: bytes.length, sha256: sha256(bytes) } };
  }
  const receipt = await delivered('consumer/STARTER-DELIVERY.json');
  const manifest = await delivered('consumer/package.json');
  const lockfile = await delivered('consumer/package-lock.json');
  const receiptJson = JSON.parse(receipt.bytes);
  const manifestJson = JSON.parse(manifest.bytes);
  const lockJson = JSON.parse(lockfile.bytes);
  assert.match(receiptJson.library ?? '', /^file:vendor\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/, 'Expected a retained vendor archive');
  const archive = await delivered('consumer/' + receiptJson.library.slice('file:'.length));
  assert.equal(archive.record.sha256, receiptJson.sha256, 'Delivered archive must match the delivery receipt');
  assert.equal(manifestJson.dependencies[still], receiptJson.library, 'Manifest must pin the delivered archive');
  assert.equal(lockJson.packages[''].dependencies[still], receiptJson.library, 'Lock root must pin the delivered archive');
  const locked = lockJson.packages['node_modules/' + still];
  assert.equal(locked.resolved, receiptJson.library, 'Locked package must resolve to the delivered archive');
  assert.equal(locked.integrity, 'sha512-' + createHash('sha512').update(archive.bytes).digest('base64'), 'Lock integrity must match delivered archive bytes');
  const runtime = {
    node: process.version,
    npm: execFileSync(process.platform === 'win32' ? process.execPath : 'npm',
      process.platform === 'win32' ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), '--version'] : ['--version'],
      { encoding: 'utf8' }).trim(),
  };
  assert.deepEqual(checkout(root), source, 'Source checkout changed while recording qualification');
  const record = {
    schemaVersion: 1,
    kind: 'still-core-ci-qualification',
    recordedAt: new Date().toISOString(),
    source,
    subject,
    event: { name: eventName, candidate: eventCandidate, pullRequest },
    run,
    runtime,
    delivery: { receipt: receipt.record, manifest: manifest.record, lockfile: lockfile.record, archive: archive.record },
  };
  await writeFile(path.join(destination, 'CI-QUALIFICATION.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/ci-qualification.mjs <retained-delivery-directory>');
  const record = await writeQualification({ delivery: process.argv[2] });
  console.log(JSON.stringify(record, null, 2));
}
