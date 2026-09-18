const multer = require('multer');

// Shared multer config for driver compliance documents - used by the
// signup upload (all four at once) and by the driver's re-upload of a
// single rejected document.
const documentUpload = multer({
  dest: 'uploads/driver-documents/',
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    const ok = allowed.includes(file.mimetype);
    cb(ok ? null : new Error('Documents must be JPG, PNG or PDF'), ok);
  },
  limits: { fileSize: 8 * 1024 * 1024 },
});

const documentUrl = (file) => `/uploads/driver-documents/${file.filename}`;

module.exports = { documentUpload, documentUrl };
