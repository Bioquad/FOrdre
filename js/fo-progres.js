// ═══════════════════════════════════════════════════════════════
// FOrdre — Processos del taller: operacions, rols, permisos i estats
// ───────────────────────────────────────────────────────────────
// Tot el que passa al taller és una OPERACIÓ petita amb identificador únic
// (omplir una caixa, agafar-la, començar un pas, muntar-lo, verificar-lo…).
// El mateix reductor (FO.aplicaOp) s'executa al mòbil, a l'ordinador i al
// servidor, de manera que diversos aparells poden treballar alhora:
//  · cada operació s'aplica una sola vegada, encara que arribi repetida;
//  · l'estoc es mou per increments (dues persones que sumen, sumen);
//  · el registre de traçabilitat surt de les mateixes operacions.
//
// El progrés és per ORDRE DE FABRICACIÓ: cada unitat que es fabrica té el
// seu progrés propi, i el projecte fa de plantilla reutilitzable.
//
// Processos i rols:
//   Omplir      → Magatzem     (posar el material a les caixes; surt de l'estoc;
//                               el que no ha arribat queda com a MANCANT)
//   Utilitzar   → Muntador     (agafar caixes, començar, muntar, tornar caixes;
//                               si falten peces, es munta la resta i es completa després)
//   Comprovar   → Qualitat     (verificar: aprovar o rebutjar amb motiu;
//                               decidir què es fa amb les peces DEFECTUOSES)
//   Gestionar   → Responsable  (assignar, incidències, tancar l'ordre)
//   Resultats   → tothom en pot consultar; l'informe el fa js/fo-informe.js
// Funciona al navegador i a Node (servidor).
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO || (G.FO = {});
    const t = (s, v) => (FO.t ? FO.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)));   // textos visibles: js/fo-i18n.js (al servidor, sempre en català)
    const MAX_VIST = 20000, MAX_REG = 5000;

    // ─── Rols ───
    FO.ROLS = {
        magatzem: { nom: t('Magatzem'), ico: '📦', desc: t('Omple les caixes amb el material i porta l\'estoc.') },
        muntador: { nom: t('Muntador'), ico: '🔧', desc: t('Agafa les caixes, munta els conjunts i torna les caixes buides.') },
        qualitat: { nom: t('Qualitat'), ico: '✅', desc: t('Verifica els passos muntats: aprova o rebutja amb motiu.') },
        responsable: { nom: t('Responsable'), ico: '📋', desc: t('Organitza la feina, resol incidències, gestiona persones i ordres.') }
    };

    // Qui pot fer cada operació (el Responsable ho pot fer tot)
    FO.PERMISOS = {
        omple: ['magatzem'], buida: ['magatzem'], manca: ['magatzem'], estoc: ['magatzem'], estocFix: ['magatzem'],
        agafa: ['muntador'], inicia: ['muntador'], instr: ['muntador'], fet: ['muntador'], desfet: ['muntador'], completa: ['muntador'],
        retorna: ['magatzem', 'muntador'],
        verifica: ['qualitat'], resol: ['qualitat'], decideix: ['qualitat'],
        defecte: ['magatzem', 'muntador', 'qualitat'],
        assigna: [], tanca: [], reobre: [],
        incidencia: ['magatzem', 'muntador', 'qualitat'], foto: ['magatzem', 'muntador', 'qualitat'], nota: ['magatzem', 'muntador', 'qualitat']
    };
    FO.potFer = (rols, t) => {
        rols = [].concat(rols || []);
        return rols.includes('responsable') || (FO.PERMISOS[t] || []).some(r => rols.includes(r));
    };

    // ─── Estats derivats ───
    FO.ESTATS_PAS = {
        pendent: { nom: t('Pendent'), col: '#8888A0' },
        preparat: { nom: t('Preparat'), col: '#E8A838' },
        'en curs': { nom: t('En curs'), col: '#4A90D9' },
        parcial: { nom: t('Muntat amb mancants'), col: '#F57C00' },
        muntat: { nom: t('Muntat'), col: '#7E57C2' },
        rebutjat: { nom: t('Rebutjat'), col: '#E53935' },
        verificat: { nom: t('Verificat'), col: '#43A047' }
    };
    FO.ESTATS_CAIXA = {
        buida: { nom: t('Buida'), col: '#8888A0' },
        parcial: { nom: t('Omplint-se'), col: '#E8A838' },
        mancant: { nom: t('Amb mancants'), col: '#F57C00' },
        plena: { nom: t('Plena'), col: '#4A90D9' },
        'en ús': { nom: t('En ús'), col: '#7E57C2' },
        retornada: { nom: t('Retornada'), col: '#43A047' }
    };

    FO.progresBuit = () => ({
        agafat: {}, instr: {}, fets: {}, estoc: {}, registre: [], fotos: {},
        omplert: {},        // clau de caixetí → { qty, mat, ts, op }
        mancants: {},       // clau de caixetí → { mat, falten, inicial, nota, ts, op, resolt: null | { ts, op } }
        defectes: [],       // peces defectuoses o trencades: { id, clau, mat, conj, qty, origen, tipus, descripcio, ts, op, decisio }
        retornat: {},       // id de caixa / safata → { ts, op }
        inicis: {},         // conjunt → { ts, op } (inici del muntatge, per mesurar el temps)
        verificacions: {},  // conjunt → { resultat: 'ok'|'ko', motiu, checks, ts, op }
        historial: [],      // rebutjos anteriors: { conj, motiu, ts, op }
        incidencies: [],    // { id, conj, clau, text, gravetat, ts, op, resolta }
        assignacions: {},   // conjunt → nom de la persona
        tancada: null,      // { ts, op } quan el Responsable tanca l'ordre
        rev: 0, vist: []
    });

    // Completa un progrés d'una versió anterior amb els camps que li falten
    FO.normalitzaProgres = function (p) {
        const b = FO.progresBuit();
        p = p && typeof p === 'object' ? p : {};
        Object.keys(b).forEach(k => {
            const buit = b[k];
            const tipusDiferent = buit !== null && (p[k] === undefined || p[k] === null || typeof p[k] !== typeof buit || Array.isArray(p[k]) !== Array.isArray(buit));
            if (tipusDiferent || (buit === null && p[k] === undefined)) p[k] = buit;
        });
        return p;
    };

    // Estat d'un pas (conjunt). `preparat`: si totes les seves caixes estan agafades
    FO.estatPas = function (p, conj, preparat) {
        const v = p.verificacions[conj], f = p.fets[conj];
        if (f && f.pendents && f.pendents.length) return 'parcial';   // muntat, però hi falten peces
        if (f) return v && v.resultat === 'ok' ? 'verificat' : 'muntat';
        if (v && v.resultat === 'ko') return 'rebutjat';
        if (p.inicis[conj]) return 'en curs';
        return preparat ? 'preparat' : 'pendent';
    };

    // Estat d'una caixa a partir de les claus dels seus caixetins
    FO.estatCaixa = function (p, obj, claus) {
        if (p.retornat[obj]) return 'retornada';
        if (!claus.length) return 'buida';
        if (claus.every(k => p.agafat[k])) return 'en ús';
        if (claus.some(k => FO.esMancant(p, k))) return 'mancant';
        const n = claus.filter(k => p.omplert[k]).length;
        return n === claus.length ? 'plena' : n ? 'parcial' : 'buida';
    };

    // ─── Mancants ───
    // Un caixetí té un mancant obert si hi falta material que encara no ha arribat
    FO.esMancant = (p, clau) => !!(p.mancants && p.mancants[clau] && !p.mancants[clau].resolt);
    FO.mancantsOberts = p => Object.entries(p.mancants || {}).filter(([, m]) => !m.resolt).map(([clau, m]) => Object.assign({ clau }, m));
    // Obre, actualitza o resol el mancant d'un caixetí segons quantes peces hi falten
    function actualitzaMancant(p, clau, mat, falten, ts, qui, nota) {
        // (les notes es desen tal com arriben; la interfície les tradueix en mostrar-les)
        const ant = p.mancants[clau], obert = ant && !ant.resolt;
        if (falten > 0) {
            p.mancants[clau] = {
                mat: mat || (ant && ant.mat) || '', falten,
                inicial: obert ? Math.max(ant.inicial || 0, falten) : falten,
                nota: nota != null && nota !== '' ? nota : obert ? ant.nota : '',
                ts: obert ? ant.ts : ts, op: obert ? ant.op : qui, resolt: null
            };
        } else if (obert) {
            ant.falten = 0; ant.resolt = { ts, op: qui };   // ja ha arribat tot
        }
    }

    // ─── Peces defectuoses ───
    // origen: 'arribada' (ja venia malament: és del proveïdor) o 'muntatge' (s'ha trencat o fet malbé al taller)
    FO.ORIGENS_DEFECTE = {
        arribada: { nom: t('Venia defectuosa'), ico: '📦' },
        muntatge: { nom: t('Trencada en muntar'), ico: '🔧' }
    };
    // Es desen en català (fan de clau) i es mostren amb FO.t(): així el registre es llegeix en l'idioma de cadascú
    FO.TIPUS_DEFECTE = ['Trencada', 'Mal fabricada / fora de mesura', 'Danyada en el transport', 'Peça equivocada', 'Ratllada o amb cops', 'Altres'];
    // Què se'n fa (ho decideix Qualitat)
    FO.DECISIONS_DEFECTE = {
        retorn: { nom: t('Retornar al proveïdor'), ico: '↩' },
        ferralla: { nom: t('Ferralla'), ico: '🗑' },
        reparar: { nom: t('Reparar / recuperar'), ico: '🛠' },
        acceptada: { nom: t('Acceptar tal com està'), ico: '✓' }
    };
    FO.defectesPendents = p => (p.defectes || []).filter(d => !d.decisio);

    // ─── Validació (regles del procés) ───
    // Retorna el motiu pel qual una operació no es pot fer, o '' si és correcta.
    // `usuari` = { nom, rols }; si no se sap (aparell sol), no es comproven permisos.
    FO.validaOp = function (p, o, usuari, opcions) {
        opcions = Object.assign({ quatreUlls: true }, opcions || {});
        if (p.tancada && !['reobre', 'nota'].includes(o.t)) return t('L\'ordre està tancada');
        if (usuari && !FO.potFer(usuari.rols, o.t)) return t('El teu rol no permet aquesta acció ({accio})', { accio: o.t });
        if (o.t === 'verifica') {
            const f = p.fets[o.conj];
            if (!f) return t('Aquest pas encara no està muntat');
            if (opcions.quatreUlls && usuari && f.op && f.op === usuari.nom && !usuari.rols.includes('responsable'))
                return t('No pots verificar un pas que has muntat tu: ho ha de fer una altra persona');
            if (o.resultat === 'ko' && !String(o.motiu || '').trim()) return t('Per rebutjar cal indicar el motiu');
            if (o.resultat !== 'ko' && f.pendents && f.pendents.length) return t('Hi falten peces (mancants): no es pot aprovar fins que el pas estigui complet');
        }
        if (o.t === 'manca' && !(Number(o.falten) >= 0)) return t('Cal indicar quantes peces falten');
        if (o.t === 'defecte' && (!o.clau || !(Number(o.qty) > 0))) return t('Cal indicar la peça i quantes són defectuoses');
        if (o.t === 'decideix') {
            const d = p.defectes.find(x => x.id === o.def);
            if (!d) return t('Aquesta peça defectuosa no existeix');
            if (!FO.DECISIONS_DEFECTE[o.decisio]) return t('Decisió desconeguda');
        }
        if (o.t === 'completa' && !p.fets[o.conj]) return t('Aquest pas encara no està muntat');
        if (o.t === 'omple' && !(Number(o.qty) > 0)) return t('Cal una quantitat');
        return '';
    };

    // ─── Reductor ───
    // Aplica una operació. Retorna true si s'ha aplicat (false si ja s'havia vist o és invàlida)
    FO.aplicaOp = function (p, o) {
        if (!o || !o.id || !o.t) return false;
        if (!p._vist) Object.defineProperty(p, '_vist', { value: new Set(p.vist), enumerable: false, writable: true });
        if (p._vist.has(o.id)) return false;
        const ts = o.ts || new Date().toISOString(), qui = o.op || '';
        switch (o.t) {
            // — Omplir (Magatzem) —
            case 'omple': {
                const ant = p.omplert[o.clau], q = Number(o.qty) || 0;
                if (o.mat) p.estoc[o.mat] = (p.estoc[o.mat] || 0) - (q - (ant ? ant.qty : 0));   // el material surt del magatzem
                p.omplert[o.clau] = { qty: q, mat: o.mat || '', ts, op: qui };
                // `cal` = quantitat que hi ha d'anar: si n'hi ha menys, la resta queda com a mancant
                if (o.cal != null) actualitzaMancant(p, o.clau, o.mat, Number(o.cal) - q, ts, qui);
                break;
            }
            case 'manca':
                // el material no ha arribat (o no n'hi ha prou): es marca sense aturar la feina
                actualitzaMancant(p, o.clau, o.mat, Number(o.falten) || 0, ts, qui, o.nota);
                break;
            case 'buida': {
                const ant = p.omplert[o.clau];
                if (!ant) return marca(p, o);
                if (ant.mat) p.estoc[ant.mat] = (p.estoc[ant.mat] || 0) + ant.qty;             // torna al magatzem
                delete p.omplert[o.clau];
                break;
            }
            case 'retorna':
                p.retornat[o.obj] = { ts, op: qui };
                break;
            // — Utilitzar (Muntador) —
            case 'agafa':
                if (o.v) p.agafat[o.clau] = ts; else delete p.agafat[o.clau];
                break;
            case 'inicia':
                p.inicis[o.conj] = { ts, op: qui };
                break;
            case 'instr': {
                const a = p.instr[o.conj] || (p.instr[o.conj] = []);
                a[o.i] = !!o.v;
                break;
            }
            case 'fet':
                if (p.fets[o.conj]) return marca(p, o);           // ja estava muntat: no es torna a consumir
                Object.entries(o.consum || {}).forEach(([m, q]) => { p.estoc[m] = (p.estoc[m] || 0) - q; });
                // `pendents`: peces que no s'han pogut posar perquè falten; el pas es completarà quan arribin
                p.fets[o.conj] = { ts, op: qui, consum: o.consum || {}, pendents: Array.isArray(o.pendents) ? o.pendents : [] };
                if (!p.inicis[o.conj]) p.inicis[o.conj] = { ts, op: qui };
                delete p.verificacions[o.conj];                   // un pas refet s'ha de tornar a verificar
                break;
            case 'desfet': {
                const f = p.fets[o.conj];
                if (!f) return marca(p, o);
                Object.entries(f.consum || {}).forEach(([m, q]) => { p.estoc[m] = (p.estoc[m] || 0) + q; });
                delete p.fets[o.conj];
                delete p.verificacions[o.conj];
                break;
            }
            case 'defecte': {
                // Una peça defectuosa o trencada: es registra i en calen de noves (mancant del mateix caixetí).
                // El taller no s'atura: el pas es pot muntar amb la resta i es completa quan arriba el recanvi.
                const q = Math.max(1, Math.round(Number(o.qty)) || 1);
                p.defectes.push({ id: o.id, clau: o.clau, mat: o.mat || '', conj: o.conj || '', qty: q, origen: o.origen === 'muntatge' ? 'muntatge' : 'arribada', tipus: o.tipus || '', descripcio: o.descripcio || '', ts, op: qui, decisio: null });
                // les peces dolentes surten de la caixa (no tornen a l'estoc: no serveixen)
                const om = p.omplert[o.clau];
                if (om) om.qty = Math.max(0, om.qty - q);
                const ant = p.mancants[o.clau];
                actualitzaMancant(p, o.clau, o.mat, (ant && !ant.resolt ? ant.falten : 0) + q, ts, qui, `Recanvi de ${q} (${o.tipus || 'defectuosa'})`);
                // si el pas ja estava muntat, torna a quedar pendent d'aquesta peça (i s'haurà de tornar a verificar)
                const f = o.conj && p.fets[o.conj];
                if (f) {
                    const pe = (f.pendents || (f.pendents = [])).find(x => x.clau === o.clau);
                    if (pe) pe.qty += q; else f.pendents.push({ clau: o.clau, mat: o.mat || '', qty: q });
                    delete f.completat;
                    delete p.verificacions[o.conj];
                }
                break;
            }
            case 'decideix': {
                const d = p.defectes.find(x => x.id === o.def);
                if (d) d.decisio = { tipus: o.decisio, nota: o.nota || '', ts, op: qui };
                break;
            }
            case 'completa': {
                // s'han posat les peces que faltaven (totes, o només les claus indicades)
                const f = p.fets[o.conj];
                if (!f) return marca(p, o);
                f.pendents = o.claus ? (f.pendents || []).filter(x => !o.claus.includes(x.clau)) : [];
                if (!f.pendents.length) f.completat = { ts, op: qui };
                break;
            }
            // — Comprovar (Qualitat) —
            case 'verifica':
                p.verificacions[o.conj] = { resultat: o.resultat === 'ko' ? 'ko' : 'ok', motiu: o.motiu || '', checks: o.checks || [], ts, op: qui };
                if (o.resultat === 'ko') {
                    // rebutjat: torna al muntador, que l'haurà de refer
                    p.historial.push({ conj: o.conj, motiu: o.motiu || '', ts, op: qui, muntador: p.fets[o.conj] ? p.fets[o.conj].op : '' });
                    delete p.fets[o.conj];
                    delete p.inicis[o.conj];
                }
                break;
            // — Gestionar —
            case 'incidencia':
                p.incidencies.push({ id: o.id, conj: o.conj || '', clau: o.clau || '', text: o.textInc || '', gravetat: o.gravetat || 'mitjana', ts, op: qui, resolta: null });
                break;
            case 'resol': {
                const inc = p.incidencies.find(i => i.id === o.inc);
                if (inc) inc.resolta = { ts, op: qui, text: o.solucio || '' };
                break;
            }
            case 'assigna':
                if (o.persona) p.assignacions[o.conj] = o.persona; else delete p.assignacions[o.conj];
                break;
            case 'tanca':
                p.tancada = { ts, op: qui };
                break;
            case 'reobre':
                p.tancada = null;
                break;
            // — Estoc —
            case 'estoc':
                p.estoc[o.mat] = (p.estoc[o.mat] || 0) + (Number(o.delta) || 0);
                break;
            case 'estocFix':
                p.estoc[o.mat] = Number(o.valor) || 0;
                break;
            // — Documentació —
            case 'foto':
                (p.fotos[o.conj] || (p.fotos[o.conj] = [])).push({ fitxer: o.fitxer, ts, op: qui });
                break;
            case 'nota':
                break;
            default:
                return false;
        }
        if (o.text) {
            p.registre.push({ ts, op: qui, rol: o.rol || '', tipus: o.t, text: o.text, disp: o.disp || '' });
            if (p.registre.length > MAX_REG) p.registre.splice(0, p.registre.length - MAX_REG);
        }
        return marca(p, o, true);
    };
    // Recorda l'operació com a vista (per no aplicar-la dues vegades) i avança la revisió
    function marca(p, o, ok) {
        p._vist.add(o.id); p.vist.push(o.id);
        if (p.vist.length > MAX_VIST) { const fora = p.vist.splice(0, p.vist.length - MAX_VIST); fora.forEach(id => p._vist.delete(id)); }
        p.rev = (p.rev || 0) + 1;
        return !!ok;
    }

    // ─── Identitat de l'aparell i creació d'operacions ───
    FO.nouDispositiu = () => 'd' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
    FO.creaOp = function (disp, comptador, t, dades, operari, rol) {
        return Object.assign({ id: disp + '-' + comptador, t, ts: new Date().toISOString(), op: operari || '', rol: rol || '', disp }, dades);
    };

    // ─── Ordres de fabricació ───
    // Codi següent: OF-AAAA-001, OF-AAAA-002… segons les que ja existeixen
    FO.codiOrdreSeguent = function (ordres) {
        const any = new Date().getFullYear();
        const n = (ordres || []).map(o => (/^OF-(\d{4})-(\d+)$/.exec(o.codi) || [])).filter(m => +m[1] === any).map(m => +m[2]);
        return `OF-${any}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0')}`;
    };
})(typeof window !== 'undefined' ? window : globalThis);
