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
prova('cada material d\'un conjunt té caixetí (o queda marcat fora)', () => {
    pla.forEach(r => r.conj.items.forEach(it => {
        const hi = r.safates.some(s => s.caixetins.some(c => c.mat.id === it.mat)) || r.fora.some(c => c.mat.id === it.mat);
        assert(hi, r.conj.codi + ' ' + it.mat);
    }));
});
prova('les quantitats es multipliquen per les unitats de subconjunt', () => {
    const r = pla.find(x => x.conj.id === 'MOT');
    assert(r.multiplicador === 2);
    const c = r.safates[0].caixetins.find(x => x.mat.id === 'MT-050');
    assert(c.qty === 2, 'MT-050 ×' + c.qty);
});
prova('els subconjunts muntats tenen caixa de guarda', () => {
    const r = pla.find(x => x.conj.id === 'MOT');
    assert(r.safates.some(s => s.tipus === 'muntat' && s.caixetins[0].qty === 2));
});
prova('les peces ESD van a una safata ESD', () => {
    pla.forEach(r => r.safates.forEach(s => s.caixetins.forEach(c => assert(!!c.mat.esd === (s.id.includes('ESD')), s.id + ' ' + c.mat.codi))));
});
prova('cap caixetí se surt de la safata ni se solapa amb un altre', () => {
    pla.forEach(r => r.safates.forEach(s => {
        s.caixetins.forEach((a, i) => {
            assert(a.x >= p.config.paret - 1e-6 && a.y >= p.config.paret - 1e-6, s.id);
            assert(a.x + a.w <= s.W - p.config.paret + 1e-6 && a.y + a.d <= s.D - p.config.paret + 1e-6, s.id + ' ' + a.mat.codi);
            s.caixetins.slice(i + 1).forEach(b => assert(!solapen(a, b), `${s.id}: ${a.mat.codi} / ${b.mat.codi}`));
        });
    }));
});
prova('les safates caben al llit de la impressora', () => {
    pla.forEach(r => r.safates.forEach(s => assert(s.W <= p.config.llit.x + 1e-6 && s.D <= p.config.llit.y + 1e-6 && s.H <= p.config.llit.z, s.id)));
});
prova('un conjunt massa gran es reparteix en diverses safates', () => {
    const q = FO.normalitzaProjecte({
        materials: [{ id: 'A', codi: 'A', x: 90, y: 90, z: 20 }],
        conjunts: [{ id: 'C', codi: 'C', items: [{ mat: 'A', qty: 12 }] }]
    });
    const r = FO.calculaPla(q)[0];
    assert(r.safates.length > 1, 'safates: ' + r.safates.length);
    assert(r.safates.reduce((a, s) => a + s.caixetins.reduce((b, c) => b + c.qty, 0), 0) === 12);
});
prova('la inclinació es limita per les peces que no es poden tombar', () => {
    const q = FO.exemple(); q.config.inclinacio = 25;
    const s = FO.calculaPla(q).find(r => r.conj.id === 'HID').safates[0];
    assert(s.angle === 10, 'angle ' + s.angle);
});

console.log('Geometria i fitxers');
prova('totes les safates i falques són sòlids tancats', () => {
    pla.forEach(r => r.safates.forEach(s => {
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
    const n = pla.reduce((a, r) => a + r.safates.reduce((b, s) => b + 1 + s.caixetins.length, 0), 0);
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
