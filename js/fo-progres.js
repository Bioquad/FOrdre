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
//   Omplir      → Magatzem     (posar el material a les caixes; surt de l'estoc)
//   Utilitzar   → Muntador     (agafar caixes, començar, muntar, tornar caixes)
//   Comprovar   → Qualitat     (verificar: aprovar o rebutjar amb motiu)
//   Gestionar   → Responsable  (assignar, incidències, tancar l'ordre)
//   Resultats   → tothom en pot consultar; l'informe el fa js/fo-informe.js
// Funciona al navegador i a Node (servidor).
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO || (G.FO = {});
    const MAX_VIST = 20000, MAX_REG = 5000;

    // ─── Rols ───
    FO.ROLS = {
        magatzem: { nom: 'Magatzem', ico: '📦', desc: 'Omple les caixes amb el material i porta l\'estoc.' },
        muntador: { nom: 'Muntador', ico: '🔧', desc: 'Agafa les caixes, munta els conjunts i torna les caixes buides.' },
        qualitat: { nom: 'Qualitat', ico: '✅', desc: 'Verifica els passos muntats: aprova o rebutja amb motiu.' },
        responsable: { nom: 'Responsable', ico: '📋', desc: 'Organitza la feina, resol incidències, gestiona persones i ordres.' }
    };

    // Qui pot fer cada operació (el Responsable ho pot fer tot)
    FO.PERMISOS = {
        omple: ['magatzem'], buida: ['magatzem'], estoc: ['magatzem'], estocFix: ['magatzem'],
        agafa: ['muntador'], inicia: ['muntador'], instr: ['muntador'], fet: ['muntador'], desfet: ['muntador'],
        retorna: ['magatzem', 'muntador'],
        verifica: ['qualitat'], resol: ['qualitat'],
        assigna: [], tanca: [], reobre: [],
        incidencia: ['magatzem', 'muntador', 'qualitat'], foto: ['magatzem', 'muntador', 'qualitat'], nota: ['magatzem', 'muntador', 'qualitat']
    };
    FO.potFer = (rols, t) => {
        rols = [].concat(rols || []);
        return rols.includes('responsable') || (FO.PERMISOS[t] || []).some(r => rols.includes(r));
    };

    // ─── Estats derivats ───
    FO.ESTATS_PAS = {
        pendent: { nom: 'Pendent', col: '#8888A0' },
        preparat: { nom: 'Preparat', col: '#E8A838' },
        'en curs': { nom: 'En curs', col: '#4A90D9' },
        muntat: { nom: 'Muntat', col: '#7E57C2' },
        rebutjat: { nom: 'Rebutjat', col: '#E53935' },
        verificat: { nom: 'Verificat', col: '#43A047' }
    };
    FO.ESTATS_CAIXA = {
        buida: { nom: 'Buida', col: '#8888A0' },
        parcial: { nom: 'Omplint-se', col: '#E8A838' },
        plena: { nom: 'Plena', col: '#4A90D9' },
        'en ús': { nom: 'En ús', col: '#7E57C2' },
        retornada: { nom: 'Retornada', col: '#43A047' }
    };

    FO.progresBuit = () => ({
        agafat: {}, instr: {}, fets: {}, estoc: {}, registre: [], fotos: {},
        omplert: {},        // clau de caixetí → { qty, mat, ts, op }
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
        const v = p.verificacions[conj];
        if (p.fets[conj]) return v && v.resultat === 'ok' ? 'verificat' : 'muntat';
        if (v && v.resultat === 'ko') return 'rebutjat';
        if (p.inicis[conj]) return 'en curs';
        return preparat ? 'preparat' : 'pendent';
    };

    // Estat d'una caixa a partir de les claus dels seus caixetins
    FO.estatCaixa = function (p, obj, claus) {
        if (p.retornat[obj]) return 'retornada';
        if (!claus.length) return 'buida';
        if (claus.every(k => p.agafat[k])) return 'en ús';
        const n = claus.filter(k => p.omplert[k]).length;
        return n === claus.length ? 'plena' : n ? 'parcial' : 'buida';
    };

    // ─── Validació (regles del procés) ───
    // Retorna el motiu pel qual una operació no es pot fer, o '' si és correcta.
    // `usuari` = { nom, rols }; si no se sap (aparell sol), no es comproven permisos.
    FO.validaOp = function (p, o, usuari, opcions) {
        opcions = Object.assign({ quatreUlls: true }, opcions || {});
        if (p.tancada && !['reobre', 'nota'].includes(o.t)) return 'L\'ordre està tancada';
        if (usuari && !FO.potFer(usuari.rols, o.t)) return `El teu rol no permet aquesta acció (${o.t})`;
        if (o.t === 'verifica') {
            const f = p.fets[o.conj];
            if (!f) return 'Aquest pas encara no està muntat';
            if (opcions.quatreUlls && usuari && f.op && f.op === usuari.nom && !usuari.rols.includes('responsable'))
                return 'No pots verificar un pas que has muntat tu: ho ha de fer una altra persona';
            if (o.resultat === 'ko' && !String(o.motiu || '').trim()) return 'Per rebutjar cal indicar el motiu';
        }
        if (o.t === 'omple' && !(Number(o.qty) > 0)) return 'Cal una quantitat';
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
                break;
            }
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
                p.fets[o.conj] = { ts, op: qui, consum: o.consum || {} };
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
