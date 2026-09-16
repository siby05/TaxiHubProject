import { useState } from 'react';

// Interactive 1-5 star picker with an optional review, calling
// onSubmit(rating, review) when confirmed.
export default function StarRating({ label, onSubmit, submitLabel }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [review, setReview] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!rating) return;
    setLoading(true);
    try {
      await onSubmit(rating, review);
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  if (done) return <p className="muted">Thanks for the rating!</p>;

  return (
    <div>
      {label && <div className="muted" style={{ marginBottom: 4 }}>{label}</div>}
      <div style={{ fontSize: '1.4rem', cursor: 'pointer' }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
            style={{ color: (hover || rating) >= n ? '#f59e0b' : '#d1d5db' }}
          >
            ★
          </span>
        ))}
      </div>
      {rating > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input placeholder="Optional comment" value={review} onChange={(e) => setReview(e.target.value)} />
          <button className="btn" onClick={submit} disabled={loading}>{loading ? '...' : (submitLabel || 'Submit')}</button>
        </div>
      )}
    </div>
  );
}
