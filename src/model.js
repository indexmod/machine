// Procedural height-field reconstructed from the supplied relief reference.
// Coordinates are normalized to [0,1]. The source photograph is NOT used as a texture.
export const MODEL = {
  center: [0.5, 0.49],
  outerFrame: [0.115, 0.885],
  innerFrame: [0.158, 0.842],
  circleRadius: 0.302,
  holes: [[0.42, 0.405], [0.58, 0.405], [0.50, 0.575]]
};

const smooth = (a,b,x) => {
  const t=Math.max(0,Math.min(1,(x-a)/(b-a)));
  return t*t*(3-2*t);
};
const roundedRectDistance = (x,y,cx,cy,hx,hy,r) => {
  const qx=Math.abs(x-cx)-(hx-r), qy=Math.abs(y-cy)-(hy-r);
  return Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r;
};
const ring = (d, radius, width, height, softness) =>
  height * (1-smooth(width, width+softness, Math.abs(d-radius)));

export function heightAt(x,y) {
  const [cx,cy]=MODEL.center;
  let z=0;
  // Broad, gently raised plate and two inset square bevels.
  const dOuter=roundedRectDistance(x,y,.5,.5,.386,.386,.012);
  const dInner=roundedRectDistance(x,y,.5,.5,.343,.343,.010);
  z += ring(dOuter,0,.010,.095,.014);
  z += ring(dInner,0,.009,.075,.013);
  // A very shallow recessed field between the two square edges.
  z -= .018 * (1-smooth(.32,.35,Math.max(Math.abs(x-.5),Math.abs(y-.5))));
  // Circular sculpted lip: dark inner bevel and bright outer roll are expressed by height.
  const r=Math.hypot(x-cx,y-cy);
  z += .115*Math.exp(-Math.pow((r-.302)/.012,2));
  z -= .038*Math.exp(-Math.pow((r-.281)/.020,2));
  z += .018*Math.exp(-Math.pow((r-.325)/.022,2));
  // Three drilled, softly chamfered recesses.
  for(const [hx,hy] of MODEL.holes) {
    const d=Math.hypot(x-hx,y-hy);
    z -= .125*(1-smooth(.008,.022,d));
    z += .035*Math.exp(-Math.pow((d-.018)/.006,2));
  }
  // Gentle convexity of the central face, as in the reference.
  z += .018*Math.exp(-Math.pow(r/.24,4));
  return z;
}
export function gradientAt(x,y) {
  const e=.0007;
  return [(heightAt(x+e,y)-heightAt(x-e,y))/(2*e),
          (heightAt(x,y+e)-heightAt(x,y-e))/(2*e)];
}
