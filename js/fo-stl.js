// ═══════════════════════════════════════════════════════════════
// FOrdre — Geometria de safates, caixes, contenidors i tapes
// ───────────────────────────────────────────────────────────────
// Cada objecte es descriu com una seqüència d'operacions sobre caixes
// alineades amb els eixos: afegir (+) o treure (−) material. Això permet
// parets, caixetins, divisors, llavis interiors amb voladís a 45°,
// allotjaments d'imants, text gravat a les cares i rampes al fons.
//
// El sòlid es discretitza sobre una graella comuna (X, Y i nivells de Z)
// i se n'extreuen les cares frontera. Les cares coplanars es fusionen en
// rectangles grans i, per no deixar unions en T, cada aresta rep tots els
// vèrtexs que hi cauen al damunt. El resultat és una malla tancada
// (manifold), llesta per laminar, amb pocs triangles.
// Unitats: mm. X = amplada, Y = fondària (davant → darrere), Z = alçada.
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO || (G.FO = {});
    const t = (s, v) => (FO.t ? FO.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)));   // textos visibles: js/fo-i18n.js
    const EPS = 1e-6;
    const unics = a => a.sort((p, q) => p - q).filter((v, i, arr) => i === 0 || v - arr[i - 1] > EPS);
    function cerca(arr, v) { // índex de v dins arr (ordenat)
        let lo = 0, hi = arr.length - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v - EPS) lo = m + 1; else hi = m; }
        return lo;
    }

    // ═══ Motor de sòlids ═══
    // ops: [{x0,y0,x1,y1,z0,z1,s}] amb s = 1 (afegir) o 0 (treure)
    FO.malla = function (ops) {
        ops = ops.filter(o => o.x1 - o.x0 > EPS && o.y1 - o.y0 > EPS && o.z1 - o.z0 > EPS);
        if (!ops.length) return [];
        const xs = unics(ops.flatMap(o => [o.x0, o.x1])), ys = unics(ops.flatMap(o => [o.y0, o.y1])), zs = unics(ops.flatMap(o => [o.z0, o.z1]));
        const nx = xs.length - 1, ny = ys.length - 1, nz = zs.length - 1;
        const vox = new Uint8Array(nx * ny * nz);
        for (const o of ops) {
            const i0 = cerca(xs, o.x0), i1 = cerca(xs, o.x1), j0 = cerca(ys, o.y0), j1 = cerca(ys, o.y1), k0 = cerca(zs, o.z0), k1 = cerca(zs, o.z1);
            for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
                const b = (i * ny + j) * nz;
                for (let k = k0; k < k1; k++) vox[b + k] = o.s;
            }
        }
        const S = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? 0 : vox[(i * ny + j) * nz + k];

        // Cares: {ax (0=X,1=Y,2=Z), p (índex del pla), a0,a1,b0,b1 (índexs), sg (+1/−1)}
        const cares = [];
        // fusió voraç d'una màscara A×B en rectangles
        function fusiona(A, B, val, emet) {
            const usat = new Uint8Array(A * B);
            for (let a = 0; a < A; a++) for (let b = 0; b < B; b++) {
                const v = val(a, b);
                if (!v || usat[a * B + b]) continue;
                let b1 = b + 1;
                while (b1 < B && val(a, b1) === v && !usat[a * B + b1]) b1++;
                let a1 = a + 1;
                outer: while (a1 < A) {
                    for (let q = b; q < b1; q++) if (val(a1, q) !== v || usat[a1 * B + q]) break outer;
                    a1++;
                }
                for (let p = a; p < a1; p++) for (let q = b; q < b1; q++) usat[p * B + q] = 1;
                emet(a, a1, b, b1, v);
            }
        }
        // plans Z (a = i, b = j)
        for (let k = 0; k <= nz; k++) fusiona(nx, ny, (i, j) => { const d = S(i, j, k - 1), u = S(i, j, k); return d && !u ? 1 : (!d && u ? -1 : 0); },
            (a0, a1, b0, b1, sg) => cares.push({ ax: 2, p: k, a0, a1, b0, b1, sg }));
        // plans X (a = j, b = k)
        for (let i = 0; i <= nx; i++) fusiona(ny, nz, (j, k) => { const l = S(i - 1, j, k), r = S(i, j, k); return l && !r ? 1 : (!l && r ? -1 : 0); },
            (a0, a1, b0, b1, sg) => cares.push({ ax: 0, p: i, a0, a1, b0, b1, sg }));
        // plans Y (a = i, b = k)
        for (let j = 0; j <= ny; j++) fusiona(nx, nz, (i, k) => { const f = S(i, j - 1, k), b = S(i, j, k); return f && !b ? 1 : (!f && b ? -1 : 0); },
            (a0, a1, b0, b1, sg) => cares.push({ ax: 1, p: j, a0, a1, b0, b1, sg }));

        // cantonades de cada cara en índexs (i,j,k)
        const cant = c => {
            if (c.ax === 2) return [[c.a0, c.b0, c.p], [c.a1, c.b0, c.p], [c.a1, c.b1, c.p], [c.a0, c.b1, c.p]];
            if (c.ax === 0) return [[c.p, c.a0, c.b0], [c.p, c.a1, c.b0], [c.p, c.a1, c.b1], [c.p, c.a0, c.b1]];
            return [[c.a0, c.p, c.b0], [c.a0, c.p, c.b1], [c.a1, c.p, c.b1], [c.a1, c.p, c.b0]];
        };
        // vèrtexs per línia: línies paral·leles a X (clau j,k), a Y (i,k), a Z (i,j)
        const linies = [new Map(), new Map(), new Map()];
        const posa = (ax, clau, v) => { let s = linies[ax].get(clau); if (!s) linies[ax].set(clau, s = new Set()); s.add(v); };
        for (const c of cares) for (const [i, j, k] of cant(c)) { posa(0, j + ',' + k, i); posa(1, i + ',' + k, j); posa(2, i + ',' + j, k); }
        const ordenat = new Map();
        const interiors = (ax, clau, v0, v1) => {
            const id = ax + '|' + clau;
            let arr = ordenat.get(id);
            if (!arr) { arr = Array.from(linies[ax].get(clau) || []).sort((a, b) => a - b); ordenat.set(id, arr); }
            const lo = Math.min(v0, v1), hi = Math.max(v0, v1);
            const r = arr.filter(v => v > lo && v < hi);
            return v0 < v1 ? r : r.reverse();
        };
        const coord = ([i, j, k]) => [xs[i], ys[j], zs[k]];
        const tri = [];
        for (const c of cares) {
            let q = cant(c);
            if (c.sg < 0) q = [q[0], q[3], q[2], q[1]];
            const pol = [];
            for (let e = 0; e < 4; e++) {
                const a = q[e], b = q[(e + 1) % 4];
                pol.push(a);
                const ax = a[0] !== b[0] ? 0 : a[1] !== b[1] ? 1 : 2;
                const clau = ax === 0 ? a[1] + ',' + a[2] : ax === 1 ? a[0] + ',' + a[2] : a[0] + ',' + a[1];
                for (const v of interiors(ax, clau, a[ax], b[ax])) { const p = a.slice(); p[ax] = v; pol.push(p); }
            }
            const P = pol.map(coord);
            if (P.length === 4) { tri.push([P[0], P[1], P[2]], [P[0], P[2], P[3]]); continue; }
            // ventall des del centre del rectangle: cap triangle degenerat
            const Q = coord(q[0]), R = coord(q[2]);
            const mig = [(Q[0] + R[0]) / 2, (Q[1] + R[1]) / 2, (Q[2] + R[2]) / 2];
            for (let n = 0; n < P.length; n++) tri.push([mig, P[n], P[(n + 1) % P.length]]);
        }
        return tri;
    };

    // ═══ Font de píxels 5×7 per gravar text ═══
    const FONT = {
        '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
        '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
        '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
        '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
        '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
        'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], 'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
        'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'], 'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
        'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], 'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
        'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'], 'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
        'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'], 'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
        'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'], 'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
        'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'], 'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
        'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], 'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
        'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'], 'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
        'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], 'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
        'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'], 'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
        'W': ['10001', '10001', '10001', '10101', '10101', '10101', '01010'], 'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
        'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'], 'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
        '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'], '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
        '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'], '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
        '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'], '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'],
        ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'], '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100']
    };
    const netText = t => String(t).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/×/g, 'X');
    FO.ampleText = (t, p) => { const n = netText(t).length; return n ? (n * 6 - 0.6) * p : 0; };
    // Rectangles (u, v) d'un text de mòdul p amb origen a baix a l'esquerra (v cap amunt)
    FO.rectsText = function (t, p) {
        const out = [];
        netText(t).split('').forEach((ch, n) => {
            const g = FONT[ch] || FONT['?'];
            g.forEach((fila, r) => {
                let c = 0;
                while (c < 5) {
                    if (fila[c] !== '1') { c++; continue; }
                    let c1 = c; while (c1 < 5 && fila[c1] === '1') c1++;
                    // cada tram s'eixampla 0,2 mòduls per banda: així els píxels en diagonal
                    // es toquen per una cara i no només per una aresta (sòlid tancat)
                    out.push({ u0: (n * 6 + c - 0.2) * p, u1: (n * 6 + c1 + 0.2) * p, v0: (6 - r) * p, v1: (7 - r) * p });
                    c = c1;
                }
            });
        });
        return out;
    };
    // Mòdul de píxel perquè el text càpiga en ample × alt (0 si no hi cap llegible)
    FO.moduleText = (t, ample, alt, pMax) => {
        const n = netText(t).length; if (!n) return 0;
        const p = Math.min(pMax || 1, ample / (n * 6 - 1), alt / 7);
        return p >= 0.45 ? Math.floor(p * 20) / 20 : 0;
    };

    // ═══ Niu amb la forma real de la peça (a partir del seu STL) ═══
    // Llegeix un STL binari o ASCII → llista de triangles
    FO.llegeixSTL = function (dades) {
        const u8 = dades instanceof Uint8Array ? dades : new Uint8Array(dades);
        const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        const tri = [];
        if (u8.length >= 84) {
            const n = dv.getUint32(80, true);
            if (84 + n * 50 === u8.length) {
                for (let i = 0, o = 84; i < n; i++, o += 50) {
                    const v = k => [dv.getFloat32(o + 12 + k * 12, true), dv.getFloat32(o + 16 + k * 12, true), dv.getFloat32(o + 20 + k * 12, true)];
                    tri.push([v(0), v(1), v(2)]);
                }
                return tri;
            }
        }
        const text = new TextDecoder().decode(u8);
        const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
        let m, vs = [];
        while ((m = re.exec(text))) { vs.push([+m[1], +m[2], +m[3]]); if (vs.length === 3) { tri.push(vs); vs = []; } }
        if (!tri.length) throw new Error(t('No és un fitxer STL vàlid'));
        return tri;
    };

    // Perfil de la cara de sota: per a cada punt de la graella, l'alçada mínima de la peça
    // (respecte del seu punt més baix); −1 on no hi ha peça. Retorna el niu que es guarda al material.
    FO.rasteritzaNiu = function (tri, resolucio) {
        let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        tri.forEach(t => t.forEach(v => { for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); } }));
        const w = mx[0] - mn[0], d = mx[1] - mn[1], h = mx[2] - mn[2];
        if (!(w > 0 && d > 0 && h > 0)) throw new Error(t('La peça no té volum'));
        const res = resolucio || Math.max(0.5, Math.round(Math.max(w, d) / 100 * 10) / 10);
        const nx = Math.ceil(w / res), ny = Math.ceil(d / res);
        const z = new Float64Array(nx * ny).fill(Infinity);
        for (const t of tri) {
            const [a, b, c] = t.map(v => [v[0] - mn[0], v[1] - mn[1], v[2] - mn[2]]);
            const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
            if (Math.abs(det) < 1e-12) continue;   // triangle vertical
            const i0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) / res)), i1 = Math.min(nx - 1, Math.floor(Math.max(a[0], b[0], c[0]) / res));
            const j0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) / res)), j1 = Math.min(ny - 1, Math.floor(Math.max(a[1], b[1], c[1]) / res));
            for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
                const px = (i + 0.5) * res, py = (j + 0.5) * res;
                const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det;
                const l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det;
                const l3 = 1 - l1 - l2;
                if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
                const zz = l1 * a[2] + l2 * b[2] + l3 * c[2];
                if (zz < z[i * ny + j]) z[i * ny + j] = zz;
            }
        }
        const hs = Array.from(z, v => isFinite(v) ? Math.round(v * 10) / 10 : -1);
        return { niu: { res, nx, ny, h: hs }, x: Math.round(w * 10) / 10, y: Math.round(d * 10) / 10, z: Math.round(h * 10) / 10, triangles: tri.length };
    };

    // Operacions del niu d'una unitat, centrada a (cx, cy), amb el fons a cz
    function niu(ops, n, w, d, cx, cy, cz, girat, joc, alt) {
        const r = n.res, k = Math.max(1, Math.ceil(joc / r)), anell = Math.ceil(3 / r), R = k + anell;
        const NX = n.nx + 2 * R, NY = n.ny + 2 * R;
        const hp = (i, j) => { i -= R; j -= R; return i < 0 || j < 0 || i >= n.nx || j >= n.ny ? -1 : n.h[i * n.ny + j]; };
        // mínim en un veïnat quadrat (dilata la peça: folgança i anell de centrat)
        const minim = (i, j, rad) => { let m = Infinity; for (let a = i - rad; a <= i + rad; a++) for (let b = j - rad; b <= j + rad; b++) { const v = hp(a, b); if (v >= 0 && v < m) m = v; } return m; };
        const dn = Math.min(Math.max(3, alt * 0.4), 15);
        for (let j = 0; j < NY; j++) {
            let i = 0;
            while (i < NX) {
                const alçada = i2 => { const a = minim(i2, j, k); if (isFinite(a)) return Math.max(0, Math.min(dn, Math.floor((a - 0.3) * 2) / 2)); return isFinite(minim(i2, j, R)) ? dn : 0; };
                const hz = alçada(i);
                let i1 = i + 1;
                while (i1 < NX && alçada(i1) === hz) i1++;
                if (hz > 0) {
                    // coordenades locals de la peça (u al llarg de la seva X, v de la seva Y), centrades
                    const u0 = (i - R) * r - (n.nx * r - w) / 2, u1 = (i1 - R) * r - (n.nx * r - w) / 2;
                    const v0 = (j - R) * r - (n.ny * r - d) / 2, v1 = (j + 1 - R) * r - (n.ny * r - d) / 2;
                    if (!girat) ops.push(OP(cx - w / 2 + u0, cy - d / 2 + v0, cx - w / 2 + u1, cy - d / 2 + v1, cz, cz + hz, 1));
                    else ops.push(OP(cx + d / 2 - v1, cy - w / 2 + u0, cx + d / 2 - v0, cy - w / 2 + u1, cz, cz + hz, 1));
                }
                i = i1;
            }
        }
    }

    // ═══ QR gravat ═══
    // Mateixes dades que l'etiqueta: una caixa individual = el seu material; la resta = TAPA
    FO.dadesQRObjecte = o => o.forma === 'caixa' && o.caixetins[0]
        ? ['FO1', o.id, o.conj ? o.conj.codi : '', o.caixetins[0].mat.codi, o.caixetins[0].qty].join('|')
        : ['FO1', o.id, o.conj ? o.conj.codi : '', o.id, 'TAPA'].join('|');
    function matriuQR(text) {
        const lib = G.qrcode; if (typeof lib !== 'function') return null;
        try { const q = lib(0, 'L'); q.addData(text); q.make(); return { n: q.getModuleCount(), fosc: (r, c) => q.isDark(r, c) }; } catch (e) { return null; }
    }
    // Recorre els mòduls foscos per files i en retorna els trams [fila, col0, col1).
    // Cada tram s'eixampla 0,15 mòduls per banda: els mòduls que es toquen en diagonal
    // queden units per una cara (sòlid tancat) i el QR es continua llegint.
    function tramsQR(q) {
        const out = [];
        for (let r = 0; r < q.n; r++) { let c = 0; while (c < q.n) { if (!q.fosc(r, c)) { c++; continue; } let c1 = c; while (c1 < q.n && q.fosc(r, c1)) c1++; out.push([r, c - 0.15, c1 + 0.15]); c = c1; } }
        return out;
    }
    const MODUL_QR_MIN = 0.8;

    // ═══ Operacions d'un objecte (safata, caixa o contenidor) ═══
    const OP = (x0, y0, x1, y1, z0, z1, s) => ({ x0, y0, x1, y1, z0, z1, s });

    // Posicions dels imants a la part superior de les parets
    FO.posImants = function (o) {
        const e = o.paret / 2, pos = [[e, e], [o.W - e, e], [e, o.D - e], [o.W - e, o.D - e]];
        if (o.W > 160) pos.push([o.W / 2, e], [o.W / 2, o.D - e]);
        if (o.D > 160) pos.push([e, o.D / 2], [o.W - e, o.D / 2]);
        return pos;
    };

    // Llavi interior amb la cara de sota a 45° (sense suports)
    function llavi(ops, c, L, top) {
        if (L <= 0) return;
        const n = Math.max(1, Math.ceil(L / 0.5)), gruix = 1.0;
        const zMin = c.z + 1;
        const anella = (w, z0, z1) => {
            z0 = Math.max(z0, zMin); if (z1 - z0 <= EPS) return;
            ops.push(OP(c.x, c.y, c.x + c.w, c.y + w, z0, z1, 1), OP(c.x, c.y + c.d - w, c.x + c.w, c.y + c.d, z0, z1, 1),
                OP(c.x, c.y, c.x + w, c.y + c.d, z0, z1, 1), OP(c.x + c.w - w, c.y, c.x + c.w, c.y + c.d, z0, z1, 1));
        };
        anella(L, top - gruix, top);
        for (let k = 1; k <= n; k++) anella(L * (n - k + 1) / n, top - gruix - k * L / n, top - gruix - (k - 1) * L / n);
    }

    // Rampa arrodonida al davant del caixetí (per treure la cargoleria fent lliscar el dit)
    function rampa(ops, c) {
        const R = Math.min(c.d * 0.45, (c.prof || 10) * 0.7, 18);
        if (R < 3) return;
        const n = Math.max(3, Math.round(R / 1.2));
        for (let k = 0; k < n; k++) {
            const u0 = R * k / n, u1 = R * (k + 1) / n, um = (u0 + u1) / 2;
            const h = R - Math.sqrt(Math.max(0, R * R - (R - um) * (R - um)));
            if (h > 0.2) ops.push(OP(c.x, c.y + u0, c.x + c.w, c.y + u1, c.z, c.z + h, 1));
        }
    }

    // Text gravat en una cara vertical (davant o darrere) o al fons d'un caixetí
    function gravaFront(ops, o, text, x0, x1, z0, z1, darrere, prof) {
        const p = FO.moduleText(text, x1 - x0 - 2, z1 - z0 - 1, 1.2);
        if (!p) return false;
        const w = FO.ampleText(text, p), h = 7 * p;
        const u = x0 + (x1 - x0 - w) / 2, v = z0 + (z1 - z0 - h) / 2;
        FO.rectsText(text, p).forEach(r => {
            const xa = darrere ? o.W - (u + r.u1) : u + r.u0, xb = darrere ? o.W - (u + r.u0) : u + r.u1;
            if (darrere) ops.push(OP(xa, o.D - prof, xb, o.D, v + r.v0, v + r.v1, 0));
            else ops.push(OP(xa, 0, xb, prof, v + r.v0, v + r.v1, 0));
        });
        return true;
    }
    function gravaFons(ops, c, text) {
        const prof = Math.min(0.4, c.z - 0.5);
        if (prof < 0.2) return;
        const zona = Math.min(c.d * 0.45, 14);   // franja del darrere del caixetí
        const p = FO.moduleText(text, c.w - 3, zona - 2, 1.2);
        if (!p) return;
        const w = FO.ampleText(text, p), h = 7 * p;
        const u = c.x + (c.w - w) / 2, v = c.y + c.d - 1.5 - h;
        FO.rectsText(text, p).forEach(r => ops.push(OP(u + r.u0, v + r.v0, u + r.u1, v + r.v1, c.z - prof, c.z, 0)));
    }

    FO.opsObjecte = function (o, cfg) {
        const ops = [], H = o.H, pw = o.paret, tanc = o.tancament || 'cap';
        const avisos = [];
        ops.push(OP(0, 0, o.W, o.D, 0, H, 1));
        let franjaText = [pw + 1, o.W - pw - 1];
        if (o.forma === 'contenidor') {
            const fons = o.fons || cfg.terra, peu = FO.PEU_APILABLE || 3;
            const osca = Math.min(30, o.W / 3), hO = Math.max(fons + 3, H * 0.45);
            ops.push(OP(pw, pw, o.W - pw, o.D - pw, fons, H, 0));
            ops.push(OP((o.W - osca) / 2, 0, (o.W + osca) / 2, pw, hO, H, 0), OP((o.W - osca) / 2, o.D - pw, (o.W + osca) / 2, o.D, hO, H, 0));
            franjaText = [pw + 1, (o.W - osca) / 2 - 1];
            // Nanses: a cada costat curt, un bloc amb un forat vertical per als dits;
            // la barra exterior és l'agafador. S'imprimeix sense suports.
            if (o.nanses && o.D >= 80) {
                const z = FO.ZONA_NANSA || 30, yc = o.D / 2, mig = Math.min(36, o.D / 2 - pw - 4), forat = mig - 6;
                const hN = o.apilable ? H - peu - 0.6 : H;
                [[0, 1], [o.W, -1]].forEach(([x0, sg]) => {
                    const X = a => sg > 0 ? x0 + a : x0 - a;
                    const xa = (a, b) => [Math.min(X(a), X(b)), Math.max(X(a), X(b))];
                    const [b0, b1] = xa(0, pw + z), [f0, f1] = xa(5, 5 + 22);
                    ops.push(OP(b0, yc - mig, b1, yc + mig, 0, hN, 1));
                    ops.push(OP(f0, yc - forat, f1, yc + forat, 0, H, 0));
                });
                franjaText = [pw + z + 1, (o.W - osca) / 2 - 1];
            }
            // Peu encastat: la base és una mica més petita i entra dins el contenidor de sota
            if (o.apilable) {
                const b = pw + 0.6;
                ops.push(OP(0, 0, o.W, b, 0, peu, 0), OP(0, o.D - b, o.W, o.D, 0, peu, 0), OP(0, 0, b, o.D, 0, peu, 0), OP(o.W - b, 0, o.W, o.D, 0, peu, 0));
            }
        } else {
            // alçada dels divisors: sense vora alta; amb tapa a pressió, per sota de la faldilla
            const cims = H - Math.max(cfg.llavi, tanc === 'pressio' ? 4.5 : 0);
            o.caixetins.forEach(c => {
                ops.push(OP(c.x, c.y, c.x + c.w, c.y + c.d, c.z, H, 0));
                if (c.mode === 'individual' && c.cel && (c.cel.nx > 1 || c.cel.ny > 1)) {
                    const nx = c.girat ? c.cel.ny : c.cel.nx, ny = c.girat ? c.cel.nx : c.cel.ny, t = cfg.divisor;
                    const pwc = (c.w - (nx - 1) * t) / nx, pd = (c.d - (ny - 1) * t) / ny;
                    for (let i = 1; i < nx; i++) { const x = c.x + i * pwc + (i - 1) * t; ops.push(OP(x, c.y, x + t, c.y + c.d, c.z, cims, 1)); }
                    for (let k = 1; k < ny; k++) { const y = c.y + k * pd + (k - 1) * t; ops.push(OP(c.x, y, c.x + c.w, y + t, c.z, cims, 1)); }
                }
                // niu amb la forma real de la peça, una unitat per cel·la
                if (c.mode === 'individual' && c.mat.niu && c.cel) {
                    const nx = c.girat ? c.cel.ny : c.cel.nx, ny = c.girat ? c.cel.nx : c.cel.ny, t = cfg.divisor;
                    const pwc = (c.w - (nx - 1) * t) / nx, pd = (c.d - (ny - 1) * t) / ny;
                    for (let q = 0; q < c.qty; q++) {
                        const i = q % nx, k = Math.floor(q / nx);
                        niu(ops, c.mat.niu, c.o.w, c.o.d, c.x + i * (pwc + t) + pwc / 2, c.y + k * (pd + t) + pd / 2, c.z, !!c.girat, cfg.joc, c.o.h);
                    }
                }
                if (cfg.fonsArrodonit && c.mode === 'granel') rampa(ops, c);
                if (cfg.codiFons) gravaFons(ops, c, c.mat.codi);
                if (tanc === 'llavi') llavi(ops, c, c.llavi || 0, H);
            });
        }
        if (tanc === 'imants') {
            const s = cfg.imantD + 0.3, h = cfg.imantH + 0.2;
            FO.posImants(o).forEach(([x, y]) => ops.push(OP(x - s / 2, y - s / 2, x + s / 2, y + s / 2, H - h, H, 0)));
        }
        // identificació a la cara frontal (i posterior si cal)
        const profG = Math.min(0.6, pw / 2);
        const text = o.forma === 'caixa' && o.caixetins[0] ? o.caixetins[0].mat.codi : o.id;
        const zText0 = cfg.terra + 0.8, zText1 = H - Math.max(cfg.llavi, 1) - 0.8;
        let cara = 'davant';
        if (cfg.relleu && zText1 - zText0 > 3) {
            if (gravaFront(ops, o, text, franjaText[0], franjaText[1], zText0, zText1, false, profG)) cara = 'darrere';
            else avisos.push(t('el codi no hi cap en relleu'));
        }
        if (cfg.rebaixEtiqueta && FO.midaEtiqueta) {
            const m = FO.midaEtiqueta({ nom: text, ample: franjaText[1] - franjaText[0] }, cfg.etiqueta, cfg.etiqueta === 'mida' ? { w: cfg.etiquetaW, h: cfg.etiquetaH } : null);
            const w = Math.min(m.w + 0.6, franjaText[1] - franjaText[0]), h = Math.min(m.h + 0.6, zText1 - zText0);
            if (w > 8 && h > 5) {
                const x0 = cara === 'darrere' ? o.W - franjaText[1] + (franjaText[1] - franjaText[0] - w) / 2 : franjaText[0] + (franjaText[1] - franjaText[0] - w) / 2;
                const z0 = zText0 + (zText1 - zText0 - h) / 2, pr = Math.min(0.4, pw / 2);
                ops.push(cara === 'darrere' ? OP(x0, o.D - pr, x0 + w, o.D, z0, z0 + h, 0) : OP(x0, 0, x0 + w, pr, z0, z0 + h, 0));
            } else avisos.push(t('l\'etiqueta no hi cap al rebaix'));
        }
        // QR a la cara posterior quan no hi ha tapa i la cara és lliure
        if (cfg.qrRelleu && tanc !== 'pressio' && tanc !== 'imants' && !(cfg.rebaixEtiqueta && cara === 'darrere')) {
            const q = matriuQR(FO.dadesQRObjecte(o));
            if (q) {
                const x0f = o.forma === 'contenidor' ? pw + 1 : pw + 1, x1f = o.W - pw - 1;
                const m = Math.min(1.6, (x1f - x0f) / (q.n + 2), (zText1 - zText0) / (q.n + 2));
                if (m >= MODUL_QR_MIN) {
                    const pr = Math.min(0.6, pw / 2), costat = q.n * m;
                    const xc = (x0f + x1f) / 2, zTop = (zText0 + zText1) / 2 + costat / 2;
                    // vist des del darrere, la X va al revés: es reflecteix perquè es llegeixi bé
                    tramsQR(q).forEach(([r, c0, c1]) => ops.push(OP(xc + costat / 2 - c1 * m, o.D - pr, xc + costat / 2 - c0 * m, o.D, zTop - (r + 1) * m, zTop - r * m, 0)));
                }
            }
        }
        return { ops, avisos };
    };

    FO.mallaSafata = (o, cfg) => FO.malla(FO.opsObjecte(o, cfg).ops);

    // ═══ Tapes ═══
    // Es modelen en posició d'impressió (placa a sota); en girar-la per posar-la,
    // Y queda invertida, per això les posicions es reflecteixen (D − y).
    FO.opsTapa = function (o, cfg) {
        const tanc = o.tancament;
        if (tanc !== 'pressio' && tanc !== 'imants') return null;
        const W = o.W, D = o.D, pw = o.paret, ops = [];
        const t = tanc === 'imants' ? Math.max(cfg.gruixTapa, cfg.imantH + 1) : cfg.gruixTapa;
        const hf = o.cim > o.H + 0.01 ? Math.ceil(o.cim - o.H + 1) : 0;   // marc si hi ha peces que sobresurten
        ops.push(OP(0, 0, W, D, 0, t, 1));
        if (hf > 0) ops.push(OP(0, 0, W, D, t, t + hf, 1), OP(pw, pw, W - pw, D - pw, t, t + hf, 0));
        const z0 = t + hf;
        const my = (y0, y1) => [D - y1, D - y0];
        if (tanc === 'pressio') {
            const jt = cfg.jocTapa, g = 1.2, hs = 4;
            const zones = o.forma === 'contenidor' ? [{ x: pw, y: pw, w: W - 2 * pw, d: D - 2 * pw }] : o.caixetins;
            zones.forEach(c => {
                const strips = [];
                if (Math.abs(c.y - pw) < 0.05) strips.push([c.x + jt, pw + jt, c.x + c.w - jt, pw + jt + g]);
                if (Math.abs(c.y + c.d - (D - pw)) < 0.05) strips.push([c.x + jt, D - pw - jt - g, c.x + c.w - jt, D - pw - jt]);
                if (Math.abs(c.x - pw) < 0.05) strips.push([pw + jt, c.y + jt, pw + jt + g, c.y + c.d - jt]);
                if (Math.abs(c.x + c.w - (W - pw)) < 0.05) strips.push([W - pw - jt - g, c.y + jt, W - pw - jt, c.y + c.d - jt]);
                strips.forEach(([x0, y0, x1, y1]) => { const [a, b] = my(y0, y1); ops.push(OP(x0, a, x1, b, z0, z0 + hs, 1)); });
            });
        } else {
            const s = cfg.imantD + 0.3, h = cfg.imantH + 0.2;
            FO.posImants(o).forEach(([x, y]) => { const [a, b] = my(y - s / 2, y + s / 2); ops.push(OP(x - s / 2, a, x + s / 2, b, z0 - h, z0, 0)); });
        }
        // QR gravat a la cara de la tapa que toca el llit (la de dalt quan està posada)
        if (cfg.qrRelleu) {
            const q = matriuQR(FO.dadesQRObjecte(o));
            if (q) {
                const m = Math.min(1.6, (Math.min(W, D) - 2 * pw - 6) / (q.n + 2));
                if (m >= MODUL_QR_MIN) {
                    const costat = q.n * m, x0 = (W - costat) / 2, y0 = (D - costat) / 2, pr = Math.min(0.6, t / 2);
                    // girada la tapa, la fila 0 queda al fons: en posició d'impressió va a y0
                    tramsQR(q).forEach(([r, c0, c1]) => ops.push(OP(x0 + c0 * m, y0 + r * m, x0 + c1 * m, y0 + (r + 1) * m, 0, pr, 0)));
                }
            }
        }
        return ops;
    };
    FO.mallaTapa = (o, cfg) => { const ops = FO.opsTapa(o, cfg); return ops ? FO.malla(ops) : null; };

    // ═══ Peça de calibratge ═══
    // Una placa amb forats quadrats de 10 mm + folgança i un tac de 10 × 10 mm.
    // El número gravat sota cada forat és la folgança (per costat) en dècimes de mm.
    FO.JOCS_CALIBRATGE = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];
    FO.mallaCalibratge = function () {
        const n = FO.JOCS_CALIBRATGE.length, pas = 16, W = n * pas + 6, D = 30, T = 4, ops = [OP(0, 0, W, D, 0, T, 1)];
        FO.JOCS_CALIBRATGE.forEach((j, i) => {
            const cx = 3 + pas * i + pas / 2, cy = 19, s = 10 + 2 * j;
            ops.push(OP(cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2, 0, T, 0));
            const txt = String(Math.round(j * 100)), p = 0.7, w = FO.ampleText(txt, p);
            FO.rectsText(txt, p).forEach(r => ops.push(OP(cx - w / 2 + r.u0, 3 + r.v0, cx - w / 2 + r.u1, 3 + r.v1, T - 0.5, T, 0)));
        });
        // tac de prova, separat de la placa
        ops.push(OP(W + 8, 10, W + 18, 20, 0, 12, 1));
        ops.push(OP(W + 8, 10, W + 18, 11, 11.5, 12, 0)); // marca per saber quina cara és la de dalt
        return FO.malla(ops);
    };

    // ═══ Falca per inclinar ═══
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
    FO.mallaFalca = function (s) {
        const a = s.angle * Math.PI / 180, h0 = 3, t = 3, tope = h0 + 6, ample = Math.min(12, s.W / 4);
        const D = s.D, W = s.W, hB = h0 + D * Math.tan(a);
        const rail = [[-t, 0], [D, 0], [D, hB], [0, h0], [0, tope], [-t, tope]];
        const railT = [[0, 1, 3], [1, 2, 3], [0, 3, 4], [0, 4, 5]];
        const barra = (y0, y1) => [[y0, 0], [y1, 0], [y1, h0], [y0, h0]];
        return [].concat(extrueix(rail, railT, 0, ample), extrueix(rail, railT, W - ample, W),
            extrueix(barra(-t, 10), RECT, ample, W - ample), extrueix(barra(D - 10, D), RECT, ample, W - ample));
    };

    // ═══ STL binari ═══
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

    FO.volumMalla = tri => Math.abs(tri.reduce((acc, [a, b, c]) =>
        acc + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6, 0));

    // ═══ Peces imprimibles d'un objecte (objecte, tapa, falca) ═══
    // Es guarden en memòria cau: la geometria només canvia quan es recalcula el pla.
    FO.pecesImpressio = function (o, cfg) {
        if (o._peces) return o._peces;
        const peces = [{ tipus: 'objecte', nom: o.id, tri: FO.mallaSafata(o, cfg), W: o.W, D: o.D }];
        const tapa = FO.mallaTapa(o, cfg);
        if (tapa) peces.push({ tipus: 'tapa', nom: o.id + ' tapa', tri: tapa, W: o.W, D: o.D });
        if (o.angle > 0 && !o.pare) peces.push({ tipus: 'falca', nom: o.id + ' falca', tri: FO.mallaFalca(o), W: o.W, D: o.D + 3 });
        peces.forEach(p => { p.vol = FO.volumMalla(p.tri); });
        Object.defineProperty(o, '_peces', { value: peces, enumerable: false, configurable: true });
        return peces;
    };

    FO.gramsFilament = function (o, cfg) {
        const mat = FO.MATERIALS_IMPRESSIO[o.material] || FO.MATERIALS_IMPRESSIO.PLA;
        return FO.pecesImpressio(o, cfg).reduce((a, p) => a + p.vol / 1000 * mat.dens * cfg.factorPes, 0);
    };
    FO.horesImpressio = (vol, cfg) => vol * cfg.factorPes / cfg.cabal / 3600 * 1.3;

    FO.resumFilament = function (pla, cfg) {
        const m = new Map();
        pla.forEach(r => FO.imprimibles(r).forEach(o => {
            const k = o.material + '|' + o.color;
            const e = m.get(k) || { material: o.material, color: o.color, grams: 0, peces: 0 };
            e.grams += FO.gramsFilament(o, cfg); e.peces += FO.pecesImpressio(o, cfg).length;
            m.set(k, e);
        }));
        return Array.from(m.values()).sort((a, b) => a.material.localeCompare(b.material) || b.grams - a.grams);
    };

    // ═══ Tandes d'impressió: peces agrupades per material i color, col·locades al llit ═══
    FO.tandes = function (pla, cfg) {
        const grups = new Map();
        pla.forEach(r => FO.imprimibles(r).forEach(o => FO.pecesImpressio(o, cfg).forEach(p => {
            const k = o.material + '|' + o.color;
            if (!grups.has(k)) grups.set(k, { material: o.material, color: o.color, peces: [] });
            grups.get(k).peces.push(Object.assign({ obj: o, pas: r.pas }, p));
        })));
        const sep = cfg.separacioTanda, BW = cfg.llit.x, BD = cfg.llit.y, out = [];
        // intenta col·locar una peça (w × d) en una tanda, per prestatges
        const col = (t, p, w, d, girat) => {
            for (const f of t.files) {
                if (d <= f.d + EPS && f.x + w <= BW + EPS) { t.items.push({ p, x: f.x, y: f.y, girat }); f.x += w + sep; return true; }
            }
            const y = t.files.reduce((a, f) => Math.max(a, f.y + f.d + sep), 0);
            if (y + d <= BD + EPS && w <= BW + EPS) { t.files.push({ y, d, x: w + sep }); t.items.push({ p, x: 0, y, girat }); return true; }
            return false;
        };
        grups.forEach(g => {
            const obertes = [];
            g.peces.slice().sort((a, b) => Math.max(b.W, b.D) - Math.max(a.W, a.D) || b.W * b.D - a.W * a.D).forEach(p => {
                const opcions = [[p.W, p.D, false], [p.D, p.W, true]];
                const cap = opcions.filter(([w, d]) => w <= BW + EPS && d <= BD + EPS);
                if (!cap.length) {
                    const t = { material: g.material, color: g.color, items: [{ p, x: 0, y: 0, girat: false }], files: [], vol: p.vol, massaGran: true };
                    out.push(t); return;
                }
                for (const t of obertes) for (const [w, d, gi] of cap) if (col(t, p, w, d, gi)) { t.vol += p.vol; return; }
                const t = { material: g.material, color: g.color, items: [], files: [], vol: p.vol };
                col(t, p, cap[0][0], cap[0][1], cap[0][2]);
                obertes.push(t); out.push(t);
            });
        });
        out.forEach((t, i) => {
            const mat = FO.MATERIALS_IMPRESSIO[t.material] || FO.MATERIALS_IMPRESSIO.PLA;
            t.num = i + 1;
            t.grams = t.vol / 1000 * mat.dens * cfg.factorPes;
            t.hores = FO.horesImpressio(t.vol, cfg);
        });
        return out;
    };

    // ═══ 3MF (una tanda: totes les peces col·locades, amb el color) ═══
    FO.tresMF = function (tanda, nom) {
        const fmt = v => (Math.round(v * 1000) / 1000).toString();
        let objs = '', items = '', id = 2;
        tanda.items.forEach(it => {
            const idx = new Map(), verts = [], tris = [];
            const vid = v => { const k = v.map(fmt).join(','); let n = idx.get(k); if (n === undefined) { n = verts.length; idx.set(k, n); verts.push(v); } return n; };
            it.p.tri.forEach(t => tris.push(t.map(vid)));
            objs += `<object id="${id}" type="model" pid="1" pindex="0" name="${String(it.p.nom).replace(/[<&"]/g, '_')}"><mesh><vertices>` +
                verts.map(v => `<vertex x="${fmt(v[0])}" y="${fmt(v[1])}" z="${fmt(v[2])}"/>`).join('') + '</vertices><triangles>' +
                tris.map(t => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('') + '</triangles></mesh></object>';
            // girat 90° sobre Z: x' = −y + D, y' = x
            const tr = it.girat ? `0 1 0 -1 0 0 0 0 1 ${fmt(it.x + it.p.D)} ${fmt(it.y)} 0` : `1 0 0 0 1 0 0 0 1 ${fmt(it.x)} ${fmt(it.y)} 0`;
            items += `<item objectid="${id}" transform="${tr}"/>`;
            id++;
        });
        const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="ca" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${String(nom).replace(/[<&]/g, '_')}</metadata><metadata name="Application">FOrdre</metadata>
<resources><basematerials id="1"><base name="${tanda.material}" displaycolor="${tanda.color}FF"/></basematerials>${objs}</resources>
<build>${items}</build></model>`;
        return FO.zip([
            { nom: '[Content_Types].xml', dades: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>' },
            { nom: '_rels/.rels', dades: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
            { nom: '3D/3dmodel.model', dades: model }
        ]);
    };

    // ═══ ZIP sense compressió (store), sense dependències ═══
    const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    const crc32 = d => { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    const utf8 = s => new TextEncoder().encode(s);
    FO.zip = function (fitxers) {
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

    FO.nomFitxer = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_');
})(typeof window !== 'undefined' ? window : globalThis);
