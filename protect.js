(function (w, d) {
  "use strict";

  // Grid size: 6x6
  var GRID = 6;

  // Target processed image width
  var PROC_W = 500;

  // Total number of grid cells
  var TOTAL = GRID * GRID;

  // All active items
  var items = [];

  // requestAnimationFrame id
  var rafId = 0;

  // Random seed
  var seed = (Date.now() ^ (Math.random() * 4294967296)) >>> 0 || 1;

  // Fast pseudo-random generator
  function rnd() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  }

  // Fisher-Yates shuffle
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = (rnd() * (i + 1)) | 0;
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
  }

  /* ---------- idle preparation queue (does not block main thread) ---------- */

  // Items waiting to be prepared
  var prepQ = [];
  var prepScheduled = false;

  // Use requestIdleCallback if available, otherwise setTimeout
  var idleFn = w.requestIdleCallback
    ? function (fn) { w.requestIdleCallback(fn, { timeout: 250 }); }
    : function (fn) { setTimeout(fn, 0); };

  // Schedule preparation during idle time
  function schedulePrep() {
    if (prepScheduled) return;
    prepScheduled = true;
    idleFn(runPrep);
  }

  // Run preparation tasks within idle budget
  function runPrep(deadline) {
    prepScheduled = false;
    var budget = deadline && deadline.timeRemaining
      ? deadline.timeRemaining() - 1
      : 4;

    while (prepQ.length && budget > 0) {
      var it = prepQ.shift();
      var t0 = performance.now();
      prepare(it);
      budget -= performance.now() - t0;
    }

    if (prepQ.length) schedulePrep();
  }

  // Add item to preparation queue
  function queuePrep(it) {
    if (it.buf || it.queued) return;
    it.queued = 1;
    prepQ.push(it);
    schedulePrep();
  }

  /* ---------- item ---------- */

  // Create an item from an image element
  function makeItem(img) {
    var nw = img.naturalWidth;
    var nh = img.naturalHeight;

    // Skip small or invalid images
    if (!nw || !nh || nw < PROC_W) return null;

    var sw = PROC_W;
    var sh = Math.max(1, Math.round(nh * sw / nw));

    // Create visible canvas
    var cv = d.createElement("canvas");
    cv.width = sw;
    cv.height = sh;

    // Copy class name
    if (img.className) cv.className = img.className;

    // Copy inline style or set size
    var st = img.getAttribute("style");
    if (st) {
      cv.setAttribute("style", st);
    } else if (!img.className) {
      cv.style.width = (img.clientWidth || nw) + "px";
      cv.style.height = (img.clientHeight || nh) + "px";
    }

    var ctx = cv.getContext("2d", {
      alpha: true,
      desynchronized: true
    });

    ctx.imageSmoothingEnabled = false;

    return {
      img: img,
      cv: cv,
      ctx: ctx,
      sw: sw,
      sh: sh,
      buf: null,
      cols: null,
      rows: null,
      seq: null,
      ptr: 0,
      prev: -1,
      vis: false,
      queued: 0,
      busy: 0
    };
  }

  // Prepare item: resize image off main thread when possible
  function prepare(it) {
    if (it.buf || it.busy || !it.img || !it.img.naturalWidth) return;
    it.busy = 1;

    var sw = it.sw;
    var sh = it.sh;
    var src = it.img;

    // Use createImageBitmap for off-main-thread resizing if available
    if (w.createImageBitmap) {
      w.createImageBitmap(src, {
        resizeWidth: sw,
        resizeHeight: sh,
        resizeQuality: "high"
      }).then(function (bmp) {
        build(it, bmp, sw, sh);
      }, function () {
        build(it, src, sw, sh);
      });
      return;
    }

    build(it, src, sw, sh);
  }

  // Build buffer canvas and grid data
  function build(it, src, sw, sh) {
    if (it.buf) {
      if (src && typeof src.close === "function") src.close();
      return;
    }

    var buf = d.createElement("canvas");
    buf.width = sw;
    buf.height = sh;

    var bx = buf.getContext("2d");
    bx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in bx) {
      bx.imageSmoothingQuality = "high";
    }

    bx.drawImage(src, 0, 0, sw, sh);
    if (src && typeof src.close === "function") src.close();

    it.buf = buf;
    it.img = null;
    it.busy = 0;

    // Precompute column and row boundaries
    var cols = new Int32Array(GRID + 1);
    var rows = new Int32Array(GRID + 1);

    for (var i = 0; i <= GRID; i++) {
      cols[i] = (i * sw / GRID + 0.5) | 0;
      rows[i] = (i * sh / GRID + 0.5) | 0;
    }

    it.cols = cols;
    it.rows = rows;

    // Create shuffled cell order
    var seq = new Uint8Array(TOTAL);
    for (i = 0; i < TOTAL; i++) seq[i] = i;

    shuffle(seq);
    it.seq = seq;

    if (it.vis) kick();
  }

  /* ---------- drawing ---------- */

  // Draw one random grid cell
  function draw(it) {
    var ctx = it.ctx;
    var c = it.cols;
    var r = it.rows;
    var buf = it.buf;

    var pi = it.prev;

    // Clear previous cell
    if (pi >= 0) {
      var pc = pi % GRID;
      var pr = (pi / GRID) | 0;
      ctx.clearRect(c[pc], r[pr], c[pc + 1] - c[pc], r[pr + 1] - r[pr]);
    }

    var p = it.ptr;
    var idx = it.seq[p];

    // Move pointer and reshuffle when finished
    if (++p === TOTAL) {
      shuffle(it.seq);
      p = 0;
    }

    var cc = idx % GRID;
    var rr = (idx / GRID) | 0;

    var x = c[cc];
    var y = r[rr];
    var tw = c[cc + 1] - x;
    var th = r[rr + 1] - y;

    // Draw the selected cell
    if (tw > 0 && th > 0) {
      ctx.drawImage(buf, x, y, tw, th, x, y, tw, th);
    }

    it.prev = idx;
    it.ptr = p;
  }

  // Main animation loop
  function loop() {
    rafId = 0;
    var active = 0;

    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i];

      // Remove disconnected items
      if (!it.cv.isConnected) {
        if (io) io.unobserve(it.cv);
        if (ioPrep) ioPrep.unobserve(it.cv);
        items.splice(i, 1);
        continue;
      }

      if (!it.vis || !it.buf) continue;

      draw(it);
      active++;
    }

    // Continue only if there is active work
    if (active) {
      rafId = requestAnimationFrame(loop);
    }
  }

  // Start animation loop if needed
  function kick() {
    if (!rafId && items.length) {
      rafId = requestAnimationFrame(loop);
    }
  }

  /* ---------- observers ---------- */

  // Observe visibility to start/stop drawing
  var io = w.IntersectionObserver
    ? new w.IntersectionObserver(function (es) {
        var need = false;

        for (var i = 0; i < es.length; i++) {
          var it = es[i].target.__asp;
          if (!it) continue;

          if (es[i].isIntersecting) {
            it.vis = true;
            if (!it.buf) prepare(it); // prepare if not ready yet
            need = true;
          } else {
            it.vis = false;
          }
        }

        if (need) kick();
      }, { rootMargin: "0px" })
    : null;

  // Prepare buffer before the element becomes visible
  var ioPrep = w.IntersectionObserver
    ? new w.IntersectionObserver(function (es) {
        for (var i = 0; i < es.length; i++) {
          if (!es[i].isIntersecting) continue;
          var it = es[i].target.__asp;
          if (!it) continue;
          ioPrep.unobserve(it.cv);
          queuePrep(it);
        }
      }, { rootMargin: "400px 0px" })
    : null;

  /* ---------- binding ---------- */

  // Replace image with its canvas version
  function mount(img) {
    if (!img.parentNode || img.naturalWidth < PROC_W) return;

    var it = makeItem(img);
    if (!it) return;

    it.cv.__asp = it;
    img.parentNode.replaceChild(it.cv, img);
    items.push(it);

    if (io) {
      io.observe(it.cv);
      if (ioPrep) ioPrep.observe(it.cv);
      else queuePrep(it);
    } else {
      it.vis = true;
      prepare(it);
    }

    kick();
  }

  // Attach behavior to a single image
  function attach(img) {
    if (!img || img.__asp || img.tagName !== "IMG") return;
    if (img.dataset && img.dataset.asp === "off") return;

    img.__asp = 1;

    // If image is already loaded, mount immediately
    if (img.complete && img.naturalWidth) {
      mount(img);
      return;
    }

    // Otherwise wait for load
    img.addEventListener("load", function () {
      mount(img);
    }, { once: true });
  }

  // Scan a root element for images
  function scan(root) {
    var l = (root || d).querySelectorAll("img");
    for (var i = 0; i < l.length; i++) {
      attach(l[i]);
    }
  }

  // Initial boot
  function boot() {
    scan(d);

    // Watch for new images
    if (w.MutationObserver) {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var add = muts[i].addedNodes;

          for (var j = 0; j < add.length; j++) {
            var n = add[j];
            if (n.nodeType !== 1) continue;

            if (n.tagName === "IMG") attach(n);
            else scan(n);
          }
        }

        kick();
      }).observe(d.documentElement, {
        childList: true,
        subtree: true
      });
    }

    kick();
  }

  // Start after DOM is ready
  if (d.readyState === "loading") {
    d.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // Public API
  w.AntiSS = {
    refresh: function () {
      scan(d);
      kick();
    }
  };
})(window, document);