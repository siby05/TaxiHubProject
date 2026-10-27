// Single source for the car logo: /favicon.svg. The same asset is used by
// the navbar, drawer, receipt emails and browser icon.
export function LogoBadge({ size = 32 }) {
  return <img src="/favicon.svg" width={size} height={size} alt="" aria-hidden="true" style={{display:'block',flexShrink:0}} />;
}
export default function Logo({size=32,tagline=false,dark=false,gap}) {
  return <span style={{display:'inline-flex',alignItems:'center',gap:gap??size*.22}}>
    <LogoBadge size={size}/>
    <span style={{display:'flex',flexDirection:'column',lineHeight:1}}>
      <span style={{fontFamily:'Sora,system-ui,sans-serif',fontWeight:800,fontSize:size*.67}}><span style={{color:dark?'#fff':'#0B2942'}}>Easy</span><span style={{color:'#FFCA28'}}>Ride</span></span>
      {tagline&&<span style={{fontSize:size*.18,letterSpacing:1,color:dark?'#ddd':'#475569',marginTop:4}}>TAXI &amp; PRIVATE TRANSFERS</span>}
    </span>
  </span>;
}
