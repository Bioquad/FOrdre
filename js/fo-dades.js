// ═══════════════════════════════════════════════════════════════
// FOrdre — Model de dades
// ───────────────────────────────────────────────────────────────
// Un projecte és un catàleg de materials i un arbre de conjunts.
//   · material: una peça, un element de cargoleria o un consumible,
//     amb les seves propietats físiques (mides en mm, pes en g…).
//   · conjunt: un grup de muntatge. Té un pare (o cap, si és l'arrel:
//     la màquina) i una llista d'items {mat, qty} amb els materials
//     que s'hi munten directament. Els subconjunts es munten abans.
// L'ordre de muntatge surt de recórrer l'arbre de les fulles cap
// amunt: primer els subconjunts, després el conjunt que els conté.
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO || (G.FO = {});

    FO.VERSIO = '1.3.0';

    // Paràmetres de fabricació de les safates (mm) i de les etiquetes
    FO.CONFIG_DEFECTE = {
        llit: { x: 220, y: 220, z: 100 },   // volum útil de la impressora 3D
        paret: 1.6,        // gruix de la paret exterior de la safata
        terra: 1.2,        // gruix del terra
        separador: 1.2,    // gruix de les parets entre caixetins
        divisor: 0.8,      // gruix de les cel·les internes (peces individuals)
        joc: 1.0,          // folgança al voltant de cada peça
        dit: 8,            // espai extra per poder agafar una peça amb els dits
        minCaixeti: 18,    // amplada mínima d'un caixetí (hi ha de cabre un dit)
        profMax: 45,       // profunditat màxima d'un caixetí
        retencio: 0.6,     // fracció mínima de l'alçada d'una peça dreta que queda dins
        granel: 0.55,      // factor d'ocupació del material a granel
        omplert: 0.8,      // fins on s'omple un caixetí a granel (no fins dalt de tot)
        llavi: 2,          // alçada extra de les parets per evitar vessaments
        inclinacio: 0,     // inclinació de la safata (graus); 0 = horitzontal
        esdSeparat: true,  // les peces sensibles a l'ESD van a una safata pròpia
        fonsElevat: 'petits', // 'petits' | 'tots' | 'cap': on s'eleva el fons dels caixetins
        areaPetit: 4000,   // mm²: per sota, el caixetí es considera petit
        etiqueta: 'cinta12',
        // ─── Caixes i contenidors ───
        formatKit: 'mixt',          // fusionat | individual | contenidor | mixt
        paretCaixa: 1.2,            // paret de les caixes individuals
        paretContenidor: 2.0,       // paret del contenidor general
        jocCaixes: 0.6,             // folgança entre caixes dins el contenidor
        alcadaContenidor: 0.6,      // alçada del contenidor respecte la caixa més alta (0-1)
        materialCaixa: 'PLA',       // material d'impressió per defecte de caixes i safates
        materialESD: 'PETG-ESD',    // material per a les caixes de peces sensibles a l'ESD
        materialContenidor: 'PETG', // material del contenidor general
        colorCaixa: '#E3E6EE',      // color fix de caixes i safates
        colorContenidor: '#546E7A', // color del contenidor general
        esquemaColor: 'material',   // color de les caixes individuals: material | conjunt | tipus | fix
        ajustaFilaments: true,      // ajustar els colors automàtics al filament disponible més proper
        filaments: ['#FFFFFF', '#212121', '#9E9E9E', '#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E88E5', '#8E24AA', '#6D4C41'],
        factorPes: 0.45,            // fracció real de plàstic d'un sòlid imprès (parets + farciment)
        // ─── Tancament ───
        tancament: 'llavi',         // cap | llavi | pressio | imants
        llaviAmple: 2,              // llavi interior: mm que sobresurt cap al centre del caixetí (0-5)
        jocTapa: 0.25,              // folgança de la tapa a pressió
        gruixTapa: 1.6,             // gruix de la placa de la tapa
        tapesInternes: true,        // en formats amb contenidor, tapa també a cada caixa de dins
        contenidorsApilables: true, // mida comuna, peu encastat i alçada suficient per apilar-los
        nanses: true,               // nanses als costats curts del contenidor
        qrRelleu: true,             // QR gravat a la tapa (i a la cara posterior si no hi ha tapa ni rebaix)
        imantD: 6, imantH: 2,       // imant de disc (diàmetre × alçada)
        // ─── Identificació física i ergonomia ───
        relleu: true,               // codi gravat a la cara frontal
        rebaixEtiqueta: false,      // rebaix per a l'etiqueta adhesiva (cara frontal o posterior)
        codiFons: true,             // codi gravat al fons de cada caixetí
        fonsArrodonit: true,        // rampa arrodonida als caixetins a granel
        // ─── Impressió ───
        cabal: 8,                   // cabal volumètric mitjà de la impressora (mm³/s) per estimar temps
        separacioTanda: 6           // separació entre peces en una tanda d'impressió (mm)
    };

    // Límits dels paràmetres numèrics [mínim, màxim]
    FO.RANGS = {
        'llit.x': [150, 2000], 'llit.y': [150, 2000], 'llit.z': [50, 2000],
        paret: [1, 10], paretCaixa: [1, 10], paretContenidor: [1, 10],
        terra: [0.6, 10], separador: [0.6, 10], divisor: [0.4, 5], joc: [0, 10], dit: [0, 40],
        minCaixeti: [5, 200], profMax: [5, 500], retencio: [0.1, 1], granel: [0.2, 0.9], omplert: [0.3, 1],
        llavi: [0, 20], inclinacio: [0, 45], areaPetit: [0, 1e6], jocCaixes: [0, 5], alcadaContenidor: [0.2, 1],
        factorPes: [0.1, 1], llaviAmple: [0, 5], jocTapa: [0, 1.5], gruixTapa: [0.8, 6], imantD: [2, 30], imantH: [0.5, 10],
        cabal: [1, 60], separacioTanda: [1, 50]
    };
    FO.limita = function (k, v) {
        const r = FO.RANGS[k]; if (!r) return v;
        return Math.min(r[1], Math.max(r[0], v));
    };

    FO.TANCAMENTS = {
        cap: { nom: 'Oberta', desc: 'Sense tancament.' },
        llavi: { nom: 'Llavi interior', desc: 'Una vora que entra cap al centre de cada caixetí (0-5 mm) i reté les peces; s\'imprimeix a 45° sense suports.' },
        pressio: { nom: 'Tapa a pressió', desc: 'Tapa amb una faldilla que encaixa per dins de les parets.' },
        imants: { nom: 'Tapa amb imants', desc: 'Tapa i caixa amb allotjaments per a imants de disc a les cantonades.' }
    };

    // Formats del kit d'un conjunt
    FO.FORMATS_KIT = {
        fusionat: { nom: 'Safata fusionada', desc: 'Una sola peça amb tots els caixetins. La més ràpida d\'imprimir.' },
        individual: { nom: 'Caixes individuals', desc: 'Una caixa per material, cadascuna del seu color i material.' },
        contenidor: { nom: 'Caixes + contenidor', desc: 'Caixes individuals dins un contenidor obert per dalt per transportar-les juntes.' },
        mixt: { nom: 'Mixt (petits fusionats)', desc: 'Els materials petits en un bloc de caixetins fusionats, els grans en caixes individuals, tot dins el contenidor.' }
    };

    // Materials d'impressió (densitat en g/cm³)
    FO.MATERIALS_IMPRESSIO = {
        PLA: { nom: 'PLA', dens: 1.24, notes: 'Rígid i fàcil. Evitar calor (> 55 °C) i dissolvents.' },
        PETG: { nom: 'PETG', dens: 1.27, notes: 'Resistent a olis, greixos i cops. Bo per a líquids.' },
        ABS: { nom: 'ABS', dens: 1.04, notes: 'Resisteix temperatura; cal impressora tancada.' },
        ASA: { nom: 'ASA', dens: 1.07, notes: 'Com l\'ABS, resistent als UV.' },
        PC: { nom: 'PC (policarbonat)', dens: 1.20, notes: 'Molt resistent i rígid.' },
        PA: { nom: 'PA (niló)', dens: 1.14, notes: 'Resistent al desgast i a olis; absorbeix humitat.' },
        PP: { nom: 'PP (polipropilè)', dens: 0.90, notes: 'Resistència química màxima (àcids, dissolvents).' },
        TPU: { nom: 'TPU (flexible)', dens: 1.21, notes: 'Flexible: per a peces delicades o amortir cops.' },
        'PETG-ESD': { nom: 'PETG-ESD (antiestàtic)', dens: 1.30, esd: true, notes: 'Dissipatiu: per a electrònica sensible.' },
        'PLA-CF': { nom: 'PLA amb fibra de carboni', dens: 1.29, notes: 'Rígid i lleuger; lleugerament conductor.' }
    };

    // Color de la caixa per tipus de material (esquema 'tipus')
    FO.COLOR_TIPUS = { peca: '#1E88E5', cargol: '#9E9E9E', consumible: '#FDD835', subconjunt: '#43A047' };

    // Color disponible més proper (distància RGB ponderada)
    FO.filamentProper = function (col, llista) {
        if (!llista || !llista.length) return col;
        const rgb = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
        const a = rgb(col);
        let millor = llista[0], dMin = Infinity;
        llista.forEach(c => {
            const b = rgb(c), rm = (a[0] + b[0]) / 2;
            const d = (2 + rm / 256) * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + (2 + (255 - rm) / 256) * (a[2] - b[2]) ** 2;
            if (d < dMin) { dMin = d; millor = c; }
        });
        return millor;
    };

    // Tipus de material
    FO.TIPUS = {
        peca: { nom: 'Peça', ico: '◼' },
        cargol: { nom: 'Cargoleria / petit material', ico: '⚙' },
        consumible: { nom: 'Consumible (coles, brides…)', ico: '✚' },
        subconjunt: { nom: 'Subconjunt muntat', ico: '▣' }
    };

    // Com es col·loquen les unitats dins el caixetí
    FO.DISPOSICIONS = {
        auto: 'Automàtica',
        individual: 'Individual (una cel·la per unitat)',
        apilat: 'Apilades',
        capa: 'En una sola capa',
        granel: 'A granel (amuntegades)'
    };

    FO.FORMES = { box: 'Prisma', cylinder: 'Cilindre' };

    // Paleta per assignar colors quan no n'hi ha
    FO.PALETA = ['#4A90D9', '#E8A838', '#4CAF50', '#9C27B0', '#E53935', '#00ACC1',
        '#FF7043', '#8D6E63', '#5C6BC0', '#C0CA33', '#EC407A', '#26A69A'];

    const num = (v, d) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : d; };
    const boo = v => v === true || /^(1|s|si|sí|y|yes|true|x|✓)$/i.test(String(v == null ? '' : v).trim());
    FO.num = num;
    FO.boo = boo;

    let seq = 0;
    FO.nouId = function (pref) { seq++; return pref + Date.now().toString(36) + seq.toString(36); };

    FO.normalitzaMaterial = function (m, i) {
        m = m || {};
        const tipus = FO.TIPUS[m.tipus] && m.tipus !== 'subconjunt' ? m.tipus : 'peca';
        return {
            id: String(m.id || FO.nouId('m')),
            codi: String(m.codi || m.id || ('MAT-' + (i + 1))).trim(),
            nom: String(m.nom || m.codi || 'Material').trim(),
            tipus,
            forma: FO.FORMES[m.forma] ? m.forma : 'box',
            x: Math.max(0.1, num(m.x, 10)),   // llarg (mm)
            y: Math.max(0.1, num(m.y, 10)),   // ample (mm)
            z: Math.max(0.1, num(m.z, 10)),   // alt (mm), en la posició natural de la peça
            pes: Math.max(0, num(m.pes, 0)),  // g per unitat
            col: /^#[0-9a-f]{6}$/i.test(m.col) ? m.col : FO.PALETA[(i || 0) % FO.PALETA.length],
            esd: boo(m.esd),                  // sensible a descàrregues electrostàtiques
            liquid: boo(m.liquid),            // conté fluids
            angleMax: Math.min(90, Math.max(0, num(m.angleMax, (boo(m.liquid) ? 0 : 90)))), // inclinació tolerada
            apilable: m.apilable === undefined ? true : boo(m.apilable),
            maxApilat: Math.max(0, Math.round(num(m.maxApilat, 0))), // 0 = sense límit
            fragil: Math.min(10, Math.max(0, Math.round(num(m.fragil, 0)))),
            disposicio: FO.DISPOSICIONS[m.disposicio] ? m.disposicio : 'auto',
            origen: m.origen === 'comprat' ? 'comprat' : 'propi',
            proveidor: String(m.proveidor || ''),
            caixaMaterial: FO.MATERIALS_IMPRESSIO[m.caixaMaterial] ? m.caixaMaterial : '',   // '' = per defecte
            caixaColor: /^#[0-9a-f]{6}$/i.test(m.caixaColor) ? m.caixaColor : '',            // '' = segons l'esquema
            // perfil de la cara de sota (des del seu STL) per fer un niu a mida; null = sense forma real
            niu: m.niu && m.niu.nx > 0 && m.niu.ny > 0 && Array.isArray(m.niu.h) && m.niu.h.length === m.niu.nx * m.niu.ny && m.niu.res > 0
                ? { res: +m.niu.res, nx: m.niu.nx | 0, ny: m.niu.ny | 0, h: m.niu.h.map(Number), fitxer: String(m.niu.fitxer || '') } : null,
            notes: String(m.notes || '')
        };
    };

    FO.normalitzaConjunt = function (c, i) {
        c = c || {};
        return {
            id: String(c.id || FO.nouId('c')),
            codi: String(c.codi || ('CJ-' + (i + 1))).trim(),
            nom: String(c.nom || c.codi || 'Conjunt').trim(),
            col: /^#[0-9a-f]{6}$/i.test(c.col) ? c.col : FO.PALETA[(i || 0) % FO.PALETA.length],
            pare: c.pare ? String(c.pare) : null,
            ordre: num(c.ordre, i || 0),
            qty: Math.max(1, Math.round(num(c.qty, 1))),   // unitats que en necessita el pare
            // Dades de la peça un cop muntada. Si hi són, el conjunt té caixa
            // d'emmagatzematge pròpia i entra com una peça al muntatge del pare.
            muntat: c.muntat && num(c.muntat.x, 0) > 0 && num(c.muntat.y, 0) > 0 && num(c.muntat.z, 0) > 0
                ? FO.normalitzaMaterial(Object.assign({}, c.muntat, { id: 'muntat', codi: c.codi || 'CJ', nom: c.nom, col: c.col, tipus: 'peca' }))
                : null,
            items: (Array.isArray(c.items) ? c.items : [])
                .filter(it => it && it.mat)
                .map(it => ({
                    mat: String(it.mat), qty: Math.max(1, Math.round(num(it.qty, 1))),
                    parell: Math.max(0, num(it.parell, 0)),   // parell de collada (N·m); 0 = no s'aplica
                    nota: String(it.nota || '')                // indicació de muntatge per a aquest element
                })),
            // Muntatge: instruccions (una per línia), eines i imatge de referència
            instruccions: String(c.instruccions || ''),
            eines: String(c.eines || ''),
            imatge: /^data:image\/(png|jpeg|webp);base64,/.test(c.imatge || '') || /^https?:\/\//.test(c.imatge || '') ? c.imatge : '',
            tancament: FO.TANCAMENTS[c.tancament] ? c.tancament : '',                             // '' = el del projecte
            formatKit: FO.FORMATS_KIT[c.formatKit] ? c.formatKit : '',                            // '' = el del projecte
            materialCaixa: FO.MATERIALS_IMPRESSIO[c.materialCaixa] ? c.materialCaixa : '',
            colorCaixa: /^#[0-9a-f]{6}$/i.test(c.colorCaixa) ? c.colorCaixa : '',
            materialContenidor: FO.MATERIALS_IMPRESSIO[c.materialContenidor] ? c.materialContenidor : '',
            colorContenidor: /^#[0-9a-f]{6}$/i.test(c.colorContenidor) ? c.colorContenidor : '',
            notes: String(c.notes || '')
        };
    };

    FO.normalitzaProjecte = function (p) {
        p = p || {};
        const cfg = Object.assign({}, FO.CONFIG_DEFECTE, p.config || {});
        cfg.llit = Object.assign({}, FO.CONFIG_DEFECTE.llit, (p.config || {}).llit || {});
        if (!FO.FORMATS_KIT[cfg.formatKit]) cfg.formatKit = FO.CONFIG_DEFECTE.formatKit;
        if (!FO.TANCAMENTS[cfg.tancament]) cfg.tancament = FO.CONFIG_DEFECTE.tancament;
        Object.keys(FO.RANGS).forEach(k => {
            const [a, b] = k.split('.');
            if (b) cfg[a][b] = FO.limita(k, num(cfg[a][b], FO.CONFIG_DEFECTE[a][b]));
            else cfg[k] = FO.limita(k, num(cfg[k], FO.CONFIG_DEFECTE[k]));
        });
        ['materialCaixa', 'materialESD', 'materialContenidor'].forEach(k => { if (!FO.MATERIALS_IMPRESSIO[cfg[k]]) cfg[k] = FO.CONFIG_DEFECTE[k]; });
        cfg.filaments = (Array.isArray(cfg.filaments) ? cfg.filaments : []).filter(c => /^#[0-9a-f]{6}$/i.test(c));
        const materials = (p.materials || []).map(FO.normalitzaMaterial);
        const conjunts = (p.conjunts || []).map(FO.normalitzaConjunt);
        const ids = new Set(conjunts.map(c => c.id));
        conjunts.forEach(c => { if (c.pare && !ids.has(c.pare)) c.pare = null; });
        // id estable: l'app de muntatge hi associa el progrés i l'estoc
        const revisions = (Array.isArray(p.revisions) ? p.revisions : []).slice(-30);
        return { v: FO.VERSIO, id: String(p.id || FO.nouId('p')), nom: String(p.nom || 'Projecte FOrdre'), config: cfg, materials, conjunts, revisions };
    };

    // Tancament efectiu d'un conjunt
    FO.tancamentDe = (conj, cfg) => (conj && conj.tancament) || cfg.tancament || 'cap';

    FO.nouProjecte = () => FO.normalitzaProjecte({});

    // Material virtual que representa un subconjunt ja muntat
    FO.materialMuntat = function (c) {
        if (!c.muntat) return null;
        return Object.assign({}, c.muntat, { id: 'CJ:' + c.id, codi: c.codi, nom: c.nom, col: c.col, tipus: 'subconjunt', conj: c.id });
    };

    // Quantes vegades cal muntar un conjunt per fer una màquina (producte de qty fins a l'arrel)
    FO.multiplicador = function (p, c) {
        let m = 1, guard = 0;
        while (c && c.pare && guard++ < 1000) { m *= c.qty; c = FO.conjunt(p, c.pare); }
        return m;
    };

    // ─── Consultes sobre l'arbre ───
    FO.material = (p, id) => p.materials.find(m => m.id === id) || null;
    FO.conjunt = (p, id) => p.conjunts.find(c => c.id === id) || null;
    FO.fills = (p, id) => p.conjunts.filter(c => c.pare === id).sort((a, b) => a.ordre - b.ordre);
    FO.arrels = p => FO.fills(p, null);

    // Evita cicles: un conjunt no pot penjar d'ell mateix ni d'un descendent
    FO.esDescendent = function (p, id, possibleAncestre) {
        let c = FO.conjunt(p, id), guard = 0;
        while (c && guard++ < 1000) { if (c.id === possibleAncestre) return true; c = c.pare ? FO.conjunt(p, c.pare) : null; }
        return false;
    };

    // Ordre de muntatge: post-ordre (primer els fills, després el pare)
    FO.ordreMuntatge = function (p) {
        const out = [], vist = new Set();
        const visita = (c, nivell) => {
            if (vist.has(c.id)) return; vist.add(c.id);
            FO.fills(p, c.id).forEach(f => visita(f, nivell + 1));
            out.push({ conj: c, nivell });
        };
        FO.arrels(p).forEach(r => visita(r, 0));
        p.conjunts.forEach(c => { if (!vist.has(c.id)) visita(c, 0); }); // cicles trencats
        out.forEach((o, i) => { o.pas = i + 1; });
        return out;
    };

    // Quantitat total de cada material a tota la màquina (per a compres)
    FO.totals = function (p) {
        const t = new Map();
        p.conjunts.forEach(c => { const k = FO.multiplicador(p, c); c.items.forEach(it => t.set(it.mat, (t.get(it.mat) || 0) + it.qty * k)); });
        return t;
    };

    FO.validaProjecte = function (p) {
        const av = [];
        const ids = new Set(p.materials.map(m => m.id));
        p.conjunts.forEach(c => {
            c.items.forEach(it => { if (!ids.has(it.mat)) av.push(`${c.codi}: material inexistent (${it.mat})`); });
            if (c.pare && FO.esDescendent(p, c.pare, c.id)) av.push(`${c.codi}: forma un cicle a l'arbre`);
        });
        const codis = new Map();
        p.materials.forEach(m => codis.set(m.codi, (codis.get(m.codi) || 0) + 1));
        codis.forEach((n, k) => { if (n > 1) av.push(`Codi de material repetit: ${k}`); });
        return av;
    };

    // ─── Projecte d'exemple ───
    FO.exemple = function () {
        // proveïdor d'exemple segons el prefix del codi (per a la llista de compra)
        const PROV = { 'MT': 'RS Components', 'CRG': 'Würth', 'FEM': 'Würth', 'VOL': 'Würth', 'SEP': 'Würth', 'HID': 'SMC', 'CON': 'Ferreteria local', 'PCB-101': 'Mouser' };
        const M = (codi, nom, tipus, x, y, z, pes, extra) => {
            const prov = PROV[codi] || PROV[codi.split('-')[0]];
            return Object.assign({ id: codi, codi, nom, tipus, x, y, z, pes }, prov ? { origen: 'comprat', proveidor: prov } : {}, extra || {});
        };
        return FO.normalitzaProjecte({
            id: 'exemple-dx1',
            nom: 'Dosificadora DX-1 (exemple)',
            materials: [
                M('PL-001', 'Placa base alumini 3 mm', 'peca', 180, 120, 3, 175, { col: '#9AA5B1', apilable: true }),
                M('PL-002', 'Escaire acer inox', 'peca', 40, 30, 25, 38, { col: '#B0BEC5' }),
                M('FV-010', 'Tapa fibra de vidre', 'peca', 150, 90, 12, 60, { col: '#E0D6A8', fragil: 6, apilable: false }),
                M('3D-021', 'Suport motor (PETG imprès)', 'peca', 55, 45, 30, 22, { col: '#FF7043' }),
                M('3D-022', 'Guia cable (PLA imprès)', 'peca', 60, 12, 10, 4, { col: '#26A69A', disposicio: 'capa' }),
                M('PCB-100', 'Placa de control', 'peca', 100, 70, 18, 55, { col: '#2E7D32', esd: true, fragil: 7, apilable: false }),
                M('PCB-101', 'Mòdul sensor de pressió', 'peca', 30, 20, 8, 6, { col: '#388E3C', esd: true, fragil: 6 }),
                M('MT-050', 'Motor pas a pas NEMA17', 'peca', 42, 42, 48, 280, { col: '#455A64', apilable: false }),
                M('HID-200', 'Mànega pressió 6 mm (tram)', 'peca', 120, 14, 14, 18, { col: '#1E88E5', disposicio: 'capa' }),
                M('HID-201', 'Racord ràpid 1/4"', 'cargol', 22, 14, 14, 9, { col: '#FBC02D' }),
                M('HID-210', 'Dipòsit d\'oli precarregat', 'peca', 40, 40, 70, 95, { col: '#6D4C41', forma: 'cylinder', liquid: true, angleMax: 10 }),
                M('CRG-M4x10', 'Cargol DIN912 M4×10', 'cargol', 10, 7, 7, 1.6, { col: '#78909C' }),
                M('CRG-M3x8', 'Cargol DIN7985 M3×8', 'cargol', 8, 6, 6, 0.8, { col: '#90A4AE' }),
                M('FEM-M4', 'Femella autoblocant M4', 'cargol', 7, 7, 5, 1.1, { col: '#607D8B' }),
                M('VOL-M4', 'Volandera DIN125 M4', 'cargol', 9, 9, 1, 0.3, { col: '#B0BEC5' }),
                M('SEP-M3', 'Separador M3×10 niló', 'cargol', 6, 6, 10, 0.2, { col: '#ECEFF1' }),
                M('CON-01', 'Frenafils Loctite 243 (10 ml)', 'consumible', 25, 25, 75, 18, { col: '#1565C0', forma: 'cylinder', liquid: true, angleMax: 30, caixaMaterial: 'PETG', caixaColor: '#FDD835' }),
                M('CON-02', 'Brides 100 mm', 'consumible', 100, 3, 1.2, 0.3, { col: '#212121' }),
                M('CON-03', 'Etiquetes de cable', 'consumible', 60, 40, 5, 10, { col: '#FFFFFF' }),
                M('CON-04', 'Cola epoxi bicomponent', 'consumible', 30, 20, 100, 30, { col: '#8E24AA', liquid: true, angleMax: 45 })
            ],
            conjunts: [
                { id: 'MAQ', codi: 'DX-1', nom: 'Dosificadora completa', col: '#4A90D9', ordre: 0 },
                {
                    id: 'XAS', codi: 'DX-1.1', nom: 'Xassís', pare: 'MAQ', ordre: 1, col: '#9AA5B1',
                    eines: 'Clau Allen 3 mm, clau dinamomètrica, clau fixa 7 mm',
                    instruccions: 'Presentar les dues plaques base i alinear els forats\nMuntar els 4 escaires amb cargol, volandera i femella\nFixar els 2 grups motor a la placa superior\nComprovar l\'escaire del conjunt abans del collat final',
                    items: [{ mat: 'PL-001', qty: 2 }, { mat: 'PL-002', qty: 4 }, { mat: 'CRG-M4x10', qty: 24, parell: 2.5 }, { mat: 'FEM-M4', qty: 16, parell: 2.5 }, { mat: 'VOL-M4', qty: 24 }, { mat: 'CON-01', qty: 1, nota: 'Una gota a cada cargol dels escaires' }]
                },
                {
                    id: 'MOT', codi: 'DX-1.1.1', nom: 'Grup motor', pare: 'XAS', ordre: 1, col: '#FF7043', qty: 2,
                    muntat: { x: 60, y: 50, z: 80, pes: 320, apilable: false, fragil: 3 },
                    eines: 'Clau Allen 2,5 mm',
                    instruccions: 'Encarar el motor al suport amb el connector cap enrere\nCollar els 4 cargols en creu',
                    items: [{ mat: 'MT-050', qty: 1 }, { mat: '3D-021', qty: 1 }, { mat: 'CRG-M3x8', qty: 4, parell: 1.2, nota: 'En creu, sense passar-se: el suport és de plàstic' }, { mat: 'CON-01', qty: 1 }]
                },
                {
                    id: 'ELE', codi: 'DX-1.2', nom: 'Electrònica de control', pare: 'MAQ', ordre: 2, col: '#2E7D32', formatKit: 'contenidor', tancament: 'imants',
                    muntat: { x: 110, y: 80, z: 35, pes: 90, esd: true, fragil: 7, apilable: false },
                    eines: 'Polsera antiestàtica, tornavís PH1, alicates de tall',
                    instruccions: 'Posar-se la polsera antiestàtica abans d\'obrir les caixes ESD\nMuntar els separadors a la placa de control\nConnectar els mòduls de pressió\nOrdenar el cablejat amb les guies i les brides\nEtiquetar tots els cables',
                    items: [{ mat: 'PCB-100', qty: 1, nota: 'Manipular només per les vores' }, { mat: 'PCB-101', qty: 2 }, { mat: 'SEP-M3', qty: 8 }, { mat: 'CRG-M3x8', qty: 8, parell: 0.6 }, { mat: '3D-022', qty: 6 }, { mat: 'CON-02', qty: 20 }, { mat: 'CON-03', qty: 1 }]
                },
                {
                    id: 'HID', codi: 'DX-1.3', nom: 'Circuit hidràulic', pare: 'MAQ', ordre: 3, col: '#1E88E5', materialCaixa: 'PETG', materialContenidor: 'PETG', tancament: 'pressio',
                    eines: 'Talla-tubs, clau fixa 14 mm',
                    instruccions: 'Tallar les mànegues a escaire\nEndollar els racords fins al tope\nOmplir el circuit des del dipòsit i purgar l\'aire\nProva d\'estanquitat a 6 bar durant 10 min',
                    items: [{ mat: 'HID-200', qty: 4 }, { mat: 'HID-201', qty: 8, parell: 8 }, { mat: 'HID-210', qty: 1, nota: 'Mantenir vertical' }, { mat: 'CON-02', qty: 10 }]
                },
                {
                    formatKit: 'fusionat', id: 'CAR', codi: 'DX-1.4', nom: 'Carcassa', pare: 'MAQ', ordre: 4, col: '#E0D6A8',
                    eines: 'Tornavís PH2, guants, espàtula',
                    instruccions: 'Preparar la cola epoxi (temps obert 5 min)\nEncolar els reforços de les tapes\nCollar les tapes al xassís',
                    items: [{ mat: 'FV-010', qty: 2, nota: 'Fràgil: no recolzar sobre les cantonades' }, { mat: 'CRG-M3x8', qty: 12, parell: 0.8 }, { mat: 'CON-04', qty: 1 }]
                }
            ]
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
