/*
 * The report's one chart: the rules it is drawn by, kept here rather than in
 * the browser so `node --test` reads the same source the chart draws with.
 *
 * Two series per bucket. The capacity the plan offers is a quiet band whose
 * solid top edge is the roof; what is allocated is a line riding under it. The
 * band is painted first and the line over it, so the eye lands on the
 * allocation.
 *
 * The ruler is the chart's answer to the pointer and to the keyboard. It snaps
 * to the nearest bucket's centre and states that bucket's own figures, so a
 * reading never depends on an estimate from the picture. A pointer's position
 * arrives here in the SVG's own viewBox units: `chartInPlot` says whether it is
 * over the plot at all and `chartNearestIndex` where the rule belongs.
 *
 * Every rule here is pure.
 */

// A whole-number ceiling a chart can divide cleanly: the smallest of the
// friendly steps above the largest value.
export function chartCeiling(value) {
  if (!isFinite(value) || value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const scaled = value / magnitude;
  for (let i = 0; i < steps.length; i++) {
    if (scaled <= steps[i]) return steps[i] * magnitude;
  }
  return 10 * magnitude;
}

// The plot's own geometry: where it starts, how wide one bucket is, how tall it
// is and the value its top stands for. `bw` divides the plot over the buckets,
// so a bucket's centre is half a bucket in from its own left edge.
export function chartGeometry(width, height, pad, count, max) {
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  return {
    left: pad.l,
    top: pad.t,
    plotW: plotW,
    plotH: plotH,
    bw: plotW / Math.max(1, count),
    max: max,
    count: count
  };
}

// A bucket index as the x of its centre, and a value as its y on the plot.
export function chartX(index, geom) {
  return geom.left + index * geom.bw + geom.bw / 2;
}

export function chartY(value, geom) {
  return geom.top + geom.plotH - (value / geom.max) * geom.plotH;
}

// Whether a point, in the SVG's viewBox units, is over the plot - inside its
// edges and under its top. The axis labels, the ticks and the margin are not
// the plot.
export function chartInPlot(x, y, geom) {
  return x >= geom.left && x <= geom.left + geom.plotW &&
    y >= geom.top && y <= geom.top + geom.plotH;
}

// The bucket whose centre is nearest an x: the ruler snaps to a data point
// rather than standing between two. A pointer past either end lands on the end
// bucket rather than nowhere. An empty chart has no bucket to snap to, and
// answers -1.
export function chartNearestIndex(x, geom) {
  if (!(geom.count > 0) || !(geom.bw > 0)) return -1;
  const index = Math.round((x - geom.left - geom.bw / 2) / geom.bw);
  return Math.min(Math.max(index, 0), geom.count - 1);
}

// One series as a polyline through the bucket centres: the allocation line, and
// the capacity's own top edge.
export function chartLinePath(buckets, geom, key) {
  if (!buckets.length) return "";
  return buckets.map(function (bucket, i) {
    return (i === 0 ? "M" : "L") + chartX(i, geom) + " " + chartY(bucket[key], geom);
  }).join(" ");
}

// The capacity as the area between its line and the baseline, closed along the
// bottom edge: the band the allocation line rides against.
export function chartBandPath(buckets, geom) {
  if (!buckets.length) return "";
  const base = geom.top + geom.plotH;
  const first = chartX(0, geom);
  const last = chartX(buckets.length - 1, geom);
  const top = chartLinePath(buckets, geom, "capacity");
  return top + " L" + last + " " + base + " L" + first + " " + base + " Z";
}

// One bucket's reading, as the ruler states it: the bucket's own label as the
// axis writes it, the allocated and capacity figures as a slash-separated pair
// and the share after them. A bucket the plan offers no capacity in has no
// share to divide, and says so instead of claiming 0% or an infinity.
export function chartReadout(bucket) {
  const allocated = Math.round(bucket.alloc);
  const capacity = Math.round(bucket.capacity);
  const figures = bucket.label + ": " + allocated + "/" + capacity + " FTE-days";
  if (!(bucket.capacity > 0)) return figures + " \u00b7 no capacity";
  return figures + " \u00b7 " + Math.round((bucket.alloc / bucket.capacity) * 100) + "%";
}

// The paper under the readout's words: the ink `getBBox` measures plus a small
// padding, so a long bucket label is never clipped and the paper never ends
// short of the text. The padding is even either side, which puts the paper's
// own left edge on the group's origin.
export function chartReadoutBox(ink) {
  return { x: ink.x - 6, y: ink.y - 4, width: ink.width + 12, height: ink.height + 8 };
}

// Where the readout's group sits: the plot's bottom-left corner, inset by the
// same small margin it already took, and lifted by the paper's own height so
// the paper stands above the baseline rather than into the axis labels under
// it. The height is measured, not guessed, so the placement follows the words.
export function chartReadoutAt(geom, box) {
  return {
    x: geom.left + 4,
    y: geom.top + geom.plotH - 4 - (box.y + box.height)
  };
}

// Where a key press moves the ruler, or null for a key the chart does not use.
// The arrows walk one bucket at a time and stop at the ends; Home and End jump
// there. A chart nobody has read yet starts at its first bucket, whichever
// arrow opens it.
export function chartKeyIndex(key, current, count) {
  if (!(count > 0)) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key !== "ArrowRight" && key !== "ArrowLeft") return null;
  if (current === null || current === undefined) return 0;
  if (key === "ArrowRight") return Math.min(current + 1, count - 1);
  return Math.max(current - 1, 0);
}
