// ═══════════════════════════════════════════════════════════════
// FOrdre — Vista 3D de les safates (Three.js r128)
// ───────────────────────────────────────────────────────────────
// Totes les safates del pla es col·loquen sobre la taula, una columna
// per pas de muntatge (d'esquerra a dreta). Cada safata és la mateixa
// malla que s'exporta a STL, amb les peces representades dins els
// caixetins. Seleccionar un conjunt en ressalta les safates; seleccionar
// un material en marca el caixetí i hi apunta el cartell de l'etiqueta.
// Coordenades: safata (x, y, z) en mm → escena (x, z, −y).
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO || (G.FO = {});

    const SEP_PAS = 60, SEP_SAF = 30, AMPLE_FILA = 1400;

    function spriteText(text, opts) {
        opts = opts || {};
        const fs = opts.fs || 44, pad = 14;
        const c = document.createElement('canvas'), x = c.getContext('2d');
        x.font = `600 ${fs}px Segoe UI, Arial, sans-serif`;
        const w = Math.ceil(x.measureText(text).width) + pad * 2, h = fs + pad * 2;
        c.width = w; c.height = h;
        x.font = `600 ${fs}px Segoe UI, Arial, sans-serif`;
        x.fillStyle = opts.bg || 'rgba(28,28,48,.85)';
        const r = 12; x.beginPath(); x.moveTo(r, 0); x.arcTo(w, 0, w, h, r); x.arcTo(w, h, 0, h, r); x.arcTo(0, h, 0, 0, r); x.arcTo(0, 0, w, 0, r); x.fill();
        if (opts.col) { x.fillStyle = opts.col; x.fillRect(0, 0, 10, h); }
        x.fillStyle = opts.fg || '#F0F0FF'; x.textBaseline = 'middle'; x.fillText(text, pad + (opts.col ? 6 : 0), h / 2 + 2);
        const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
        const alt = opts.alt || 12;
        s.scale.set(alt * w / h, alt, 1);
        s.renderOrder = 10;
        return s;
    }

    function geomDeTriangles(tri) {
        const pos = new Float32Array(tri.length * 9);
        let k = 0;
        for (const t of tri) for (const v of t) { pos[k++] = v[0]; pos[k++] = v[2]; pos[k++] = -v[1]; }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.computeVertexNormals();
        return g;
    }

    const mescla = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);

    // Pseudoaleatori determinista (el mateix dibuix cada vegada)
    function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296); }

    // Posicions (coordenades de safata) de les unitats dins un caixetí
    function posicionsPeces(c, cfg) {
        const o = c.o, out = [];
        const gir = !!c.girat;
        const w = gir ? o.d : o.w, d = gir ? o.w : o.d; // planta de la peça en X/Y de la safata
        if (c.mode === 'granel') {
            const n = Math.min(c.qty, 400), r = rnd(c.qty * 7919 + Math.round(c.x * 31 + c.y));
            const porCapa = Math.max(1, Math.floor((c.w * c.d) / (o.w * o.d) * 0.45));
            // peces allargades: alineades amb l'eix llarg del caixetí (amb una mica de joc)
            const llarga = o.w > Math.min(c.w, c.d) * 0.6;
            const eix = c.w >= c.d ? 0 : Math.PI / 2;
            for (let i = 0; i < n; i++) {
                const capa = Math.floor(i / porCapa);
                const rot = llarga ? eix + (r() - 0.5) * 0.12 : r() * Math.PI;
                const cs = Math.abs(Math.cos(rot)), sn = Math.abs(Math.sin(rot));
                const mx = (o.w * cs + o.d * sn) / 2 + 0.3, my = (o.w * sn + o.d * cs) / 2 + 0.3;
                out.push({ x: c.x + mx + r() * Math.max(0, c.w - 2 * mx), y: c.y + my + r() * Math.max(0, c.d - 2 * my), z: c.z + o.h / 2 + capa * o.h * 0.8, rot });
            }
            return out;
        }
        if (c.mode === 'individual') {
            const nx = gir ? c.cel.ny : c.cel.nx, ny = gir ? c.cel.nx : c.cel.ny, t = cfg.divisor;
            const pw = (c.w - (nx - 1) * t) / nx, pd = (c.d - (ny - 1) * t) / ny;
            for (let k = 0; k < c.qty; k++) {
                const i = k % nx, j = Math.floor(k / nx);
                out.push({ x: c.x + i * (pw + t) + pw / 2, y: c.y + j * (pd + t) + pd / 2, z: c.z + o.h / 2, rot: gir ? Math.PI / 2 : 0 });
            }
            return out;
        }
        // capa o apilat
        const nx = gir ? c.cel.ny : c.cel.nx, ny = gir ? c.cel.nx : c.cel.ny;
        const pw = (c.w - cfg.dit) / nx, pd = c.d / ny;
        let k = 0;
        for (let capa = 0; capa < (c.cel.perCel || 1) && k < c.qty; capa++)
            for (let j = 0; j < ny && k < c.qty; j++)
                for (let i = 0; i < nx && k < c.qty; i++, k++)
                    out.push({ x: c.x + cfg.dit + i * pw + pw / 2, y: c.y + j * pd + pd / 2, z: c.z + o.h / 2 + capa * o.h, rot: gir ? Math.PI / 2 : 0 });
        return out;
    }

    FO.Vista = function (canvas, cb) {
        cb = cb || {};
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(2, G.devicePixelRatio || 1));
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x12121F);
        const camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x404060, 0.75));
        const sol = new THREE.DirectionalLight(0xffffff, 0.75); sol.position.set(300, 800, 500); scene.add(sol);
        const contra = new THREE.DirectionalLight(0xffffff, 0.25); contra.position.set(-400, 300, -300); scene.add(contra);
        let graella = null;
        const arrel = new THREE.Group(); scene.add(arrel);

        const orb = { th: Math.PI / 2 - 0.5, ph: 0.95, r: 900, tg: new THREE.Vector3() };
        let anim = null, brut = true;
        let safates = [];     // [{s, r, grup, malla, mat, peces:[{mesh, c, idx}], caixMarc}]
        let mostraPeces = true, mostraFalca = true, mostraTapes = true, cfgAct = null;
        let marca = null, selConj = null, selCaix = null;

        function updCam() {
            const { th, ph, r, tg } = orb;
            camera.position.set(tg.x + r * Math.sin(ph) * Math.cos(th), tg.y + r * Math.cos(ph), tg.z + r * Math.sin(ph) * Math.sin(th));
            camera.lookAt(tg);
            brut = true;
        }
        function mida() {
            const w = canvas.clientWidth, h = canvas.clientHeight;
            if (!w || !h) return;
            renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); brut = true;
        }
        new ResizeObserver(mida).observe(canvas);

        function bucle() {
            requestAnimationFrame(bucle);
            if (anim) {
                const t = Math.min(1, (performance.now() - anim.t0) / anim.dur), e = 1 - Math.pow(1 - t, 3);
                orb.r = anim.r0 + (anim.r1 - anim.r0) * e;
                orb.th = anim.th0 + (anim.th1 - anim.th0) * e;
                orb.ph = anim.ph0 + (anim.ph1 - anim.ph0) * e;
                orb.tg.lerpVectors(anim.tg0, anim.tg1, e);
                updCam();
                if (t >= 1) anim = null;
            }
            if (brut) { renderer.render(scene, camera); brut = false; if (cb.onCamera) cb.onCamera(); }
        }

        function anima(tg, r, th, ph) {
            anim = {
                t0: performance.now(), dur: 450, r0: orb.r, r1: r, th0: orb.th, th1: th === undefined ? orb.th : th,
                ph0: orb.ph, ph1: ph === undefined ? orb.ph : ph, tg0: orb.tg.clone(), tg1: tg.clone()
            };
        }

        function enquadra(box, th, ph) {
            if (box.isEmpty()) return;
            const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
            const rad = Math.max(40, s.length() / 2);
            const r = rad / Math.sin(camera.fov * Math.PI / 360) * (camera.aspect < 1 ? 1.3 / camera.aspect : 1.05);
            anima(c, r, th, ph);
        }

        // ─── Construcció de l'escena ───
        function buida() {
            for (let i = arrel.children.length - 1; i >= 0; i--) {
                const o = arrel.children[i]; arrel.remove(o);
                o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) { (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } });
            }
            safates = []; marca = null;
        }

        function construeix(pla, cfg) {
            buida();
            cfgAct = cfg;
            let x = 0, zFila = 0, fondFila = 0;
            const geoCaixa = new THREE.BoxGeometry(1, 1, 1), geoCil = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
            pla.forEach(r => {
                if (!r.safates.length) return;
                const ampleCol = Math.max(...r.safates.map(s => s.W));
                if (x > 0 && x + ampleCol > AMPLE_FILA) { x = 0; zFila -= fondFila + SEP_PAS * 1.6; fondFila = 0; }
                let z = zFila, fond = 0;
                const et = spriteText(`Pas ${r.pas} · ${r.conj.codi}${r.multiplicador > 1 ? ' ×' + r.multiplicador : ''}`, { col: r.conj.col, alt: 11 });
                et.position.set(x + ampleCol / 2, 2, z + 22);
                arrel.add(et);
                // Crea un objecte imprès (safata, caixa o contenidor) dins `pare`
                const creaObjecte = (s, pare, px, py, pz, girat) => {
                    const grup = new THREE.Group();
                    grup.position.set(px, py, pz);
                    if (girat) grup.rotation.y = Math.PI / 2;
                    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(s.color || '#E3E6EE'), roughness: 0.72, metalness: 0.02, transparent: true, opacity: 1 });
                    const peces = FO.pecesImpressio(s, cfg);
                    const malla = new THREE.Mesh(geomDeTriangles(peces[0].tri), mat);
                    malla.userData = { tipus: 'safata' };
                    const safGrup = new THREE.Group(); // part que s'inclina
                    safGrup.add(malla);
                    grup.add(safGrup);
                    let falca = null;
                    if (s.angle > 0 && !s.pare) {
                        falca = new THREE.Mesh(geomDeTriangles(FO.mallaFalca(s)), new THREE.MeshStandardMaterial({ color: new THREE.Color(s.color || '#607080').multiplyScalar(0.7), roughness: 0.8, transparent: true }));
                        grup.add(falca);
                    }
                    // tapa, girada com quan està posada, flotant una mica per sobre
                    let tapa = null;
                    const pt = peces.find(p => p.tipus === 'tapa');
                    if (pt) {
                        const alt = Math.max(...pt.tri.flat().map(v => v[2]));
                        tapa = new THREE.Mesh(geomDeTriangles(pt.tri), new THREE.MeshStandardMaterial({ color: new THREE.Color(s.color || '#E3E6EE'), roughness: 0.6, transparent: true, opacity: 0.55, depthWrite: false }));
                        tapa.rotation.x = Math.PI;
                        tapa.position.set(0, Math.max(s.H, s.cim || 0) + alt + 14, -s.D);
                        tapa.visible = mostraTapes;
                        tapa.userData = { tipus: 'tapa' };
                        safGrup.add(tapa);
                    }
                    // peces
                    const pecesM = [];
                    s.caixetins.forEach((c, idx) => {
                        const pos = posicionsPeces(c, cfg);
                        if (!pos.length) return;
                        const cil = c.mat.forma === 'cylinder';
                        const pm = new THREE.MeshStandardMaterial({ color: c.mat.col, roughness: 0.55, metalness: c.mat.tipus === 'cargol' ? 0.5 : 0.05, transparent: true });
                        const im = new THREE.InstancedMesh(cil ? geoCil : geoCaixa, pm, pos.length);
                        const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
                        const o = c.o;
                        pos.forEach((p, i) => {
                            let S;
                            if (cil && !o.dreta && o.w > o.d * 1.05) { e.set(0, p.rot, Math.PI / 2, 'YXZ'); S = new THREE.Vector3(o.d, o.w, o.h); }
                            else { e.set(0, p.rot, 0); S = new THREE.Vector3(o.w, o.h, o.d); }
                            q.setFromEuler(e);
                            M.compose(new THREE.Vector3(p.x, p.z, -p.y), q, S.multiplyScalar(0.97));
                            im.setMatrixAt(i, M);
                        });
                        im.instanceMatrix.needsUpdate = true;
                        im.userData = { tipus: 'peca', idx };
                        im.visible = mostraPeces;
                        safGrup.add(im);
                        pecesM.push({ mesh: im, c, idx });
                    });
                    // nom (només dels objectes de primer nivell)
                    let nom = null;
                    if (!s.pare) {
                        const extra = s.tipus === 'muntat' ? '  ▣ guarda' : s.forma === 'contenidor' ? '  ⧉ contenidor' : s.tipus === 'esd' ? '  ⚡ESD' : '';
                        nom = spriteText(s.id + extra, { alt: 7, fs: 36, bg: 'rgba(28,28,48,.75)', col: s.color });
                        nom.position.set(s.W / 2, Math.max(s.H, ...(s.caixes || []).map(c => c.obj.H + cfg.terra)) + 10, -s.D / 2);
                        safGrup.add(nom);
                    }
                    const reg = { s, r, grup, safGrup, malla, mat, falca, peces: pecesM, nom, tapa };
                    if (!s.pare) aplicaInclinacio(reg);
                    malla.userData.reg = reg;
                    pecesM.forEach(p => { p.mesh.userData.reg = reg; });
                    pare.add(grup);
                    safates.push(reg);
                    // caixes de dins d'un contenidor
                    (s.caixes || []).forEach(c => {
                        const o = c.obj;
                        creaObjecte(o, safGrup, c.girat ? c.x + o.D : c.x, cfg.terra, -c.y, c.girat);
                    });
                    return reg;
                };
                r.safates.forEach(s => {
                    creaObjecte(s, arrel, x, 0, z, false);
                    z -= s.D + SEP_SAF;
                    fond += s.D + SEP_SAF;
                });
                fondFila = Math.max(fondFila, fond);
                x += ampleCol + SEP_PAS;
            });
            // taula
            if (graella) { scene.remove(graella); graella.geometry.dispose(); graella.material.dispose(); }
            const bb = new THREE.Box3().setFromObject(arrel);
            if (!bb.isEmpty()) {
                const s = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
                const m = Math.ceil(Math.max(s.x, s.z) / 100) * 100 + 400;
                graella = new THREE.GridHelper(m, m / 20, 0x3A3A5A, 0x26263C);
                graella.position.set(c.x, -0.2, c.z);
                scene.add(graella);
            }
            aplicaSeleccio();
            brut = true;
        }

        function aplicaInclinacio(reg) {
            const a = mostraFalca ? reg.s.angle * Math.PI / 180 : 0;
            reg.safGrup.rotation.x = a;
            reg.safGrup.position.y = a > 0 ? 3 : 0;
            if (reg.falca) reg.falca.visible = a > 0;
        }

        // ─── Selecció ───
        function treuMarca() {
            if (marca) { marca.parent.remove(marca); marca.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose(); }); marca = null; }
        }

        function aplicaSeleccio() {
            treuMarca();
            safates.forEach(reg => {
                const actiu = !selConj || reg.r.conj.id === selConj;
                reg.mat.opacity = actiu ? 1 : 0.16;
                reg.mat.depthWrite = actiu;
                if (reg.falca) reg.falca.material.opacity = actiu ? 1 : 0.16;
                if (reg.nom) reg.nom.material.opacity = actiu ? 1 : 0.25;
                if (reg.tapa) { reg.tapa.visible = mostraTapes && actiu; }
                reg.peces.forEach(p => {
                    const marcat = selCaix && selCaix.reg === reg && selCaix.idxs.includes(p.idx);
                    p.mesh.material.opacity = actiu ? 1 : 0.12;
                    p.mesh.material.emissive = new THREE.Color(marcat ? 0x335577 : 0x000000);
                    p.mesh.visible = mostraPeces || marcat;
                });
            });
            if (selCaix) {
                const { reg, idxs } = selCaix;
                marca = new THREE.Group();
                idxs.forEach(i => {
                    const c = reg.s.caixetins[i];
                    const alt = reg.s.H - c.z + 2;
                    const g = new THREE.BoxGeometry(c.w, alt, c.d);
                    const caixa = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x4A90D9, transparent: true, opacity: 0.18, depthWrite: false }));
                    const vora = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x7FC0FF }));
                    [caixa, vora].forEach(o => { o.position.set(c.x + c.w / 2, c.z + alt / 2, -(c.y + c.d / 2)); marca.add(o); });
                });
                reg.safGrup.add(marca);
            }
            brut = true;
        }

        function registresDeConj(id) { return safates.filter(r => r.r.conj.id === id); }

        function caixaDe(regs) {
            const b = new THREE.Box3();
            regs.forEach(r => b.expandByObject(r.grup));
            return b;
        }

        const api = {
            construeix,
            seleccionaConjunt(id, enfocar) {
                selConj = id; selCaix = null; aplicaSeleccio();
                if (enfocar && id) { const regs = registresDeConj(id); if (regs.length) enquadra(caixaDe(regs)); }
            },
            // Selecciona el material `matId` dins les safates del conjunt `conjId`
            seleccionaMaterial(conjId, matId, enfocar) {
                selConj = conjId; selCaix = null;
                for (const reg of registresDeConj(conjId)) {
                    const idxs = reg.s.caixetins.map((c, i) => c.mat.id === matId ? i : -1).filter(i => i >= 0);
                    if (idxs.length) { selCaix = { reg, idxs }; break; }
                }
                aplicaSeleccio();
                if (enfocar && selCaix) enquadra(caixaDe([selCaix.reg]));
                return selCaix ? { safata: selCaix.reg.s, caixetins: selCaix.idxs.map(i => selCaix.reg.s.caixetins[i]) } : null;
            },
            // Selecció de la caixa de guarda d'un subconjunt (material virtual)
            seleccionaCaixeti(safataId, idx, enfocar) {
                const reg = safates.find(r => r.s.id === safataId);
                if (!reg) return null;
                selConj = reg.r.conj.id; selCaix = { reg, idxs: [idx] }; aplicaSeleccio();
                if (enfocar) enquadra(caixaDe([reg]));
                return { safata: reg.s, caixetins: [reg.s.caixetins[idx]] };
            },
            netejaSeleccio() { selConj = null; selCaix = null; aplicaSeleccio(); },
            veureTot() { enquadra(new THREE.Box3().setFromObject(arrel), Math.PI / 2 - 0.5, 0.95); },
            enfoca() {
                if (selCaix) enquadra(caixaDe([selCaix.reg]));
                else if (selConj) enquadra(caixaDe(registresDeConj(selConj)));
                else api.veureTot();
            },
            planta() {
                const regs = selConj ? registresDeConj(selConj) : safates;
                enquadra(regs.length ? caixaDe(regs) : new THREE.Box3().setFromObject(arrel), Math.PI / 2, 0.02);
            },
            setFons(clar) { scene.background = new THREE.Color(clar ? 0xE4E7EF : 0x12121F); brut = true; },
            setPeces(v) { mostraPeces = v; aplicaSeleccio(); },
            setTapes(v) { mostraTapes = v; aplicaSeleccio(); },
            setFalca(v) { mostraFalca = v; safates.forEach(aplicaInclinacio); aplicaSeleccio(); },
            // Punt de pantalla (px) de la vora superior davantera del caixetí seleccionat
            puntCartell() {
                if (!selCaix) return null;
                const { reg, idxs } = selCaix;
                const c = reg.s.caixetins[idxs[0]];
                reg.safGrup.updateMatrixWorld(true);
                const v = new THREE.Vector3(c.x + c.w / 2, reg.s.H + 1, -(c.y + c.d * 0.3)).applyMatrix4(reg.safGrup.matrixWorld);
                v.project(camera);
                if (v.z > 1) return null;
                return { x: (v.x + 1) / 2 * canvas.clientWidth, y: (1 - v.y) / 2 * canvas.clientHeight };
            },
            captura() { renderer.render(scene, camera); return canvas.toDataURL('image/png'); },
            redibuixa() { brut = true; }
        };

        // ─── Ratolí ───
        let drag = null;
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        canvas.addEventListener('pointerdown', e => {
            canvas.setPointerCapture(e.pointerId);
            drag = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey, mogut: false };
            anim = null;
        });
        canvas.addEventListener('pointermove', e => {
            if (!drag) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) drag.mogut = true;
            drag.x = e.clientX; drag.y = e.clientY;
            if (drag.b === 2 || drag.b === 1 || drag.shift) {
                const k = orb.r * 0.0016;
                const dreta = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
                const amunt = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
                orb.tg.addScaledVector(dreta, -dx * k).addScaledVector(amunt, dy * k);
            } else {
                orb.th += dx * 0.006;
                orb.ph = Math.max(0.02, Math.min(Math.PI / 2 - 0.02, orb.ph - dy * 0.006));
            }
            updCam();
        });
        canvas.addEventListener('pointerup', e => {
            const d = drag; drag = null;
            if (!d || d.mogut || d.b !== 0) return;
            const r = canvas.getBoundingClientRect();
            const m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
            const ray = new THREE.Raycaster(); ray.setFromCamera(m, camera);
            const objs = [];
            safates.forEach(reg => { if (reg.mat.opacity > 0.5 || !selConj) { objs.push(reg.malla); reg.peces.forEach(p => { if (p.mesh.visible) objs.push(p.mesh); }); } });
            const h = ray.intersectObjects(objs, false)[0];
            if (!h) { if (cb.onPick) cb.onPick(null); return; }
            const reg = h.object.userData.reg;
            let idx = h.object.userData.tipus === 'peca' ? h.object.userData.idx : -1;
            if (idx < 0) {
                const l = reg.safGrup.worldToLocal(h.point.clone());
                const x = l.x, y = -l.z;
                idx = reg.s.caixetins.findIndex(c => x >= c.x - 0.8 && x <= c.x + c.w + 0.8 && y >= c.y - 0.8 && y <= c.y + c.d + 0.8);
            }
            if (cb.onPick) cb.onPick({ safata: reg.s, conj: reg.r.conj, idx, caixeti: idx >= 0 ? reg.s.caixetins[idx] : null });
        });
        canvas.addEventListener('wheel', e => {
            e.preventDefault(); anim = null;
            orb.r = Math.max(30, Math.min(15000, orb.r * (e.deltaY > 0 ? 1.12 : 1 / 1.12)));
            updCam();
        }, { passive: false });

        mida(); updCam(); bucle();
        return api;
    };
})(typeof window !== 'undefined' ? window : globalThis);
