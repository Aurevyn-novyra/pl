/* script.js
   Client-side logic:
   - Handles PDF file selection
   - Uses PDF.js to render pages to canvases -> data URLs
   - Injects pages into DOM and initializes StPageFlip (page-flip)
   - Provides toolbar (prev/next/zoom/fullscreen/close)
   - Accessibility & keyboard controls
*/

/* ========== Config / helpers ========== */
const SELECTORS = {
  landing: '#landing',
  fileInput: '#file-input',
  demoOpen: '#demo-open',
  viewer: '#viewer',
  loader: '#loader',
  loaderText: '#loader-text',
  loaderProgress: '#loader-progress > div',
  flipbookWrap: '#flipbook-wrap',
  flipbook: '#flipbook',
  btnPrev: '#btn-prev',
  btnNext: '#btn-next',
  btnZoomIn: '#btn-zoom-in',
  btnZoomOut: '#btn-zoom-out',
  btnFull: '#btn-fullscreen',
  btnClose: '#btn-close',
  pageCurrent: '#page-current',
  pageTotal: '#page-total'
};

const el = sel => document.querySelector(sel);
const show = (node) => node.classList.remove('hidden');
const hide = (node) => node.classList.add('hidden');

/* page-flip instance holder */
let pageFlip = null;
let pagesCount = 0;
let currentZoom = 1;
const MIN_ZOOM = 0.6, MAX_ZOOM = 2.2, ZOOM_STEP = 0.15;

/* PDF.js worker - ensure correct worker src for the version loaded via CDN */
if (window['pdfjsLib']) {
  // match the CDN version used in index.html; this value must point to a worker shipped with the same build
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.7.570/pdf.worker.min.js';
}

/* ========== UI references ========== */
const landing = el(SELECTORS.landing);
const fileInput = el(SELECTORS.fileInput);
const demoOpen = el(SELECTORS.demoOpen);
const viewer = el(SELECTORS.viewer);
const loader = el(SELECTORS.loader);
const loaderText = el(SELECTORS.loaderText);
const loaderProgress = el(SELECTORS.loaderProgress);
const flipbookWrap = el(SELECTORS.flipbookWrap);
const flipbook = el(SELECTORS.flipbook);
const btnPrev = el(SELECTORS.btnPrev);
const btnNext = el(SELECTORS.btnNext);
const btnZoomIn = el(SELECTORS.btnZoomIn);
const btnZoomOut = el(SELECTORS.btnZoomOut);
const btnFull = el(SELECTORS.btnFull);
const btnClose = el(SELECTORS.btnClose);
const pageCurrent = el(SELECTORS.pageCurrent);
const pageTotal = el(SELECTORS.pageTotal);

/* ========== Utilities ========== */
function setProgress(percent, text) {
  loaderProgress.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (text) loaderText.textContent = text;
}
function resetViewerState() {
  // clear flipbook DOM
  flipbook.innerHTML = '';
  pagesCount = 0;
  pageCurrent.textContent = '0';
  pageTotal.textContent = '0';
  currentZoom = 1;
}

/* ========== PDF processing ========== */
async function processPDF(arrayBuffer) {
  // Show loader
  show(loader);
  hide(flipbookWrap);
  setProgress(0, 'Parsing PDF…');

  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, disableFontFace: true });
    const pdfDoc = await loadingTask.promise;
    const total = pdfDoc.numPages;
    pagesCount = total;
    pageTotal.textContent = total;

    // Render each page sequentially (keeps memory predictable)
    const pageImages = [];
    for (let i = 1; i <= total; i++) {
      setProgress(Math.round(((i - 1) / total) * 100), `Rendering page ${i} of ${total}…`);
      const page = await pdfDoc.getPage(i);

      // scale strategy: make images crisp but bounded in width
      const viewport = page.getViewport({ scale: 1 });
      const desiredMaxWidth = 1400; // clamp width to avoid extreme memory usage
      const deviceScale = window.devicePixelRatio || 1;
      const scale = Math.min((desiredMaxWidth / viewport.width) || 2, 2) * deviceScale;

      const scaledViewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(scaledViewport.width);
      canvas.height = Math.ceil(scaledViewport.height);
      const ctx = canvas.getContext('2d', { alpha: false });

      // Fill background to white for better appearance on dark themes
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;

      // convert to compressed image to reduce memory (JPEG 0.85)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      pageImages.push(dataUrl);

      // free the canvas (allow GC)
      canvas.width = canvas.height = 0;
    }

    setProgress(100, 'Rendering complete — opening flipbook…');
    await new Promise(r => setTimeout(r, 250)); // short visual pause
    return pageImages;
  } catch (err) {
    console.error('PDF processing failed', err);
    throw err;
  }
}

