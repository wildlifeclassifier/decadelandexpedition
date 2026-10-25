// Smooth wheel zoom (ported from the Shiny app's www/smooth-zoom.js).
// Scroll input becomes a continuous zoom target anchored under the cursor; while
// the gesture runs the view moves with Leaflet's internal _move() (CSS transforms
// only), and one real re-render happens when the target is reached.
// Requires the map to be created with zoomSnap = 0 and scrollWheelZoom = false.
window.installSmoothZoom = function (map) {
  var SENSITIVITY = 0.006, MAX_STEP = 1.2, SETTLE_MS = 110;
  if (map._smoothWheelInstalled) return;
  map._smoothWheelInstalled = true;
  if (map.scrollWheelZoom) map.scrollWheelZoom.disable();

  var target = map.getZoom(), frame = null, anchor = null, last = 0, moving = false;

  function centerFor(zoom) {
    var scale = map.getZoomScale(zoom), half = map.getSize().divideBy(2),
        off = anchor.subtract(half).multiplyBy(1 - 1 / scale);
    return map.containerPointToLatLng(half.add(off));
  }
  function begin() { if (!moving) { moving = true; map._moveStart(true, false); } }
  function finish(zoom) {
    map._move(centerFor(zoom), zoom);
    moving = false; frame = null;
    map._moveEnd(true);
  }
  function tick(now) {
    var dt = Math.min(64, now - last); last = now;
    var z = map.getZoom(), diff = target - z;
    if (Math.abs(diff) < 0.004) return finish(target);
    var k = 1 - Math.exp(-dt / SETTLE_MS);
    var nz = z + diff * k;
    map._move(centerFor(nz), nz);
    frame = window.requestAnimationFrame(tick);
  }
  map.getContainer().addEventListener("wheel", function (e) {
    e.preventDefault();
    var d = e.deltaY;
    if (e.deltaMode === 1) d *= 18; else if (e.deltaMode === 2) d *= 400;
    var step = Math.max(-MAX_STEP, Math.min(MAX_STEP, -d * SENSITIVITY));
    if (!frame) { target = map.getZoom(); last = performance.now(); }
    target = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), target + step));
    anchor = map.mouseEventToContainerPoint(e);
    begin();
    if (!frame) frame = window.requestAnimationFrame(tick);
  }, { passive: false });
};
