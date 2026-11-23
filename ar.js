// DINO WEST · realidad aumentada de los stickers de dinos con nombre.
// Cada sticker es un marcador de MindAR (dinos.mind, mismo orden que dinos.json).
// Al reconocerlo, el dino sale de pie sobre el sticker; "Ver en tu mesa" lo abre en el AR del teléfono.
// Prueba sin cámara: ?prueba=Triceratops  (simula el sticker sobre la mesa)
(() => {
  const $ = (id) => document.getElementById(id);
  const escena = $('escena');
  const PRUEBA = new URLSearchParams(location.search).get('prueba');
  let cat = [];
  let visible = null;
  let ocultarT = null;
  let activo = null;   // la entidad "giro" del dino que se ve ahora: es la que se agarra con los dedos
  const giros = new Map();

  const esperarEscena = () => new Promise((r) => (escena.hasLoaded ? r() : escena.addEventListener('loaded', r, { once: true })));
  const sistema = () => escena.systems['mindar-image-system'];

  // El sticker queda en el plano XY del marcador (Z sale hacia la cámara).
  // El modelo viene de pie en Y, con 1 de largo = el ancho del sticker.
  function dino() {
    const pie = document.createElement('a-entity');
    pie.setAttribute('position', '0 0.08 0');   // sobre el dibujo, no sobre el nombre
    pie.setAttribute('rotation', '90 0 0');
    const giro = document.createElement('a-entity');
    giro.setAttribute('rotation', '0 -35 0');
    const m = document.createElement('a-entity');
    m.setAttribute('scale', '0.001 0.001 0.001');
    giro.appendChild(m);
    pie.appendChild(giro);
    return { pie, m, giro };
  }

  function salir(m, d) {
    if (!m.hasAttribute('gltf-model')) m.setAttribute('gltf-model', `url(${d.glb})`);
    // se vuelve a poner la animación para que arranque siempre, aunque el entity esté recién creado
    m.removeAttribute('animation__pop');
    m.setAttribute('scale', '0.001 0.001 0.001');
    m.setAttribute('animation__pop', 'property: scale; from: 0.001 0.001 0.001; to: 0.9 0.9 0.9; dur: 650; easing: easeOutBack');
    mostrar(d);
  }

  function mostrar(d) {
    clearTimeout(ocultarT);
    visible = d;
    activo = giros.get(d.id) || null;
    $('pista').hidden = true;
    $('encontrado').hidden = false;
    $('nombre').textContent = d.nombre;
  }

  function ocultar(d) {
    clearTimeout(ocultarT);
    ocultarT = setTimeout(() => {
      if (visible !== d) return;
      visible = null;
      $('encontrado').hidden = true;
      $('pista').hidden = false;
    }, 1200);
  }

  function modoPrueba() {
    let i = cat.findIndex((d) => d.id === PRUEBA);
    if (i < 0) i = Math.min(cat.length - 1, Math.max(0, parseInt(PRUEBA, 10) || 0));
    const d = cat[i];
    $('inicio').hidden = true;
    $('hud').hidden = false;
    escena.setAttribute('background', 'color: #3a2e24');
    const a = document.createElement('a-entity');
    a.setAttribute('position', '0 -0.25 -1.6');
    a.setAttribute('rotation', '-60 0 0');   // el sticker sobre la mesa, visto en diagonal
    const p = document.createElement('a-plane');
    p.setAttribute('width', 1);
    p.setAttribute('height', 0.78);
    p.setAttribute('material', `shader: flat; src: url(/_fuentes/ar/targets/completo/${String(i).padStart(2, '0')}_${d.id}.png)`);
    a.appendChild(p);
    const { pie, m, giro } = dino();
    giros.set(d.id, giro);
    a.appendChild(pie);
    escena.appendChild(a);
    salir(m, d);
  }

  const listo = (async () => {
    cat = await (await fetch('dinos.json')).json();
    await esperarEscena();
    if (PRUEBA) return modoPrueba();
    cat.forEach((d, i) => {
      const a = document.createElement('a-entity');
      a.setAttribute('mindar-image-target', `targetIndex: ${i}`);
      const { pie, m, giro } = dino();
      giros.set(d.id, giro);
      a.appendChild(pie);
      a.addEventListener('targetFound', () => salir(m, d));
      a.addEventListener('targetLost', () => ocultar(d));
      escena.appendChild(a);
    });
  })();

  $('empezar').addEventListener('click', async () => {
    const nota = $('nota');
    nota.classList.remove('error');
    nota.textContent = 'Abriendo la cámara…';
    await listo;
    escena.addEventListener('arReady', () => { $('inicio').hidden = true; $('hud').hidden = false; }, { once: true });
    escena.addEventListener('arError', () => {
      nota.textContent = 'No se pudo abrir la cámara. Revisa el permiso de cámara del navegador.';
      nota.classList.add('error');
    }, { once: true });
    sistema().start();
  });

  // el visor de mesa trae su propio three.js: se carga solo cuando hace falta
  let visorListo = null;
  const cargarVisor = () => (visorListo ||= import('https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js'));

  $('mesa').addEventListener('click', async () => {
    if (!visible) return;
    const d = visible;
    await cargarVisor();
    if (!PRUEBA) sistema().stop();   // suelta la cámara para el AR del teléfono
    $('hud').hidden = true;
    $('visor').hidden = false;
    $('mv').src = d.glb;
    $('mv-nombre').textContent = d.nombre;
  });

  $('cerrar').addEventListener('click', () => {
    $('visor').hidden = true;
    $('hud').hidden = false;
    if (PRUEBA) return;
    visible = null;
    $('encontrado').hidden = true;
    $('pista').hidden = false;
    sistema().start();
  });

  // ---- Agarrar el dino con los dedos ----
  // 1 dedo: girarlo (horizontal = darle la vuelta, vertical = voltearlo)
  // 2 dedos: pellizcar = agrandar/achicar, arrastrar = moverlo sobre el sticker
  // doble toque: volver a como salió
  const dedos = new Map();
  let antes = null;          // estado de los dedos en el evento anterior
  let ultimoToque = 0;
  const estado = new WeakMap(); // por dino: { yaw, pitch, s, x, y }
  const inicial = () => ({ yaw: -35 * Math.PI / 180, pitch: 0, s: 1, x: 0, y: 0 });

  function aplicar(g) {
    const e = estado.get(g);
    const o = g.object3D;
    o.rotation.order = 'YXZ';
    o.rotation.set(e.pitch, e.yaw, 0);
    o.scale.setScalar(e.s);
    o.position.set(e.x, 0, e.y);   // el plano del sticker es XZ dentro de "pie"
  }

  function resumen() {
    const p = [...dedos.values()];
    if (p.length === 1) return { n: 1, x: p[0].x, y: p[0].y };
    const [a, b] = p;
    return { n: 2, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  const ignorar = (t) => t.closest && t.closest('button, #visor, #inicio');

  document.addEventListener('pointerdown', (ev) => {
    if (ignorar(ev.target) || !activo) return;
    dedos.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    antes = resumen();
    if (dedos.size === 1) {
      const ahora = performance.now();
      if (ahora - ultimoToque < 300) {   // doble toque
        estado.set(activo, inicial());
        aplicar(activo);
      }
      ultimoToque = ahora;
    }
  });

  document.addEventListener('pointermove', (ev) => {
    if (!dedos.has(ev.pointerId) || !activo) return;
    dedos.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const r = resumen();
    if (!antes || antes.n !== r.n) { antes = r; return; }
    if (!estado.has(activo)) estado.set(activo, inicial());
    const e = estado.get(activo);
    const k = 1 / Math.min(innerWidth, innerHeight);
    if (r.n === 1) {
      e.yaw += (r.x - antes.x) * k * 2 * Math.PI;
      e.pitch += (r.y - antes.y) * k * 2 * Math.PI;
    } else {
      if (antes.d > 0) e.s = Math.min(3, Math.max(0.35, e.s * r.d / antes.d));
      e.x += (r.x - antes.x) * k * 1.2;
      e.y += (r.y - antes.y) * k * 1.2;
    }
    aplicar(activo);
    antes = r;
    ev.preventDefault();
  }, { passive: false });

  const soltar = (ev) => { dedos.delete(ev.pointerId); antes = dedos.size ? resumen() : null; };
  document.addEventListener('pointerup', soltar);
  document.addEventListener('pointercancel', soltar);
})();
