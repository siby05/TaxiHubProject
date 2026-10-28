import { useEffect, useMemo, useRef, useState } from 'react';
import { moveCenter, selectedPoint, visibleTiles } from '../utils/mapTiles';

// Manual map pin, used only when a driver explicitly opts in. Coordinates
// are chosen by the person booking, never silently guessed from an address.
const DEFAULT_CENTER = { lat: -39.057, lng: 174.077 };
const HEIGHT = 260;
export default function MapPinPicker({ address, near, onPick, onCancel }) {
  const [center, setCenter] = useState(near || DEFAULT_CENTER);
  const [zoom, setZoom] = useState(15);
  const [width, setWidth] = useState(340);
  const [hasMoved, setHasMoved] = useState(false);
  const map = useRef(null);
  const gesture = useRef(null);

  useEffect(() => {
    if (!map.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(180, entry.contentRect.width)));
    observer.observe(map.current);
    return () => observer.disconnect();
  }, []);
  const tiles = useMemo(() => visibleTiles(center, zoom, width, HEIGHT), [center, zoom, width]);
  function down(e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    map.current?.setPointerCapture?.(e.pointerId);
    gesture.current = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false };
  }
  function move(e) {
    if (!gesture.current) return;
    const p = gesture.current;
    const dx = e.clientX-p.x, dy = e.clientY-p.y;
    p.x=e.clientX; p.y=e.clientY;
    if (Math.hypot(e.clientX-p.startX,e.clientY-p.startY)>6) p.moved = true;
    if (p.moved) { setCenter(c => moveCenter(c,zoom,dx,dy)); setHasMoved(true); }
  }
  function up(e) {
    const p=gesture.current;
    if (!p) return;
    gesture.current=null;
    if (!p.moved && map.current) {
      const rect=map.current.getBoundingClientRect();
      setCenter(c => selectedPoint(c,zoom,e.clientX-rect.left,e.clientY-rect.top,rect.width,rect.height));
      setHasMoved(true);
    }
  }
  const label = (address || '').trim();
  return <section className="map-pin-picker" aria-label="Set address position on map">
    <div className="map-pin-heading">
      <strong>Choose the location on the map</strong>
      <button type="button" onClick={onCancel} aria-label="Close map picker">✕</button>
    </div>
    <p className="muted">The address service is unavailable or can't find your street. Drag the map or tap the correct pickup/drop-off point under the yellow pin. Please confirm the location carefully.</p>
    <div ref={map} className="map-pin-map" style={{height:HEIGHT}} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{gesture.current=null}} role="group" aria-label="Interactive map. Tap or drag to choose an address location">
      {tiles.map(t => <img key={t.key} src={t.url} alt="" draggable="false" loading="lazy" style={{position:'absolute',left:t.x,top:t.y,width:256,height:256,maxWidth:'none',pointerEvents:'none',userSelect:'none'}} />)}
      <span className="map-pin-center" aria-hidden="true">📍</span>
      <span className="map-pin-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></span>
    </div>
    <div className="map-pin-actions">
      <div className="map-pin-zoom">
        <button type="button" onClick={()=>setZoom(v=>Math.min(19,v+1))} aria-label="Zoom in">+</button>
        <button type="button" onClick={()=>setZoom(v=>Math.max(11,v-1))} aria-label="Zoom out">−</button>
      </div>
      <button type="button" className="btn" disabled={!label || label.length<3 || !hasMoved} onClick={()=>onPick({label,lat:center.lat,lng:center.lng,manualPin:true})}>Use this location</button>
    </div>
    <small className="muted">Type the full address above, then tap/drag the map to position the pin. This is a manually selected location—not a verified address.</small>
  </section>;
}
