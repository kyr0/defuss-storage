const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./core-BX35Bja8.js","./rolldown-runtime-DK3Fl9T5.js"])))=>i.map(i=>d[i]);
import{f as e,o as t}from"./index-BJzDNxX_.js";import{t as n}from"./status-C5KdH_FW.js";var r,i=()=>r??=(async()=>{let[{createHighlighterCore:e},{createJavaScriptRegexEngine:n}]=await Promise.all([t(()=>import(`./core-BX35Bja8.js`),__vite__mapDeps([0,1]),import.meta.url),t(()=>import(`./engine-javascript-C30F4iNc.js`),[],import.meta.url)]);return e({themes:[t(()=>import(`./github-light-high-contrast-B68TUdTA.js`),[],import.meta.url),t(()=>import(`./github-dark-high-contrast-B_tTalzw.js`),[],import.meta.url)],langs:[t(()=>import(`./javascript-BgS3c2Ky.js`),[],import.meta.url)],engine:n()})})(),a=e=>e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`);function o(e,t){let n=!1;try{n=document.execCommand(`insertText`,!1,t)}catch{n=!1}n||(e.setRangeText(t,e.selectionStart,e.selectionEnd,`end`),e.dispatchEvent(new Event(`input`,{bubbles:!0})))}function s(e,t){let n=e.querySelector(`.code-example-editor`),r=e.querySelector(`.code-example-paint`),s=e.querySelector(`.code-example-src`),c,l=!1,u=()=>{r.scrollTop=s.scrollTop,r.scrollLeft=s.scrollLeft},d=()=>{let e=s.value;e!==c&&i().then(t=>{if(s.value!==e)return;let i=t.codeToHtml(e,{lang:`javascript`,themes:{light:`github-light-high-contrast`,dark:`github-dark-high-contrast`},defaultColor:!1,cssVariablePrefix:`--code-example-`}),o=/<code[^>]*>([\s\S]*)<\/code>/.exec(i)?.[1]??a(e);r.innerHTML=`${o}\n`,n.setAttribute(`data-painted`,``),c=e,u()}).catch(()=>{n.removeAttribute(`data-painted`)})};return s.addEventListener(`input`,d),s.addEventListener(`scroll`,u),s.addEventListener(`keydown`,e=>{if(!e.isComposing){if(e.key===`Escape`)l=!0;else if(e.key===`Tab`&&!e.ctrlKey&&!e.metaKey&&!e.altKey){if(l){l=!1;return}e.preventDefault();let t=s.value,n=s.selectionStart,r=s.selectionEnd,i=t.lastIndexOf(`
`,n-1)+1;if(n===r&&!e.shiftKey){o(s,`  `);return}let a=t.slice(i,r).split(`
`).map(t=>e.shiftKey?t.replace(/^( {1,2}|\t)/,``):`  ${t}`).join(`
`);s.setSelectionRange(i,r),o(s,a),s.setSelectionRange(i,i+a.length)}else if(l=!1,e.key===`Enter`&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey){let t=s.value.lastIndexOf(`
`,s.selectionStart-1)+1,n=/^[\t ]*/.exec(s.value.slice(t,s.selectionStart))?.[0]??``;if(!n)return;e.preventDefault(),o(s,`\n${n}`)}}}),s.value=t,d(),{get value(){return s.value},set(e){s.value=e,d()},focus(){s.focus()}}}var c={chunks:`import { appendChunks } from 'defuss-storage';
import { createOPFSStorage } from 'defuss-storage/opfs';

const storage = await createOPFSStorage({ name: 'playground' });
const file = await storage.open('numbers.bin', { create: true });
try {
  await file.truncate(0);
  async function* source() {
    for (let i = 0; i < 1000; i++) yield new Uint8Array(1024).fill(i % 256);
  }
  const started = performance.now();
  let count = 0;
  for await (const receipt of appendChunks(file, source(), { inFlight: 16 })) count++;
  console.log('appended', count, 'chunks in', Math.round(performance.now() - started), 'ms');
  console.log('size', await file.size());
  console.log('last 4 bytes', [...await file.readExactly(await file.size() - 4, 4)]);
  await file.flush();
} finally {
  await file.close();
}
console.log('files', await storage.list());
`,owner:`import { createOPFSStorage } from 'defuss-storage/opfs';

