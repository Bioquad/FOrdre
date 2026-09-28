// ═══════════════════════════════════════════════════════════════
// FOrdre — Càlcul de caixetins i distribució de safates
// ───────────────────────────────────────────────────────────────
// 1. Cada material d'un conjunt té el seu caixetí (mai es barregen).
//    La mida surt de les dimensions de la peça, la quantitat i la
//    manera de col·locar-la: individual, apilada, en capa o a granel.
// 2. Els caixetins d'un conjunt es col·loquen en files (shelf packing)
//    dins el llit de la impressora. Cada fila s'estira fins a ocupar
//    tota l'amplada, de manera que entre caixetins només queden parets.
// 3. Si no hi caben, el conjunt es reparteix en diverses safates (A, B…).
//    Les peces sensibles a l'ESD van a una safata pròpia.
// Totes les mides en mm. Eix X = amplada (esquerra→dreta),
// Y = fondària (davant→darrere), Z = alçada.
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO || (G.FO = {});
    const r05 = v => Math.ceil(v * 2 - 1e-9) / 2; // arrodoneix a 0,5 mm per amunt

    // Una peça ha d'anar dreta si porta líquids o no tolera tombar-se del tot
    FO.vaDreta = m => m.liquid || m.angleMax < 90;

    // Dimensions de la peça tal com reposa al caixetí: w ≥ d (planta) i h (alçada)
    FO.orientacio = function (m) {
        let w, d, h;
        const cil = m.forma === 'cylinder';
        if (FO.vaDreta(m)) {
            h = m.z;
            if (cil) { w = d = Math.max(m.x, m.y); } else { w = Math.max(m.x, m.y); d = Math.min(m.x, m.y); }
        } else {
            const s = [m.x, m.y, m.z].sort((a, b) => a - b);
            h = s[0]; d = s[1]; w = s[2];
        }
        return { w, d, h, dreta: FO.vaDreta(m) };
    };

    FO.modeDisposicio = function (m, qty) {
        if (m.disposicio && m.disposicio !== 'auto') return m.disposicio;
        const o = FO.orientacio(m);
        const vol = o.w * o.d * o.h;
        if (m.liquid || m.fragil >= 6) return 'individual';
        if (m.tipus === 'cargol' && m.fragil < 5) return 'granel';
        if (vol < 1500 && qty >= 6 && m.fragil < 5) return 'granel';
        if (m.apilable && qty > 1) return 'apilat';
        return 'capa';
    };

    // Millor graella nx × ny per a n cel·les de (cw × cd) separades per s:
    // la més quadrada que no passi de maxW × maxD
    function graella(n, cw, cd, s, extraW, maxW, maxD) {
        let millor = null;
        for (let nx = 1; nx <= n; nx++) {
            const ny = Math.ceil(n / nx);
            if (nx > 1 && (nx - 1) * ny >= n) continue; // una columna sobrant
            const W = nx * cw + (nx - 1) * s + extraW, D = ny * cd + (ny - 1) * s;
            const cap = W <= maxW + 1e-6 && D <= maxD + 1e-6;
            const cost = Math.max(W, D) / Math.min(W, D) + (nx * ny - n) * 0.05;
            if (!millor || (cap && !millor.cap) || (cap === millor.cap && cost < millor.cost)) millor = { nx, ny, W, D, cap, cost };
        }
        return millor;
    }

    // Caixetí per a una quantitat d'un material. maxW/maxD: espai útil del llit.
    FO.calculaCaixeti = function (m, qty, cfg, maxW, maxD) {
        const o = FO.orientacio(m);
        const mode = FO.modeDisposicio(m, qty);
        const j = cfg.joc, dit = cfg.dit, avisos = [];
        let W, D, prof, cel = null;

        if (mode === 'granel') {
            const vUnit = o.w * o.d * o.h;
            const vol = qty * vUnit / cfg.granel;
            prof = Math.min(cfg.profMax, Math.max(12, o.h + 2 * j, Math.cbrt(vol) * 0.8));
            const area = vol / (prof * cfg.omplert);
            W = Math.max(o.w + 2 * j, Math.sqrt(area), cfg.minCaixeti);
            D = Math.max(o.d + 2 * j, area / W, cfg.minCaixeti);
        } else if (mode === 'individual') {
            const cw = o.w + 2 * j + dit, cd = o.d + 2 * j;
            const g = graella(qty, cw, cd, cfg.divisor, 0, maxW, maxD);
            W = g.W; D = g.D;
            cel = { nx: g.nx, ny: g.ny, cw, cd, perCel: 1 };
            prof = Math.min(o.h + j, cfg.profMax);
            if (o.dreta) prof = Math.max(prof, o.h * cfg.retencio);
        } else if (mode === 'apilat') {
            let porPila = Math.max(1, Math.floor((cfg.profMax - j) / o.h));
            if (m.maxApilat > 0) porPila = Math.min(porPila, m.maxApilat);
            const piles = Math.ceil(qty / porPila);
            porPila = Math.ceil(qty / piles);
            const g = graella(piles, o.w + j, o.d + j, 0, j + dit, maxW, maxD);
            W = g.W; D = g.D + j;
            cel = { nx: g.nx, ny: g.ny, cw: o.w + j, cd: o.d + j, perCel: porPila, obert: true };
            prof = Math.min(porPila * o.h + j, Math.max(cfg.profMax, o.h + j));
        } else { // capa
            const g = graella(qty, o.w + j, o.d + j, 0, j + dit, maxW, maxD);
            W = g.W; D = g.D + j;
            cel = { nx: g.nx, ny: g.ny, cw: o.w + j, cd: o.d + j, perCel: 1, obert: true };
            prof = Math.min(o.h + j, cfg.profMax);
        }
        W = r05(Math.max(W, cfg.minCaixeti));
        D = r05(Math.max(D, cfg.minCaixeti));
        prof = r05(Math.max(prof, 5));
        if (o.h > prof + 0.01 && mode !== 'granel') avisos.push(`sobresurt ${r05(o.h - prof)} mm del caixetí`);
        return { mat: m, qty, mode, W, D, prof, cel, o, avisos, pes: qty * m.pes };
    };

    // Genera els caixetins d'un material; si no caben al llit, divideix la quantitat
    FO.caixetinsMaterial = function (m, qty, cfg, maxW, maxD) {
        const c = FO.calculaCaixeti(m, qty, cfg, maxW, maxD);
        const cap = (c.W <= maxW && c.D <= maxD) || (c.D <= maxW && c.W <= maxD);
        if (cap) return [c];
        if (qty <= 1) { c.fora = true; c.avisos.push('no cap al llit de la impressora: cal preparar-la fora de safata'); return [c]; }
        const a = Math.ceil(qty / 2);
        return FO.caixetinsMaterial(m, a, cfg, maxW, maxD).concat(FO.caixetinsMaterial(m, qty - a, cfg, maxW, maxD));
    };

    // Quant es pot estirar un caixetí per aprofitar un forat sense que
    // les peces petites quedin perdudes en un caixetí massa gran
    const estirable = (orig, nou) => nou <= Math.max(orig * 1.4, orig + 12) + 1e-6;

    // ─── Distribució en files i columnes dins una amplada interior L ───
    // Cada fila té columnes; dins una columna s'apilen caixetins de davant
    // cap enrere mentre hi càpiguen. El que sobra queda massís.
    // Retorna {W, D, pos:[{c,x,y,w,d,girat}]} (coordenades interiors) o null.
    function enFiles(caix, L, s, maxD) {
        const files = [];
        let fila = null;
        const novaFila = grup => { fila = { grup, w: 0, d: 0, cols: [] }; files.push(fila); };
        for (const c of caix) {
            const grup = c.mat.tipus === 'consumible' ? 1 : 0;
            const opcions = [{ w: c.W, d: c.D, girat: false }];
            if (c.W !== c.D) opcions.push({ w: c.D, d: c.W, girat: true });
            let posat = false;
            if (fila && fila.grup === grup) {
                // 1) apilar a l'última columna
                const col = fila.cols[fila.cols.length - 1];
                for (const o of opcions) {
                    if (o.w <= col.w + 1e-6 && estirable(o.w, col.w) && col.d + s + o.d <= fila.d + 1e-6) {
                        col.items.push({ c, w: o.w, d: o.d, girat: o.girat }); col.d += s + o.d; posat = true; break;
                    }
                }
                // 2) nova columna a la mateixa fila (sense fer-la més fonda)
                if (!posat) {
                    const o = opcions.filter(o => o.d <= fila.d + 1e-6 && fila.w + s + o.w <= L + 1e-6)
                        .sort((a, b) => a.w - b.w)[0];
                    if (o) {
                        fila.cols.push({ w: o.w, d: o.d, items: [{ c, w: o.w, d: o.d, girat: o.girat }] });
                        fila.w += s + o.w; posat = true;
                    }
                }
            }
            // 3) fila nova: orientació de menys fondària que càpiga a L
            if (!posat) {
                const o = opcions.filter(o => o.w <= L + 1e-6).sort((a, b) => a.d - b.d)[0];
                if (!o) return null;
                novaFila(grup);
                fila.cols.push({ w: o.w, d: o.d, items: [{ c, w: o.w, d: o.d, girat: o.girat }] });
                fila.w = o.w; fila.d = o.d;
            }
        }
        const W = Math.max(...files.map(f => f.w));
        const D = files.reduce((a, f) => a + f.d, 0) + s * (files.length - 1);
        if (D > maxD + 1e-6) return null;

        // Posicions, estirant dins els límits per aprofitar forats
        const pos = [];
        let y = 0;
        files.forEach((f, fi) => {
            let x = 0;
            const sobraFila = W - f.w;
            f.cols.forEach((col, ci) => {
                let cw = col.w;
                const ultimaCol = ci === f.cols.length - 1;
                if (ultimaCol && col.items.every(it => estirable(it.w, cw + sobraFila))) cw += sobraFila;
                let yy = y;
                const sobraCol = f.d - col.d;
                col.items.forEach((it, ii) => {
                    let w = estirable(it.w, cw) ? cw : it.w;
                    let d = it.d;
                    if (ii === col.items.length - 1 && estirable(it.d, d + sobraCol)) d += sobraCol;
                    pos.push({ c: it.c, x, y: yy, w, d, girat: it.girat, fila: fi });
                    yy += d + s;
                });
                x += cw + s;
            });
            y += f.d + s;
        });
        return { W, D, pos };
    }

    // Converteix a coordenades de safata (sumant la paret exterior)
    function posiciona(dist, cfg) {
        const p = cfg.paret, r = v => Math.round(v * 100) / 100;
        return dist.pos.map(q => Object.assign({}, q.c, {
            x: r(q.x + p), y: r(q.y + p), w: r(q.w), d: r(q.d), girat: q.girat, fila: q.fila
        }));
    }

    // Cerca la distribució de mínima superfície que cap al llit
    FO.distribueix = function (caix, cfg) {
        const s = cfg.separador, p = cfg.paret;
        const maxW = cfg.llit.x - 2 * p, maxD = cfg.llit.y - 2 * p;
        const ordenats = caix.slice().sort((a, b) =>
            (a.mat.tipus === 'consumible') - (b.mat.tipus === 'consumible') || b.D - a.D || b.W - a.W);
        const minL = Math.max(...ordenats.map(c => Math.min(c.W, c.D)));
        let millor = null;
        for (let L = minL; L <= maxW + 1e-6; L += 2) {
            const d = enFiles(ordenats, L, s, maxD);
            if (!d) continue;
            const area = (d.W + 2 * p) * (d.D + 2 * p);
            const cost = area * (1 + 0.02 * Math.max(d.W, d.D) / Math.min(d.W, d.D));
            if (!millor || cost < millor.cost) millor = Object.assign(d, { cost });
        }
        return millor;
    };

    // Reparteix caixetins en safates: omple la primera i continua a la següent
    function reparteix(caix, cfg) {
        const safates = [];
        let actual = [];
        const ordenats = caix.slice().sort((a, b) =>
            (a.mat.tipus === 'consumible') - (b.mat.tipus === 'consumible') || (b.W * b.D) - (a.W * a.D));
        for (const c of ordenats) {
            if (FO.distribueix(actual.concat([c]), cfg)) { actual.push(c); continue; }
            if (actual.length) safates.push(actual);
            actual = [c];
        }
        if (actual.length) safates.push(actual);
        return safates;
    }

    function construeixSafata(id, tipus, caix, cfg, conj) {
        const dist = FO.distribueix(caix, cfg) || enFiles(caix, Math.max(...caix.map(c => Math.max(c.W, c.D))), cfg.separador, Infinity);
        const caixetins = posiciona(dist, cfg);
        const profMax = Math.max(...caixetins.map(c => c.prof));
        const H = r05(profMax + cfg.terra + cfg.llavi);
        // Cota del fons de cada caixetí. El fons s'eleva perquè les peces petites
        // quedin a l'abast; els caixetins grans baixen fins al terra per estalviar plàstic.
        caixetins.forEach(c => {
            const eleva = cfg.fonsElevat === 'tots' || (cfg.fonsElevat !== 'cap' && c.w * c.d <= cfg.areaPetit);
            c.z = eleva ? H - c.prof - cfg.llavi : cfg.terra;
            c.profReal = H - c.z;
        });
        const angle = Math.min(cfg.inclinacio || 0, ...caixetins.map(c => c.mat.angleMax));
        const avisos = [];
        if (H > cfg.llit.z) avisos.push(`alçada ${H} mm superior a la del llit (${cfg.llit.z} mm)`);
        if ((cfg.inclinacio || 0) > angle) avisos.push(`inclinació limitada a ${angle}° per peces que no es poden tombar`);
        return {
            id, tipus, conj, W: r05(dist.W + 2 * cfg.paret), D: r05(dist.D + 2 * cfg.paret), H, angle,
            caixetins, avisos, pes: caixetins.reduce((a, c) => a + c.pes, 0)
        };
    }

    function agrupa(conj, caix, cfg, prefix) {
        const grups = cfg.esdSeparat
            ? [['', caix.filter(c => !c.mat.esd)], ['ESD', caix.filter(c => c.mat.esd)]]
            : [['', caix]];
        const safates = [];
        grups.forEach(([tipus, llista]) => {
            if (!llista.length) return;
            const parts = reparteix(llista, cfg);
            parts.forEach((pc, i) => {
                const lletra = parts.length > 1 ? String.fromCharCode(65 + i) : '';
                const id = conj.codi + prefix + (tipus ? '-' + tipus : '') + (lletra ? '-' + lletra : '');
                safates.push(construeixSafata(id, prefix === '-M' ? 'muntat' : (tipus ? 'esd' : 'kit'), pc, cfg, conj));
            });
        });
        return safates;
    }

    // Safates d'un conjunt:
    //  · kit: els materials que s'hi munten directament (× vegades que es munta)
    //  · muntat: caixa per guardar el conjunt acabat, si té dades de peça muntada
    FO.safatesConjunt = function (p, conj, cfg) {
        cfg = cfg || p.config;
        const maxW = cfg.llit.x - 2 * cfg.paret, maxD = cfg.llit.y - 2 * cfg.paret;
        const k = FO.multiplicador(p, conj);
        let caix = [];
        conj.items.forEach(it => {
            const m = FO.material(p, it.mat);
            if (m) caix = caix.concat(FO.caixetinsMaterial(m, it.qty * k, cfg, maxW, maxD));
        });
        const fora = caix.filter(c => c.fora);
        const safates = agrupa(conj, caix.filter(c => !c.fora), cfg, '');
        // Entrades: subconjunts que ja s'han d'haver muntat abans
        const entrades = FO.fills(p, conj.id).map(f => ({ conj: f, qty: f.qty * k }));
        let muntat = [];
        const mm = FO.materialMuntat(conj);
        if (mm && conj.pare) {
            const cm = FO.caixetinsMaterial(mm, k, cfg, maxW, maxD);
            cm.filter(c => c.fora).forEach(c => fora.push(c));
            muntat = agrupa(conj, cm.filter(c => !c.fora), cfg, '-M');
        }
        return { conj, multiplicador: k, safates: safates.concat(muntat), fora, entrades };
    };

    // Resultat complet: un pla per conjunt, en ordre de muntatge
    FO.calculaPla = function (p) {
        return FO.ordreMuntatge(p).map(o => Object.assign(FO.safatesConjunt(p, o.conj, p.config), { pas: o.pas, nivell: o.nivell }));
    };
})(typeof window !== 'undefined' ? window : globalThis);
