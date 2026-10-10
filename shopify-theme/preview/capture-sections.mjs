/**
 * Capture homepage section screenshots via CDP (Chrome must be open on preview URL).
 * Usage: node capture-sections.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'screenshots');
const VIEWPORT = { width: 1440, height: 900 };

const SECTIONS = [
  {
    file: '01-header.png',
    setup: () => {
      document.querySelector('.isb-announcement').style.display = '';
      document.querySelector('.isb-header').style.position = '';
      window.scrollTo(0, 0);
    },
    clip: () => {
      const a = document.getElementById('section-announcement');
      const h = document.getElementById('section-header');
      const r1 = a.getBoundingClientRect();
      const r2 = h.getBoundingClientRect();
      return {
        x: 0,
        y: 0,
        width: Math.ceil(Math.max(r1.width, r2.width)),
        height: Math.ceil(r2.bottom - r1.top),
      };
    },
  },
  { file: '02-hero.png', id: 'section-hero' },
  { file: '03-features.png', id: 'section-features' },
  { file: '04-best-sellers.png', id: 'section-best-sellers' },
  { file: '05-our-story.png', id: 'section-story' },
  { file: '06-collection.png', id: 'section-collection' },
  { file: '07-testimonials.png', id: 'section-testimonials' },
  { file: '08-footer.png', id: 'section-footer' },
];

async function getWsUrl() {
  const res = await fetch('http://127.0.0.1:9222/json/version');
  const json = await res.json();
  return json.webSocketDebuggerUrl;
}

function send(ws, method, params = {}) {
  const id = send._id = (send._id || 0) + 1;
  return new Promise((resolve, reject) => {
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== id) return;
      ws.off('message', handler);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  const wsUrl = await getWsUrl();
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  await mkdir(OUT, { recursive: true });

  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const targets = await send(ws, 'Target.getTargets');
  const pageTarget = targets.targetInfos.find((t) => t.type === 'page' && t.url.includes('preview/index.html'))
    || targets.targetInfos.find((t) => t.type === 'page');

  if (!pageTarget) throw new Error('No browser page target found');

  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });

  const cdp = (method, params = {}) => send(ws, method, params, sessionId).catch(() =>
    new Promise((resolve, reject) => {
      const id = (send._id || 0) + 1;
      send._id = id;
      const handler = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id !== id) return;
        ws.off('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    })
  );

  // Flattened session messages include sessionId on send
  const sessionSend = (method, params = {}) => {
    const id = (send._id = (send._id || 0) + 1);
    return new Promise((resolve, reject) => {
      const handler = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id !== id) return;
        ws.off('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  };

  for (const section of SECTIONS) {
    if (section.setup) {
      await sessionSend('Runtime.evaluate', {
        expression: `(${section.setup.toString()})()`,
      });
      const { result } = await sessionSend('Runtime.evaluate', {
        expression: `JSON.stringify((${section.clip.toString()})())`,
        returnByValue: true,
      });
      const clip = JSON.parse(result.value);
      const shot = await sessionSend('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { ...clip, scale: 1 },
      });
      await writeFile(join(OUT, section.file), Buffer.from(shot.data, 'base64'));
      console.log('Saved', section.file);
      continue;
    }

    await sessionSend('Runtime.evaluate', {
      expression: `(() => {
        document.querySelector('.isb-announcement').style.display = 'none';
        const h = document.querySelector('.isb-header');
        h.style.position = 'relative';
        h.style.top = 'auto';
        const el = document.getElementById('${section.id}');
        el.scrollIntoView({ block: 'start' });
        window.scrollBy(0, -8);
      })()`,
    });

    const { result } = await sessionSend('Runtime.evaluate', {
      expression: `(() => {
        const el = document.getElementById('${section.id}');
        const r = el.getBoundingClientRect();
        return JSON.stringify({
          x: Math.max(0, r.left),
          y: Math.max(0, r.top + window.scrollY),
          width: Math.ceil(r.width),
          height: Math.ceil(r.height),
        });
      })()`,
      returnByValue: true,
    });

    const clip = JSON.parse(result.value);
    const shot = await sessionSend('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { ...clip, scale: 1 },
    });
    await writeFile(join(OUT, section.file), Buffer.from(shot.data, 'base64'));
    console.log('Saved', section.file, `${clip.width}x${clip.height}`);
  }

  ws.close();
  console.log('\nAll screenshots saved to:', OUT);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
