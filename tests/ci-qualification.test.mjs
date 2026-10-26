import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeQualification } from '../scripts/ci-qualification.mjs';

const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const still = '@effortlessmetrics/still';
const merge = 'a'.repeat(40);
const base = 'b'.repeat(40);
async function fixture(t, eventName = 'pull_request') {
  const temporary = await mkdtemp(path.join(tmpdir(), 'still-ci-qualification-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'source');
  const delivery = path.join(temporary, 'delivery');
  const consumer = path.join(delivery, 'consumer');
  await mkdir(root);
  await mkdir(path.join(consumer, 'vendor'), { recursive: true });
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  await writeFile(path.join(root, 'source.txt'), 'fixture source\n');
  git(['add', 'source.txt']);
  git(['-c', 'user.name=Qualification Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const commit = git(['rev-parse', 'HEAD']);
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  const pin = 'file:vendor/still-0.2.2.tgz';
  const archive = Buffer.from('distinct delivered archive bytes');
  const files = {
    'vendor/still-0.2.2.tgz': archive,
    'STARTER-DELIVERY.json': JSON.stringify({ library: pin, sha256: digest(archive) }),
    'package.json': JSON.stringify({ dependencies: { [still]: pin } }),
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: {
      '': { dependencies: { [still]: pin } },
      ['node_modules/' + still]: { resolved: pin, integrity: 'sha512-' + digest(archive, 'sha512', 'base64') },
    } }),
  };
  for (const [file, bytes] of Object.entries(files)) await writeFile(path.join(consumer, file), bytes);
  const event = { repository: { full_name: 'EffortlessMetrics/still-core' } };
  if (eventName === 'pull_request') Object.assign(event, { number: 42, pull_request: {
    head: { sha: commit, ref: 'repair/qualification' }, base: { sha: base, ref: 'main' },
  } });
  else Object.assign(event, { ref: 'refs/heads/main', after: commit, deleted: false });
  const eventPath = path.join(temporary, 'event.json');
  const saveEvent = () => writeFile(eventPath, JSON.stringify(event));
  await saveEvent();
  const env = {
    GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: event.repository.full_name, GITHUB_SHA: eventName === 'pull_request' ? merge : commit,
    GITHUB_REF: eventName === 'pull_request' ? 'refs/pull/42/merge' : 'refs/heads/main',
    GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '2', GITHUB_WORKFLOW: 'Verify Still', GITHUB_JOB: 'verify',
  };
  const options = { root, delivery, env };
  const receiptPath = path.join(delivery, 'CI-QUALIFICATION.json');
  const absent = () => assert.rejects(readFile(receiptPath), { code: 'ENOENT' });
  return { root, delivery, consumer, git, commit, tree, files, env, event, saveEvent, options, receiptPath, absent };
}

test('PR receipt binds actual checkout and delivered hashes without qualifying the event merge candidate', async t => {
  const f = await fixture(t);
  const record = await writeQualification(f.options);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.kind, 'still-core-ci-qualification');
  assert.deepEqual(record.source, { commit: f.commit, tree: f.tree, dirty: false });
  assert.deepEqual(record.subject, { kind: 'pull-request-head', commit: f.commit });
  assert.deepEqual(record.event.candidate, { commit: merge, ref: 'refs/pull/42/merge' });
  assert.deepEqual(record.event.pullRequest, { number: 42, head: { commit: f.commit, ref: 'repair/qualification' }, base: { commit: base, ref: 'main' } });
  assert.deepEqual(record.run, { repository: 'EffortlessMetrics/still-core', id: '12345', attempt: '2', workflow: 'Verify Still', job: 'verify' });
  assert.equal(record.runtime.node, process.version);
  assert.equal(record.runtime.npm, execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim());
  assert(Number.isFinite(Date.parse(record.recordedAt)));
  for (const file of Object.values(record.delivery)) {
    const bytes = await readFile(path.join(f.delivery, file.path));
    assert.equal(file.sha256, digest(bytes));
    assert.equal(file.bytes, bytes.length);
  }
  assert.deepEqual(JSON.parse(await readFile(f.receiptPath, 'utf8')), record);
  await assert.rejects(writeQualification(f.options), { code: 'EEXIST' });
});

test('push receipt qualifies the actual main commit and records no PR', async t => {
  const f = await fixture(t, 'push');
  const record = await writeQualification(f.options);
  assert.deepEqual(record.subject, { kind: 'main-push', commit: f.commit });
  assert.deepEqual(record.event, { name: 'push', candidate: { commit: f.commit, ref: 'refs/heads/main' }, pullRequest: null });
});

test('delivery creation has no qualification record; missing and substituted archive bytes reject', async t => {
  const f = await fixture(t);
  await f.absent();
  const archivePath = path.join(f.consumer, 'vendor/still-0.2.2.tgz');
  await rm(archivePath);
  await assert.rejects(writeQualification(f.options), { code: 'ENOENT' });
  await f.absent();
  await writeFile(archivePath, 'substituted archive');
  await assert.rejects(writeQualification(f.options), /archive must match the delivery receipt/);
  await f.absent();
});

test('manifest, lock pin and lock integrity must agree with the retained archive', async t => {
  const f = await fixture(t);
  for (const file of ['package.json', 'package-lock.json']) {
    await writeFile(path.join(f.consumer, file), String(f.files[file]).replaceAll('still-0.2.2.tgz', 'other.tgz'));
    await assert.rejects(writeQualification(f.options), /must pin the delivered archive/);
    await f.absent();
    await writeFile(path.join(f.consumer, file), f.files[file]);
  }
  const lock = JSON.parse(f.files['package-lock.json']);
  lock.packages['node_modules/' + still].resolved = 'file:vendor/other.tgz';
  await writeFile(path.join(f.consumer, 'package-lock.json'), JSON.stringify(lock));
  await assert.rejects(writeQualification(f.options), /must resolve to the delivered archive/);
  lock.packages['node_modules/' + still].resolved = 'file:vendor/still-0.2.2.tgz';
  lock.packages['node_modules/' + still].integrity = 'sha512-wrong';
  await writeFile(path.join(f.consumer, 'package-lock.json'), JSON.stringify(lock));
  await assert.rejects(writeQualification(f.options), /Lock integrity must match/);
  await f.absent();
});

test('dirty tracked, staged and untracked source cannot claim exact committed-tree proof', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'source.txt'), 'changed\n');
  await assert.rejects(writeQualification(f.options), /clean checkout/);
  f.git(['add', 'source.txt']);
  await assert.rejects(writeQualification(f.options), /clean checkout/);
  // Restore only this disposable fixture's own file, never the working candidate.
  f.git(['restore', '--staged', 'source.txt']);
  f.git(['restore', 'source.txt']);
  await writeFile(path.join(f.root, 'untracked.txt'), 'untracked\n');
  await assert.rejects(writeQualification(f.options), /clean checkout/);
  await f.absent();
});

