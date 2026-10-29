import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AddressAutocomplete from '../components/AddressAutocomplete';
import { nzWallTimeToISO, todayNz } from '../utils/nzTime';
import client from '../api/client';
import './home.css';

const Icon = {
  check: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6 9 17l-5-5" /></svg>,
  qr: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M14 14h3v3M21 14v3h-4M14 21h7" /></svg>,
  phone: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></svg>,
  calendar: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  shield: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>,
  tag: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13 13 20a2 2 0 0 1-2.8 0L3 12.8V4h8.8L20 12.2a2 2 0 0 1 0 .8z" /><circle cx="7.5" cy="8.5" r="1.5" /></svg>,
  pin: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg>,
  star: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z" /></svg>,
  user: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>,
  plane: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" /></svg>,
  road: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21 9 3M20 21 15 3M12 5v2M12 11v2M12 17v2" /></svg>,
  clock: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  car: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11" /><rect x="3" y="11" width="18" height="7" rx="2" /><circle cx="7.5" cy="18" r="1.8" /><circle cx="16.5" cy="18" r="1.8" /></svg>,
};


const ROUTES={'np-akl':'New Plymouth → Auckland','akl-np':'Auckland → New Plymouth','np-pmr':'New Plymouth → Palmerston North','pmr-np':'Palmerston North → New Plymouth'};
const SERVICES=[
  {title:'Airport Transfers',desc:'Reliable transfers to and from New Plymouth Airport.',icon:'✈',img:'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=85',alt:'Passenger aeroplane',points:['Pre-book airport rides','Convenient pickup arrangements','Comfortable, stress-free travel'],link:'/airport-transfers'},
  {title:'Local Rides',desc:'Taxis for shopping, appointments, events and more.',icon:'⌖',img:'https://commons.wikimedia.org/wiki/Special:FilePath/New-plymouth-city-skyline-npdc.jpg?width=1200',alt:'New Plymouth with Mount Taranaki',points:['Quick and convenient','New Plymouth and nearby','Friendly local service'],link:'/register'},
  {title:'Private Transport',desc:'Personalised transport for business, leisure or groups.',icon:'♧',img:'/images/byd-atto3.png',alt:'BYD Atto 3 electric SUV used for EasyRide private transport',points:['Flexible scheduling','Comfortable vehicles','Great for tours and events'],link:'/about'}
];
function BookingPanel(){
  const navigate=useNavigate();
  const [params]=useSearchParams();
  const qrDriver=params.get('qrDriver');
  const [mode,setMode]=useState('ride');
  const [pickup,setPickup]=useState(null),[drop,setDrop]=useState(null);
  const [pickupDate,setPickupDate]=useState(''),[pickupTime,setPickupTime]=useState('');
  const [datePickerOpen,setDatePickerOpen]=useState(false),[quote,setQuote]=useState(null);
  const [error,setError]=useState(''),[loading,setLoading]=useState(false);
  const scheduledFor=pickupDate&&pickupTime?nzWallTimeToISO(pickupDate,pickupTime):null;
  const scheduleLabel=pickupDate&&pickupTime
    ? new Date(pickupDate+'T12:00:00').toLocaleDateString('en-NZ',{day:'numeric',month:'short',year:'numeric'})+' at '+pickupTime
    : 'Select date & time';
  useEffect(()=>{setQuote(null);setError('');},[pickup,drop,pickupDate,pickupTime,mode]);
  async function getQuote(e){
    e.preventDefault();
    if(!pickup||!drop){setError('Choose both addresses from the location suggestions.');return;}
    if((pickupDate&&!pickupTime)||(!pickupDate&&pickupTime)){setDatePickerOpen(true);setError('Select both a date and time, or clear them to request the earliest pickup.');return;}
    setError('');setLoading(true);setQuote(null);
    try{const {data}=await client.post('/booking/homepage-quote',{pickupLat:pickup.lat,pickupLng:pickup.lng,dropLat:drop.lat,dropLng:drop.lng,scheduledFor});setQuote(data);}
    catch(err){setError(err.response?.data?.error||'Unable to calculate a fare. Please try again.');}
    finally{setLoading(false);}
  }
  function continueBooking(){sessionStorage.setItem('easyride-home-quote',JSON.stringify({pickup,drop,scheduledFor}));navigate(qrDriver ? `/book-direct/${encodeURIComponent(qrDriver)}` : '/register');}
  return <form className="er-booking" id="book-ride" onSubmit={getQuote}>
    {qrDriver && <div role="status" style={{ padding: "10px 14px", borderRadius: 8, background: "#fff7df", color: "#24354a", marginBottom: 10 }}>
      You scanned a driver QR code. <Link to={`/book-direct/${encodeURIComponent(qrDriver)}`}>Book this driver directly</Link> or check your fare below.
    </div>}
    <div className="er-tabs" role="tablist" aria-label="Booking type">
      <button type="button" role="tab" aria-selected={mode==='ride'} className={mode==='ride'?'active':''} onClick={()=>setMode('ride')}><Icon.car/><span><strong>Book a Ride</strong><small>Local &amp; Private</small></span></button>
      <button type="button" role="tab" aria-selected={mode==='airport'} className={mode==='airport'?'active':''} onClick={()=>setMode('airport')}><Icon.plane/><span><strong>Airport Transfer</strong><small>To / From Airport</small></span></button>
    </div>
    <div className="er-booking-body">
      <AddressAutocomplete label="Pickup Location" placeholder="Enter pickup location" onSelect={setPickup} required allowLocate compactLocate />
      <AddressAutocomplete label="Drop-off Location" placeholder="Enter destination" onSelect={setDrop} required/>
      <div className="er-date">
        <label id="er-date-label">Date &amp; Time <span>(optional)</span></label>
        <button type="button" className="er-date-trigger" aria-labelledby="er-date-label er-schedule-display" aria-expanded={datePickerOpen} aria-controls="er-date-controls" onClick={()=>setDatePickerOpen(v=>!v)}>
          <Icon.calendar/><span id="er-schedule-display">{scheduleLabel}</span><span className="er-date-chevron" aria-hidden="true">{datePickerOpen?'▴':'▾'}</span>
        </button>
        {datePickerOpen&&<div id="er-date-controls" className="er-date-controls">
          <div><label htmlFor="er-pickup-datetime">Pickup date &amp; time</label><input id="er-pickup-datetime" type="datetime-local" value={pickupDate&&pickupTime?`${pickupDate}T${pickupTime}`:''} min={`${todayNz()}T00:00`} onChange={e=>{const [date='',time='']=e.target.value.split('T');setPickupDate(date);setPickupTime(time);}}/></div>
          <div className="er-date-actions"><button type="button" onClick={()=>{setPickupDate('');setPickupTime('');setDatePickerOpen(false);}}>Book as soon as possible</button><button type="button" onClick={()=>setDatePickerOpen(false)}>Done</button></div>
        </div>}
        <small>Leave blank for the earliest available pickup</small>
      </div>
      {error&&<p className="er-error" role="alert">{error}</p>}
      {quote&&<div className="er-fare" role="status"><strong>{'Estimated fare: NZ$'+Number(quote.estimatedFare).toFixed(2)}</strong><span>{Number(quote.distanceKm).toFixed(1)} km{quote.discountPercent>0?' · '+quote.discountPercent+'% discount':''}</span>{quote.awaitingDriverConfirmation&&<small>Driver confirmation is pending. Your trip is not yet confirmed.</small>}</div>}
      {quote?<button type="button" className="er-book-button" onClick={continueBooking}>Continue to Booking <span aria-hidden="true">→</span></button>:<button className="er-book-button" disabled={loading}>{loading?'Calculating fare…':'Get a Quote & Book'} <span aria-hidden="true">→</span></button>}
      <div className="er-booking-secure"><Icon.shield/> Secure booking · Fare displayed before confirmation</div>
    </div>
  </form>;
}
function Offers(){
  const [offers,setOffers]=useState(null);
  useEffect(()=>{client.get('/booking/promotions').then(r=>setOffers(r.data)).catch(()=>{});},[]);
  const {promo,returnTrip,routeDiscounts=[]}=offers||{};
  const active=!!promo||routeDiscounts.length>0||!!returnTrip?.openings?.length;
  return <section className="er-offers" id="offers"><div className="er-offer-intro"><svg className="er-percent" viewBox="0 0 100 100" role="img" aria-label="Discounts"><path d="M50 5 C55 5 56 13 62 14 C68 15 73 8 78 11 C83 14 80 22 85 27 C90 32 98 28 99 34 C100 40 92 44 92 50 C92 56 100 60 99 66 C98 72 90 68 85 73 C80 78 83 86 78 89 C73 92 68 85 62 86 C56 87 55 95 50 95 C45 95 44 87 38 86 C32 85 27 92 22 89 C17 86 20 78 15 73 C10 68 2 72 1 66 C0 60 8 56 8 50 C8 44 0 40 1 34 C2 28 10 32 15 27 C20 22 17 14 22 11 C27 8 32 15 38 14 C44 13 45 5 50 5 Z" fill="#ffbb11"/><text x="50" y="63" textAnchor="middle" fontSize="40" fontWeight="900" fill="#fff">%</text></svg><div><h2>{active?'Special Discounts Available!':'Special Offers & Discounts'}</h2><p>{active?'Configured discounts are included automatically in fare estimates.':'Special fares will be shown when configured by EasyRide.'}</p></div></div><div className="er-offer-box"><span className="er-present">🎁</span><div>{promo&&<p><strong>{promo.percent}% off</strong><small>{promo.startDate} to {promo.endDate}</small></p>}{routeDiscounts.map(r=><p key={r.direction}><strong>{r.percent}% route discount</strong><small>{ROUTES[r.direction]||r.direction}</small></p>)}{returnTrip?.openings?.length>0&&<p><strong>{returnTrip.percent}% same-day return</strong><small>For qualifying trips</small></p>}{!active&&<p><strong>Discount details</strong><small>Will be shown here once configured</small></p>}</div></div></section>;
}
function Services(){return <section id="services" className="er-services er-container">
  <div className="er-heading"><span>OUR SERVICES</span><h2>Travel Your Way</h2><p>From airport runs to local trips, we've got you covered.</p></div>
  <div className="er-service-grid">{SERVICES.map(s=><article className="er-card" key={s.title}>
    <img src={s.img} alt={s.alt} loading="lazy"/>
    <div className="er-card-inner"><div className="er-card-head"><span className="er-card-icon">{s.icon}</span><div><h3>{s.title}</h3><p>{s.desc}</p></div></div><ul>{s.points.map(point=><li key={point}><span>✓</span>{point}</li>)}</ul><Link to={s.link}>Learn More <span>→</span></Link></div>
  </article>)}</div>
  <div className="er-benefits"><div><Icon.shield/><span><strong>Trusted Service</strong><small>Local and reliable</small></span></div><div><Icon.car/><span><strong>Clean &amp; Comfortable</strong><small>Well-maintained vehicles</small></span></div><div><Icon.user/><span><strong>Friendly Drivers</strong><small>Professional and courteous</small></span></div><div><Icon.clock/><span><strong>Flexible Bookings</strong><small>For your convenience</small></span></div></div>
</section>;}
function Testimonials(){
  const [reviews,setReviews]=useState([]);
  useEffect(()=>{client.get('/feedback/testimonials').then(r=>setReviews((r.data||[]).filter(f=>f.message&&f.rating))).catch(()=>{});},[]);
  if(!reviews.length)return null;
  return <section className="er-reviews" id="testimonials"><div className="er-container"><div className="er-heading"><span>WHAT OUR CUSTOMERS SAY</span><h2>Trusted by the New Plymouth Community</h2></div><div className="er-review-grid">{reviews.map((r,i)=><blockquote key={i}><div className="er-stars" aria-label={r.rating+' out of five stars'}>{'★'.repeat(Math.min(5,Math.max(0,Number(r.rating))))}</div><p>“{r.message}”</p><footer>— {r.name||'EasyRide passenger'}</footer></blockquote>)}</div></div></section>;
}
export default function Home(){return <main className="er-home">
  <section className="er-hero"><div className="er-container er-hero-inner"><div className="er-hero-copy">
    <span className="er-kicker">TAXI &amp; PRIVATE TRANSFERS</span>
    <h1>Your Local Ride<br/>in New Plymouth</h1>
    <p>Airport transfers, local trips and private transport<br className="er-wide-only"/> — safe, comfortable and on time.</p>
    <div className="er-points"><div><Icon.shield/><span><strong>Safe &amp; Reliable</strong><small>Your safety first</small></span></div><div><Icon.clock/><span><strong>On Time</strong><small>When confirmed</small></span></div><div><Icon.user/><span><strong>Local Service</strong><small>Proudly New Plymouth</small></span></div></div>
  </div><BookingPanel/></div></section>
  <div className="er-container er-offers-wrap"><Offers/></div>
  <Services/>
  <section className="er-why"><div className="er-container"><span className="er-kicker">WHY CHOOSE EASYRIDE</span><h2>More Than Just a Taxi</h2><p>We're a local New Plymouth service focused on reliability,<br className="er-wide-only"/> comfort and great customer care.</p><div className="er-why-benefits"><div><Icon.star/><span><strong>Local &amp; Trusted</strong><small>Proudly serving New Plymouth</small></span></div><div><Icon.shield/><span><strong>Customer Focused</strong><small>Friendly, professional drivers</small></span></div><div><Icon.car/><span><strong>Comfortable Rides</strong><small>Clean, modern vehicles</small></span></div><div><Icon.shield/><span><strong>Safe Travel</strong><small>Your safety is our priority</small></span></div></div></div></section>
  <Testimonials/>
  <footer className="er-footer"><div className="er-container"><p>© {new Date().getFullYear()} EasyRide NZ · <Link to="/about">About</Link> · <Link to="/terms">Terms</Link> · <a href="mailto:easyridenz@gmail.com">Contact</a></p></div></footer>
</main>;}