/* ========== Build Flipbook DOM and initialize StPageFlip ========== */
function buildFlipbookFromImages(images) {
  // reset previous state
  resetViewerState();

  // create DOM structure expected by StPageFlip
  // each page element: <div class="page"><div class="page-content"><img/></div></div>
  images.forEach((src, idx) => {
    const page = document.createElement('div');
    page.className = 'page';
    // allow 'hard' covers for first & last for better visual
    if (idx === 0 || idx === images.length - 1) page.setAttribute('data-density', 'hard');

    const content = document.createElement('div');
    content.className = 'page-content';

    const img = document.createElement('img');
    img.src = src;
    img.alt = `Page ${idx + 1}`;

    content.appendChild(img);
    page.appendChild(content);
    flipbook.appendChild(page);
  });

  // initialize PageFlip (StPageFlip)
  const BookElement = flipbook;
  // pick constructor from global exports (conservative)
  const PageFlipCtor = window.PageFlip || (window.St && window.St.PageFlip) || (window.HTMLFlipBook && window.HTMLFlipBook.PageFlip);
  if (!PageFlipCtor) {
    throw new Error('PageFlip library not found. Ensure page-flip script was loaded.');
  }

  // Calculate book dimensions slightly responsive
  const wrapperRect = flipbookWrap.getBoundingClientRect();
  const bookWidth = Math.min(1000, Math.max(300, Math.floor(wrapperRect.width * 0.9)));
  const bookHeight = Math.min(1400, Math.max(400, Math.floor(wrapperRect.height * 0.9)));

  // Destroy previous instance safely
  if (pageFlip && typeof pageFlip.destroy === 'function') {
    try { pageFlip.destroy(); } catch (e) { /* ignore */ }
    pageFlip = null;
  }

  pageFlip = new PageFlipCtor(BookElement, {
    width: bookWidth,
    height: bookHeight,
    size: 'stretch',
    usePortrait: false,
    maxShadowOpacity: 0.45,
    showCover: true,
    drawShadow: true,
    flippingTime: 700
  });

  // load pages from HTML (the library will look for children)
  if (typeof pageFlip.loadFromHTML === 'function') {
    pageFlip.loadFromHTML(document.querySelectorAll('#flipbook .page'));
  } else {
    // some builds expose different method names - try generic
    if (typeof pageFlip.loadFromImages === 'function') {
      // fallback: convert images to objects
      pageFlip.loadFromImages(images.map(src => ({ src })));
    }
  }

  // update UI counts
  pagesCount = images.length;
  pageTotal.textContent = pagesCount;

  // events: update current page when flip changes
  try {
    // Many builds offer getCurrentPageIndex() and flipNext/flipPrev
    const updateCurrent = () => {
      if (typeof pageFlip.getCurrentPageIndex === 'function') {
        const idx = pageFlip.getCurrentPageIndex();
        pageCurrent.textContent = Math.min(pagesCount, Math.max(1, idx + 1)); // human-readable
      }
    };
    // install event listener if provided
    if (pageFlip && pageFlip.on && typeof pageFlip.on === 'function') {
      pageFlip.on('flip', () => updateCurrent());
      pageFlip.on('init', () => updateCurrent());
    } else {
      // fallback polling for safety
      setTimeout(updateCurrent, 400);
      setInterval(() => { if (pageFlip) updateCurrent(); }, 900);
    }
  } catch (err) {
    console.warn('Could not attach flip event — using best-effort updates.', err);
  }

  // show flipbook, hide loader
  hide(loader);
  show(flipbookWrap);

  // small fade-in
  flipbookWrap.classList.remove('hidden');
  flipbookWrap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, fill: 'forwards' });
}

