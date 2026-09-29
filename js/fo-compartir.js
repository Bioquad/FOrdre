// ═══════════════════════════════════════════════════════════════
// FOrdre — Compartir el projecte entre l'ordinador i el mòbil
// ───────────────────────────────────────────────────────────────
// El projecte es comprimeix (deflate) i es codifica en base64url per
// posar-lo dins un enllaç (…/muntatge.html#p=…) o un codi QR. Si el
// navegador no té CompressionStream, es fa servir base64 sense comprimir.
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO || (G.FO = {});

    const b64u = bytes => {
        let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const deB64u = t => {
        const s = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4));
        const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
    };
    async function passa(bytes, Stream, mode) {
        const st = new Blob([bytes]).stream().pipeThrough(new Stream(mode));
        return new Uint8Array(await new Response(st).arrayBuffer());
    }

    // text → 'z' + base64url(deflate) · o bé 'u' + base64url(utf8)
    FO.comprimeix = async function (text) {
        const bytes = new TextEncoder().encode(text);
        if (typeof G.CompressionStream === 'function') {
            try { return 'z' + b64u(await passa(bytes, G.CompressionStream, 'deflate-raw')); } catch (e) { /* continua sense comprimir */ }
        }
        return 'u' + b64u(bytes);
    };
    FO.descomprimeix = async function (codi) {
        const tipus = codi[0], bytes = deB64u(codi.slice(1));
        if (tipus === 'z') return new TextDecoder().decode(await passa(bytes, G.DecompressionStream, 'deflate-raw'));
        return new TextDecoder().decode(bytes);
    };

    // Versió lleugera del projecte per enviar (sense imatges ni historial)
    // Treu els camps amb el valor per defecte: en normalitzar-lo al mòbil es refan igual
    function sensDefectes(obj, def, manté) {
        Object.keys(obj).forEach(k => {
            if (manté && manté.includes(k)) return;
            if (JSON.stringify(obj[k]) === JSON.stringify(def[k])) delete obj[k];
        });
        return obj;
    }
    FO.projecteLleuger = function (p, ambImatges) {
        const q = JSON.parse(JSON.stringify(p));
        delete q.revisions;
        if (!ambImatges) q.conjunts.forEach(c => { c.imatge = ''; });
        if (FO.normalitzaMaterial && FO.CONFIG_DEFECTE) {
            const dm = FO.normalitzaMaterial({ id: 'x' }, 0);
            q.materials.forEach(m => sensDefectes(m, Object.assign({}, dm, { angleMax: m.liquid ? 0 : 90 }), ['id', 'codi', 'nom', 'col']));
            const dc = FO.normalitzaConjunt({ id: 'x' }, 0);
            q.conjunts.forEach(c => {
                sensDefectes(c, dc, ['id', 'codi', 'nom', 'col', 'items']);
                c.items.forEach(it => { if (!it.parell) delete it.parell; if (!it.nota) delete it.nota; });
                if (c.muntat) c.muntat = sensDefectes(c.muntat, FO.normalitzaMaterial({}, 0), ['x', 'y', 'z']);
            });
            sensDefectes(q.config, FO.CONFIG_DEFECTE);
            if (q.config.llit) sensDefectes(q.config.llit, FO.CONFIG_DEFECTE.llit);
        }
        return q;
    };

    FO.CLAU_PROJECTE = 'fordre.projecte.v1';
})(typeof window !== 'undefined' ? window : globalThis);
