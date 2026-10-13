import { useEffect, useState } from 'react';
import client, { fileOrigin } from '../../api/client';
import { formatNzDate } from '../../utils/nzTime';

const STATUS_LABEL = {
  pending: 'Awaiting review',
  verified: 'Verified',
  rejected: 'Rejected - re-upload needed',
  'not-supplied': 'Not supplied',
};

const STATUS_CLASS = {
  pending: 'pending',
  verified: 'approved',
  rejected: 'rejected',
  'not-supplied': 'closed',
};

export default function DriverDocuments() {
  const [data, setData] = useState(null);
  const [uploadingKey, setUploadingKey] = useState(null);
  const [error, setError] = useState('');

  function load() {
    client.get('/driver/documents').then((r) => setData(r.data)).catch((err) => setError(err.response?.data?.error || 'Could not load documents'));
  }

  useEffect(() => { load(); }, []);

  async function reupload(key, file) {
    if (!file) return;
    setError('');
    setUploadingKey(key);
    const body = new FormData();
    body.append('document', file);
    try {
      await client.post(`/driver/documents/${key}`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploadingKey(null);
    }
  }

  return (
    <div className="container">
      <h1>My documents</h1>
      <p className="muted">
        An admin checks each document individually. If one is rejected you'll see the reason here - fix it and upload
        a replacement, and it goes straight back into the review queue.
      </p>
      {error && <p className="error-text">{error}</p>}

      {data && data.driverStatus !== 'approved' && (
        <div className="card" style={{ background: '#fef3c7' }}>
          {data.allVerified
            ? '✅ All your documents are verified. An admin will activate your account shortly.'
            : '⚠️ Your account stays pending until every document below is verified.'}
        </div>
      )}

      {data?.documents.map((doc) => (
        <div className="card" key={doc.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <strong>{doc.label}</strong>
              <div className="muted">
                {doc.uploadedAt ? `Uploaded ${formatNzDate(doc.uploadedAt)}` : 'Never uploaded'}
                {doc.reviewedAt && ` · reviewed ${formatNzDate(doc.reviewedAt)}`}
              </div>
            </div>
            <span className={`badge ${STATUS_CLASS[doc.status] || 'pending'}`}>{STATUS_LABEL[doc.status] || doc.status}</span>
          </div>

          {doc.status === 'rejected' && (
            <p className="error-text" style={{ marginTop: 8 }}>Reason given: {doc.rejectionReason}</p>
          )}

          <div className="btn-grid">
            {doc.url && <a className="btn secondary" href={`${fileOrigin}${doc.url}`} target="_blank" rel="noreferrer">View current file</a>}
            {doc.status !== 'verified' && (
              <label className="btn secondary" style={{ cursor: 'pointer', margin: 0 }}>
                {uploadingKey === doc.key ? 'Uploading...' : doc.url ? 'Upload replacement' : 'Upload document'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => reupload(doc.key, e.target.files[0])}
                />
              </label>
            )}
          </div>
        </div>
      ))}

      {!data && !error && <p className="muted">Loading...</p>}
    </div>
  );
}
