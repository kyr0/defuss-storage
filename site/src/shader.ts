// The flythrough band's background: a field of byte cells that a write head
// fills in append order, one WebGL fragment shader. Why a shader instead of a
// few thousand DOM cells: one draw call per frame, no layout work while the
// page scrolls. It runs only while the band is on screen, renders one still
// frame under prefers-reduced-motion, and the band keeps its CSS background
// when WebGL is unavailable. UNKNOWN: its frame cost on low-end integrated GPUs
// (not measured; a performance trace on such a laptop would settle it).

const VERTEX = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAGMENT = `precision mediump float;
uniform vec2 u_size;
uniform float u_time;
uniform float u_scroll;
uniform float u_cell;
uniform vec3 u_ink;
uniform vec3 u_head;
uniform vec3 u_ground;

float hash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 cell = floor(px / u_cell);
  vec2 local = fract(px / u_cell);
  float columns = floor(u_size.x / u_cell);
  float rows = floor(u_size.y / u_cell);
  // Cells count from the top left, like bytes in a hex dump.
  float index = (rows - 1.0 - cell.y) * columns + cell.x;
  float total = columns * rows;
  // The head follows the scroll through the pinned stage, so the visible middle
  // band fills while the words pass; a slow drift keeps it moving at rest.
  float head = u_scroll * total * 1.1 + mod(u_time * 9.0, columns);
  float written = step(index, head);
  float age = clamp((head - index) / (columns * 4.0), 0.0, 1.0);
  float byte = hash(cell);
  float flicker = 0.5 + 0.5 * sin(u_time * 1.6 + byte * 40.0);
  // Rounded cell with a gap.
  vec2 d = abs(local - 0.5);
  float box = 1.0 - smoothstep(0.34, 0.38, max(d.x, d.y));
  float idle = 0.07 + 0.08 * flicker * step(0.72, byte);
  float glow = mix(idle, (0.3 + 0.6 * byte) * (1.0 - 0.45 * age), written);
  float trail = written * (1.0 - smoothstep(0.0, columns * 0.6, head - index));
  float isHead = (1.0 - step(1.0, abs(index - floor(head))));
  vec3 colour = u_ground + box * u_ink * glow;
  colour = mix(colour, u_head, box * max(isHead, trail * 0.35));
  // Fade towards the edges so the words stay readable.
  vec2 uv = px / u_size - 0.5;
  float vignette = smoothstep(0.75, 0.15, length(uv * vec2(1.0, 1.4)));
  gl_FragColor = vec4(mix(u_ground, colour, vignette), 1.0);
}`;

/** `#rrggbb` or `rgb()` CSS colour of `property` on `element` as 0..1 floats. */
function cssColour(element: Element, property: string, fallback: [number, number, number]): [number, number, number] {
  const probe = document.createElement('span');
  probe.style.color = `var(${property})`;
  element.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  // Computed colours may be rgb() or a modern space; render a pixel to normalize.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context || !value) return fallback;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r! / 255, g! / 255, b! / 255];
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
  return shader;
}

/** Starts the shader on `canvas`; returns false when WebGL is unavailable. */
export function startShader(canvas: HTMLCanvasElement): boolean {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
  if (!gl) return false;
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const [uSize, uTime, uScroll, uCell, uInk, uHead, uGround] =
    ['u_size', 'u_time', 'u_scroll', 'u_cell', 'u_ink', 'u_head', 'u_ground'].map(uniform);

  const colours = () => {
    gl.uniform3fv(uInk!, cssColour(canvas, '--st-shader-ink', [0.2, 0.83, 0.78]));
    gl.uniform3fv(uHead!, cssColour(canvas, '--st-shader-head', [0.75, 0.95, 0.3]));
    gl.uniform3fv(uGround!, cssColour(canvas, '--st-shader-ground', [0.03, 0.06, 0.07]));
  };
  colours();

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const scene = canvas.closest('.parallax') ?? canvas;
  let visible = false;
  let frame = 0;
  const started = performance.now();

  const resize = () => {
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uSize!, canvas.width, canvas.height);
    gl.uniform1f(uCell!, 22 * ratio);
  };
  const scrollProgress = () => {
    const box = scene.getBoundingClientRect();
    const span = box.height - innerHeight;
    return span > 0 ? Math.min(1, Math.max(0, -box.top / span)) : 0;
  };
  const draw = (now: number) => {
    gl.uniform1f(uTime!, reduced.matches ? 6 : (now - started) / 1000);
    gl.uniform1f(uScroll!, reduced.matches ? 0.5 : scrollProgress());
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    frame = visible && !reduced.matches ? requestAnimationFrame(draw) : 0;
  };
  const kick = () => { if (!frame) frame = requestAnimationFrame(draw); };

  new ResizeObserver(() => { resize(); kick(); }).observe(canvas);
  new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting); if (visible) kick(); }).observe(canvas);
  new MutationObserver(() => { colours(); kick(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  reduced.addEventListener('change', kick);
  resize();
  kick();
  return true;
}
