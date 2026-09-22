const path = require('path');
const jwt = require('jsonwebtoken');

// Uploaded files - driver licences/TSL/CoF scans and complaint evidence -
// are personal documents, but they're referenced by plain URLs the
// browser opens directly (no Authorization header possible), so
// express.static alone would make every one of them public to anyone
// holding the link, forever. Instead every /uploads/... URL leaving the
// API gets a signed, expiring token appended, and the file route below
// refuses anything without a valid one. Stored records keep the bare
// path; signing happens on the way out.
const TTL = '12h';

function signUploadUrl(url) {
  const [file] = url.split('?');
  return `${file}?t=${jwt.sign({ f: file }, process.env.JWT_SECRET, { expiresIn: TTL })}`;
}

function signDeep(value) {
  if (typeof value === 'string') return value.startsWith('/uploads/') && !value.includes('?t=') ? signUploadUrl(value) : value;
  if (Array.isArray(value)) return value.map(signDeep);
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = signDeep(v);
    return out;
  }
  return value;
}

// Wraps res.json so any /uploads path in any API response is signed - one
// place, rather than remembering it in every route that returns a driver
// document or complaint attachment.
function signUploadsInResponses(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(signDeep(body));
  next();
}

// Replaces express.static for /uploads: same files, but only with a token
// minted by signUploadUrl for that exact path.
function serveSignedUpload(uploadsRoot) {
  return (req, res) => {
    let payload;
    try {
      payload = jwt.verify(String(req.query.t || ''), process.env.JWT_SECRET);
    } catch {
      return res.status(401).type('text').send('This file link has expired - open it again from the app.');
    }
    if (payload.f !== `/uploads${req.path}`) return res.status(403).type('text').send('This link is for a different file.');
    const abs = path.join(uploadsRoot, req.path);
    if (!abs.startsWith(uploadsRoot)) return res.status(400).end();
    res.sendFile(abs, (err) => { if (err) res.status(err.statusCode || 404).type('text').send('File not found'); });
  };
}

module.exports = { signUploadsInResponses, serveSignedUpload, signUploadUrl };
