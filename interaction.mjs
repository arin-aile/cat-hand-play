// Four fingertips from ONE hand; the thumb is deliberately excluded.
export const TIP_IDS = [8, 12, 16, 20];
export function videoToScreen(p, width, height, videoWidth, videoHeight) {
  const scale = Math.max(width / videoWidth, height / videoHeight);
  return { x: (width - videoWidth * scale) / 2 + (1 - p.x) * videoWidth * scale,
    y: (height - videoHeight * scale) / 2 + p.y * videoHeight * scale };
}
export function contactTips(landmarks, project, hitTest) {
  if (!landmarks || landmarks.length < 21) return [];
  return TIP_IDS.filter(id => hitTest(project(landmarks[id]), id));
}
export const REACTIONS = [null, 'pet', 'run', 'angry', 'sleep'];
// Debounce changes, but do not repeatedly fire while the same contact is held.
export class ContactGate {
  candidate = 0; since = 0; committed = 0;
  update(count, now) {
    count = Math.max(0, Math.min(4, count));
    if (count !== this.candidate) { this.candidate = count; this.since = now; }
    if (now - this.since < (count ? 140 : 200) || count === this.committed) return null;
    this.committed = count;
    return REACTIONS[count];
  }
  reset() { this.candidate = this.committed = 0; this.since = 0; }
}

// Preserve each fingertip through brief tracking gaps, without inventing new contacts.
export class FingerContactTracker {
  lastHits = new Map();
  update(ids, now) {
    for (const id of ids) this.lastHits.set(id, now);
    for (const [id, time] of this.lastHits) if (now - time > 120) this.lastHits.delete(id);
    return [...this.lastHits.keys()];
  }
  reset() { this.lastHits.clear(); }
}

// Joint geometry works for upright, sideways and mirrored hands.
export function extendedFingers(landmarks) {
  if (!landmarks || landmarks.length < 21) return [];
  const vector = (a,b) => [b.x-a.x,b.y-a.y,(b.z||0)-(a.z||0)];
  const length = v => Math.hypot(...v);
  return TIP_IDS.filter(tip => {
    const mcp=landmarks[tip-3], pip=landmarks[tip-2], end=landmarks[tip];
    const lower=vector(mcp,pip), upper=vector(pip,end);
    const a=length(lower), b=length(upper);
    if (a<1e-8 || b<1e-8) return false;
    const alignment=lower.reduce((sum,v,i)=>sum+v*upper[i],0)/(a*b);
    return alignment>.45 && length(vector(mcp,end))>a*1.35;
  });
}
export function gestureCount(landmarks, contactCount) {
  return contactCount>0 ? extendedFingers(landmarks).length : 0;
}
