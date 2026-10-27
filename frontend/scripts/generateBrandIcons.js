// Regenerate every raster/favicon format from the SAME car mark used in
// public/favicon.svg. Node standard library only: no optional native
// image-processing dependencies or stale pre-rendered binary files.
// Coordinates below reproduce that SVG's rounded navy square, outlined
// white car, white wheels and gold curved underline.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const COLORS = { navy: [11, 41, 66], white: [255, 255, 255], gold: [255, 202, 40] };
const vec = (x, y) => [x, y];
const quadratic = (a, b, c, steps = 16) =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps, u = 1 - t;
    return [u*u*a[0] + 2*u*t*b[0] + t*t*c[0],
      u*u*a[1] + 2*u*t*b[1] + t*t*c[1]];
  });
const outline = [
  vec(10,30), vec(17,19),
  ...quadratic(vec(17,19),vec(19,15),vec(25,15)).slice(1),
  vec(40,15),
  ...quadratic(vec(40,15),vec(46,15),vec(48,20)).slice(1),
  vec(54,30),
];
const smile = quadratic(vec(12,52),vec(32,69),vec(52,52),40);
function distanceToSegments(x,y,pts) {
  let best=Infinity;
  for(let i=1;i<pts.length;i++) {
    const [ax,ay]=pts[i-1], [bx,by]=pts[i];
    const dx=bx-ax,dy=by-ay,dd=dx*dx+dy*dy;
    const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dd||1)));
    const xx=x-ax-dx*t,yy=y-ay-dy*t;
    const dist=xx*xx+yy*yy;
    if(dist<best)best=dist;
  }
  return Math.sqrt(best);
}
function roundedRectDistance(x,y,cx,cy,w,h,r){
  const qx=Math.abs(x-cx)-(w/2-r), qy=Math.abs(y-cy)-(h/2-r);
  return Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r;
}
function rgbAt(x,y) {
  if(roundedRectDistance(x,y,32,32,64,64,14)>0)return null;
  let rgb=COLORS.navy;
  if(distanceToSegments(x,y,outline)<=2 ||
      Math.abs(roundedRectDistance(x,y,32,36.5,50,15,5))<=2 ||
      Math.hypot(x-19,y-44)<=5 || Math.hypot(x-45,y-44)<=5)rgb=COLORS.white;
  if(distanceToSegments(x,y,smile)<=1.5)rgb=COLORS.gold;
  return rgb;
}
function crc32(bytes) {
  let c=0xFFFFFFFF;
  for(const b of bytes) {
    c^=b;
    for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xEDB88320:0);
  }
  return (c^0xFFFFFFFF)>>>0;
}
function pngChunk(type,data) {
  const t=Buffer.from(type);
  const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
  const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));
  return Buffer.concat([len,t,data,crc]);
}
function renderPng(size) {
  const raw=Buffer.alloc((size*4+1)*size);
  const sampleCount=size<=96?4:2;
  for(let y=0;y<size;y++) {
    const offset=y*(size*4+1);
    raw[offset]=0;
    for(let x=0;x<size;x++) {
      let r=0,g=0,b=0,a=0;
      for(let sy=0;sy<sampleCount;sy++)for(let sx=0;sx<sampleCount;sx++){
        const xx=(x+(sx+.5)/sampleCount)*64/size;
        const yy=(y+(sy+.5)/sampleCount)*64/size;
        const color=rgbAt(xx,yy);
        if(color){r+=color[0];g+=color[1];b+=color[2];a++;}
      }
      const samples=sampleCount*sampleCount;
      const p=offset+1+x*4;
      if(a){raw[p]=Math.round(r/a);raw[p+1]=Math.round(g/a);raw[p+2]=Math.round(b/a);}
      raw[p+3]=Math.round(a*255/samples);
    }
  }
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),
    pngChunk('IHDR',ihdr),pngChunk('IDAT',zlib.deflateSync(raw,{level:9})),
    pngChunk('IEND',Buffer.alloc(0))]);
}
function icoFromPng(png) {
  // PNG-compressed ICO (modern Windows, Chrome, Google crawlers).
  const header=Buffer.alloc(22);
  header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);
  header[6]=48;header[7]=48;header[8]=0;header[9]=0;
  header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);
  header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
  return Buffer.concat([header,png]);
}
export function writeBrandIcons(publicDir,distDir) {
  const svg=fs.readFileSync(path.join(publicDir,'favicon.svg'),'utf8');
  for(const required of ['viewBox="0 0 64 64"','fill="#0B2942"','stroke="#FFCA28"','cx="19"']) {
    if(!svg.includes(required))throw new Error('EasyRide logo geometry changed: update the rasterizer alongside favicon.svg');
  }
  const files={
    'favicon-48x48.png':48,
    'favicon-96x96.png':96,
    'favicon-192x192.png':192,
    'apple-touch-icon.png':180,
    'icon-512x512.png':512,
    'icon-maskable-512x512.png':512,
  };
  const cache=new Map();
  for(const [file,size] of Object.entries(files)){
    if(!cache.has(size))cache.set(size,renderPng(size));
    fs.writeFileSync(path.join(distDir,file),cache.get(size));
  }
  fs.writeFileSync(path.join(distDir,'favicon.ico'),icoFromPng(cache.get(48)));
}
