/** Procedural textures — no external art, ever. Each returns a canvas we hand to Three. */
function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function noiseFill(ctx: CanvasRenderingContext2D, size: number, base: string, spots: string[], density: number) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < density; i++) {
    ctx.fillStyle = spots[(Math.random() * spots.length) | 0];
    const x = Math.random() * size, y = Math.random() * size, r = 1 + Math.random() * 3;
    ctx.globalAlpha = 0.25 + Math.random() * 0.4;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function grassTexture(size = 256) {
  const [c, ctx] = canvas(size);
  noiseFill(ctx, size, '#4b7a34', ['#3d6b2a', '#5f8f3f', '#2f5a22', '#6ba04a'], size * 12);
  return c;
}
export function dirtTexture(size = 256) {
  const [c, ctx] = canvas(size);
  noiseFill(ctx, size, '#7a6142', ['#6a5136', '#8b7150', '#5d4630'], size * 10);
  return c;
}
export function rockTexture(size = 256) {
  const [c, ctx] = canvas(size);
  noiseFill(ctx, size, '#6e6e73', ['#5a5a60', '#83838a', '#4b4b50'], size * 10);
  return c;
}
export function roadTexture(size = 128) {
  const [c, ctx] = canvas(size);
  noiseFill(ctx, size, '#8a7657', ['#7a684c', '#9a8666'], size * 8);
  return c;
}
