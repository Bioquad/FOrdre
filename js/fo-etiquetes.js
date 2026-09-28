// ═══════════════════════════════════════════════════════════════
// FOrdre — Etiquetes: formats, QR, codi de barres, RFID/NFC
// ───────────────────────────────────────────────────────────────
// Cada caixetí porta una etiqueta amb el codi del material, el nom,
// la quantitat, el conjunt i el pas de muntatge. El contingut s'adapta
// a la mida: completa, compacta o mínima. Les cintes (Brother, Dymo…)
// tenen alçada fixa i la llargada s'ajusta a l'amplada del caixetí.
// El QR i la memòria RFID/NFC porten el mateix text de dades.
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO || (G.FO = {});

    // w = null → cinta contínua (llargada automàtica)
    FO.FORMATS_ETIQUETA = {
        cinta9: { nom: 'Cinta 9 mm', w: null, h: 9 },
        cinta12: { nom: 'Cinta 12 mm', w: null, h: 12 },
        cinta18: { nom: 'Cinta 18 mm', w: null, h: 18 },
        cinta24: { nom: 'Cinta 24 mm', w: null, h: 24 },
        rotlle62: { nom: 'Rotlle tèrmic 62 × 29 mm', w: 62, h: 29 },
        rotlle50: { nom: 'Rotlle tèrmic 50 × 25 mm', w: 50, h: 25 },
        rotlle40: { nom: 'Rotlle tèrmic 40 × 20 mm', w: 40, h: 20 },
        a4_70x37: { nom: 'A4 · 70 × 37 mm (3 × 8)', w: 70, h: 37, full: { cols: 3, files: 8, mx: 0, my: 0.5, gx: 0, gy: 0 } },
        a4_48x25: { nom: 'A4 · 48,5 × 25,4 mm (4 × 11)', w: 48.5, h: 25.4, full: { cols: 4, files: 11, mx: 8, my: 8.8, gx: 0, gy: 0 } },
        a4_38x21: { nom: 'A4 · 38 × 21,2 mm (5 × 13)', w: 38, h: 21.2, full: { cols: 5, files: 13, mx: 10, my: 10.7, gx: 0, gy: 0 } },
        a4_25x10: { nom: 'A4 · 25,4 × 10 mm (7 × 27)', w: 25.4, h: 10, full: { cols: 7, files: 27, mx: 8.5, my: 13.5, gx: 2.5, gy: 0 } },
        mida: { nom: 'A mida…', w: 40, h: 15 }
    };

    // ─── Code 128 (joc B) ───
    const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
    // Retorna una llista d'amplades de barres i espais (en mòduls), començant per barra
    FO.code128 = function (text) {
        const t = String(text).replace(/[^\x20-\x7e]/g, '?');
        const codis = [104];
        for (const ch of t) codis.push(ch.charCodeAt(0) - 32);
        let suma = 104;
        for (let i = 1; i < codis.length; i++) suma += codis[i] * i;
        codis.push(suma % 103, 106);
        return codis.map(c => C128[c]).join('').split('').map(Number);
    };

    function svgBarres(text, x, y, w, h) {
        const m = FO.code128(text);
        const moduls = m.reduce((a, b) => a + b, 0) + 20; // zona de silenci
        const u = w / moduls;
        let cx = x + 10 * u, out = '';
        m.forEach((v, i) => { if (i % 2 === 0) out += `<rect x="${(cx).toFixed(3)}" y="${y}" width="${(v * u).toFixed(3)}" height="${h}"/>`; cx += v * u; });
        return { svg: out, modul: u };
    }

    // ─── QR (llibreria qrcode-generator, si està carregada) ───
    function svgQR(text, x, y, mida) {
        if (typeof G.qrcode !== 'function') return '';
        try {
            const q = G.qrcode(0, 'M'); q.addData(unescape(encodeURIComponent(text))); q.make();
            const n = q.getModuleCount(), u = mida / n;
            let d = '';
            for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${(x + c * u).toFixed(3)} ${(y + r * u).toFixed(3)}h${u.toFixed(3)}v${u.toFixed(3)}h-${u.toFixed(3)}z`;
            return `<path d="${d}" fill="#000"/>`;
        } catch (e) { return ''; }
    }
    FO.hiHaQR = () => typeof G.qrcode === 'function';

    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fit = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);

    // Dades que es codifiquen al QR i a l'RFID/NFC
    FO.dadesEtiqueta = e => ['FO1', e.safata, e.conjunt, e.codi, e.qty].join('|');

    // EPC de 96 bits (24 hex) derivat de l'identificador (per a gravadores RFID)
    FO.epc = function (text) {
        let h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0x9e3779b9;
        for (let i = 0; i < text.length; i++) {
            const c = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 + c, 2246822519) >>> 0; h3 = Math.imul(h3 ^ (c << 3), 3266489917) >>> 0;
        }
        return ('F0' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + h3.toString(16).padStart(8, '0')).slice(0, 24).toUpperCase();
    };

    // ─── Llista d'etiquetes d'un pla ───
    FO.etiquetesPla = function (pla) {
        const out = [];
        pla.forEach(r => r.safates.forEach(s => {
            out.push({
                clau: s.id, tipus: 'safata', safata: s.id, conjunt: r.conj.codi, codi: s.id,
                nom: (s.tipus === 'muntat' ? 'Guarda: ' : '') + r.conj.nom, qty: s.tipus === 'muntat' ? s.caixetins.reduce((a, c) => a + c.qty, 0) : '',
                pas: r.pas, col: r.conj.col, col2: r.conj.col, esd: s.tipus === 'esd' || s.caixetins.some(c => c.mat.esd),
                liquid: s.caixetins.some(c => c.mat.liquid), dreta: s.angle < 90 && s.caixetins.some(c => c.o.dreta), ample: s.W
            });
            s.caixetins.forEach((c, i) => out.push({
                clau: s.id + '#' + (i + 1), tipus: 'caixeti', safata: s.id, conjunt: r.conj.codi, codi: c.mat.codi, nom: c.mat.nom,
                qty: c.qty, pas: r.pas, col: c.mat.col, col2: r.conj.col, esd: c.mat.esd, liquid: c.mat.liquid, dreta: c.o.dreta,
                consumible: c.mat.tipus === 'consumible', ample: c.w, caixeti: c
            }));
        }));
        return out;
    };

    // Mida real d'una etiqueta per a un caixetí d'amplada `ample`
    FO.midaEtiqueta = function (e, fmtId, midaPers) {
        const f = fmtId === 'mida' && midaPers ? Object.assign({}, FO.FORMATS_ETIQUETA.mida, midaPers) : (FO.FORMATS_ETIQUETA[fmtId] || FO.FORMATS_ETIQUETA.cinta12);
        const h = f.h;
        let w = f.w;
        if (!w) { // cinta: llargada segons contingut, limitada a l'amplada del caixetí
            const ideal = h * (h < 15 ? 4.2 : 3.2) + Math.min(28, String(e.nom).length * h * 0.12);
            w = Math.max(h * 2.2, Math.min(ideal, (e.ample || 999) - 2));
        }
        return { w: Math.round(w * 10) / 10, h, cap: !e.ample || w <= e.ample - 1, cinta: !f.w, full: f.full };
    };

    // SVG d'una etiqueta (unitats en mm)
    FO.svgEtiqueta = function (e, fmtId, opts) {
        opts = opts || {};
        const { w, h, cap } = FO.midaEtiqueta(e, fmtId, opts.mida);
        const dades = FO.dadesEtiqueta(e);
        const ambQR = opts.qr !== false && FO.hiHaQR() && h >= 9;
        const ambBarres = opts.barres !== false && h >= 18 && w >= 36;
        const pad = Math.max(0.8, h * 0.06);
        const franja = Math.max(1.5, h * 0.12);
        let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" font-family="Arial,Helvetica,sans-serif">`;
        s += `<rect width="${w}" height="${h}" fill="#fff"/>`;
        s += `<rect width="${franja}" height="${h}" fill="${e.col}"/>`;       // color del material
        s += `<rect x="${franja}" width="${franja * 0.5}" height="${h}" fill="${e.col2}"/>`; // color del conjunt
        const x = franja * 1.5 + pad;
        let dreta = w - pad;
        const qtyTxt = e.qty !== '' ? '×' + e.qty : '';
        // Mida de lletra perquè "codi  ×qty" càpiga en l'amplada disponible
        const ajusta = (fMax, amp) => Math.max(1.6, Math.min(fMax, amp / ((e.codi.length + qtyTxt.length + 1.5) * 0.6)));
        let qrMida = ambQR ? Math.min(h - 2 * pad, w * 0.4) : 0;
        // si el QR deixa massa poc lloc per al text, es treu
        if (ambQR && (dreta - x - qrMida - pad) < Math.max(h * 1.4, (e.codi.length + 3) * 1.9)) qrMida = 0;
        if (qrMida) { s += svgQR(dades, dreta - qrMida, (h - qrMida) / 2, qrMida); dreta -= qrMida + pad; }
        const amp = dreta - x;
        const icones = (e.esd ? '⚡' : '') + (e.liquid ? '💧' : '') + (e.dreta ? '⬆' : '');
        const linia1 = (f, y) => {
            let t = `<text x="${x}" y="${y}" font-size="${f.toFixed(2)}" font-weight="700">${esc(e.codi)}</text>`;
            if (qtyTxt) t += `<text x="${dreta}" y="${y}" font-size="${f.toFixed(2)}" font-weight="700" text-anchor="end">${qtyTxt}</text>`;
            return t;
        };
        if (h < 11) { // mínima: una línia
            const fs = ajusta(h * 0.62, amp);
            s += linia1(fs, h / 2 + fs * 0.36);
        } else if (h < 18) { // compacta: codi + quantitat / nom
            const f1 = ajusta(h * 0.42, amp), f2 = Math.min(h * 0.27, Math.max(1.6, f1 * 0.75));
            s += linia1(f1, pad + f1 * 0.85);
            s += `<text x="${x}" y="${h - pad - f2 * 0.2}" font-size="${f2.toFixed(2)}">${esc(fit((icones ? icones + ' ' : '') + e.nom, Math.floor(amp / (f2 * 0.5))))}</text>`;
        } else { // completa
            const f1 = ajusta(Math.min(h * 0.24, 7), amp), f2 = Math.min(h * 0.14, 4), f3 = Math.min(h * 0.11, 3.2);
            let y = pad + f1 * 0.85;
            s += linia1(f1, y);
            y += f2 * 1.3;
            s += `<text x="${x}" y="${y}" font-size="${f2}">${esc(fit(e.nom, Math.floor(amp / (f2 * 0.5))))}</text>`;
            y += f3 * 1.35;
            s += `<text x="${x}" y="${y}" font-size="${f3}" fill="#444">${esc(fit(`Pas ${e.pas} · ${e.conjunt} · ${e.safata}`, Math.floor(amp / (f3 * 0.5))))}</text>`;
            if (icones) { y += f3 * 1.35; s += `<text x="${x}" y="${y}" font-size="${f3}">${icones}${e.esd ? ' ESD' : ''}${e.liquid ? ' líquid' : ''}${e.dreta ? ' vertical' : ''}</text>`; }
            if (ambBarres) {
                const bh = Math.max(4, h - y - pad * 1.5);
                if (bh >= 4) s += `<g fill="#000">${svgBarres(e.codi, x, h - pad - bh, amp, bh).svg}</g>`;
            }
        }
        if (!cap && opts.avis !== false) s += `<rect x="0.2" y="0.2" width="${w - 0.4}" height="${h - 0.4}" fill="none" stroke="#E53935" stroke-width="0.4" stroke-dasharray="1 0.6"/>`;
        return s + '</svg>';
    };

    // ─── Pàgina d'impressió ───
    FO.htmlImpressio = function (etiquetes, fmtId, opts) {
        opts = opts || {};
        const f = FO.FORMATS_ETIQUETA[fmtId] || FO.FORMATS_ETIQUETA.cinta12;
        let cos = '', css;
        if (f.full) {
            const g = f.full, perFull = g.cols * g.files;
            css = `@page{size:A4;margin:0}body{margin:0}.full{width:210mm;height:297mm;position:relative;page-break-after:always;overflow:hidden}.e{position:absolute;display:flex;align-items:center;justify-content:center}`;
            for (let i = 0; i < etiquetes.length; i += perFull) {
                cos += '<div class="full">';
                etiquetes.slice(i, i + perFull).forEach((e, k) => {
                    const c = k % g.cols, r = Math.floor(k / g.cols);
                    const x = g.mx + c * (f.w + g.gx), y = g.my + r * (f.h + g.gy);
                    cos += `<div class="e" style="left:${x}mm;top:${y}mm;width:${f.w}mm;height:${f.h}mm">${FO.svgEtiqueta(Object.assign({}, e, { ample: 0 }), fmtId, opts)}</div>`;
                });
                cos += '</div>';
            }
        } else {
            // Rotlle o cinta: una etiqueta per pàgina, de la seva mida
            css = `body{margin:0}.e{page-break-after:always;display:block}@page{margin:0}`;
            etiquetes.forEach(e => {
                const m = FO.midaEtiqueta(e, fmtId, opts.mida);
                cos += `<div class="e" style="width:${m.w}mm;height:${m.h}mm">${FO.svgEtiqueta(e, fmtId, Object.assign({}, opts, { avis: false }))}</div>`;
            });
            if (f.w) css = css.replace('@page{margin:0}', `@page{size:${f.w}mm ${f.h}mm;margin:0}`);
        }
        return `<!doctype html><html lang="ca"><head><meta charset="utf-8"><title>Etiquetes FOrdre</title><style>${css}svg{display:block}</style></head><body>${cos}<script>setTimeout(()=>print(),300)<\/script></body></html>`;
    };

    // ─── CSV per a RFID / NFC / sistemes externs ───
    FO.csvEtiquetes = function (etiquetes) {
        const cols = ['clau', 'tipus', 'safata', 'conjunt', 'pas', 'codi', 'nom', 'quantitat', 'esd', 'liquid', 'dades', 'epc'];
        const q = v => /[";\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
        const files = etiquetes.map(e => [e.clau, e.tipus, e.safata, e.conjunt, e.pas, e.codi, e.nom, e.qty, e.esd ? 1 : 0, e.liquid ? 1 : 0, FO.dadesEtiqueta(e), FO.epc(e.clau)].map(q).join(';'));
        return '﻿' + cols.join(';') + '\n' + files.join('\n') + '\n';
    };

    // Escriptura NFC directa (Chrome per a Android)
    FO.nfcDisponible = () => typeof G.NDEFReader === 'function';
    FO.escriuNFC = async function (e) {
        const w = new G.NDEFReader();
        await w.write({ records: [{ recordType: 'text', lang: 'ca', data: FO.dadesEtiqueta(e) }] });
    };
})(typeof window !== 'undefined' ? window : globalThis);
