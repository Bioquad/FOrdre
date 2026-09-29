// ═══════════════════════════════════════════════════════════════
// FOrdre — Progrés del muntatge com a operacions
// ───────────────────────────────────────────────────────────────
// Cada canvi (agafar una caixa, marcar un pas, sumar estoc…) és una
// operació petita amb identificador únic. El mateix reductor l'aplica
// al mòbil, a l'ordinador i al servidor del taller, de manera que
// diversos aparells poden treballar alhora sense trepitjar-se:
//  · l'estoc es mou per increments (dues persones que sumen, sumen)
//  · cada operació s'aplica una sola vegada encara que arribi repetida
//  · el registre es genera a partir de les mateixes operacions
// Funciona al navegador i a Node (servidor).
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO || (G.FO = {});
    const MAX_VIST = 20000, MAX_REG = 5000;

    FO.progresBuit = () => ({ agafat: {}, instr: {}, fets: {}, estoc: {}, registre: [], fotos: {}, rev: 0, vist: [] });

    // Completa un progrés antic (versions anteriors, sense rev ni vist)
    FO.normalitzaProgres = function (p) {
        const b = FO.progresBuit();
        p = p && typeof p === 'object' ? p : {};
        Object.keys(b).forEach(k => { if (p[k] === undefined || p[k] === null || typeof p[k] !== typeof b[k] || Array.isArray(p[k]) !== Array.isArray(b[k])) p[k] = b[k]; });
        return p;
    };

    // Aplica una operació. Retorna true si s'ha aplicat (false si ja s'havia vist o és invàlida)
    FO.aplicaOp = function (p, o) {
        if (!o || !o.id || !o.t) return false;
        if (!p._vist) Object.defineProperty(p, '_vist', { value: new Set(p.vist), enumerable: false, writable: true });
        if (p._vist.has(o.id)) return false;
        const ts = o.ts || new Date().toISOString();
        switch (o.t) {
            case 'agafa':
                if (o.v) p.agafat[o.clau] = ts; else delete p.agafat[o.clau];
                break;
            case 'instr': {
                const a = p.instr[o.conj] || (p.instr[o.conj] = []);
                a[o.i] = !!o.v;
                break;
            }
            case 'fet':
                if (p.fets[o.conj]) return marca(p, o);           // ja estava muntat: no es torna a consumir
                Object.entries(o.consum || {}).forEach(([m, q]) => { p.estoc[m] = (p.estoc[m] || 0) - q; });
                p.fets[o.conj] = { ts, op: o.op || '', consum: o.consum || {} };
                break;
            case 'desfet': {
                const f = p.fets[o.conj];
                if (!f) return marca(p, o);
                Object.entries(f.consum || {}).forEach(([m, q]) => { p.estoc[m] = (p.estoc[m] || 0) + q; });
                delete p.fets[o.conj];
                break;
            }
            case 'estoc':
                p.estoc[o.mat] = (p.estoc[o.mat] || 0) + (Number(o.delta) || 0);
                break;
            case 'estocFix':
                p.estoc[o.mat] = Number(o.valor) || 0;
                break;
            case 'foto':
                (p.fotos[o.conj] || (p.fotos[o.conj] = [])).push({ fitxer: o.fitxer, ts, op: o.op || '' });
                break;
            case 'nota':
                break;
            default:
                return false;
        }
        if (o.text) {
            p.registre.push({ ts, op: o.op || '', tipus: o.t, text: o.text, disp: o.disp || '' });
            if (p.registre.length > MAX_REG) p.registre.splice(0, p.registre.length - MAX_REG);
        }
        return marca(p, o, true);
    };
    function marca(p, o, ok) {
        p._vist.add(o.id); p.vist.push(o.id);
        if (p.vist.length > MAX_VIST) { const fora = p.vist.splice(0, p.vist.length - MAX_VIST); fora.forEach(id => p._vist.delete(id)); }
        p.rev = (p.rev || 0) + 1;
        return !!ok;
    }

    // Identificador de dispositiu estable i generador d'operacions
    FO.nouDispositiu = () => 'd' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
    FO.creaOp = function (disp, comptador, t, dades, operari) {
        return Object.assign({ id: disp + '-' + comptador, t, ts: new Date().toISOString(), op: operari || '', disp }, dades);
    };
})(typeof window !== 'undefined' ? window : globalThis);
