// ═══════════════════════════════════════════════════════════════
// FOrdre — Idiomes: català, castellà i anglès
// ───────────────────────────────────────────────────────────────
// Tots els textos visibles passen per FO.t('text en català'). El català
// fa de clau: si una traducció no existeix, surt el text original (mai
// un buit). Els diccionaris són a js/fo-idiomes.js.
//
//   FO.t('Pas {n} de {total}', { n: 2, total: 6 })  →  «Paso 2 de 6»
//
// L'idioma es tria (per ordre): ?lang=es a l'adreça, l'última tria
// desada en aquest navegador, o l'idioma del navegador. En canviar-lo,
// la pàgina es torna a carregar perquè tot es pinti en el nou idioma.
// A Node (servidor i proves) l'idioma per defecte és el català, i cada
// crida pot demanar-ne un altre amb el tercer paràmetre.
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO || (G.FO = {});

    FO.IDIOMES = {
        ca: { nom: 'Català', curt: 'CA', locale: 'ca-ES' },
        es: { nom: 'Castellano', curt: 'ES', locale: 'es-ES' },
        en: { nom: 'English', curt: 'EN', locale: 'en-GB' }
    };
    FO.TRAD = FO.TRAD || { es: {}, en: {} };
    const CLAU = 'fordre.idioma';
    const navegador = typeof window !== 'undefined' && typeof document !== 'undefined';

    // Idioma inicial
    function detecta() {
        try {
            const q = new URLSearchParams(location.search).get('lang');
            if (q && FO.IDIOMES[q]) { localStorage.setItem(CLAU, q); return q; }
        } catch (e) { /* sense adreça o sense emmagatzematge */ }
        try {
            const d = localStorage.getItem(CLAU);
            if (d && FO.IDIOMES[d]) return d;
        } catch (e) { /* navegació privada */ }
        const llista = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']).map(l => String(l).slice(0, 2).toLowerCase());
        return llista.find(l => FO.IDIOMES[l]) || 'en';
    }
    let idioma = navegador ? detecta() : 'ca';
    if (navegador) document.documentElement.lang = idioma;

    FO.idioma = () => idioma;
    FO.locale = lang => FO.IDIOMES[lang || idioma].locale;
    // Canvia l'idioma i torna a carregar la pàgina (sense el ?lang de l'adreça)
    FO.canviaIdioma = function (l) {
        if (!FO.IDIOMES[l]) return;
        try { localStorage.setItem(CLAU, l); } catch (e) { /* */ }
        const u = new URL(location.href);
        if (u.searchParams.has('lang')) { u.searchParams.delete('lang'); location.replace(u.pathname + u.search + u.hash); }
        else location.reload();
    };

    // Omple els {marcadors} amb els valors
    const omple = (s, v) => v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m)) : String(s);

    // Tradueix un text (clau en català) a l'idioma actual o al que es demani
    FO.t = function (s, valors, lang) {
        const L = lang || idioma;
        const d = L !== 'ca' && FO.TRAD[L];
        return omple(d && d[s] != null ? d[s] : s, valors);
    };

    // Tradueix un missatge que ja porta els valors posats (per exemple, un error del
    // servidor, que sempre respon en català): primer exacte, després per plantilla.
    let plantilles = null;
    FO.tMissatge = function (s, lang) {
        const L = lang || idioma;
        s = String(s == null ? '' : s);
        const d = FO.TRAD[L];
        if (L === 'ca' || !d) return s;
        if (d[s] != null) return d[s];
        if (!plantilles) {
            // Només plantilles amb prou text fix (evita que «{a} de {b}» s'apliqui a qualsevol cosa),
            // i les més llargues primer (són les més concretes)
            const fix = k => k.replace(/\{\w+\}/g, '').replace(/[^\p{L}]/gu, '').length;
            plantilles = Object.keys(FO.TRAD.es).concat(Object.keys(FO.TRAD.en))
                .filter((k, i, a) => k.includes('{') && a.indexOf(k) === i && fix(k) >= 4)
                .sort((a, b) => fix(b) - fix(a))
                .map(k => {
                    const noms = [];
                    const re = new RegExp('^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{(\w+)\\?\}/g, (m, n) => { noms.push(n); return '(.+?)'; }) + '$');
                    return { k, re, noms };
                });
        }
        for (const p of plantilles) {
            const m = p.re.exec(s);
            if (m) {
                const v = {};
                p.noms.forEach((n, i) => { v[n] = FO.tMissatge(m[i + 1], L); });
                return FO.t(p.k, v, L);
            }
        }
        return s;
    };

    // Tradueix els textos fixos de l'HTML marcats amb data-t (contingut) i
    // data-t-title / data-t-placeholder / data-t-aria-label (atributs)
    FO.traduiexDOM = function (arrel) {
        if (idioma === 'ca' || !navegador) return;
        (arrel || document).querySelectorAll('[data-t]').forEach(el => {
            const k = el.getAttribute('data-t') || el.innerHTML.trim();
            el.setAttribute('data-t', k);
            el.innerHTML = FO.t(k);
        });
        ['title', 'placeholder', 'aria-label'].forEach(a => {
            (arrel || document).querySelectorAll(`[data-t-${a}]`).forEach(el => {
                const k = el.getAttribute(`data-t-${a}`) || el.getAttribute(a) || '';
                el.setAttribute(`data-t-${a}`, k);
                el.setAttribute(a, FO.t(k));
            });
        });
        const tit = document.querySelector('title');
        if (tit) tit.textContent = FO.t(tit.textContent);
    };

    // Selector d'idioma (HTML) per posar a qualsevol lloc: <select data-idioma>.
    // `curt`: només «CA / ES / EN» (per a barres d'eines estretes)
    FO.selectorIdioma = (cls, curt) => `<select class="${cls || ''}" data-idioma aria-label="Idioma · Idioma · Language" title="Idioma · Idioma · Language">${Object.entries(FO.IDIOMES).map(([k, x]) => `<option value="${k}"${k === idioma ? ' selected' : ''}>${curt ? x.curt : x.curt + ' · ' + x.nom}</option>`).join('')}</select>`;
    FO.activaSelectorsIdioma = function (arrel) {
        (arrel || document).querySelectorAll('select[data-idioma]').forEach(s => { s.onchange = () => FO.canviaIdioma(s.value); });
    };
})(typeof window !== 'undefined' ? window : globalThis);