test('a checkout mismatch, unsupported queue event or mismatched push cannot produce qualification', async t => {
  const f = await fixture(t);
  f.event.pull_request.head.sha = merge;
  await f.saveEvent();
  await assert.rejects(writeQualification(f.options), /Actual checkout must match/);
  f.env.GITHUB_EVENT_NAME = 'merge_group';
  await assert.rejects(writeQualification(f.options), /Only PR-head and main-push/);
  await f.absent();
  const push = await fixture(t, 'push');
  push.event.after = merge;
  await push.saveEvent();
  await assert.rejects(writeQualification(push.options), /Push event candidate must match/);
  push.env.GITHUB_REF = 'refs/heads/other';
  await assert.rejects(writeQualification(push.options), /Push must target main/);
  await push.absent();
});

test('unsafe archive paths and symlink substitutions cannot enter a qualification record', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.consumer, 'STARTER-DELIVERY.json'), JSON.stringify({ library: 'file:../outside.tgz' }));
  await assert.rejects(writeQualification(f.options), /Expected a retained vendor archive/);
  await writeFile(path.join(f.consumer, 'STARTER-DELIVERY.json'), f.files['STARTER-DELIVERY.json']);
  const archive = path.join(f.consumer, 'vendor/still-0.2.2.tgz');
  const outside = path.join(f.delivery, 'outside.tgz');
  await writeFile(outside, f.files['vendor/still-0.2.2.tgz']);
  await rm(archive);
  await symlink(outside, archive);
  await assert.rejects(writeQualification(f.options), /must not traverse symlinks/);
  await f.absent();
});
