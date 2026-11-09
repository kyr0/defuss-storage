function e(e,t,n){let r=document.createElement(`span`);r.style.color=`var(${t})`,e.append(r);let i=getComputedStyle(r).color;r.remove();let a=document.createElement(`canvas`);a.width=a.height=1;let o=a.getContext(`2d`);if(!o||!i)return n;o.fillStyle=i,o.fillRect(0,0,1,1);let[s,c,l]=o.getImageData(0,0,1,1).data;return[s/255,c/255,l/255]}function t(e,t,n){let r=e.createShader(t);if(e.shaderSource(r,n),e.compileShader(r),!e.getShaderParameter(r,e.COMPILE_STATUS))throw Error(e.getShaderInfoLog(r)??`shader compile failed`);return r}function n(n){let r=n.getContext(`webgl`,{antialias:!1,alpha:!1,preserveDrawingBuffer:!1});if(!r)return!1;let i=r.createProgram();if(r.attachShader(i,t(r,r.VERTEX_SHADER,`attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`)),r.attachShader(i,t(r,r.FRAGMENT_SHADER,`precision mediump float;
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
}`)),r.linkProgram(i),!r.getProgramParameter(i,r.LINK_STATUS))return!1;r.useProgram(i);let a=r.createBuffer();r.bindBuffer(r.ARRAY_BUFFER,a),r.bufferData(r.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),r.STATIC_DRAW);let o=r.getAttribLocation(i,`p`);r.enableVertexAttribArray(o),r.vertexAttribPointer(o,2,r.FLOAT,!1,0,0);let[s,c,l,u,d,f,p]=[`u_size`,`u_time`,`u_scroll`,`u_cell`,`u_ink`,`u_head`,`u_ground`].map(e=>r.getUniformLocation(i,e)),m=()=>{r.uniform3fv(d,e(n,`--st-shader-ink`,[.2,.83,.78])),r.uniform3fv(f,e(n,`--st-shader-head`,[.75,.95,.3])),r.uniform3fv(p,e(n,`--st-shader-ground`,[.03,.06,.07]))};m();let h=matchMedia(`(prefers-reduced-motion: reduce)`),g=n.closest(`.parallax`)??n,_=!1,v=0,y=performance.now(),b=()=>{let e=Math.min(devicePixelRatio||1,1.5),{width:t,height:i}=n.getBoundingClientRect();n.width=Math.max(1,Math.round(t*e)),n.height=Math.max(1,Math.round(i*e)),r.viewport(0,0,n.width,n.height),r.uniform2f(s,n.width,n.height),r.uniform1f(u,22*e)},x=()=>{let e=g.getBoundingClientRect(),t=e.height-innerHeight;return t>0?Math.min(1,Math.max(0,-e.top/t)):0},S=e=>{r.uniform1f(c,h.matches?6:(e-y)/1e3),r.uniform1f(l,h.matches?.5:x()),r.drawArrays(r.TRIANGLES,0,3),v=_&&!h.matches?requestAnimationFrame(S):0},C=()=>{v||=requestAnimationFrame(S)};return new ResizeObserver(()=>{b(),C()}).observe(n),new IntersectionObserver(([e])=>{_=!!e?.isIntersecting,_&&C()}).observe(n),new MutationObserver(()=>{m(),C()}).observe(document.documentElement,{attributes:!0,attributeFilter:[`class`]}),h.addEventListener(`change`,C),b(),C(),!0}export{n as startShader};