const storage = await createOPFSStorage({ name: 'playground' });
const first = await storage.open('owned.bin', { create: true });
try {
  await storage.open('owned.bin');
} catch (error) {
  console.log('second open:', error.code); // BUSY: one owner per file
}
await first.close();
const again = await storage.open('owned.bin');
console.log('after close: opened again, size', await again.size());
await again.close();

try {
  await storage.open('missing.bin');
} catch (error) {
  console.log('missing file:', error.code);
}
try {
  await again.append(new Uint8Array(1));
} catch (error) {
  console.log('closed handle:', error.code);
}
`,stream:`import { createOPFSStorage } from 'defuss-storage/opfs';

const storage = await createOPFSStorage({ name: 'playground' });
const file = await storage.open('stream.bin', { create: true });
try {
  await file.truncate(0);
  const block = new Uint8Array(1024 * 1024);
  for (let i = 0; i < block.length; i++) block[i] = i % 251;
  for (let i = 0; i < 8; i++) await file.append(block);

  let sum = 0;
  let chunks = 0;
  const started = performance.now();
  for await (const chunk of file.stream({ chunkSize: 64 * 1024 })) {
    for (const byte of chunk) sum = (sum + byte) % 65521;
    chunks++;
  }
  console.log(chunks, 'chunks, checksum', sum, 'in', Math.round(performance.now() - started), 'ms');
} finally {
  await file.close();
}
`,errors:`import { createOPFSStorage } from 'defuss-storage/opfs';

const storage = await createOPFSStorage({ name: 'playground' });
const file = await storage.open('buffered.log', { create: true, writeBuffer: 64 * 1024 });
try {
  await file.truncate(0);
  const line = new TextEncoder().encode('a small record\\n');
  const started = performance.now();
  for (let i = 0; i < 5000; i++) await file.append(line);
  console.log('5000 buffered appends in', Math.round(performance.now() - started), 'ms');
  console.log('size includes buffered bytes:', await file.size());
  await file.flush(); // writes the buffer, then flushes the handle
} finally {
  await file.close();
}
`},l=2e4;function u(t){let r=t.querySelector(`#play-preset`),i=t.querySelector(`[data-console]`),a=t.querySelector(`[data-action="run"]`),o=s(t.querySelector(`[data-editor]`),c.chunks),u,d=(e,t=`default`)=>{let n=document.createElement(`pre`);n.dataset.prefix=`>`,t!=="default"&&(n.dataset.tone=t);let r=document.createElement(`code`);r.textContent=e,n.append(r),i.append(n),i.scrollTop=i.scrollHeight},f=()=>{u?.terminate(),u=void 0,a.disabled=!1},p=()=>{if(u)return;i.replaceChildren(),a.disabled=!0,u=new Worker(new URL(new URL(`playground.worker-DOZIuu1U.js`,import.meta.url).href,``+import.meta.url),{type:`module`});let t=setTimeout(()=>{f(),n(`toastPlayground`,`playgroundTimeout`,{ms:e(l)},`error`)},l);u.onmessage=({data:r})=>{r.type===`line`?d(r.text??``,r.tone):(clearTimeout(t),f(),r.type===`done`?n(`toastPlayground`,`playgroundDone`,{ms:e(r.ms??0)},`ok`):(d(r.message??``,`destructive`),n(`toastPlayground`,`playgroundError`,{message:r.message??``},`error`)))},u.onerror=e=>{clearTimeout(t),f(),n(`toastPlayground`,`playgroundError`,{message:e.message||`worker failed`},`error`)},u.postMessage({source:o.value})};a.addEventListener(`click`,p),t.querySelector(`[data-action="reset"]`).addEventListener(`click`,()=>o.set(c[r.value])),r.addEventListener(`change`,()=>o.set(c[r.value])),t.querySelector(`.code-example-src`).addEventListener(`keydown`,e=>{let t=e;t.key===`Enter`&&(t.ctrlKey||t.metaKey)&&(t.preventDefault(),p())}),t.querySelector(`[data-copy-editor]`).addEventListener(`click`,()=>void navigator.clipboard?.writeText(o.value)),t.dataset.ready=``}export{u as initPlayground};