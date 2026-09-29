// ═══════════════════════════════════════════════════════════════
// FOrdre — Geometria de les safates i exportació STL / ZIP
// ───────────────────────────────────────────────────────────────
// La safata es descriu com un mapa d'alçades sobre una graella:
// la safata sencera és un bloc d'alçada H; cada caixetí rebaixa la
// seva zona fins a la cota del fons, i els divisors de les cel·les
// individuals tornen a pujar fins a dalt. Tot el que no és caixetí
// queda massís (parets, separadors i forats sobrants).
// La malla es construeix sobre una graella i uns nivells de Z
// comuns a tota la safata, de manera que els vèrtexs coincideixen
// sempre i el sòlid surt tancat (manifold), llest per laminar.
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO || (G.FO = {});
    const EPS = 1e-6;

    // Rectangles amb alçada, en ordre de pintat (l'últim mana)
    FO.regionsSafata = function (s, cfg) {
        const H = s.H, reg = [{ x0: 0, y0: 0, x1: s.W, y1: s.D, h: H }];
        if (s.forma === 'contenidor') {
            // caixa oberta per dalt, amb dues osques per agafar les caixes de dins
            const pc = cfg.paretContenidor, o = Math.min(30, s.W / 3), hO = Math.max(cfg.terra + 3, H * 0.45);
            reg.push({ x0: pc, y0: pc, x1: s.W - pc, y1: s.D - pc, h: cfg.terra });
            reg.push({ x0: (s.W - o) / 2, y0: 0, x1: (s.W + o) / 2, y1: pc, h: hO });
            reg.push({ x0: (s.W - o) / 2, y0: s.D - pc, x1: (s.W + o) / 2, y1: s.D, h: hO });
            return reg;
        }
        const cims = H - cfg.llavi; // els divisors interns no porten llavi
        s.caixetins.forEach(c => {
            reg.push({ x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.d, h: c.z });
            if (c.mode === 'individual' && c.cel && (c.cel.nx > 1 || c.cel.ny > 1)) {
                const nx = c.girat ? c.cel.ny : c.cel.nx, ny = c.girat ? c.cel.nx : c.cel.ny;
                const t = cfg.divisor;
                const pw = (c.w - (nx - 1) * t) / nx, pd = (c.d - (ny - 1) * t) / ny;
                for (let i = 1; i < nx; i++) {
                    const x = c.x + i * pw + (i - 1) * t;
                    reg.push({ x0: x, y0: c.y, x1: x + t, y1: c.y + c.d, h: cims });
                }
                for (let k = 1; k < ny; k++) {
                    const y = c.y + k * pd + (k - 1) * t;
                    reg.push({ x0: c.x, y0: y, x1: c.x + c.w, y1: y + t, h: cims });
                }
            }
        });
        return reg;
    };

    const unics = a => a.sort((p, q) => p - q).filter((v, i, arr) => i === 0 || v - arr[i - 1] > EPS);

    // Mapa d'alçades → llista de triangles [[x,y,z]×3]
    FO.mallaAlcades = function (reg) {
        const xs = unics(reg.flatMap(r => [r.x0, r.x1]));
        const ys = unics(reg.flatMap(r => [r.y0, r.y1]));
        const nx = xs.length - 1, ny = ys.length - 1;
        const h = new Float64Array(nx * ny);
        for (let i = 0; i < nx; i++) {
            const cx = (xs[i] + xs[i + 1]) / 2;
            for (let j = 0; j < ny; j++) {
                const cy = (ys[j] + ys[j + 1]) / 2;
                let v = 0;
                for (const r of reg) if (cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1) v = r.h;
                h[i * ny + j] = v;
            }
        }
        const H = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny) ? 0 : h[i * ny + j];
        const zs = unics([0].concat(Array.from(h)));
        const tri = [];
        const quad = (a, b, c, d) => { tri.push([a, b, c], [a, c, d]); };
        // paret vertical entre nivells, subdividida als nivells globals
        const paret = (p0, p1, zLo, zHi, flip) => {
            const lv = zs.filter(z => z > zLo + EPS && z < zHi - EPS);
            const cotes = [zLo].concat(lv, [zHi]);
            for (let k = 0; k < cotes.length - 1; k++) {
                const a = [p0[0], p0[1], cotes[k]], b = [p1[0], p1[1], cotes[k]];
                const c = [p1[0], p1[1], cotes[k + 1]], d = [p0[0], p0[1], cotes[k + 1]];
                flip ? quad(a, d, c, b) : quad(a, b, c, d);
            }
        };
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
            const v = H(i, j); if (v <= EPS) continue;
            const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
            quad([x0, y0, v], [x1, y0, v], [x1, y1, v], [x0, y1, v]);   // dalt (+Z)
            quad([x0, y0, 0], [x0, y1, 0], [x1, y1, 0], [x1, y0, 0]);   // sota (−Z)
        }
        // parets verticals a les línies X (entre i-1 i i)
        for (let i = 0; i <= nx; i++) for (let j = 0; j < ny; j++) {
            const a = H(i - 1, j), b = H(i, j); if (Math.abs(a - b) <= EPS) continue;
            const p0 = [xs[i], ys[j]], p1 = [xs[i], ys[j + 1]];
            // si a > b la paret mira cap a +X
            if (a > b) paret(p0, p1, b, a, false); else paret(p0, p1, a, b, true);
        }
        // parets verticals a les línies Y (entre j-1 i j)
        for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
            const a = H(i, j - 1), b = H(i, j); if (Math.abs(a - b) <= EPS) continue;
            const p0 = [xs[i], ys[j]], p1 = [xs[i + 1], ys[j]];
            if (a > b) paret(p0, p1, b, a, true); else paret(p0, p1, a, b, false);
        }
        return tri;
    };

    FO.mallaSafata = (s, cfg) => FO.mallaAlcades(FO.regionsSafata(s, cfg));

    // Extrusió en X d'un perfil (Y,Z) antihorari, amb la seva triangulació
    function extrueix(P, T, x0, x1) {
        const tri = [];
        const v = (x, k) => [x, P[k][0], P[k][1]];
        T.forEach(([p, q, r]) => { tri.push([v(x1, p), v(x1, q), v(x1, r)]); tri.push([v(x0, p), v(x0, r), v(x0, q)]); });
        for (let k = 0; k < P.length; k++) {
            const n = (k + 1) % P.length;
            tri.push([v(x0, k), v(x0, n), v(x1, n)], [v(x0, k), v(x1, n), v(x1, k)]);
        }
        return tri;
    }
    const RECT = [[0, 1, 2], [0, 2, 3]];

    // Falca per inclinar la safata cap a l'usuari: bastidor de dos rails
    // laterals amb tope davanter i dues travesses (poc plàstic)
    FO.mallaFalca = function (s) {
        const a = s.angle * Math.PI / 180, h0 = 3, t = 3, tope = h0 + 6, ample = Math.min(12, s.W / 4);
        const D = s.D, W = s.W, hB = h0 + D * Math.tan(a);
        const rail = [[-t, 0], [D, 0], [D, hB], [0, h0], [0, tope], [-t, tope]];
        const railT = [[0, 1, 3], [1, 2, 3], [0, 3, 4], [0, 4, 5]];
        const barra = (y0, y1) => [[y0, 0], [y1, 0], [y1, h0], [y0, h0]];
        return [].concat(
            extrueix(rail, railT, 0, ample),
            extrueix(rail, railT, W - ample, W),
            extrueix(barra(-t, 10), RECT, ample, W - ample),
            extrueix(barra(D - 10, D), RECT, ample, W - ample));
    };

    // ─── STL binari ───
    FO.stlBinari = function (tri, nom) {
        const buf = new ArrayBuffer(84 + tri.length * 50);
        const dv = new DataView(buf);
        const cap = ('FOrdre ' + (nom || '')).slice(0, 79);
        for (let i = 0; i < cap.length; i++) dv.setUint8(i, cap.charCodeAt(i) & 0x7f);
        dv.setUint32(80, tri.length, true);
        let o = 84;
        for (const [a, b, c] of tri) {
            const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
            const l = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map(x => x / l);
            for (const x of [n, a, b, c]) { dv.setFloat32(o, x[0], true); dv.setFloat32(o + 4, x[1], true); dv.setFloat32(o + 8, x[2], true); o += 12; }
            dv.setUint16(o, 0, true); o += 2;
        }
        return new Uint8Array(buf);
    };

    // Volum (mm³) d'una malla tancada, per estimar el filament
    FO.volumMalla = tri => Math.abs(tri.reduce((acc, [a, b, c]) =>
        acc + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6, 0));

    // Grams de filament estimats d'un objecte imprès
    FO.gramsFilament = function (o, cfg) {
        const mat = FO.MATERIALS_IMPRESSIO[o.material] || FO.MATERIALS_IMPRESSIO.PLA;
        const vol = FO.volumMalla(FO.mallaSafata(o, cfg)) / 1000;
        let g = vol * mat.dens * cfg.factorPes;
        if (o.angle > 0 && !o.pare) g += FO.volumMalla(FO.mallaFalca(o)) / 1000 * mat.dens * cfg.factorPes;
        return g;
    };

    // Filament necessari agrupat per material i color: [{material, color, grams, peces}]
    FO.resumFilament = function (pla, cfg) {
        const m = new Map();
        pla.forEach(r => FO.imprimibles(r).forEach(o => {
            const k = o.material + '|' + o.color;
            const e = m.get(k) || { material: o.material, color: o.color, grams: 0, peces: 0 };
            e.grams += FO.gramsFilament(o, cfg); e.peces++;
            m.set(k, e);
        }));
        return Array.from(m.values()).sort((a, b) => a.material.localeCompare(b.material) || b.grams - a.grams);
    };

    // ─── ZIP sense compressió (store), sense dependències ───
    const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    const crc32 = d => { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    const utf8 = s => new TextEncoder().encode(s);

    FO.zip = function (fitxers) { // [{nom, dades: Uint8Array|string}]
        const parts = [], central = [];
        let off = 0;
        for (const f of fitxers) {
            const nom = utf8(f.nom), d = typeof f.dades === 'string' ? utf8(f.dades) : f.dades;
            const crc = crc32(d);
            const loc = new DataView(new ArrayBuffer(30));
            loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true);
            loc.setUint32(14, crc, true); loc.setUint32(18, d.length, true); loc.setUint32(22, d.length, true);
            loc.setUint16(26, nom.length, true);
            parts.push(new Uint8Array(loc.buffer), nom, d);
            const cen = new DataView(new ArrayBuffer(46));
            cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
            cen.setUint32(16, crc, true); cen.setUint32(20, d.length, true); cen.setUint32(24, d.length, true);
            cen.setUint16(28, nom.length, true); cen.setUint32(42, off, true);
            central.push(new Uint8Array(cen.buffer), nom);
            off += 30 + nom.length + d.length;
        }
        const midaC = central.reduce((a, b) => a + b.length, 0);
        const fi = new DataView(new ArrayBuffer(22));
        fi.setUint32(0, 0x06054b50, true); fi.setUint16(8, fitxers.length, true); fi.setUint16(10, fitxers.length, true);
        fi.setUint32(12, midaC, true); fi.setUint32(16, off, true);
        const tot = parts.concat(central, [new Uint8Array(fi.buffer)]);
        const out = new Uint8Array(tot.reduce((a, b) => a + b.length, 0));
        let p = 0; for (const b of tot) { out.set(b, p); p += b.length; }
        return out;
    };

    // Nom de fitxer segur
    FO.nomFitxer = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_');
})(typeof window !== 'undefined' ? window : globalThis);
