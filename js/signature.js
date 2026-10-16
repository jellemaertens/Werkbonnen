// Signature pad on a <canvas>: works with finger, stylus and mouse (pointer events).
class SignaturePad {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = 0;
    this.drawing = false;
    this.points = [];
    this.resize = this.resize.bind(this);
    this.resize();
    window.addEventListener('resize', this.resize);

    canvas.addEventListener('pointerdown', e => this.start(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.end(e));
    canvas.addEventListener('pointercancel', e => this.end(e));
    canvas.addEventListener('pointerleave', e => this.end(e));
  }

  resize() {
    // Keep the drawing when the canvas size changes (e.g. rotating a tablet)
    const prev = this.strokes ? this.canvas.toDataURL() : null;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * ratio);
    this.canvas.height = Math.round(rect.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = '#0f172a';
    if (prev) {
      const img = new Image();
      img.onload = () => this.ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = prev;
    }
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure || 0.5 };
  }

  start(e) {
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.drawing = true;
    this.points = [this.pos(e)];
    const p = this.points[0];
    this.ctx.beginPath();
    this.ctx.fillStyle = '#0f172a';
    this.ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
    this.ctx.fill();
  }

  move(e) {
    if (!this.drawing) return;
    e.preventDefault();
    const pts = this.points;
    pts.push(this.pos(e));
    if (pts.length < 3) return;
    // Smooth curve through the midpoints of the last three samples
    const [a, b, c] = pts.slice(-3);
    const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const m2 = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
    const pressure = e.pointerType === 'pen' ? b.p : 0.5;
    this.ctx.lineWidth = 1.6 + pressure * 2.2;
    this.ctx.beginPath();
    this.ctx.moveTo(m1.x, m1.y);
    this.ctx.quadraticCurveTo(b.x, b.y, m2.x, m2.y);
    this.ctx.stroke();
  }

  end() {
    if (!this.drawing) return;
    this.drawing = false;
    this.strokes++;
    this.onChange?.();
  }

  clear() {
    const r = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, r.width, r.height);
    this.strokes = 0;
    this.onChange?.();
  }

  isEmpty() { return this.strokes === 0; }

  // Returns a PNG cropped to the drawn area, on a white background
  toDataURL() {
    const { width, height } = this.canvas;
    const data = this.ctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 0) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const pad = 12;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(width, maxX + pad); maxY = Math.min(height, maxY + pad);
    const out = document.createElement('canvas');
    out.width = maxX - minX; out.height = maxY - minY;
    const octx = out.getContext('2d');
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(this.canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  destroy() { window.removeEventListener('resize', this.resize); }
}