/* ========== Toolbar actions ========== */
function prevPage() {
  if (!pageFlip) return;
  if (typeof pageFlip.flipPrev === 'function') pageFlip.flipPrev();
  else if (typeof pageFlip.flip === 'function') pageFlip.flip('prev');
}
function nextPage() {
  if (!pageFlip) return;
  if (typeof pageFlip.flipNext === 'function') pageFlip.flipNext();
  else if (typeof pageFlip.flip === 'function') pageFlip.flip('next');
}
function updateZoom(delta) {
  currentZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +(currentZoom + delta).toFixed(2)));
  // scale the rendered pages container — PageFlip uses internal canvases but scaling the container is a simple UX-friendly approach
  flipbook.style.transform = `scale(${currentZoom})`;
  flipbook.style.transformOrigin = 'center center';
}
function toggleFullscreen() {
  const doc = window.document;
  const elFS = document.documentElement;
  if (!document.fullscreenElement) {
    if (elFS.requestFullscreen) elFS.requestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
}
function closeViewer() {
  // Destroy pageFlip, hide viewer and show landing
  try { if (pageFlip && pageFlip.destroy) pageFlip.destroy(); } catch (e) { /* ignore */ }
  pageFlip = null;
  resetViewerState();
  hide(viewer);
  show(landing);
}

/* ========== File handling ========== */
async function handleFile(file) {
  if (!file) return;
  // Accept only PDFs
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    alert('Please select a PDF file.');
    return;
  }

  // Show viewer and loader
  hide(landing);
  show(viewer);
  show(loader);
  hide(flipbookWrap);
  setProgress(2, 'Reading file…');

  try {
    const arrayBuffer = await file.arrayBuffer();
    const images = await processPDF(arrayBuffer);
    buildFlipbookFromImages(images);
  } catch (err) {
    console.error(err);
    alert('Failed to open PDF. See console for details.');
    closeViewer();
  }
}

/* Demo sample: fetch a small sample PDF from a permissive host (only if CORS allows).
   If not available (or user wants strict offline), we skip demo auto-load.
*/
async function openDemo() {
  // Small inline demo: fetch a tiny sample PDF (public domain). If fetch fails, show message.
  try {
    const sampleUrl = 'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf';
    const resp = await fetch(sampleUrl);
    if (!resp.ok) throw new Error('Demo fetch failed');
    const buf = await resp.arrayBuffer();
    handleFile(new File([buf], 'sample.pdf', { type: 'application/pdf' }));
  } catch (err) {
    console.warn('Demo open failed (CORS or network).', err);
    alert('Unable to open demo sample due to CORS/network restrictions. Please upload a local PDF.');
  }
}

/* ========== Event listeners ========== */
fileInput.addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) handleFile(f);
  // reset input so same-file can be re-selected later
  e.target.value = '';
});

demoOpen.addEventListener('click', (e) => { e.preventDefault(); openDemo(); });

btnPrev.addEventListener('click', prevPage);
btnNext.addEventListener('click', nextPage);
btnZoomIn.addEventListener('click', () => updateZoom(ZOOM_STEP));
btnZoomOut.addEventListener('click', () => updateZoom(-ZOOM_STEP));
btnFull.addEventListener('click', toggleFullscreen);
btnClose.addEventListener('click', closeViewer);

// Keyboard navigation
document.addEventListener('keydown', (ev) => {
  if (viewer.classList.contains('hidden')) return;
  if (ev.key === 'ArrowLeft') { prevPage(); ev.preventDefault(); }
  if (ev.key === 'ArrowRight') { nextPage(); ev.preventDefault(); }
  if (ev.key === '+' || ev.key === '=') { updateZoom(ZOOM_STEP); }
  if (ev.key === '-') { updateZoom(-ZOOM_STEP); }
  if (ev.key === 'Escape') { closeViewer(); }
});

// resize handling: attempt to reflow book when viewport changes
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (!pageFlip) return;
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    try {
      // simple approach: destroy & re-initialize to fit new size (if loadFromHTML available)
      const imgs = Array.from(document.querySelectorAll('#flipbook .page img')).map(i => i.src);
      buildFlipbookFromImages(imgs);
    } catch (e) {
      console.warn('Reflow failed:', e);
    }
  }, 250);
});

/* ========== Initialize tiny accessible enhancements ========== */
(function init() {
  // focus management
  fileInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.click();
  });

  // ensure landing visible at start
  show(landing);
  hide(viewer);
})();
