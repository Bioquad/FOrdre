// ═══════════════════════════════════════════════════════════════
// FOrdre — proves del nucli (sense navegador)
// Execució:  node proves/proves.js
// ═══════════════════════════════════════════════════════════════
'use strict';
const path = require('path');
const fs = require('fs');
for (const f of ['fo-dades', 'fo-calcul', 'fo-stl', 'fo-importa', 'fo-etiquetes']) require(path.join(__dirname, '..', 'js', f + '.js'));
const FO = globalThis.FO;

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
    assert(f.reduce((a, e) => a + e.peces, 0) === pla.reduce((a, r) => a + obj(r).length, 0));
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
    const n = pla.reduce((a, r) => a + obj(r).reduce((b, s) => b + (s.forma === 'caixa' ? 0 : 1) + s.caixetins.length, 0), 0);
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

console.log(`\n${total - fallades}/${total} proves correctes`);
process.exit(fallades ? 1 : 0);
