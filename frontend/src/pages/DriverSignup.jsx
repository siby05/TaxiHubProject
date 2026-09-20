import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuthStore } from '../store/authStore';
import Modal from '../components/Modal';
import TermsContent from '../components/TermsContent';
import AddressAutocomplete from '../components/AddressAutocomplete';
import PhoneField from '../components/PhoneField';

const emptyForm = {
  name: '', email: '', password: '', mobile: '', address: '',
  licenseNumber: '', tslNumber: '', vehicleType: 'Economy', vehicleNumber: '', ratePerKm: '',
  passengerEndorsementNumber: '', passengerEndorsementExpiry: '', vehicleCofExpiry: '',
};

export default function DriverSignup() {
  const navigate = useNavigate();
  const { setSession } = useAuthStore();
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState({ licenseDoc: null, tslDoc: null, cofDoc: null, regoDoc: null });
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [signupEnabled, setSignupEnabled] = useState(true);
  const [checkedEnabled, setCheckedEnabled] = useState(false);

  useEffect(() => {
    client.get('/booking/vehicle-types').then((r) => setVehicleTypes(r.data)).catch(() => {});
    client.get('/driver-signup/enabled')
      .then((r) => setSignupEnabled(r.data.enabled))
      .catch(() => {})
      .finally(() => setCheckedEnabled(true));
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function updateFile(field, fileList) {
    setFiles((f) => ({ ...f, [field]: fileList[0] || null }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!termsAccepted) { setError('You must accept the Terms & Conditions to sign up.'); return; }
    if (!files.licenseDoc || !files.tslDoc || !files.cofDoc || !files.regoDoc) {
      setError('Please upload your license, TSL, CoF and vehicle registration documents.');
      return;
    }
    setLoading(true);
    try {
      const body = new FormData();
      Object.entries(form).forEach(([k, v]) => v && body.append(k, v));
      body.append('termsAccepted', 'true');
      body.append('licenseDoc', files.licenseDoc);
      body.append('tslDoc', files.tslDoc);
      body.append('cofDoc', files.cofDoc);
      body.append('regoDoc', files.regoDoc);

      const { data } = await client.post('/driver-signup', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSession(data.token, data.user);
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit application');
    } finally {
      setLoading(false);
    }
  }

  if (checkedEnabled && !signupEnabled) {
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: 480, margin: '0 auto' }}>
          <h2>Driver sign-up is closed</h2>
          <p className="muted">We're not accepting new driver applications right now. Please check back later.</p>
          <Link className="btn secondary" to="/">Back home</Link>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: 480, margin: '0 auto', background: '#dcfce7' }}>
          <h2>Application submitted</h2>
          <p>An admin will review your documents and approve your account before you can go online or receive trips. You can log in any time to check your status.</p>
          <button className="btn" onClick={() => navigate('/driver')}>Go to dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1>Drive with EasyRide</h1>
        <p className="muted">Submit your details and documents below. An admin reviews and approves every application before you can start accepting trips.</p>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ marginBottom: 0 }}>Account</h3>
          <div className="grid cols-2">
            <div><label>Full name</label><input value={form.name} onChange={(e) => update('name', e.target.value)} required /></div>
            <div><label>Email</label><input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required /></div>
            <div><label>Password</label><input type="password" value={form.password} onChange={(e) => update('password', e.target.value)} required minLength={6} /></div>
            <PhoneField value={form.mobile} onChange={(v) => update('mobile', v)} required hint="Trip requests are sent to this number on WhatsApp. Leave off the leading 0." />
          </div>
          <AddressAutocomplete label="Address" onSelect={(r) => update('address', r ? r.label : '')} />

          <h3 style={{ marginBottom: 0 }}>Licensing &amp; vehicle</h3>
          <div className="grid cols-2">
            <div><label>Driver license number</label><input value={form.licenseNumber} onChange={(e) => update('licenseNumber', e.target.value)} required /></div>
            <div><label>Transport Service Licence (TSL) #</label><input value={form.tslNumber} onChange={(e) => update('tslNumber', e.target.value)} required /></div>
            <div><label>Passenger (P) endorsement #</label><input value={form.passengerEndorsementNumber} onChange={(e) => update('passengerEndorsementNumber', e.target.value)} /></div>
            <div><label>Endorsement expiry</label><input type="date" value={form.passengerEndorsementExpiry} onChange={(e) => update('passengerEndorsementExpiry', e.target.value)} /></div>
            <div>
              <label>Vehicle type</label>
              <select value={form.vehicleType} onChange={(e) => update('vehicleType', e.target.value)}>
                {vehicleTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div><label>Vehicle number (rego)</label><input value={form.vehicleNumber} onChange={(e) => update('vehicleNumber', e.target.value)} required /></div>
            <div><label>Vehicle CoF expiry</label><input type="date" value={form.vehicleCofExpiry} onChange={(e) => update('vehicleCofExpiry', e.target.value)} /></div>
            <div><label>Preferred rate per km ($, optional)</label><input type="number" step="0.1" value={form.ratePerKm} onChange={(e) => update('ratePerKm', e.target.value)} /></div>
          </div>

          <h3 style={{ marginBottom: 0 }}>Required documents (JPG, PNG or PDF)</h3>
          <div className="grid cols-2">
            <div><label>Driver license</label><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => updateFile('licenseDoc', e.target.files)} required /></div>
            <div><label>Transport Service Licence (TSL)</label><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => updateFile('tslDoc', e.target.files)} required /></div>
            <div><label>Certificate of Fitness (CoF)</label><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => updateFile('cofDoc', e.target.files)} required /></div>
            <div><label>Vehicle registration (rego)</label><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => updateFile('regoDoc', e.target.files)} required /></div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
            I have read and accept the <button type="button" className="btn secondary" style={{ padding: '2px 8px' }} onClick={() => setTermsOpen(true)}>Terms &amp; Conditions</button>
          </label>

          {error && <p className="error-text">{error}</p>}
          <button className="btn" disabled={loading}>{loading ? 'Submitting...' : 'Submit application'}</button>
        </form>

        <p className="muted">Already applied? <Link to="/login">Log in</Link></p>
      </div>

      {termsOpen && (
        <Modal title="Terms & Conditions" onClose={() => setTermsOpen(false)} footer={
          <button className="btn" onClick={() => { setTermsAccepted(true); setTermsOpen(false); }}>I accept</button>
        }>
          <TermsContent />
        </Modal>
      )}
    </div>
  );
}
