const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { serveSignedUpload } = require('../middleware/signedUploads');

test('signed upload serves a valid in-directory document', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyride-upload-'));
  const prior = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-only-secret';
  try {
    const file = path.join(dir, 'document.txt');
    fs.writeFileSync(file, 'safe');
    const req = { path: '/document.txt', query: { t: jwt.sign({ f: '/uploads/document.txt' }, process.env.JWT_SECRET) } };
    let served;
    const res = { sendFile(p) { served = p; } };
    serveSignedUpload(dir)(req, res);
    assert.equal(served, file);
  } finally {
    if (prior === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prior;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('signed upload rejects paths escaping the upload root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyride-upload-'));
  const prior = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-only-secret';
  try {
    const req = { path: '/../uploads-private/private.txt', query: { t: jwt.sign({ f: '/uploads/../uploads-private/private.txt' }, process.env.JWT_SECRET) } };
    let status;
    let served = false;
    const res = { status(code) { status = code; return this; }, end() {}, sendFile() { served = true; } };
    serveSignedUpload(dir)(req, res);
    assert.equal(status, 400);
    assert.equal(served, false);
  } finally {
    if (prior === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prior;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
