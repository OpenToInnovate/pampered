// Sweep hue, binary-search lightness for a fixed WCAG contrast against the map
// surface, then greedily pick hues that stay far apart once converted to Lab.
const MAP = '#f2f0ec';
const hex2rgb = (h) => { const n = parseInt(h.replace('#',''),16); return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]; };
const rgb2hex = (r) => '#' + r.map(c => Math.round(Math.max(0,Math.min(1,c))*255).toString(16).padStart(2,'0')).join('').toUpperCase();
const lin = (c) => c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4;
const unlin = (c) => c <= 0.0031308 ? c*12.92 : 1.055*c**(1/2.4)-0.055;
const L = (rgb) => { const [r,g,b] = rgb.map(lin); return 0.2126*r+0.7152*g+0.0722*b; };
const MAP_L = L(hex2rgb(MAP));
const ratio = (rgb) => { const l = L(rgb); const [hi, lo] = l > MAP_L ? [l, MAP_L] : [MAP_L, l]; return (hi+0.05)/(lo+0.05); };
function hsl2rgb(h,s,l){ h/=360; const q = l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
  const f=(t)=>{ if(t<0)t+=1; if(t>1)t-=1;
    if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
  return [f(h+1/3),f(h),f(h-1/3)]; }
function rgb2lab(rgb){ let [r,g,b]=rgb.map(lin);
  let x=(r*0.4124+g*0.3576+b*0.1805)/0.95047, y=(r*0.2126+g*0.7152+b*0.0722), z=(r*0.0193+g*0.1192+b*0.9505)/1.08883;
  const f=(t)=>t>0.008856?Math.cbrt(t):(7.787*t+16/116);
  [x,y,z]=[f(x),f(y),f(z)];
  return [116*y-16, 500*(x-y), 200*(y-z)]; }
const dE = (a,b) => { const A=rgb2lab(a),B=rgb2lab(b); return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2]); };

const TARGET = 4.6, SAT = 0.62;
const byHue = [];
for (let h = 0; h < 360; h += 6) {
  let lo = 0.02, hi = 0.72, best = null;
  for (let i = 0; i < 40; i++) {
    const m = (lo+hi)/2; const rgb = hsl2rgb(h, SAT, m); const r = ratio(rgb);
    if (r >= TARGET) { best = { h, rgb, r }; lo = m; } else hi = m;
  }
  if (best && best.r < 6.5) byHue.push(best);
}
// Greedy farthest-point selection for maximum separation.
const want = Number(process.argv[2] || 13);
const pool = [...byHue];
// Enforce a minimum hue gap as well as Lab distance: two colours at the same
// lightness are only as separable as their hues are apart.
const hueGap = 21;
const okGap = (h) => (d) => Math.min(d, Math.abs(h - d) > 180 ? 360 - Math.abs(h - d) : Math.abs(h - d));
const picked = [pool.shift()];
while (picked.length < want && pool.length) {
  let bi = -1, bd = -1;
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i];
    if (picked.some(p => Math.min(Math.abs(p.h - c.h), 360 - Math.abs(p.h - c.h)) < hueGap)) continue;
    const d = Math.min(...picked.map(p => dE(p.rgb, c.rgb)));
    if (d > bd) { bd = d; bi = i; }
  }
  if (bi < 0) break;
  picked.push(pool.splice(bi,1)[0]);
}
for (const p of picked) console.log(rgb2hex(p.rgb), 'hue', p.h, 'contrast', p.r.toFixed(2));
console.log('min pairwise dE', Math.min(...picked.flatMap((a,i)=>picked.slice(i+1).map(b=>dE(a.rgb,b.rgb)))).toFixed(1));
console.log('map surface', MAP, 'L', L(hex2rgb(MAP)).toFixed(3));
