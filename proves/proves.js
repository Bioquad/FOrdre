// ═══════════════════════════════════════════════════════════════
// FOrdre — proves del nucli (sense navegador)
// Execució:  node proves/proves.js
// ═══════════════════════════════════════════════════════════════
'use strict';
const path = require('path');
const fs = require('fs');
for (const f of ['fo-i18n', 'fo-idiomes', 'fo-dades', 'fo-calcul', 'fo-stl', 'fo-importa', 'fo-etiquetes', 'fo-compartir', 'fo-progres', 'fo-informe']) require(path.join(__dirname, '..', 'js', f + '.js'));
const FO = globalThis.FO;
globalThis.qrcode = require(path.join(__dirname, '..', 'vendor', 'qrcode.js'));   // per als QR gravats
const jsQR = require(path.join(__dirname, '..', 'vendor', 'jsQR.js'));

let fallades = 0, total = 0;
function prova(nom, fn) {
    total++;
    try { fn(); console.log('  ✓ ' + nom); }
    catch (e) { fallades++; console.log('  ✗ ' + nom + '\n      ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };

// Totes les arestes d'una malla tancada apareixen un cop en cada sentit
function esTancada(tri) {
    const k = v => v.map(x => x.toFixed(4)).join(',');
    const ar = new Map();
    for (const t of tri) for (let i = 0; i < 3; i++) { const e = k(t[i]) + '|' + k(t[(i + 1) % 3]); ar.set(e, (ar.get(e) || 0) + 1); }
    for (const [e, n] of ar) { const [a, b] = e.split('|'); if (n !== 1 || ar.get(b + '|' + a) !== 1) return false; }
    return true;
}
const solapen = (a, b) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.d - 1e-6 && b.y < a.y + a.d - 1e-6;

console.log('Model i càlcul');
const p = FO.exemple();
const pla = FO.calculaPla(p);
prova('el projecte d\'exemple és vàlid', () => assert(FO.validaProjecte(p).length === 0));
prova('l\'ordre de muntatge posa els subconjunts abans que el pare', () => {
    const pas = new Map(pla.map(r => [r.conj.id, r.pas]));
    p.conjunts.forEach(c => { if (c.pare) assert(pas.get(c.id) < pas.get(c.pare), c.codi); });
});
const obj = r => FO.imprimibles(r);
const paretDe = o => o.forma === 'caixa' ? p.config.paretCaixa : o.forma === 'contenidor' ? p.config.paretContenidor : p.config.paret;
prova('cada material d\'un conjunt té caixetí (o queda marcat fora)', () => {
    pla.forEach(r => r.conj.items.forEach(it => {
        const hi = obj(r).some(s => s.caixetins.some(c => c.mat.id === it.mat)) || r.fora.some(c => c.mat.id === it.mat);
        assert(hi, r.conj.codi + ' ' + it.mat);
    }));
});
prova('les quantitats es multipliquen per les unitats de subconjunt', () => {
    const r = pla.find(x => x.conj.id === 'MOT');
    assert(r.multiplicador === 2);
    const c = obj(r).flatMap(o => o.caixetins).find(x => x.mat.id === 'MT-050');
    assert(c.qty === 2, 'MT-050 ×' + c.qty);
});
prova('els subconjunts muntats tenen caixa de guarda', () => {
    const r = pla.find(x => x.conj.id === 'MOT');
    assert(obj(r).some(s => s.tipus === 'muntat' && s.caixetins[0].qty === 2));
});
prova('les peces ESD s\'imprimeixen en material antiestàtic i no es barregen', () => {
    pla.forEach(r => obj(r).forEach(s => {
        if (!s.caixetins.length) return;
        const esd = s.caixetins.filter(c => c.mat.esd).length;
        assert(esd === 0 || esd === s.caixetins.length, s.id + ' barreja ESD');
        if (esd) assert(FO.MATERIALS_IMPRESSIO[s.material].esd, s.id + ' ' + s.material);
    }));
});
prova('cap caixetí se surt del seu objecte ni se solapa amb un altre', () => {
    pla.forEach(r => obj(r).forEach(s => {
        const pw = paretDe(s);
        s.caixetins.forEach((a, i) => {
            assert(a.x >= pw - 1e-6 && a.y >= pw - 1e-6, s.id);
            assert(a.x + a.w <= s.W - pw + 1e-6 && a.y + a.d <= s.D - pw + 1e-6, s.id + ' ' + a.mat.codi);
            s.caixetins.slice(i + 1).forEach(b => assert(!solapen(a, b), `${s.id}: ${a.mat.codi} / ${b.mat.codi}`));
        });
    }));
});
prova('les caixes caben dins el contenidor sense solapar-se', () => {
    pla.forEach(r => r.safates.filter(s => s.forma === 'contenidor').forEach(s => {
        const pc = p.config.paretContenidor;
        const rect = c => ({ x: c.x, y: c.y, w: c.girat ? c.obj.D : c.obj.W, d: c.girat ? c.obj.W : c.obj.D });
        s.caixes.forEach((c, i) => {
            const a = rect(c);
            assert(a.x >= pc - 1e-6 && a.y >= pc - 1e-6 && a.x + a.w <= s.W - pc + 1e-6 && a.y + a.d <= s.D - pc + 1e-6, s.id + ' ' + c.obj.id);
            s.caixes.slice(i + 1).forEach(b => assert(!solapen(a, rect(b)), `${c.obj.id} / ${b.obj.id}`));
        });
        assert(s.caixes.length > 1, s.id + ' amb una sola caixa');
    }));
});
prova('tot cap al llit de la impressora', () => {
    pla.forEach(r => obj(r).forEach(s => assert(s.W <= p.config.llit.x + 1e-6 && s.D <= p.config.llit.y + 1e-6 && s.H <= p.config.llit.z, s.id)));
});
const massaGran = format => FO.calculaPla(FO.normalitzaProjecte({
    config: { formatKit: format },
    materials: [{ id: 'A', codi: 'A', x: 90, y: 90, z: 20 }],
    conjunts: [{ id: 'C', codi: 'C', items: [{ mat: 'A', qty: 12 }] }]
}))[0];
prova('un conjunt massa gran es reparteix en diverses safates o contenidors', () => {
    ['fusionat', 'contenidor'].forEach(f => {
        const r = massaGran(f);
        assert(r.safates.length > 1, f + ': ' + r.safates.length);
        assert(obj(r).reduce((a, s) => a + s.caixetins.reduce((b, c) => b + c.qty, 0), 0) === 12, f);
    });
});
prova('els quatre formats de kit', () => {
    const f = format => { const q = FO.exemple(); q.conjunts.forEach(c => { c.formatKit = ''; }); q.config.formatKit = format; return FO.calculaPla(q).find(r => r.conj.id === 'XAS'); };
    assert(f('fusionat').safates.every(s => s.forma === 'safata'));
    assert(f('individual').safates.every(s => s.forma === 'caixa') && f('individual').safates.length === 6);
    assert(f('contenidor').safates.some(s => s.forma === 'contenidor'));
    const mx = f('mixt');
    assert(obj(mx).some(o => o.bloc) && obj(mx).some(o => o.forma === 'caixa'), 'mixt');
});
prova('material i color de les caixes: per defecte, per conjunt i per material', () => {
    const r = pla.find(x => x.conj.id === 'HID');
    assert(obj(r).filter(o => o.forma !== 'contenidor').every(o => o.material === 'PETG'));
    const c01 = obj(pla.find(x => x.conj.id === 'MOT')).find(o => o.forma === 'caixa' && o.caixetins[0].mat.id === 'CON-01');
    assert(c01.material === 'PETG' && c01.color === '#FDD835', c01.material + ' ' + c01.color);
    const q = FO.exemple(); q.config.ajustaFilaments = true; q.config.filaments = ['#000000', '#FFFFFF'];
    FO.calculaPla(q).forEach(x => obj(x).filter(o => o.forma === 'caixa' && !o.caixetins[0].mat.caixaColor)
        .forEach(o => assert(q.config.filaments.includes(o.color), o.id + ' ' + o.color)));
});
prova('resum de filament per material i color', () => {
    const f = FO.resumFilament(pla, p.config);
    assert(f.length > 1 && f.every(e => e.grams > 0));
    assert(f.reduce((a, e) => a + e.peces, 0) === pla.reduce((a, r) => a + obj(r).reduce((b, o) => b + FO.pecesImpressio(o, p.config).length, 0), 0));
});
prova('la inclinació es limita per les peces que no es poden tombar', () => {
    const q = FO.exemple(); q.config.inclinacio = 25;
    const s = FO.calculaPla(q).find(r => r.conj.id === 'HID').safates.find(o => !o.pare);
    assert(s.angle === 10, 'angle ' + s.angle);
});

console.log('Geometria i fitxers');
prova('totes les safates, caixes, contenidors i falques són sòlids tancats', () => {
    pla.forEach(r => obj(r).forEach(s => {
        assert(esTancada(FO.mallaSafata(s, p.config)), s.id);
        assert(esTancada(FO.mallaFalca(Object.assign({}, s, { angle: 15 }))), s.id + ' falca');
    }));
});
prova('STL binari amb la mida correcta', () => {
    const tri = FO.mallaSafata(pla[0].safates[0], p.config);
    const b = FO.stlBinari(tri, 'x');
    assert(b.length === 84 + tri.length * 50);
    assert(new DataView(b.buffer).getUint32(80, true) === tri.length);
});
prova('ZIP amb capçaleres vàlides', () => {
    const z = FO.zip([{ nom: 'a.txt', dades: 'hola' }]);
    const dv = new DataView(z.buffer);
    assert(dv.getUint32(0, true) === 0x04034b50 && dv.getUint32(z.length - 22, true) === 0x06054b50);
});

console.log('Tancaments, tapes i identificació');
const variant = (tanc, format, extra) => {
    const q = FO.exemple();
    q.conjunts.forEach(c => { c.tancament = ''; c.formatKit = ''; });
    Object.assign(q.config, { tancament: tanc, formatKit: format, rebaixEtiqueta: true, relleu: true, codiFons: true, fonsArrodonit: true, llaviAmple: 3 }, extra || {});
    return { q, pla: FO.calculaPla(q) };
};
prova('els quatre tancaments generen sòlids tancats (objectes i tapes)', () => {
    ['cap', 'llavi', 'pressio', 'imants'].forEach(t => ['fusionat', 'mixt'].forEach(f => {
        const { q, pla: pl } = variant(t, f);
        pl.forEach(r => obj(r).forEach(o => FO.pecesImpressio(o, q.config).forEach(pc => assert(esTancada(pc.tri), `${t}/${f}: ${pc.nom}`))));
    }));
});
prova('tapes només amb pressió o imants', () => {
    ['cap', 'llavi', 'pressio', 'imants'].forEach(t => {
        const { q, pla: pl } = variant(t, 'individual');
        const amb = pl.flatMap(r => obj(r)).filter(o => FO.opsTapa(o, q.config)).length;
        assert((t === 'pressio' || t === 'imants') ? amb > 0 : amb === 0, t + ': ' + amb);
    });
});
prova('el llavi (0-5 mm) mai tapa el pas de la peça', () => {
    const { pla: pl } = variant('llavi', 'fusionat', { llaviAmple: 5 });
    pl.forEach(r => obj(r).forEach(o => o.caixetins.forEach(c => {
        assert(c.llavi >= 0 && c.llavi <= 5, c.mat.codi + ' ' + c.llavi);
        if (c.mode !== 'granel') {
            const px = c.girat ? c.o.d : c.o.w, py = c.girat ? c.o.w : c.o.d;
            assert(c.w - 2 * c.llavi >= px && c.d - 2 * c.llavi >= py, `${c.mat.codi}: obertura massa petita`);
        }
    })));
});
prova('amb imants, les parets allotgen l\'imant', () => {
    const { q, pla: pl } = variant('imants', 'mixt');
    pl.forEach(r => obj(r).forEach(o => assert(o.paret >= q.config.imantD + 2 - 1e-6, o.id + ' paret ' + o.paret)));
});
prova('límits: parets 1-10 mm, llit 150-2000 mm, llavi 0-5 mm', () => {
    const q = FO.normalitzaProjecte({ config: { paret: 0.2, paretCaixa: 25, paretContenidor: 5, llit: { x: 5000, y: 90, z: 120 }, llaviAmple: 9 } });
    assert(q.config.paret === 1 && q.config.paretCaixa === 10 && q.config.paretContenidor === 5, 'parets');
    assert(q.config.llit.x === 2000 && q.config.llit.y === 150 && q.config.llit.z === 120, 'llit');
    assert(q.config.llaviAmple === 5, 'llavi');
});
prova('peça de calibratge tancada', () => assert(esTancada(FO.mallaCalibratge())));
prova('tandes: cada peça hi és un cop i cap al llit', () => {
    const t = FO.tandes(pla, p.config);
    const n = pla.reduce((a, r) => a + obj(r).reduce((b, o) => b + FO.pecesImpressio(o, p.config).length, 0), 0);
    assert(t.reduce((a, x) => a + x.items.length, 0) === n, 'peces');
    t.filter(x => !x.massaGran).forEach(x => x.items.forEach(it => {
        const w = it.girat ? it.p.D : it.p.W, d = it.girat ? it.p.W : it.p.D;
        assert(it.x + w <= p.config.llit.x + 1e-6 && it.y + d <= p.config.llit.y + 1e-6, it.p.nom);
    }));
    t.forEach(x => assert(x.items.every(it => it.p.tri && x.material), 'material'));
});
prova('3MF vàlid', () => {
    const z = FO.tresMF(FO.tandes(pla, p.config)[0], 'prova');
    const txt = Buffer.from(z).toString('latin1');
    assert(txt.includes('3D/3dmodel.model') && txt.includes('<triangle ') && txt.includes('displaycolor'));
});
prova('revisions: detecta canvis i peces a reimprimir', () => {
    const b = JSON.parse(JSON.stringify(p));
    b.materials.find(m => m.id === 'PL-002').x = 60;
    b.conjunts.find(c => c.id === 'XAS').items.find(i => i.mat === 'CRG-M4x10').qty = 40;
    const d = FO.diffProjectes(p, FO.normalitzaProjecte(b));
    assert(d.matCanviats.some(c => c.codi === 'PL-002'), 'material');
    assert(d.quantitats.some(q => q.mat === 'CRG-M4x10' && q.despres === 40), 'quantitat');
    assert(d.reimprimir.length + d.nous.length > 0, 'reimprimir');
    assert(FO.diffProjectes(p, p).buit, 'sense canvis');
});

prova('niu amb la forma real (STL): sòlid tancat i bressol', () => {
    const tri = [], N = 24, L = 60, R = 15;
    for (let k = 0; k < N; k++) {
        const a0 = Math.PI * k / N, a1 = Math.PI * (k + 1) / N, q = (a, x) => [x, R + R * Math.cos(a), R - R * Math.sin(a)];
        tri.push([q(a0, 0), q(a1, 0), q(a1, L)], [q(a0, 0), q(a1, L), q(a0, L)]);
    }
    const r = FO.rasteritzaNiu(FO.llegeixSTL(FO.stlBinari(tri, 'semi')));
    assert(r.x === 60 && r.y === 30 && r.z === 15, 'mides');
    const q = FO.normalitzaProjecte({ config: { formatKit: 'fusionat' }, materials: [{ id: 'S', codi: 'SEMI', x: r.x, y: r.y, z: r.z, niu: r.niu }], conjunts: [{ id: 'C', codi: 'C', items: [{ mat: 'S', qty: 3 }] }] });
    const s = FO.calculaPla(q)[0].safates[0];
    assert(s.caixetins[0].mode === 'individual', 'un niu per unitat');
    assert(esTancada(FO.mallaSafata(s, q.config)), 'tancat');
});
prova('contenidors apilables: mateixa planta, peu encastat i nanses tancades', () => {
    const conts = pla.flatMap(r => r.safates.filter(x => x.forma === 'contenidor'));
    assert(conts.length > 1 && conts.every(c => c.W === conts[0].W && c.D === conts[0].D), 'mateixa planta');
    conts.forEach(c => {
        assert(c.H >= c.cim + FO.PEU_APILABLE, c.id + ': massa baix per apilar');
        assert(c.caixes.every(q => q.x >= FO.ZONA_NANSA), c.id + ': caixes a la zona de la nansa');
    });
});
prova('QR gravat a les tapes: es llegeix des de la malla', () => {
    const { q, pla: pl } = variant('pressio', 'individual');
    let gravats = 0;
    pl.forEach(r => obj(r).forEach(o => {
        const t = FO.mallaTapa(o, q.config); if (!t) return;
        const n = FO.rasteritzaNiu(t, 0.2).niu, S = 4, pad = 20, W = n.nx * S + 2 * pad, H = n.ny * S + 2 * pad;
        if (!n.h.some(v => v > 0.3)) return;   // tapa massa petita: sense QR
        const px = new Uint8ClampedArray(W * H * 4).fill(255);
        for (let i = 0; i < n.nx; i++) for (let j = 0; j < n.ny; j++) if (n.h[i * n.ny + j] > 0.3)
            for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) { const k = ((pad + j * S + b) * W + pad + i * S + a) * 4; px[k] = px[k + 1] = px[k + 2] = 0; }
        const res = jsQR(px, W, H);
        assert(res && res.data === FO.dadesQRObjecte(o), o.id + ': QR il·legible');
        gravats++;
    }));
    assert(gravats >= 5, 'gravats: ' + gravats);
});
prova('importació: parell, nota, instruccions, eines, tancament i format', () => {
    const f = FO.llegeixCSV(FO.plantillaCSV()), h = FO.trobaCapcalera(f), m = FO.detectaColumnes(f[h]);
    const q = FO.incorporaImport(FO.nouProjecte(), FO.construeixImport(f.slice(h + 1), m, 'pla', {}), 'substitueix');
    const x = FO.conjunt(q, 'c:XAS'), it = x.items.find(i => i.mat === 'm:CRG-M4x10');
    assert(it.parell === 2.5 && it.nota === 'En creu', 'element');
    assert(x.instruccions.split('\n').length === 3 && x.eines && x.tancament === 'llavi', 'conjunt');
    assert(FO.conjunt(q, 'c:MOT').formatKit === 'contenidor', 'format');
});
prova('progrés: operacions idempotents i estoc per increments', () => {
    const pr = FO.progresBuit();
    FO.aplicaOp(pr, { id: 'a1', t: 'estoc', mat: 'X', delta: 5 });
    FO.aplicaOp(pr, { id: 'b1', t: 'estoc', mat: 'X', delta: 3 });
    assert(!FO.aplicaOp(pr, { id: 'a1', t: 'estoc', mat: 'X', delta: 5 }), 'repetida');
    FO.aplicaOp(pr, { id: 'a2', t: 'fet', conj: 'C', consum: { X: 2 }, text: 'muntat' });
    FO.aplicaOp(pr, { id: 'b2', t: 'fet', conj: 'C', consum: { X: 2 } });   // un altre aparell, alhora
    assert(pr.estoc.X === 6 && pr.fets.C, 'fet un sol cop: ' + pr.estoc.X);
    FO.aplicaOp(pr, { id: 'a3', t: 'desfet', conj: 'C' });
    assert(pr.estoc.X === 8 && !pr.fets.C && pr.registre.length === 1, 'desfet');
});

console.log('Processos: rols, ordres i resultats');
{
    const m = FO.modelTaller(p);
    const nova = () => FO.progresBuit();
    let k = 0;
    const op = (pr, t, dades, qui, rol) => FO.creaOp('t', ++k, t, dades, qui, rol);
    const fes = (pr, t, dades, qui, rols) => {
        const o = op(pr, t, dades, qui, rols[0]);
        const motiu = FO.validaOp(pr, o, { nom: qui, rols });
        if (!motiu) FO.aplicaOp(pr, o);
        return motiu;
    };
    const r0 = m.PLA[0], c0 = r0.conj.id;
    prova('cada rol només pot fer les seves operacions', () => {
        assert(FO.potFer(['magatzem'], 'omple') && !FO.potFer(['magatzem'], 'fet'));
        assert(FO.potFer(['muntador'], 'fet') && !FO.potFer(['muntador'], 'verifica'));
        assert(FO.potFer(['qualitat'], 'verifica') && !FO.potFer(['qualitat'], 'omple'));
        assert(FO.potFer(['responsable'], 'tanca') && FO.potFer(['responsable'], 'omple'));
    });
    prova('omplir una caixa treu el material de l\'estoc i buidar-la el torna', () => {
        const pr = nova(), e = m.aOmplir(r0)[0], mat = e.caixeti.mat.id;
        fes(pr, 'estoc', { mat, delta: 10 }, 'Marc', ['magatzem']);
        fes(pr, 'omple', { clau: e.clau, mat, qty: e.qty }, 'Marc', ['magatzem']);
        assert(pr.estoc[mat] === 10 - e.qty, 'surt de l\'estoc');
        fes(pr, 'buida', { clau: e.clau }, 'Marc', ['magatzem']);
        assert(pr.estoc[mat] === 10 && !pr.omplert[e.clau], 'torna a l\'estoc');
    });
    prova('estats d\'una caixa: buida → omplint-se → plena → en ús → retornada', () => {
        const pr = nova(), c = m.caixes.find(x => !x.guarda && x.claus.length > 1);
        assert(FO.estatCaixa(pr, c.id, c.claus) === 'buida');
        FO.aplicaOp(pr, { id: 'e1', t: 'omple', clau: c.claus[0], qty: 1 });
        assert(FO.estatCaixa(pr, c.id, c.claus) === 'parcial');
        c.claus.forEach((cl, i) => FO.aplicaOp(pr, { id: 'e2' + i, t: 'omple', clau: cl, qty: 1 }));
        assert(FO.estatCaixa(pr, c.id, c.claus) === 'plena');
        c.claus.forEach((cl, i) => FO.aplicaOp(pr, { id: 'e3' + i, t: 'agafa', clau: cl, v: true }));
        assert(FO.estatCaixa(pr, c.id, c.claus) === 'en ús');
        FO.aplicaOp(pr, { id: 'e4', t: 'retorna', obj: c.id });
        assert(FO.estatCaixa(pr, c.id, c.claus) === 'retornada');
    });
    prova('un pas passa per pendent → en curs → muntat → verificat', () => {
        const pr = nova();
        assert(FO.estatPas(pr, c0, false) === 'pendent');
        fes(pr, 'inicia', { conj: c0 }, 'Anna', ['muntador']);
        assert(FO.estatPas(pr, c0, false) === 'en curs');
        fes(pr, 'fet', { conj: c0 }, 'Anna', ['muntador']);
        assert(FO.estatPas(pr, c0, false) === 'muntat');
        assert(!fes(pr, 'verifica', { conj: c0, resultat: 'ok' }, 'Pau', ['qualitat']));
        assert(FO.estatPas(pr, c0, false) === 'verificat');
    });
    prova('quatre ulls: qui munta no verifica, i rebutjar demana motiu', () => {
        const pr = nova();
        fes(pr, 'fet', { conj: c0 }, 'Joan', ['muntador', 'qualitat']);
        assert(/altra persona/.test(fes(pr, 'verifica', { conj: c0, resultat: 'ok' }, 'Joan', ['muntador', 'qualitat'])));
        assert(/motiu/.test(fes(pr, 'verifica', { conj: c0, resultat: 'ko' }, 'Pau', ['qualitat'])));
        assert(!fes(pr, 'verifica', { conj: c0, resultat: 'ko', motiu: 'Falta un cargol' }, 'Pau', ['qualitat']));
        assert(FO.estatPas(pr, c0, false) === 'rebutjat' && pr.historial.length === 1, 'torna al muntador');
    });
    prova('una ordre tancada no admet canvis fins que es reobre', () => {
        const pr = nova();
        fes(pr, 'tanca', {}, 'Rosa', ['responsable']);
        assert(/tancada/.test(fes(pr, 'fet', { conj: c0 }, 'Anna', ['muntador'])));
        assert(!fes(pr, 'reobre', {}, 'Rosa', ['responsable']));
        assert(!fes(pr, 'fet', { conj: c0 }, 'Anna', ['muntador']));
    });
    prova('codis d\'ordre correlatius per any', () => {
        const a = new Date().getFullYear();
        assert(FO.codiOrdreSeguent([]) === `OF-${a}-001`);
        assert(FO.codiOrdreSeguent([{ codi: `OF-${a}-001` }, { codi: `OF-${a}-007` }]) === `OF-${a}-008`);
    });
    prova('un progrés antic es completa amb els camps nous', () => {
        const pr = FO.normalitzaProgres({ fets: { X: { ts: 't' } }, vist: ['a'] });
        assert(pr.fets.X && Array.isArray(pr.historial) && pr.tancada === null && typeof pr.omplert === 'object');
    });
    prova('mancants: omplir menys del que cal obre un mancant i omplir-ho tot el resol', () => {
        const pr = nova(), e = m.aOmplir(r0)[0], mat = e.caixeti.mat.id;
        fes(pr, 'omple', { clau: e.clau, mat, qty: 1, cal: 3 }, 'Marc', ['magatzem']);
        assert(FO.esMancant(pr, e.clau) && pr.mancants[e.clau].falten === 2, 'falten 2');
        fes(pr, 'omple', { clau: e.clau, mat, qty: 3, cal: 3 }, 'Marc', ['magatzem']);
        assert(!FO.esMancant(pr, e.clau) && pr.mancants[e.clau].resolt, 'resolt en arribar');
        assert(!fes(pr, 'manca', { clau: 'X', mat, falten: 4, nota: 'arriba dijous' }, 'Marc', ['magatzem']));
        assert(FO.mancantsOberts(pr).length === 1 && FO.mancantsOberts(pr)[0].nota === 'arriba dijous');
        assert(/rol/.test(fes(pr, 'manca', { clau: 'Y', mat, falten: 1 }, 'Anna', ['muntador'])), 'només el magatzem marca mancants');
    });
    prova('mancants: un pas muntat amb mancants no bloqueja el pare i no es pot aprovar fins que es completa', () => {
        const pr = nova(), fill = m.PLA.find(r => r.conj.pare), pare = fill.conj.pare;
        fes(pr, 'fet', { conj: fill.conj.id, pendents: [{ clau: 'K', mat: 'A', qty: 2 }] }, 'Anna', ['muntador']);
        assert(FO.estatPas(pr, fill.conj.id, false) === 'parcial', 'estat parcial');
        assert(!!pr.fets[fill.conj.id], 'compta com a muntat per als passos següents');
        assert(!fes(pr, 'fet', { conj: pare }, 'Anna', ['muntador']), 'el pare es pot muntar');
        assert(/mancants/.test(fes(pr, 'verifica', { conj: fill.conj.id, resultat: 'ok' }, 'Pau', ['qualitat'])), 'no s\'aprova amb peces que falten');
        assert(!fes(pr, 'completa', { conj: fill.conj.id }, 'Anna', ['muntador']));
        assert(FO.estatPas(pr, fill.conj.id, false) === 'muntat' && pr.fets[fill.conj.id].completat, 'complet');
        assert(!fes(pr, 'verifica', { conj: fill.conj.id, resultat: 'ok' }, 'Pau', ['qualitat']));
    });
    prova('mancants: una caixa amb un mancant es veu com a «amb mancants» i surt a l\'informe', () => {
        const pr = nova(), c = m.caixes.find(x => !x.guarda && x.claus.length);
        c.claus.forEach((k, i) => FO.aplicaOp(pr, { id: 'q' + i, t: 'omple', clau: k, qty: 1 }));
        FO.aplicaOp(pr, { id: 'q-m', t: 'manca', clau: c.claus[0], mat: 'A', falten: 2, nota: 'proveïdor' });
        assert(FO.estatCaixa(pr, c.id, c.claus) === 'mancant');
        const res = FO.resumOrdre(m, pr);
        assert(res.mancantsOberts === 1 && res.mancants.length === 1 && /mancants/.test(FO.textEstatOrdre(Object.assign(res, { inici: 'x' }))));
        assert(/<h2>Mancants<\/h2>/.test(FO.informeHTML(m, pr, { codi: 'OF' })));
    });
    prova('defectes: una peça que arriba malament surt de la caixa, no torna a l\'estoc i se\'n demana recanvi', () => {
        const pr = nova(), e = m.aOmplir(r0)[0], mat = e.caixeti.mat.id;
        fes(pr, 'estoc', { mat, delta: 10 }, 'Marc', ['magatzem']);
        fes(pr, 'omple', { clau: e.clau, mat, qty: e.qty, cal: e.qty }, 'Marc', ['magatzem']);
        const estoc = pr.estoc[mat];
        assert(!fes(pr, 'defecte', { clau: e.clau, mat, conj: c0, qty: 1, origen: 'arribada', tipus: 'Trencada' }, 'Marc', ['magatzem']));
        assert(pr.omplert[e.clau].qty === e.qty - 1 && pr.estoc[mat] === estoc, 'surt de la caixa sense tornar a l\'estoc');
        assert(FO.esMancant(pr, e.clau) && pr.mancants[e.clau].falten === 1, 'recanvi demanat');
        fes(pr, 'omple', { clau: e.clau, mat, qty: e.qty, cal: e.qty }, 'Marc', ['magatzem']);
        assert(!FO.esMancant(pr, e.clau) && pr.estoc[mat] === estoc - 1, 'el recanvi surt de l\'estoc');
    });
    prova('defectes: una peça trencada en un pas ja verificat el torna a deixar pendent', () => {
        const pr = nova(), e = m.aOmplir(r0)[0], mat = e.caixeti.mat.id;
        fes(pr, 'fet', { conj: c0 }, 'Anna', ['muntador']);
        fes(pr, 'verifica', { conj: c0, resultat: 'ok' }, 'Pau', ['qualitat']);
        assert(!fes(pr, 'defecte', { clau: e.clau, mat, conj: c0, qty: 2, origen: 'muntatge', tipus: 'Trencada' }, 'Anna', ['muntador']));
        assert(FO.estatPas(pr, c0, false) === 'parcial' && !pr.verificacions[c0], 'torna a estar pendent i sense verificar');
        assert(pr.fets[c0].pendents[0].qty === 2);
    });
    prova('defectes: només Qualitat (o el Responsable) decideix què es fa amb la peça', () => {
        const pr = nova(), e = m.aOmplir(r0)[0];
        fes(pr, 'defecte', { clau: e.clau, mat: e.caixeti.mat.id, qty: 1, origen: 'arribada', tipus: 'Peça equivocada' }, 'Marc', ['magatzem']);
        const d = pr.defectes[0];
        assert(/rol/.test(fes(pr, 'decideix', { def: d.id, decisio: 'retorn' }, 'Anna', ['muntador'])));
        assert(/desconeguda/.test(fes(pr, 'decideix', { def: d.id, decisio: 'llençar-ho' }, 'Pau', ['qualitat'])));
        assert(!fes(pr, 'decideix', { def: d.id, decisio: 'retorn', nota: 'RMA-123' }, 'Pau', ['qualitat']));
        assert(!FO.defectesPendents(pr).length && d.decisio.nota === 'RMA-123');
        const res = FO.resumOrdre(m, pr);
        assert(res.pecesDefectuoses === 1 && res.defectesArribada === 1 && /Peces defectuoses/.test(FO.informeHTML(m, pr, { codi: 'OF' })));
    });
    // ─── Traçabilitat (ISO 9001) ───
    const eTraca = tipus => m.aOmplir(m.PLA.find(r => m.aOmplir(r).some(e => e.caixeti.mat.tracabilitat === tipus))).find(e => e.caixeti.mat.tracabilitat === tipus);
    prova('traçabilitat: un material per número de sèrie no s\'omple sense un número per peça, ni repetit', () => {
        const pr = nova(), e = eTraca('serie'), mat = e.caixeti.mat.id, q = e.qty;
        assert(q >= 2, 'cal un exemple amb 2 o més peces');
        const base = { clau: e.clau, mat, qty: q, cal: q, tracaTipus: 'serie' };
        assert(/necessita/.test(fes(pr, 'omple', base, 'Marc', ['magatzem'])), 'sense números');
        assert(/sumar/.test(fes(pr, 'omple', Object.assign({ traca: [{ codi: 'SN1', qty: 1 }] }, base), 'Marc', ['magatzem'])), 'menys números que peces');
        assert(/repetit/.test(fes(pr, 'omple', Object.assign({ traca: [{ codi: 'SN1', qty: 1 }, { codi: 'sn1', qty: 1 }] }, base), 'Marc', ['magatzem'])), 'repetit');
        const series = Array.from({ length: q }, (x, i) => ({ codi: 'SN-' + (i + 1), qty: 1 }));
        assert(!fes(pr, 'omple', Object.assign({ traca: series }, base), 'Marc', ['magatzem']));
        assert(FO.tracaTotal(pr, e.clau) === q && pr.traca[e.clau][0].op === 'Marc');
        // el mateix número no pot anar a un altre caixetí de la mateixa ordre
        assert(/ja s'ha fet servir/.test(FO.validaOp(pr, FO.creaOp('t', 999, 'traca', { clau: 'ALTRE', mat, tracaTipus: 'serie', traca: [{ codi: 'SN-1', qty: 1 }] }), null)));
    });
    prova('traçabilitat: lots, correcció, buidar i cerca inversa', () => {
        const pr = nova(), e = eTraca('lot'), mat = e.caixeti.mat.id, q = e.qty;
        const l1 = q > 1 ? [{ codi: 'L-A', qty: q - 1 }, { codi: 'L-B', qty: 1 }] : [{ codi: 'L-A', qty: 1 }];
        assert(!fes(pr, 'omple', { clau: e.clau, mat, qty: q, cal: q, tracaTipus: 'lot', traca: l1 }, 'Marc', ['magatzem']));
        assert(FO.cercaTraca(pr, 'l-a').length === 1 && FO.cercaTraca(pr, 'X').length === 0);
        assert(!fes(pr, 'traca', { clau: e.clau, mat, qty: q, tracaTipus: 'lot', traca: [{ codi: 'L-C', qty: q }] }, 'Pau', ['qualitat']), 'correcció');
        assert(pr.traca[e.clau].length === 1 && pr.traca[e.clau][0].codi === 'L-C' && pr.traca[e.clau][0].op === 'Pau');
        assert(FO.potFer(['responsable'], 'traca') && FO.potFer(['muntador'], 'traca') && !FO.potFer([], 'traca'), 'qui pot anotar lots');
        assert(!fes(pr, 'buida', { clau: e.clau }, 'Marc', ['magatzem']) && !pr.traca[e.clau], 'buidar treu els lots');
    });
    prova('traçabilitat: una peça defectuosa s\'emporta el seu número de sèrie i en cal un de nou', () => {
        const pr = nova(), e = eTraca('serie'), mat = e.caixeti.mat.id, q = e.qty;
        const series = Array.from({ length: q }, (x, i) => ({ codi: 'M-' + (i + 1), qty: 1 }));
        fes(pr, 'omple', { clau: e.clau, mat, qty: q, cal: q, tracaTipus: 'serie', traca: series }, 'Marc', ['magatzem']);
        assert(/lot o el número de sèrie/.test(fes(pr, 'defecte', { clau: e.clau, mat, qty: 1, origen: 'arribada', tipus: 'Trencada', tracaTipus: 'serie' }, 'Marc', ['magatzem'])));
        assert(!fes(pr, 'defecte', { clau: e.clau, mat, qty: 1, origen: 'arribada', tipus: 'Trencada', tracaTipus: 'serie', traca: [{ codi: 'M-1', qty: 1 }] }, 'Marc', ['magatzem']));
        assert(FO.tracaTotal(pr, e.clau) === q - 1 && pr.defectes[0].traca[0].codi === 'M-1');
        const on = FO.cercaTraca(pr, 'M-1');
        assert(on.length === 1 && on[0].defectuosa, 'el número defectuós es troba igualment');
        // arriba el recanvi: s'omple amb els números que queden i el nou
        const nous = series.filter(x => x.codi !== 'M-1').concat([{ codi: 'M-NOU', qty: 1 }]);
        assert(!fes(pr, 'omple', { clau: e.clau, mat, qty: q, cal: q, tracaTipus: 'serie', traca: nous }, 'Marc', ['magatzem']));
        assert(FO.tracaTotal(pr, e.clau) === q && !FO.esMancant(pr, e.clau));
    });
    prova('traçabilitat: un pas amb parells de collada diu amb quin instrument s\'han donat', () => {
        const pr = nova();
        assert(/instrument/.test(fes(pr, 'fet', { conj: c0, calInstrument: true }, 'Anna', ['muntador'])));
        assert(!fes(pr, 'fet', { conj: c0, calInstrument: true, instrument: 'CD-07' }, 'Anna', ['muntador']));
        assert(pr.fets[c0].instrument === 'CD-07');
    });
    prova('resultats: rendiment a la primera, temps i persones', () => {
        const pr = nova(), t0 = Date.parse('2026-01-01T10:00:00Z');
        const at = min => new Date(t0 + min * 60000).toISOString();
        FO.aplicaOp(pr, { id: 'r1', t: 'inicia', conj: c0, op: 'Anna', ts: at(0) });
        FO.aplicaOp(pr, { id: 'r2', t: 'fet', conj: c0, op: 'Anna', ts: at(25), text: 'muntat' });
        FO.aplicaOp(pr, { id: 'r3', t: 'verifica', conj: c0, resultat: 'ok', op: 'Pau', ts: at(30), text: 'ok' });
        const res = FO.resumOrdre(m, pr);
        assert(res.verificats === 1 && res.primeraPassada === 1, 'primera passada');
        assert(res.tempsMuntatge === 25 * 60000 && FO.textDurada(res.tempsMuntatge) === '25 min', 'temps');
        assert(res.persones.find(x => x.nom === 'Anna').muntats === 1 && res.persones.find(x => x.nom === 'Pau').verificats === 1);
        const html = FO.informeHTML(m, pr, { codi: 'OF-2026-001', empremta: 'aaa' }, { empremtaActual: 'bbb' });
        assert(/Informe de fabricació/.test(html) && /s'ha modificat/.test(html), 'informe amb avís de versió');
    });
}

console.log('Importació');
prova('plantilla CSV → projecte', () => {
    const f = FO.llegeixCSV(FO.plantillaCSV()), h = FO.trobaCapcalera(f), m = FO.detectaColumnes(f[h]);
    const q = FO.incorporaImport(FO.nouProjecte(), FO.construeixImport(f.slice(h + 1), m, FO.formatProbable(m), {}), 'substitueix');
    assert(q.conjunts.length === 4 && q.materials.length === 5, `${q.conjunts.length} conjunts, ${q.materials.length} materials`);
    assert(FO.conjunt(q, 'c:MOT').muntat && FO.conjunt(q, 'c:MOT').qty === 2);
});
prova('BOM de CAD indentada (1 · 1.1 · 1.2.1)', () => {
    const t = fs.readFileSync(path.join(__dirname, '..', 'exemples', 'bom_cad_solidworks.csv'), 'utf8');
    const f = FO.llegeixCSV(t), h = FO.trobaCapcalera(f), m = FO.detectaColumnes(f[h]);
    assert(FO.formatProbable(m) === 'bom');
    const q = FO.incorporaImport(FO.nouProjecte(), FO.construeixImport(f.slice(h + 1), m, 'bom', {}), 'substitueix');
    const sub = q.conjunts.find(c => c.codi === 'SUB-20'), asm = q.conjunts.find(c => c.codi === 'ASM-100');
    assert(sub && asm && sub.pare === asm.id && sub.qty === 2 && sub.items.length === 2);
    assert(asm.items.length === 2 && !asm.pare);
});
prova('columnes en castellà amb unitats en cm i kg', () => {
    const t = 'Conjunto;Código;Descripción;Cantidad;Largo;Ancho;Alto;Peso\nG1;P1;Pieza;3;2;1;0,5;0,01\n';
    const f = FO.llegeixCSV(t), m = FO.detectaColumnes(f[0]);
    const r = FO.construeixImport(f.slice(1), m, 'pla', { mida: 'cm', pes: 'kg' });
    assert(r.materials[0].x === 20 && r.materials[0].z === 5 && r.materials[0].pes === 10, JSON.stringify(r.materials[0]));
});

console.log('Etiquetes');
const et = FO.etiquetesPla(pla);
prova('una etiqueta per safata i per caixetí', () => {
    const tapa = s => s.tancament === 'pressio' || s.tancament === 'imants' ? 1 : 0;
    const n = pla.reduce((a, r) => a + obj(r).reduce((b, s) => b + (s.forma === 'caixa' ? 0 : 1) + tapa(s) + s.caixetins.length, 0), 0);
    assert(et.filter(e => e.tipus === 'tapa').every(e => FO.dadesEtiqueta(e).endsWith('|TAPA')), 'dades de la tapa');
    assert(et.length === n);
});
prova('Code 128: patrons de 11 mòduls i suma de control', () => {
    const m = FO.code128('AB');
    assert(m.join('') === '2112141113231311234111312331112', m.join(''));
});
prova('SVG vàlid en tots els formats', () => {
    Object.keys(FO.FORMATS_ETIQUETA).forEach(k => et.slice(0, 6).forEach(e => {
        const s = FO.svgEtiqueta(e, k);
        assert(s.startsWith('<svg') && s.endsWith('</svg>'), k);
    }));
});
prova('CSV RFID amb EPC de 24 dígits hexadecimals', () => {
    const l = FO.csvEtiquetes(et).trim().split('\n');
    assert(l.length === et.length + 1);
    assert(/;[0-9A-F]{24}$/.test(l[1]), l[1]);
});

console.log('Idiomes');
prova('diccionaris complets: cada text del codi té castellà i anglès amb els mateixos {marcadors}', () => {
    // tots els t('…'), tc('…') i FO.t('…') amb un literal com a primer argument
    const falten = [], mal = [];
    const ph = s => (s.match(/\{\w+\}/g) || []).sort().join();
    const fitxers = fs.readdirSync(path.join(__dirname, '..', 'js')).filter(f => /^fo-.*\.js$/.test(f) && !['fo-idiomes.js', 'fo-i18n.js'].includes(f)).map(f => path.join('js', f)).concat([path.join('servidor', 'fordre-servidor.js')]);
    for (const f of fitxers) {
        const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
        const re = /(?:^|[^\w.])(?:t|tc|FO\.t)\(\s*'((?:[^'\\]|\\.)*)'/g;
        let m;
        while ((m = re.exec(s))) {
            const k = m[1].replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
            if (!/\p{L}/u.test(k)) continue;
            for (const L of ['es', 'en']) {
                if (FO.TRAD[L][k] == null) falten.push(`${L} · ${f}: ${k}`);
                else if (ph(FO.TRAD[L][k]) !== ph(k)) mal.push(`${L} · ${k}`);
            }
        }
    }
    assert(!falten.length, 'sense traducció:\n      ' + falten.slice(0, 10).join('\n      '));
    assert(!mal.length, 'marcadors diferents:\n      ' + mal.slice(0, 10).join('\n      '));
    FO.TRAD_LLISTA.forEach(([ca, es, en]) => assert(ph(es) === ph(ca) && ph(en) === ph(ca), ca));
});
prova('FO.t: tradueix, omple els marcadors i torna el català si no hi ha traducció', () => {
    assert(FO.t('Pas {n}', { n: 3 }) === 'Pas 3');
    assert(FO.t('Pas {n}', { n: 3 }, 'es') === 'Paso 3');
    assert(FO.t('Pas {n}', { n: 3 }, 'en') === 'Step 3');
    assert(FO.t('Text que no existeix', null, 'en') === 'Text que no existeix');
});
prova('FO.tMissatge: tradueix missatges del servidor i del registre ja omplerts', () => {
    assert(FO.tMissatge('Nom o PIN incorrectes', 'en') === 'Incorrect name or PIN');
    assert(FO.tMissatge('Cal el rol de Qualitat', 'es') === 'Hace falta el rol de Calidad');
    assert(FO.tMissatge('Pas 2 · MOT: rebutjat · falta un cargol', 'en') === 'Step 2 · MOT: rejected · falta un cargol');
    assert(FO.tMissatge('💥 PL-001 ×1: venia defectuosa (Trencada) · es demana recanvi', 'es') === '💥 PL-001 ×1: venía defectuosa (Rota) · se pide recambio', FO.tMissatge('💥 PL-001 ×1: venia defectuosa (Trencada) · es demana recanvi', 'es'));
    assert(FO.tMissatge('Recanvi de 2 (Trencada)', 'en') === 'Replacement of 2 (Broken)');
    assert(FO.tMissatge('un text lliure qualsevol', 'en') === 'un text lliure qualsevol');
});
prova('plantilla CSV en castellà i anglès: l\'importador en reconeix totes les columnes', () => {
    for (const L of ['es', 'en']) {
        const capcal = ['conjunt', 'nom conjunt', 'pare', 'codi', 'nom', 'quantitat', 'pes', 'tipus', 'forma', 'liquid', 'angle max', 'apilable', 'max apilat', 'fragil', 'disposicio', 'color', 'origen', 'proveidor', 'notes', 'parell', 'nota', 'instruccions', 'eines', 'tancament', 'format kit', 'material caixa', 'color caixa', 'tracabilitat'].map(c => FO.t('csv:' + c, null, L).replace(/^csv:/, ''));
        const map = FO.detectaColumnes(capcal);
        assert(Object.keys(map).length === capcal.length, `${L}: ${Object.keys(map).length}/${capcal.length} · ${capcal.filter((c, i) => !Object.values(map).includes(i)).join(', ')}`);
    }
});

console.log('Compartir amb el mòbil');
(async () => {
    total++;
    try {
        const text = JSON.stringify(FO.projecteLleuger(p));
        const codi = await FO.comprimeix(text);
        assert(/^[zu][A-Za-z0-9_-]+$/.test(codi), 'codi');
        assert(await FO.descomprimeix(codi) === text, 'anada i tornada');
        console.log(`  ✓ enllaç comprimit i recuperat (${text.length} → ${codi.length} caràcters)`);
    } catch (e) { fallades++; console.log('  ✗ compartir\n      ' + e.message); }
    console.log(`\n${total - fallades}/${total} proves correctes`);
    process.exit(fallades ? 1 : 0);
})();
