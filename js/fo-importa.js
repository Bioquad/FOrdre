// ═══════════════════════════════════════════════════════════════
// FOrdre — Importació de llistes de peces
// ───────────────────────────────────────────────────────────────
// Dos formats, seleccionables:
//  · 'pla'  — full propi de FOrdre: cada fila és un material dins un
//             conjunt (columnes conjunt, pare, codi, quantitat, mides…).
//             Una fila sense codi de material defineix el conjunt en si
//             (i, si porta mides, les dades de la peça muntada).
//  · 'bom'  — llista de materials indentada d'un programa CAD
//             (FreeCAD, Fusion 360, SolidWorks, Inventor, Onshape…):
//             una columna de nivell (1, 2, 3 · 1.2.3 · sagnat) indica
//             la jerarquia. Una fila amb fills és un conjunt.
// Les columnes es detecten pel nom en català, castellà o anglès, i
// l'usuari les pot corregir abans d'importar.
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO || (G.FO = {});
    const t = (s, v) => (FO.t ? FO.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)));   // textos visibles: js/fo-i18n.js

    FO.CAMPS_IMPORT = {
        conjunt: { nom: t('Conjunt (codi)'), sin: ['conjunt', 'codi conjunt', 'conjunt codi', 'assembly', 'grup', 'group', 'conjunto', 'subassembly'] },
        conjuntNom: { nom: t('Conjunt (nom)'), sin: ['nom conjunt', 'nom del conjunt', 'assembly name', 'nombre conjunto', 'group name'] },
        pare: { nom: t('Conjunt pare'), sin: ['pare', 'parent', 'padre', 'conjunt pare', 'parent assembly'] },
        nivell: { nom: t('Nivell (BOM)'), sin: ['nivell', 'level', 'nivel', 'lvl', 'item', 'item no', 'item no.', 'item number', 'pos', 'posició', 'posicion', 'position', 'bom level', 'indent', 'núm', 'num', 'no.', '#'] },
        codi: { nom: t('Codi material'), sin: ['codigo', 'codi', 'code', 'part number', 'partnumber', 'part no', 'part no.', 'part', 'pn', 'p/n', 'referència', 'referencia', 'ref', 'reference', 'número de pieza', 'numero de pieza', 'article', 'sku', 'id', 'label'] },
        nom: { nom: t('Nom / descripció'), sin: ['nom', 'name', 'description', 'descripció', 'descripcion', 'descripción', 'denominació', 'denominacion', 'title', 'designation', 'nombre', 'component name', 'part name'] },
        qty: { nom: t('Quantitat'), sin: ['quantitat', 'qty', 'qty.', 'quantity', 'cantidad', 'qt', 'qtat', 'uds', 'units', 'unitats', 'count', 'cant', 'n'] },
        x: { nom: t('Llarg X'), sin: ['x', 'llarg', 'llargada', 'length', 'largo', 'longitud', 'l', 'dim x', 'size x', 'bounding box x'] },
        y: { nom: t('Ample Y'), sin: ['y', 'ample', 'amplada', 'width', 'ancho', 'anchura', 'w', 'dim y', 'size y', 'bounding box y'] },
        z: { nom: t('Alt Z'), sin: ['z', 'alt', 'alçada', 'alcada', 'height', 'alto', 'altura', 'h', 'gruix', 'thickness', 'espesor', 'dim z', 'size z', 'bounding box z'] },
        pes: { nom: t('Pes'), sin: ['pes', 'weight', 'peso', 'mass', 'massa', 'masa'] },
        tipus: { nom: t('Tipus'), sin: ['tipus', 'type', 'tipo', 'categoria', 'category'] },
        forma: { nom: t('Forma'), sin: ['forma', 'shape'] },
        esd: { nom: t('Sensible ESD'), sin: ['esd', 'electrostàtica', 'electrostatica', 'electrostatic', 'antiestàtic', 'antistatic'] },
        liquid: { nom: t('Conté líquid'), sin: ['liquid', 'líquid', 'líquido', 'liquido', 'fluid', 'fluids', 'fluido'] },
        angleMax: { nom: t('Angle màxim'), sin: ['angulo max', 'angulo maximo', 'max angle', 'angle max', 'angle màxim', 'angle maxim', 'angle', 'max tilt', 'inclinació', 'inclinacion', 'tilt'] },
        apilable: { nom: t('Apilable'), sin: ['apilable', 'stackable', 'apilar'] },
        maxApilat: { nom: t('Màx. apilat'), sin: ['max apilado', 'max apilados', 'max apilat', 'màx apilat', 'max stack', 'maxapilat'] },
        fragil: { nom: t('Fragilitat 0-10'), sin: ['fragilidad', 'fragil', 'fràgil', 'fragilitat', 'fragile', 'fragility', 'fragilidad'] },
        disposicio: { nom: t('Disposició'), sin: ['disposicio', 'disposició', 'disposicion', 'layout', 'arrangement'] },
        col: { nom: t('Color'), sin: ['color', 'colour', 'col'] },
        origen: { nom: t('Origen'), sin: ['origen', 'origin', 'make/buy', 'make buy', 'fabricat/comprat'] },
        proveidor: { nom: t('Proveïdor'), sin: ['proveidor', 'proveïdor', 'proveedor', 'supplier', 'vendor', 'fabricant', 'manufacturer'] },
        notes: { nom: t('Notes'), sin: ['notas', 'notes', 'comments', 'comentaris', 'observacions', 'observaciones', 'remarks'] },
        // dades de muntatge (element dins el conjunt)
        parell: { nom: t('Parell de collada (N·m)'), sin: ['parell', 'parell collada', 'parell de collada', 'torque', 'par', 'par de apriete', 'nm', 'n·m', 'apriete'] },
        nota: { nom: t('Nota de muntatge'), sin: ['nota', 'nota muntatge', 'nota de muntatge', 'assembly note', 'nota montaje', 'nota de montaje', 'indicacio', 'indicació'] },
        // dades del conjunt (a la fila del conjunt o a la fila de nivell superior de la BOM)
        instruccions: { nom: t('Instruccions (conjunt)'), sin: ['instruccions', 'instrucciones', 'instructions', 'passos', 'pasos', 'steps', 'procediment', 'procedimiento'] },
        eines: { nom: t('Eines (conjunt)'), sin: ['eines', 'herramientas', 'tools', 'utillatge', 'utillaje'] },
        tancament: { nom: t('Tancament (conjunt)'), sin: ['tancament', 'cierre', 'closure', 'tapa', 'lid'] },
        formatKit: { nom: t('Format del kit (conjunt)'), sin: ['format kit', 'format del kit', 'formato kit', 'kit format', 'format'] },
        caixaMaterial: { nom: t('Material de la caixa'), sin: ['material caixa', 'material de la caixa', 'material caja', 'box material', 'filament'] },
        caixaColor: { nom: t('Color de la caixa'), sin: ['box colour', 'color caixa', 'color de la caixa', 'color caja', 'box color'] },
        tracabilitat: { nom: t('Traçabilitat (lot / sèrie)'), sin: ['tracabilitat', 'traçabilitat', 'trazabilidad', 'traceability', 'tracking', 'lot/serie', 'lot / serie', 'lote/serie', 'lot/serial', 'serialitzat', 'serializado', 'serialized'] }
    };

    const net = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\(.*?\)|\[.*?\]/g, '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();

    // ─── CSV ───
    FO.llegeixCSV = function (text) {
        text = String(text).replace(/^﻿/, '');
        const primera = text.split(/\r?\n/)[0] || '';
        const sep = [';', '\t', ','].map(c => [c, primera.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
        const files = [];
        let fila = [], camp = '', cometes = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (cometes) {
                if (ch === '"') { if (text[i + 1] === '"') { camp += '"'; i++; } else cometes = false; }
                else camp += ch;
            } else if (ch === '"') cometes = true;
            else if (ch === sep) { fila.push(camp); camp = ''; }
            else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && text[i + 1] === '\n') i++;
                fila.push(camp); files.push(fila); fila = []; camp = '';
            } else camp += ch;
        }
        if (camp !== '' || fila.length) { fila.push(camp); files.push(fila); }
        return files.filter(f => f.some(c => String(c).trim() !== ''));
    };

    // Fitxer (File del navegador) → files. Excel/ODS amb SheetJS si és disponible.
    FO.llegeixFitxer = function (file) {
        return new Promise((ok, ko) => {
            const nom = file.name.toLowerCase();
            const rd = new FileReader();
            rd.onerror = () => ko(rd.error);
            if (/\.(xlsx|xlsm|xls|ods)$/.test(nom)) {
                if (!G.XLSX) return ko(new Error(t('No s\'ha pogut carregar el lector d\'Excel. Desa el full com a CSV.')));
                rd.onload = () => {
                    try {
                        const wb = G.XLSX.read(new Uint8Array(rd.result), { type: 'array' });
                        const fulls = wb.SheetNames.map(n => ({ nom: n, files: G.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }) }));
                        ok(fulls);
                    } catch (e) { ko(e); }
                };
                rd.readAsArrayBuffer(file);
            } else if (/\.json$/.test(nom)) {
                rd.onload = () => { try { ok({ json: JSON.parse(rd.result) }); } catch (e) { ko(e); } };
                rd.readAsText(file);
            } else {
                rd.onload = () => ok([{ nom: file.name, files: FO.llegeixCSV(rd.result) }]);
                rd.readAsText(file);
            }
        });
    };

    // Busca la fila de capçalera (la primera amb 2+ noms de camp reconeguts)
    FO.trobaCapcalera = function (files) {
        let millor = 0, idx = 0;
        files.slice(0, 15).forEach((f, i) => {
            const n = Object.keys(FO.detectaColumnes(f)).length;
            if (n > millor) { millor = n; idx = i; }
        });
        return idx;
    };

    FO.detectaColumnes = function (capcalera) {
        const map = {}, usat = new Set();
        const cap = capcalera.map(net);
        // primer coincidències exactes, després parcials
        for (const passada of [0, 1]) {
            for (const [camp, def] of Object.entries(FO.CAMPS_IMPORT)) {
                if (map[camp] !== undefined) continue;
                const i = cap.findIndex((h, k) => !usat.has(k) && h && def.sin.map(net).some(s =>
                    passada === 0 ? h === s : (s.length > 2 && (h.startsWith(s + ' ') || h.endsWith(' ' + s)))));
                if (i >= 0) { map[camp] = i; usat.add(i); }
            }
        }
        return map;
    };

    FO.formatProbable = map => (map.nivell !== undefined && map.conjunt === undefined ? 'bom' : 'pla');

    // Profunditat a partir del valor de nivell: 2 · "1.2.3" · sagnat de text
    // `ambPunts`: la columna fa servir numeració d'ítems (1, 1.1, 1.1.2…)
    function profunditat(v, text, ambPunts) {
        const s = String(v == null ? '' : v).trim();
        if (/^\d+(\.\d+)*\.?$/.test(s) && (ambPunts || s.indexOf('.') > 0 && !/^\d+\.$/.test(s))) return s.replace(/\.$/, '').split('.').length - 1;
        if (/^\d+$/.test(s)) return parseInt(s, 10);
        const m = String(text || '').match(/^[\s.·\-–—>]+/);
        return m ? Math.round(m[0].replace(/\t/g, '    ').length / 2) : 0;
    }

    const FACTOR_MIDA = { mm: 1, cm: 10, m: 1000, in: 25.4 };
    const FACTOR_PES = { g: 1, kg: 1000, lb: 453.6 };

    function materialDeFila(f, map, u, i) {
        const v = k => (map[k] === undefined ? undefined : f[map[k]]);
        const n = k => { const x = FO.num(v(k), NaN); return isFinite(x) ? x : undefined; };
        const m = {
            codi: String(v('codi') || '').trim(), nom: String(v('nom') || '').trim(),
            x: n('x') !== undefined ? n('x') * u.mida : undefined, y: n('y') !== undefined ? n('y') * u.mida : undefined,
            z: n('z') !== undefined ? n('z') * u.mida : undefined, pes: n('pes') !== undefined ? n('pes') * u.pes : undefined
        };
        const tipus = net(v('tipus'));
        if (tipus) m.tipus = /consum|glue|cola|adhes|brid|etiqu/.test(tipus) ? 'consumible' : /cargol|torn|screw|bolt|nut|washer|femell|volander|rosc|fasten|hardware/.test(tipus) ? 'cargol' : 'peca';
        const forma = net(v('forma'));
        if (forma) m.forma = /cil|cyl|rod|tub/.test(forma) ? 'cylinder' : 'box';
        ['esd', 'liquid', 'apilable'].forEach(k => { if (v(k) !== undefined && String(v(k)).trim() !== '') m[k] = FO.boo(v(k)); });
        ['angleMax', 'maxApilat', 'fragil'].forEach(k => { if (n(k) !== undefined) m[k] = n(k); });
        const disp = net(v('disposicio'));
        if (disp) m.disposicio = /indiv/.test(disp) ? 'individual' : /apil|stack/.test(disp) ? 'apilat' : /granel|bulk|loose/.test(disp) ? 'granel' : /capa|layer/.test(disp) ? 'capa' : 'auto';
        const col = String(v('col') || '').trim();
        if (/^#?[0-9a-f]{6}$/i.test(col)) m.col = col[0] === '#' ? col : '#' + col;
        const ori = net(v('origen'));
        if (ori) m.origen = /compr|buy|purch|compra/.test(ori) ? 'comprat' : 'propi';
        if (v('proveidor')) m.proveidor = v('proveidor');
        if (v('notes')) m.notes = v('notes');
        // traçabilitat: «serie» (S/N, serial, sèrie) o «lot» (lot, lote, batch, partida); res = no cal
        const tr = net(v('tracabilitat'));
        if (tr) m.tracabilitat = /seri|s\/?n\b|^sn$/.test(tr) ? 'serie' : /lot|batch|partid/.test(tr) ? 'lot' : '';
        const cm = String(v('caixaMaterial') || '').trim().toUpperCase().replace(/\s+/g, '-');
        if (cm && FO.MATERIALS_IMPRESSIO) { const k = Object.keys(FO.MATERIALS_IMPRESSIO).find(x => x.toUpperCase() === cm || cm.startsWith(x.toUpperCase())); if (k) m.caixaMaterial = k; }
        const cc = String(v('caixaColor') || '').trim();
        if (/^#?[0-9a-f]{6}$/i.test(cc)) m.caixaColor = cc[0] === '#' ? cc : '#' + cc;
        if (!m.codi && m.nom) m.codi = m.nom.toUpperCase().replace(/[^\w]+/g, '-').slice(0, 20);
        if (!m.nom) m.nom = m.codi;
        if (m.nom) m.nom = m.nom.replace(/^[\s.·\-–—>]+/, '');
        return m;
    }

    const teMides = m => m.x > 0 && m.y > 0 && m.z > 0;

    // Dades de muntatge d'un conjunt (instruccions, eines, tancament, format)
    function dadesConjunt(f, map) {
        const v = k => (map[k] === undefined ? '' : String(f[map[k]] == null ? '' : f[map[k]]).trim());
        const d = {};
        if (v('instruccions')) d.instruccions = v('instruccions').replace(/\s*[|;]\s*|\s*\\n\s*/g, '\n');
        if (v('eines')) d.eines = v('eines');
        const t = net(v('tancament'));
        if (t) d.tancament = /llavi|labio|lip/.test(t) ? 'llavi' : /iman|magnet/.test(t) ? 'imants' : /pres|press|snap/.test(t) ? 'pressio' : /cap|sense|ningu|none|obert|abiert/.test(t) ? 'cap' : '';
        const k = net(v('formatKit'));
        if (k) d.formatKit = /fusion|fused|tray|safata|bandeja/.test(k) ? 'fusionat' : /indiv/.test(k) ? 'individual' : /mixt|mix/.test(k) ? 'mixt' : /conten|carrier/.test(k) ? 'contenidor' : '';
        return d;
    }
    // Dades d'un element dins el conjunt (parell de collada i nota)
    function dadesItem(f, map) {
        const d = {};
        if (map.parell !== undefined) { const n = FO.num(f[map.parell], NaN); if (isFinite(n) && n > 0) d.parell = n; }
        if (map.nota !== undefined && String(f[map.nota] || '').trim()) d.nota = String(f[map.nota]).trim();
        return d;
    }

    // Construeix {materials, conjunts, avisos} a partir de files i mapa de columnes
    FO.construeixImport = function (files, map, format, unitats) {
        const u = { mida: FACTOR_MIDA[(unitats || {}).mida] || 1, pes: FACTOR_PES[(unitats || {}).pes] || 1 };
        const materials = new Map(), conjunts = new Map(), avisos = [];
        let ordre = 0;
        const afegeixMaterial = (m, fila) => {
            if (!m.codi) return null;
            const ex = materials.get(m.codi);
            if (ex) { Object.keys(m).forEach(k => { if (ex[k] === undefined && m[k] !== undefined) ex[k] = m[k]; }); return ex; }
            if (!teMides(m)) avisos.push(t('Fila {fila}: {codi} sense mides completes (s\'usen 10 mm)', { fila, codi: m.codi }));
            const nou = Object.assign({ id: 'm:' + m.codi }, m);
            materials.set(m.codi, nou);
            return nou;
        };
        const conjunt = (codi, nom) => {
            let c = conjunts.get(codi);
            if (!c) { c = { id: 'c:' + codi, codi, nom: nom || codi, pare: null, ordre: ordre++, items: [] }; conjunts.set(codi, c); }
            else if (nom && c.nom === c.codi) c.nom = nom;
            return c;
        };
        const qtyDe = f => Math.max(1, Math.round(FO.num(map.qty === undefined ? 1 : f[map.qty], 1)));
        const afegeixItem = (c, mat, q, extra) => {
            const it = c.items.find(i => i.mat === mat.id);
            if (it) { it.qty += q; Object.assign(it, extra || {}); } else c.items.push(Object.assign({ mat: mat.id, qty: q }, extra || {}));
        };

        if (format === 'bom') {
            const pila = []; // [{prof, conj}]
            const ambPunts = map.nivell !== undefined && files.some(f => /^\d+\.\d+/.test(String(f[map.nivell]).trim()));
            const dades = files.map((f, i) => ({
                f, fila: i + 2, prof: profunditat(map.nivell === undefined ? '' : f[map.nivell], map.nom === undefined ? '' : f[map.nom], ambPunts),
                m: materialDeFila(f, map, u, i)
            })).filter(d => d.m.codi);
            const base = Math.min(...dades.map(d => d.prof));
            dades.forEach(d => { d.prof -= base; });
            // arrel: si hi ha més d'una fila de nivell 0, en creem una de comuna
            const arrelsN = dades.filter(d => d.prof === 0).length;
            let arrel = null;
            if (arrelsN !== 1) { arrel = conjunt('MAQUINA', 'Màquina'); dades.forEach(d => { d.prof += 1; }); }
            dades.forEach((d, i) => {
                const seg = dades[i + 1];
                const esConjunt = seg && seg.prof > d.prof;
                while (pila.length && pila[pila.length - 1].prof >= d.prof) pila.pop();
                const pare = pila.length ? pila[pila.length - 1].conj : arrel;
                const q = qtyDe(d.f);
                if (esConjunt) {
                    const c = conjunt(d.m.codi, d.m.nom);
                    c.pare = pare ? pare.id : null;
                    c.qty = q;
                    if (teMides(d.m)) c.muntat = Object.assign({}, d.m);
                    Object.assign(c, dadesConjunt(d.f, map));
                    pila.push({ prof: d.prof, conj: c });
                } else {
                    const mat = afegeixMaterial(d.m, d.fila);
                    if (!pare) { avisos.push(t('Fila {fila}: {codi} sense conjunt; s\'ha posat a «Solts»', { fila: d.fila, codi: d.m.codi })); afegeixItem(conjunt('SOLTS', t('Peces soltes')), mat, q, dadesItem(d.f, map)); }
                    else afegeixItem(pare, mat, q, dadesItem(d.f, map));
                }
            });
        } else {
            files.forEach((f, i) => {
                const fila = i + 2;
                const cc = String(map.conjunt === undefined ? '' : f[map.conjunt] || '').trim();
                const cn = String(map.conjuntNom === undefined ? '' : f[map.conjuntNom] || '').trim();
                const pc = String(map.pare === undefined ? '' : f[map.pare] || '').trim();
                const m = materialDeFila(f, map, u, i);
                const codiC = cc || cn || 'GENERAL';
                const c = conjunt(codiC, cn || cc);
                if (pc) { const p = conjunt(pc); if (p !== c) c.pare = p.id; }
                if (!m.codi || m.codi === codiC) {
                    // fila que descriu el conjunt: quantitat i dades de peça muntada
                    if (map.qty !== undefined && f[map.qty] !== '') c.qty = qtyDe(f);
                    if (teMides(m)) c.muntat = m;
                    Object.assign(c, dadesConjunt(f, map));
                    return;
                }
                Object.assign(c, dadesConjunt(f, map));   // les dades de conjunt també poden venir a qualsevol fila
                afegeixItem(c, afegeixMaterial(m, fila), qtyDe(f), dadesItem(f, map));
            });
        }
        return { materials: Array.from(materials.values()), conjunts: Array.from(conjunts.values()), avisos };
    };

    // Incorpora el resultat al projecte ('afegeix' fusiona per codi, 'substitueix' reemplaça)
    FO.incorporaImport = function (p, imp, mode) {
        const brut = mode === 'substitueix' ? { id: p.id, nom: p.nom, config: p.config, revisions: p.revisions, materials: [], conjunts: [] } : JSON.parse(JSON.stringify(p));
        const perCodiM = new Map(brut.materials.map(m => [m.codi, m]));
        const remapM = new Map();
        imp.materials.forEach(m => {
            const ex = perCodiM.get(m.codi);
            if (ex) { Object.assign(ex, Object.fromEntries(Object.entries(m).filter(([k, v]) => k !== 'id' && v !== undefined))); remapM.set(m.id, ex.id); }
            else { brut.materials.push(m); perCodiM.set(m.codi, m); remapM.set(m.id, m.id); }
        });
        const perCodiC = new Map(brut.conjunts.map(c => [c.codi, c]));
        const remapC = new Map();
        imp.conjunts.forEach(c => {
            const ex = perCodiC.get(c.codi);
            remapC.set(c.id, ex ? ex.id : c.id);
            if (!ex) { brut.conjunts.push(c); perCodiC.set(c.codi, c); }
        });
        imp.conjunts.forEach(c => {
            const desti = brut.conjunts.find(x => x.id === remapC.get(c.id));
            if (desti !== c) {
                if (c.nom && c.nom !== c.codi) desti.nom = c.nom;
                if (c.muntat) desti.muntat = c.muntat;
                if (c.qty) desti.qty = c.qty;
                ['instruccions', 'eines', 'tancament', 'formatKit'].forEach(k => { if (c[k]) desti[k] = c[k]; });
                c.items.forEach(it => {
                    const id = remapM.get(it.mat) || it.mat;
                    const ex = desti.items.find(i => i.mat === id);
                    if (ex) { ex.qty = it.qty; if (it.parell) ex.parell = it.parell; if (it.nota) ex.nota = it.nota; }
                    else desti.items.push(Object.assign({}, it, { mat: id }));
                });
            } else c.items.forEach(it => { it.mat = remapM.get(it.mat) || it.mat; });
            if (c.pare) desti.pare = remapC.get(c.pare) || c.pare;
        });
        return FO.normalitzaProjecte(brut);
    };

    // ─── Revisions: què canvia entre dues versions del projecte ───
    const CAMPS_MAT_DIFF = ['nom', 'tipus', 'forma', 'x', 'y', 'z', 'pes', 'esd', 'liquid', 'angleMax', 'apilable', 'maxApilat', 'fragil', 'disposicio'];
    // Signatura d'un objecte imprès: si canvia, cal tornar-lo a imprimir
    const signatura = o => [o.forma, o.W, o.D, o.H, o.material, o.color, o.tancament,
        (o.caixetins || []).map(c => [c.mat.codi, c.qty, c.x, c.y, c.w, c.d, c.z, c.llavi || 0].join(':')).join(','),
        (o.caixes || []).map(q => q.obj.id + '@' + q.x + ',' + q.y).join(',')].join('|');

    FO.diffProjectes = function (a, b) {
        const d = { matNous: [], matEliminats: [], matCanviats: [], conjNous: [], conjEliminats: [], quantitats: [], reimprimir: [], nous: [], retirar: [] };
        const mA = new Map(a.materials.map(m => [m.codi, m])), mB = new Map(b.materials.map(m => [m.codi, m]));
        mB.forEach((m, k) => {
            const v = mA.get(k);
            if (!v) d.matNous.push(k);
            else { const camps = CAMPS_MAT_DIFF.filter(c => String(v[c]) !== String(m[c])); if (camps.length) d.matCanviats.push({ codi: k, camps }); }
        });
        mA.forEach((m, k) => { if (!mB.has(k)) d.matEliminats.push(k); });
        const cA = new Map(a.conjunts.map(c => [c.codi, c])), cB = new Map(b.conjunts.map(c => [c.codi, c]));
        const codiMat = (p, id) => { const m = p.materials.find(x => x.id === id); return m ? m.codi : id; };
        cB.forEach((c, k) => {
            const v = cA.get(k);
            if (!v) { d.conjNous.push(k); return; }
            const qa = new Map(v.items.map(i => [codiMat(a, i.mat), i.qty])), qb = new Map(c.items.map(i => [codiMat(b, i.mat), i.qty]));
            new Set([...qa.keys(), ...qb.keys()]).forEach(m => { if ((qa.get(m) || 0) !== (qb.get(m) || 0)) d.quantitats.push({ conj: k, mat: m, abans: qa.get(m) || 0, despres: qb.get(m) || 0 }); });
        });
        cA.forEach((c, k) => { if (!cB.has(k)) d.conjEliminats.push(k); });
        if (FO.calculaPla && FO.imprimibles) {
            const sig = p => { const m = new Map(); FO.calculaPla(p).forEach(r => FO.imprimibles(r).forEach(o => m.set(o.id, signatura(o)))); return m; };
            const sA = sig(a), sB = sig(b);
            sB.forEach((s, id) => { if (!sA.has(id)) d.nous.push(id); else if (sA.get(id) !== s) d.reimprimir.push(id); });
            sA.forEach((s, id) => { if (!sB.has(id)) d.retirar.push(id); });
        }
        d.buit = !Object.values(d).some(v => Array.isArray(v) && v.length);
        return d;
    };

    // Text breu d'una revisió
    FO.textDiff = function (d) {
        const l = [];
        if (d.matNous.length) l.push(t('Materials nous: {llista}', { llista: d.matNous.join(', ') }));
        if (d.matEliminats.length) l.push(t('Materials eliminats: {llista}', { llista: d.matEliminats.join(', ') }));
        d.matCanviats.forEach(c => l.push(t('{codi}: canvia {camps}', { codi: c.codi, camps: c.camps.map(x => t(x)).join(', ') })));
        if (d.conjNous.length) l.push(t('Conjunts nous: {llista}', { llista: d.conjNous.join(', ') }));
        if (d.conjEliminats.length) l.push(t('Conjunts eliminats: {llista}', { llista: d.conjEliminats.join(', ') }));
        d.quantitats.forEach(q => l.push(`${q.conj} · ${q.mat}: ${q.abans} → ${q.despres}`));
        if (d.reimprimir.length) l.push(t('Cal tornar a imprimir: {llista}', { llista: d.reimprimir.join(', ') }));
        if (d.nous.length) l.push(t('Peces noves a imprimir: {llista}', { llista: d.nous.join(', ') }));
        if (d.retirar.length) l.push(t('Ja no calen: {llista}', { llista: d.retirar.join(', ') }));
        return l;
    };

    // Plantilla CSV del format pla
    FO.plantillaCSV = function () {
        // capçaleres en l'idioma triat: l'importador les reconeix en català, castellà i anglès
        const cap = ['conjunt', 'nom conjunt', 'pare', 'codi', 'nom', 'quantitat', 'x', 'y', 'z', 'pes', 'tipus', 'forma', 'esd', 'liquid', 'angle max', 'apilable', 'max apilat', 'fragil', 'disposicio', 'color', 'origen', 'proveidor', 'notes',
            'parell', 'nota', 'instruccions', 'eines', 'tancament', 'format kit', 'material caixa', 'color caixa', 'tracabilitat'].map(c => t('csv:' + c).replace(/^csv:/, ''));
        const buit = n => Array(n).fill('');
        const f = [
            ['MAQ', t('Màquina completa'), '', '', '', '1', ...buit(13), '#4A90D9', '', '', t('fila de conjunt (sense codi de material)'), '', '', t('Muntatge final | Prova de funcionament'), '', '', 'mixt', '', '', ''],
            ['XAS', t('Xassís'), 'MAQ', 'PL-001', t('Placa base alumini'), '2', '180', '120', '3', '175', 'peca', 'box', '0', '0', '90', '1', '', '0', 'auto', '#9AA5B1', 'propi', '', '', '', '', t('Presentar les plaques | Muntar els escaires | Collar en creu'), t('Clau Allen 3 mm, clau dinamomètrica'), 'llavi', '', '', '', ''],
            ['XAS', t('Xassís'), 'MAQ', 'CRG-M4x10', t('Cargol DIN912 M4x10'), '24', '10', '7', '7', '1.6', 'cargol', 'box', '0', '0', '90', '1', '', '0', 'granel', '', 'comprat', 'Würth', '', '2.5', t('En creu'), '', '', '', '', '', '', ''],
            ['XAS', t('Xassís'), 'MAQ', 'CON-01', t('Frenafils 243'), '1', '25', '25', '75', '18', 'consumible', 'cylinder', '0', '1', '30', '0', '', '0', 'individual', '#1565C0', 'comprat', '', '', '', t('Una gota a cada cargol'), '', '', '', '', 'PETG', '#FDD835', 'lot'],
            ['MOT', t('Grup motor'), 'XAS', '', '', '2', '60', '50', '80', '320', '', '', '0', '0', '90', '0', '', '3', '', '#FF7043', '', '', t('conjunt muntat: mides de la peça acabada, 2 unitats'), '', '', t('Encarar el motor | Collar els 4 cargols'), t('Clau Allen 2,5 mm'), 'pressio', 'contenidor', '', '', ''],
            ['MOT', t('Grup motor'), 'XAS', 'MT-050', t('Motor NEMA17'), '1', '42', '42', '48', '280', 'peca', 'box', '0', '0', '90', '0', '', '0', 'auto', '#455A64', 'comprat', '', '', '', '', '', '', '', '', '', '', 'serie'],
            ['ELE', t('Electrònica'), 'MAQ', 'PCB-100', t('Placa de control'), '1', '100', '70', '18', '55', 'peca', 'box', '1', '0', '90', '0', '', '7', 'individual', '#2E7D32', 'propi', '', '', '', t('Manipular per les vores'), t('Polsera antiestàtica | Muntar els separadors'), t('Tornavís PH1'), 'imants', '', '', '', 'serie']
        ];
        return '﻿' + [cap].concat(f).map(r => r.join(';')).join('\n') + '\n';
    };
})(typeof window !== 'undefined' ? window : globalThis);
