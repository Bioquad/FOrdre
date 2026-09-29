// ═══════════════════════════════════════════════════════════════
// FOrdre — Interfície: arbre, fitxes, importació, exportacions
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO;
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (v, d) => (Math.round(v * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toLocaleString('ca-ES');
    const CLAU_LOCAL = 'fordre.projecte.v1';

    let P = null;             // projecte
    let PLA = [];             // resultat del càlcul (un element per conjunt)
    let perConj = new Map();  // conjId → element del pla
    let ETQ = [];             // etiquetes del pla
    let sel = null;           // {tipus:'conj'|'item'|'mat'|'caix', ...}
    const oberts = new Set();
    let vista = null, filtre = '', pestanya = 'arbre';

    // ─── Utilitats ───
    function hint(msg, ms) {
        const h = $('hint'); h.textContent = msg; h.classList.add('on');
        clearTimeout(hint.t); hint.t = setTimeout(() => h.classList.remove('on'), ms || 2200);
    }
    function descarrega(nom, dades, tipus) {
        const blob = dades instanceof Blob ? dades : new Blob([dades], { type: tipus || 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = nom;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    function finestra(html) {
        const w = G.open('', '_blank');
        if (!w) { descarrega('fordre.html', html, 'text/html'); hint('El navegador ha bloquejat la finestra: s\'ha descarregat com a fitxer'); return; }
        w.document.open(); w.document.write(html); w.document.close();
    }
    const obre = id => $(id).classList.add('on');
    const tanca = id => $(id).classList.remove('on');
    const cfg = () => P.config;
    const fmtEt = () => cfg().etiqueta || 'cinta12';
    const midaEt = () => cfg().etiqueta === 'mida' ? { w: cfg().etiquetaW || 40, h: cfg().etiquetaH || 15 } : null;

    // ─── Persistència local (comoditat; el projecte real es desa en JSON) ───
    function desaLocal() { try { localStorage.setItem(CLAU_LOCAL, JSON.stringify(P)); } catch (e) { /* sense emmagatzematge */ } }
    function llegeixLocal() { try { const t = localStorage.getItem(CLAU_LOCAL); return t ? JSON.parse(t) : null; } catch (e) { return null; } }

    // ─── Càlcul i refresc ───
    let tRecalc = null;
    function recalcula(immediat) {
        clearTimeout(tRecalc);
        const fes = () => {
            PLA = FO.calculaPla(P);
            perConj = new Map(PLA.map(r => [r.conj.id, r]));
            ETQ = FO.etiquetesPla(PLA);
            vista.construeix(PLA, cfg());
            reaplicaSeleccio(false);
            renderArbre(); renderMaterials(); renderFitxa(); renderEstat();
            $('nomProjecte').textContent = P.nom;
            desaLocal();
        };
        if (immediat) fes(); else tRecalc = setTimeout(fes, 220);
    }

    function carregaProjecte(p, missatge) {
        P = FO.normalitzaProjecte(p);
        sel = null; oberts.clear();
        FO.arrels(P).forEach(c => oberts.add(c.id));
        recalcula(true);
        setTimeout(() => vista.veureTot(), 50);
        if (missatge) hint(missatge);
    }

    // ─── Etiqueta d'un caixetí ───
    function etiquetaDe(safataId, c) {
        return ETQ.find(e => e.tipus === 'caixeti' && e.safata === safataId && e.caixeti === c) || null;
    }
    function svgEt(e, opts) { return FO.svgEtiqueta(e, fmtEt(), Object.assign({ mida: midaEt() }, opts || {})); }

    // ─── Selecció ───
    function selecciona(s, enfocar) {
        sel = s;
        if (s && (s.tipus === 'item' || s.tipus === 'conj')) obreCami(s.conj || s.id);
        if (s && s.tipus === 'conj') oberts.add(s.id);  // en triar un grup se'n veuen els components
        reaplicaSeleccio(enfocar);
        renderArbre(); renderFitxa(); renderMaterials();
        const nd = document.querySelector('.nd.sel');
        if (nd) nd.scrollIntoView({ block: 'nearest' });
    }
    function obreCami(id) {
        let c = FO.conjunt(P, id), g = 0;
        while (c && g++ < 100) { if (c.pare) oberts.add(c.pare); c = c.pare ? FO.conjunt(P, c.pare) : null; }
    }
    function reaplicaSeleccio(enfocar) {
        sel && (sel.info = null);
        if (!sel) vista.netejaSeleccio();
        else if (sel.tipus === 'conj') vista.seleccionaConjunt(sel.id, enfocar);
        else if (sel.tipus === 'item') sel.info = vista.seleccionaMaterial(sel.conj, sel.mat, enfocar);
        else if (sel.tipus === 'caix') sel.info = vista.seleccionaCaixeti(sel.safata, sel.idx, enfocar);
        else vista.netejaSeleccio();
        actualitzaCartell();
    }

    function actualitzaCartell() {
        const el = $('cartell');
        const info = sel && sel.info;
        if (!info || !info.caixetins.length) { el.style.display = 'none'; return; }
        const pt = vista.puntCartell();
        if (!pt) { el.style.display = 'none'; return; }
        const e = etiquetaDe(info.safata.id, info.caixetins[0]);
        if (!e) { el.style.display = 'none'; return; }
        const clau = e.clau + '|' + fmtEt();
        if (el.dataset.clau !== clau) {
            const m = FO.midaEtiqueta(e, fmtEt(), midaEt());
            const esc_ = Math.min(4, 230 / m.w, 110 / m.h);
            el.innerHTML = `<div class="cap">${esc(info.safata.id)} · caixetí ${info.safata.caixetins.indexOf(info.caixetins[0]) + 1}</div>` +
                svgEt(e, { avis: false }).replace(/width="[\d.]+mm" height="[\d.]+mm"/, `width="${(m.w * esc_).toFixed(0)}" height="${(m.h * esc_).toFixed(0)}"`);
            el.dataset.clau = clau;
        }
        el.style.display = 'block';
        el.style.left = pt.x + 'px'; el.style.top = pt.y + 'px';
    }

    // ─── Arbre ───
    function coincideix(txt) { return !filtre || String(txt).toLowerCase().includes(filtre); }
    function conjVisible(c) {
        if (!filtre) return true;
        if (coincideix(c.codi) || coincideix(c.nom)) return true;
        if (c.items.some(it => { const m = FO.material(P, it.mat); return m && (coincideix(m.codi) || coincideix(m.nom)); })) return true;
        return FO.fills(P, c.id).some(conjVisible);
    }

    function renderArbre() {
        const el = $('arbre');
        if (!P.conjunts.length) {
            el.innerHTML = `<div class="buit">Encara no hi ha cap conjunt.<br>Crea'n un amb <b>+ Conjunt</b>, importa una llista amb <b>Importar llista</b> o carrega l'<b>Exemple</b>.</div>`;
            return;
        }
        let h = '';
        const pintaConj = (c, niv) => {
            if (!conjVisible(c)) return;
            const r = perConj.get(c.id);
            const fills = FO.fills(P, c.id);
            const obert = oberts.has(c.id) || !!filtre;
            const teFills = fills.length || c.items.length || (c.muntat && c.pare);
            const s = sel && sel.tipus === 'conj' && sel.id === c.id;
            const nSaf = r ? r.safates.filter(x => x.tipus !== 'muntat').length : 0;
            const objs = r ? FO.imprimibles(r) : [];
            const avisos = objs.reduce((a, x) => a + x.avisos.length + x.caixetins.reduce((b, c2) => b + c2.avisos.length, 0), 0) + (r ? r.fora.length : 0);
            const esd = objs.some(x => (FO.MATERIALS_IMPRESSIO[x.material] || {}).esd);
            const fmtK = c.formatKit ? FO.FORMATS_KIT[c.formatKit].nom : '';
            h += `<div class="nd cj${s ? ' sel' : ''}" data-conj="${esc(c.id)}" style="padding-left:${6 + niv * 14}px">
                <span class="tg" data-tg="${esc(c.id)}">${teFills ? (obert ? '▾' : '▸') : ''}</span>
                <span class="sw" style="background:${c.col}"></span>
                ${r ? `<span class="pas" title="Pas de muntatge">${r.pas}</span>` : ''}
                <span class="cd">${esc(c.codi)}</span><span class="nm" title="${esc(c.nom)}">${esc(c.nom)}</span>
                ${c.pare && c.qty > 1 ? `<span class="q" title="Unitats per al conjunt pare">×${c.qty}</span>` : ''}
                ${esd ? '<span class="bd esd" title="Té safata ESD">ESD</span>' : ''}
                ${c.muntat && c.pare ? '<span class="bd mt" title="Té caixa de guarda com a peça muntada">▣</span>' : ''}
                ${nSaf > 1 ? `<span class="bd mt" title="Objectes del kit">${nSaf}</span>` : ''}
                ${fmtK ? `<span class="bd mt" title="Format del kit: ${esc(fmtK)}">${esc(fmtK.split(' ')[0])}</span>` : ''}
                ${avisos ? `<span class="bd av" title="Avisos">${avisos}</span>` : ''}
            </div>`;
            if (!obert) return;
            fills.forEach(f => pintaConj(f, niv + 1));
            const k = r ? r.multiplicador : 1;
            c.items.forEach((it, i) => {
                const m = FO.material(P, it.mat); if (!m) return;
                if (filtre && !coincideix(m.codi) && !coincideix(m.nom) && !coincideix(c.codi) && !coincideix(c.nom)) return;
                const si = sel && sel.tipus === 'item' && sel.conj === c.id && sel.mat === m.id;
                h += `<div class="nd${si ? ' sel' : ''}" data-item="${esc(c.id)}|${esc(m.id)}" style="padding-left:${20 + niv * 14}px">
                    <span class="tg">${FO.TIPUS[m.tipus].ico}</span>
                    <span class="sw" style="background:${m.col}"></span>
                    <span class="cd">${esc(m.codi)}</span><span class="nm" title="${esc(m.nom)}">${esc(m.nom)}</span>
                    ${m.esd ? '<span class="bd esd">ESD</span>' : ''}${m.liquid ? '<span class="bd liq">💧</span>' : ''}
                    <span class="q" title="${k > 1 ? `${it.qty} per unitat × ${k} unitats` : 'Quantitat'}">×${it.qty}${k > 1 ? ` <span style="color:var(--dm)">(${it.qty * k})</span>` : ''}</span>
                </div>`;
            });
            if (c.muntat && c.pare && r) {
                const sm = r.safates.find(x => x.tipus === 'muntat');
                if (sm) {
                    const sc = sel && sel.tipus === 'caix' && sel.safata === sm.id;
                    h += `<div class="nd${sc ? ' sel' : ''}" data-caix="${esc(sm.id)}" style="padding-left:${20 + niv * 14}px">
                        <span class="tg">▣</span><span class="sw" style="background:${c.col}"></span>
                        <span class="nm" style="font-style:italic">Caixa de guarda del conjunt muntat</span>
                        <span class="q">×${sm.caixetins.reduce((a, x) => a + x.qty, 0)}</span></div>`;
                }
            }
        };
        FO.arrels(P).forEach(c => pintaConj(c, 0));
        el.innerHTML = h || '<div class="buit">Cap coincidència</div>';
    }

    $('arbre').addEventListener('click', e => {
        const tg = e.target.closest('[data-tg]');
        if (tg && tg.textContent.trim()) {
            const id = tg.dataset.tg;
            oberts.has(id) ? oberts.delete(id) : oberts.add(id);
            renderArbre(); return;
        }
        const n = e.target.closest('.nd'); if (!n) return;
        if (n.dataset.conj) selecciona({ tipus: 'conj', id: n.dataset.conj }, true);
        else if (n.dataset.item) { const [c, m] = n.dataset.item.split('|'); selecciona({ tipus: 'item', conj: c, mat: m }, true); }
        else if (n.dataset.caix) selecciona({ tipus: 'caix', safata: n.dataset.caix, idx: 0 }, true);
    });
    $('arbre').addEventListener('dblclick', e => {
        const n = e.target.closest('.nd[data-conj]'); if (!n) return;
        const id = n.dataset.conj; oberts.has(id) ? oberts.delete(id) : oberts.add(id); renderArbre();
    });
    $('cerca').addEventListener('input', function () { filtre = this.value.trim().toLowerCase(); renderArbre(); });

    // ─── Taula de materials ───
    function renderMaterials() {
        if (pestanya !== 'materials') return;
        const tot = FO.totals(P);
        const us = new Map();
        P.conjunts.forEach(c => c.items.forEach(it => us.set(it.mat, (us.get(it.mat) || 0) + 1)));
        const files = P.materials.slice().sort((a, b) => a.codi.localeCompare(b.codi));
        $('taulaMat').innerHTML = `<thead><tr><th></th><th>Codi</th><th>Nom</th><th class="n">Mides</th><th class="n">Total</th><th class="n">Conj.</th></tr></thead><tbody>` +
            files.map(m => `<tr data-mat="${esc(m.id)}"${sel && sel.tipus === 'mat' && sel.id === m.id ? ' style="background:rgba(74,144,217,.22)"' : ''}>
                <td><span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${m.col}"></span></td>
                <td style="font-family:var(--mn)">${esc(m.codi)}</td><td>${esc(m.nom)}</td>
                <td class="n">${fmt(m.x, 1)}×${fmt(m.y, 1)}×${fmt(m.z, 1)}</td><td class="n">${tot.get(m.id) || 0}</td><td class="n">${us.get(m.id) || 0}</td></tr>`).join('') +
            `</tbody><tfoot><tr><td colspan="6" style="padding:8px"><button class="b sm" id="bCompra">⬇ Llista de compra / preparació (CSV)</button> <button class="b sm" id="bNouMatCat">+ Material al catàleg</button></td></tr></tfoot>`;
    }
    $('taulaMat').addEventListener('click', e => {
        if (e.target.id === 'bCompra') return llistaCompra();
        if (e.target.id === 'bNouMatCat') { const m = FO.normalitzaMaterial({ codi: nouCodi('MAT-'), nom: 'Material nou' }, P.materials.length); P.materials.push(m); selecciona({ tipus: 'mat', id: m.id }); recalcula(); return; }
        const tr = e.target.closest('tr[data-mat]'); if (tr) selecciona({ tipus: 'mat', id: tr.dataset.mat });
    });
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
        pestanya = t.dataset.tab;
        document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
        $('tabArbre').style.display = pestanya === 'arbre' ? 'flex' : 'none';
        $('tabMaterials').style.display = pestanya === 'materials' ? 'block' : 'none';
        renderMaterials();
    }));

    function llistaCompra() {
        const tot = FO.totals(P);
        const q = v => /[";\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
        const files = P.materials.map(m => [m.codi, m.nom, FO.TIPUS[m.tipus].nom, m.origen, m.proveidor, tot.get(m.id) || 0, m.x, m.y, m.z, m.pes, fmt((tot.get(m.id) || 0) * m.pes / 1000, 3)].map(q).join(';'));
        descarrega(FO.nomFitxer(P.nom) + '_materials.csv', '﻿codi;nom;tipus;origen;proveidor;total;x;y;z;pes_g;pes_total_kg\n' + files.join('\n') + '\n', 'text/csv');
    }

    // ─── Formularis ───
    const CAMPS_MAT = [
        ['codi', 'Codi', 'text'], ['nom', 'Nom', 'text'],
        ['tipus', 'Tipus', 'sel', () => Object.fromEntries(Object.entries(FO.TIPUS).filter(([k]) => k !== 'subconjunt').map(([k, v]) => [k, v.nom]))],
        ['forma', 'Forma', 'sel', () => FO.FORMES],
        ['x', 'Llarg X (mm)', 'num'], ['y', 'Ample Y (mm)', 'num'], ['z', 'Alt Z (mm)', 'num'], ['pes', 'Pes (g/unitat)', 'num'],
        ['col', 'Color', 'color'],
        ['disposicio', 'Disposició al caixetí', 'sel', () => FO.DISPOSICIONS],
        ['angleMax', 'Inclinació màxima (°)', 'num', null, '90 = es pot tombar; 0 = sempre vertical'],
        ['fragil', 'Fragilitat (0-10)', 'num'],
        ['maxApilat', 'Màx. unitats apilades', 'num', null, '0 = sense límit'],
        ['origen', 'Origen', 'sel', () => ({ propi: 'Disseny propi', comprat: 'Comprat' })],
        ['proveidor', 'Proveïdor / referència', 'text', null, null, true],
        ['esd', 'Sensible a l\'electricitat estàtica (ESD)', 'ck'], ['liquid', 'Conté líquids / fluids', 'ck'],
        ['apilable', 'Es pot apilar', 'ck'],
        ['notes', 'Notes', 'area']
    ];
    const CAMPS_MUNTAT = [
        ['x', 'Llarg X (mm)', 'num'], ['y', 'Ample Y (mm)', 'num'], ['z', 'Alt Z (mm)', 'num'], ['pes', 'Pes (g)', 'num'],
        ['forma', 'Forma', 'sel', () => FO.FORMES], ['disposicio', 'Disposició', 'sel', () => FO.DISPOSICIONS],
        ['angleMax', 'Inclinació màx. (°)', 'num'], ['fragil', 'Fragilitat (0-10)', 'num'],
        ['esd', 'Sensible a l\'ESD', 'ck'], ['liquid', 'Conté líquids', 'ck'], ['apilable', 'Es pot apilar', 'ck']
    ];

    function formulari(obj, camps, pref) {
        return '<div class="fg">' + camps.map(([k, lab, t, opc, ajuda, full]) => {
            const id = `${pref}_${k}`, v = obj[k];
            let inp;
            if (t === 'ck') return `<label class="ck full"><input type="checkbox" data-k="${k}" id="${id}"${v ? ' checked' : ''}> ${esc(lab)}</label>`;
            if (t === 'sel') inp = `<select data-k="${k}" id="${id}">${Object.entries(opc()).map(([a, b]) => `<option value="${a}"${a === v ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
            else if (t === 'num') inp = `<input type="number" step="any" data-k="${k}" id="${id}" value="${esc(v)}">`;
            else if (t === 'color') inp = `<input type="color" data-k="${k}" id="${id}" value="${esc(v)}">`;
            else if (t === 'area') return `<div class="fi full"><label for="${id}">${esc(lab)}</label><textarea data-k="${k}" id="${id}">${esc(v)}</textarea></div>`;
            else inp = `<input type="text" data-k="${k}" id="${id}" value="${esc(v)}">`;
            return `<div class="fi${full ? ' full' : ''}"><label for="${id}" title="${esc(ajuda || '')}">${esc(lab)}${ajuda ? ' ⓘ' : ''}</label>${inp}</div>`;
        }).join('') + '</div>';
    }
    // Enllaça els camps d'un formulari a l'objecte
    function enllaca(cont, obj, normalitza, despres) {
        cont.querySelectorAll('[data-k]').forEach(inp => {
            const ev = inp.type === 'checkbox' || inp.tagName === 'SELECT' || inp.type === 'color' ? 'change' : 'input';
            inp.addEventListener(ev, () => {
                const k = inp.dataset.k;
                obj[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? FO.num(inp.value, obj[k]) : inp.value;
                if (normalitza) Object.assign(obj, normalitza(obj));
                if (despres) despres(k); else recalcula();
            });
        });
    }

    // Caixetins (i caixes) d'un objecte en coordenades del seu pla
    function rectsDe(s) {
        const caixes = [], caix = [];
        if (s.forma === 'contenidor') s.caixes.forEach(q => {
            const o = q.obj;
            caixes.push({ x: q.x, y: q.y, w: q.girat ? o.D : o.W, d: q.girat ? o.W : o.D, col: o.color, o });
            o.caixetins.forEach(c => caix.push(q.girat
                ? { x: q.x + o.D - c.y - c.d, y: q.y + c.x, w: c.d, d: c.w, c }
                : { x: q.x + c.x, y: q.y + c.y, w: c.w, d: c.d, c }));
        });
        else s.caixetins.forEach(c => caix.push({ x: c.x, y: c.y, w: c.w, d: c.d, c }));
        return { caixes, caix };
    }

    // Mapa en planta (SVG); el davant queda a baix
    function svgPlanta(s, marcats, ampleMax) {
        const k = Math.min(ampleMax / s.W, 1.6 * ampleMax / s.D, 2.2);
        let h = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${s.W + 2} ${s.D + 2}" width="${(s.W * k).toFixed(0)}" height="${(s.D * k).toFixed(0)}" style="font-family:Arial,sans-serif">`;
        h += `<rect x="0" y="0" width="${s.W}" height="${s.D}" rx="2" fill="${s.color || '#C9CEDA'}" fill-opacity="${s.forma === 'contenidor' ? 0.35 : 0.55}" stroke="#555" stroke-width="0.6"/>`;
        const { caixes, caix } = rectsDe(s);
        caixes.forEach(b => { h += `<rect x="${b.x}" y="${s.D - b.y - b.d}" width="${b.w}" height="${b.d}" rx="1" fill="${b.col}" fill-opacity="0.7" stroke="#222" stroke-width="0.6"/>`; });
        caix.forEach(({ x, y: y0, w, d, c }) => {
            const y = s.D - y0 - d;
            const m = marcats && marcats.includes(c);
            h += `<rect x="${x}" y="${y}" width="${w}" height="${d}" fill="${c.mat.col}" fill-opacity="${m ? 0.95 : 0.45}" stroke="${m ? '#0A58CA' : '#333'}" stroke-width="${m ? 1.6 : 0.4}"/>`;
            const fs = Math.max(2.5, Math.min(w / (c.mat.codi.length * 0.62 + 1), d / 3.2, 9));
            h += `<text x="${x + w / 2}" y="${y + d / 2}" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" fill="#111">${esc(c.mat.codi)}</text>`;
            h += `<text x="${x + w / 2}" y="${y + d / 2 + fs * 1.1}" font-size="${fs * 0.8}" text-anchor="middle" dominant-baseline="middle" fill="#222">×${c.qty}</text>`;
        });
        h += `<text x="${s.W / 2}" y="${s.D - 0.2}" font-size="3" text-anchor="middle" fill="#333">▼ davant</text>`;
        return h + '</svg>';
    }

    const NOM_FORMA = { safata: 'Safata', caixa: 'Caixa individual', contenidor: 'Contenidor' };
    const swatch = col => `<span class="sw" style="display:inline-block;width:11px;height:11px;border-radius:2px;border:1px solid #0005;vertical-align:-1px;background:${col}"></span>`;
    const nomMat = m => (FO.MATERIALS_IMPRESSIO[m] || { nom: m }).nom;
    function nomSTL(r, o, sufix) {
        return `${String(r.pas).padStart(2, '0')}_${FO.nomFitxer(o.id)}_${FO.nomFitxer(o.material)}_${o.color.slice(1).toUpperCase()}${sufix || ''}.stl`;
    }

    function blocSafata(s, marcats) {
        const g = FO.gramsFilament(s, cfg());
        const tots = s.forma === 'contenidor' ? s.caixes.map(c => c.obj) : [];
        const av = s.avisos.concat(...s.caixetins.map(c => c.avisos.map(a => `${c.mat.codi}: ${a}`)), ...tots.map(o => o.avisos.map(a => `${o.id}: ${a}`)));
        const tipus = s.tipus === 'esd' ? '⚡ ESD' : s.tipus === 'muntat' ? '▣ Guarda' : s.bloc ? 'Bloc de petits' : NOM_FORMA[s.forma];
        const nCaix = s.forma === 'contenidor' ? `${s.caixes.length} caixes` : `${s.caixetins.length} caixetins`;
        return `<div class="sf${marcats ? ' sel' : ''}">
            <div class="sf-h"><span>${esc(s.id)}</span><span class="bd mt">${tipus}</span></div>
            <div class="sf-d">${fmt(s.W, 1)} × ${fmt(s.D, 1)} × ${fmt(s.H, 1)} mm · ${nCaix} · peces ${fmt(s.pes, 0)} g${s.angle ? ` · inclinada ${s.angle}°` : ''}</div>
            <div class="sf-d">${swatch(s.color)} ${esc(nomMat(s.material))} · ≈ ${fmt(g, 0)} g de filament</div>
            <div style="margin:6px 0;text-align:center">${svgPlanta(s, marcats, 290)}</div>
            ${tots.length ? `<table class="tt" style="margin-bottom:4px">${tots.map(o => `<tr><td>${swatch(o.color)}</td><td style="font-family:var(--mn)">${esc(o.id)}</td><td>${esc(o.bloc ? 'bloc de petits' : o.caixetins[0].mat.nom)}</td><td>${esc(o.material)}</td><td><button class="b sm" data-stl="${esc(o.id)}" title="STL d'aquesta caixa">STL</button></td></tr>`).join('')}</table>` : ''}
            ${av.map(a => `<div class="av">⚠ ${esc(a)}</div>`).join('')}
            <div class="fx" style="margin-top:6px">
                <button class="b sm" data-stl="${esc(s.id)}">⬇ STL${s.forma === 'contenidor' ? ' contenidor' : ''}</button>
                ${tots.length ? `<button class="b sm" data-stlzip="${esc(s.id)}">⬇ Tot (ZIP)</button>` : ''}
                ${s.angle ? `<button class="b sm" data-falca="${esc(s.id)}">⬇ Falca ${s.angle}°</button>` : ''}
                <button class="b sm" data-etq="${esc(s.id)}">🏷 Etiquetes</button>
            </div></div>`;
    }

    function safataPerId(id) { for (const r of PLA) for (const s of FO.imprimibles(r)) if (s.id === id) return { s, r }; return null; }
    const idsDe = s => [s.id].concat(s.caixes ? s.caixes.map(c => c.obj.id) : []);

    function renderFitxa() {
        const el = $('fitxa');
        if (!sel) return renderResum(el);
        if (sel.tipus === 'conj') return fitxaConj(el, FO.conjunt(P, sel.id));
        if (sel.tipus === 'item') return fitxaItem(el);
        if (sel.tipus === 'mat') return fitxaMat(el, FO.material(P, sel.id));
        if (sel.tipus === 'caix') return fitxaCaix(el);
        renderResum(el);
    }

    function taulaFilament() {
        const f = FO.resumFilament(PLA, cfg());
        if (!f.length) return '<div class="ajuda">Res a imprimir.</div>';
        return `<table class="tt"><thead><tr><th></th><th>Material</th><th>Color</th><th class="n">Peces</th><th class="n">g</th></tr></thead><tbody>${f.map(e => `<tr><td>${swatch(e.color)}</td><td>${esc(nomMat(e.material))}</td><td style="font-family:var(--mn)">${e.color}</td><td class="n">${e.peces}</td><td class="n">${fmt(e.grams, 0)}</td></tr>`).join('')}</tbody><tfoot><tr><td></td><td colspan="2"><b>Total</b></td><td class="n">${f.reduce((a, e) => a + e.peces, 0)}</td><td class="n"><b>${fmt(f.reduce((a, e) => a + e.grams, 0), 0)}</b></td></tr></tfoot></table>`;
    }

    function renderResum(el) {
        const nSaf = PLA.reduce((a, r) => a + FO.imprimibles(r).length, 0);
        el.innerHTML = `<div class="ps"><div class="ps-t">Projecte</div>
            <div class="fi"><label>Nom del projecte</label><input type="text" id="pNom" value="${esc(P.nom)}"></div></div>
            <div class="ps"><div class="ps-t">Com funciona</div><div class="ajuda">
            1. Defineix l'<b>arbre de muntatge</b>: la màquina, els seus conjunts i subconjunts, i els materials de cada un (o importa'l d'un Excel, CSV o BOM de CAD).<br><br>
            2. Omple les <b>propietats</b> de cada material: mides, pes, si és sensible a l'ESD, si porta líquids, si es pot tombar o apilar…<br><br>
            3. FOrdre calcula per a cada conjunt, en <b>ordre de muntatge</b>, un caixetí a mida per a cada material i el munta en el <b>format</b> que triïs: safata fusionada, caixes individuals, caixes dins un contenidor general o mixt (petits fusionats + grans en caixes). Els subconjunts amb dades de peça muntada tenen <b>caixa de guarda</b>.<br><br>
            Tria el <b>material i el color</b> d'impressió per a tot el projecte (⚙ Configuració), per a cada conjunt o per a la caixa de cada material.<br><br>
            4. Descarrega els <b>STL</b>, imprimeix les <b>etiquetes</b> i el <b>full de ruta</b>.<br><br>
            Selecciona un conjunt o un material a l'arbre (o clica una safata a la vista 3D) per veure'n el detall.</div></div>
            <div class="ps"><div class="ps-t">Resum</div><dl class="kv">
            <dt>Conjunts</dt><dd>${P.conjunts.length}</dd><dt>Materials</dt><dd>${P.materials.length}</dd>
            <dt>Objectes a imprimir</dt><dd>${nSaf}</dd><dt>Etiquetes</dt><dd>${ETQ.length}</dd></dl>
            ${FO.validaProjecte(P).map(a => `<div class="av er">⚠ ${esc(a)}</div>`).join('')}</div>
            <div class="ps"><div class="ps-t">Filament necessari</div>${taulaFilament()}
            <div class="ajuda" style="margin-top:4px">Estimació amb un ${Math.round(cfg().factorPes * 100)} % de plàstic real (parets + farciment). Es pot ajustar a la configuració.</div></div>`;
        $('pNom').addEventListener('input', function () { P.nom = this.value; $('nomProjecte').textContent = P.nom; desaLocal(); });
    }

    function fitxaConj(el, c) {
        if (!c) { sel = null; return renderResum(el); }
        const r = perConj.get(c.id);
        const opcPare = P.conjunts.filter(x => x.id !== c.id && !FO.esDescendent(P, x.id, c.id));
        const m = c.muntat || {};
        el.innerHTML = `<div class="ps"><div class="ps-t"><span class="sw" style="width:12px;height:12px;border-radius:3px;background:${c.col}"></span> Conjunt ${r ? `· pas ${r.pas}` : ''}${r && r.multiplicador > 1 ? ` · es munta ${r.multiplicador} vegades` : ''}</div>
            <div class="fg">
                <div class="fi"><label>Codi</label><input type="text" data-k="codi" value="${esc(c.codi)}"></div>
                <div class="fi"><label>Color</label><input type="color" data-k="col" value="${c.col}"></div>
                <div class="fi full"><label>Nom</label><input type="text" data-k="nom" value="${esc(c.nom)}"></div>
                <div class="fi"><label>Conjunt pare</label><select data-k="pare"><option value="">— (arrel: màquina)</option>${opcPare.map(x => `<option value="${esc(x.id)}"${x.id === c.pare ? ' selected' : ''}>${esc(x.codi)} · ${esc(x.nom)}</option>`).join('')}</select></div>
                <div class="fi"><label title="Quantes unitats d'aquest conjunt porta el pare">Unitats per al pare ⓘ</label><input type="number" min="1" step="1" data-k="qty" value="${c.qty}"></div>
                <div class="fi full"><label>Notes de muntatge</label><textarea data-k="notes">${esc(c.notes)}</textarea></div>
            </div></div>
            <div class="ps"><div class="ps-t">Peça muntada (caixa de guarda)</div>
                <label class="ck"><input type="checkbox" id="ckMuntat"${c.muntat ? ' checked' : ''}> Un cop muntat, guardar-lo com una peça per al conjunt pare</label>
                <div id="muntatForm" style="${c.muntat ? '' : 'display:none'};margin-top:6px">${formulari(Object.assign({ x: 50, y: 50, z: 50, pes: 0, forma: 'box', disposicio: 'auto', angleMax: 90, fragil: 0, esd: false, liquid: false, apilable: false }, m), CAMPS_MUNTAT, 'mu')}</div>
                ${c.muntat && !c.pare ? '<div class="ajuda" style="margin-top:4px">És l\'arrel (la màquina): no necessita caixa de guarda.</div>' : ''}
            </div>
            <div class="ps"><div class="ps-t">Format del kit i materials d'impressió</div>
                <div class="fg">
                    <div class="fi full"><label>Format del kit</label><select data-kk="formatKit"><option value="">Per defecte del projecte (${esc(FO.FORMATS_KIT[cfg().formatKit].nom)})</option>${Object.entries(FO.FORMATS_KIT).map(([k, f]) => `<option value="${k}"${c.formatKit === k ? ' selected' : ''}>${esc(f.nom)}</option>`).join('')}</select></div>
                    <div class="ajuda full">${esc(FO.FORMATS_KIT[FO.formatDe(c, cfg())].desc)}</div>
                    ${selMaterial('materialCaixa', 'Material de caixes i safates', c.materialCaixa, cfg().materialCaixa)}
                    ${selColor('colorCaixa', 'Color de safates / fix', c.colorCaixa, cfg().colorCaixa)}
                    ${selMaterial('materialContenidor', 'Material del contenidor', c.materialContenidor, cfg().materialContenidor)}
                    ${selColor('colorContenidor', 'Color del contenidor', c.colorContenidor, cfg().colorContenidor)}
                </div></div>
            ${r && r.entrades.length ? `<div class="ps"><div class="ps-t">Cal tenir muntat abans</div>${r.entrades.map(e => `<div class="nd" data-anar="${esc(e.conj.id)}"><span class="sw" style="background:${e.conj.col}"></span><span class="pas">${perConj.get(e.conj.id) ? perConj.get(e.conj.id).pas : ''}</span><span class="cd">${esc(e.conj.codi)}</span><span class="nm">${esc(e.conj.nom)}</span><span class="q">×${e.qty}</span></div>`).join('')}</div>` : ''}
            <div class="ps"><div class="ps-t">Safates, caixes i contenidors</div>
                ${r && r.safates.length ? r.safates.map(s => blocSafata(s)).join('') : '<div class="ajuda">Aquest conjunt no té materials directes: només s\'hi munten subconjunts.</div>'}
                ${r && r.fora.length ? `<div class="av er">No caben al llit de la impressora (preparar a part): ${r.fora.map(x => esc(x.mat.codi) + ' ×' + x.qty).join(', ')}</div>` : ''}
            </div>`;
        const form = el.querySelector('.ps');
        form.querySelectorAll('[data-k]').forEach(inp => {
            inp.addEventListener(inp.tagName === 'SELECT' || inp.type === 'color' ? 'change' : 'input', () => {
                const k = inp.dataset.k;
                c[k] = k === 'qty' ? Math.max(1, Math.round(FO.num(inp.value, 1))) : k === 'pare' ? (inp.value || null) : inp.value;
                recalcula();
            });
        });
        $('ckMuntat').addEventListener('change', function () {
            c.muntat = this.checked ? FO.normalitzaMaterial({ x: 50, y: 50, z: 50, pes: 0, apilable: false, codi: c.codi, nom: c.nom, col: c.col }) : null;
            recalcula(); setTimeout(renderFitxa, 250);
        });
        if (c.muntat) enllaca($('muntatForm'), c.muntat, o => FO.normalitzaMaterial(Object.assign({}, o, { id: 'muntat', codi: c.codi, nom: c.nom, col: c.col })));
        enllacaImpressio(el, c);
        accionsSafates(el);
        el.querySelectorAll('[data-anar]').forEach(n => n.addEventListener('click', () => selecciona({ tipus: 'conj', id: n.dataset.anar }, true)));
    }

    // Selector de material d'impressió ('' = per defecte)
    function selMaterial(k, lab, v, defecte) {
        return `<div class="fi"><label>${esc(lab)}</label><select data-kk="${k}"><option value="">Per defecte (${esc(defecte)})</option>${Object.entries(FO.MATERIALS_IMPRESSIO).map(([id, m]) => `<option value="${id}"${v === id ? ' selected' : ''} title="${esc(m.notes)}">${esc(m.nom)}</option>`).join('')}</select></div>`;
    }
    // Selector de color amb opció «automàtic»
    function selColor(k, lab, v, defecte) {
        return `<div class="fi"><label>${esc(lab)}</label><div class="fx" style="flex-wrap:nowrap"><label class="ck" title="Usar el color per defecte / automàtic"><input type="checkbox" data-kauto="${k}"${v ? '' : ' checked'}>auto</label><input type="color" data-kk="${k}" value="${v || defecte}"${v ? '' : ' disabled'} style="flex:1"></div></div>`;
    }
    function enllacaImpressio(el, obj) {
        el.querySelectorAll('[data-kk]').forEach(inp => inp.addEventListener('change', () => { obj[inp.dataset.kk] = inp.value; recalcula(); setTimeout(renderFitxa, 260); }));
        el.querySelectorAll('[data-kauto]').forEach(ck => ck.addEventListener('change', () => {
            const k = ck.dataset.kauto, inp = el.querySelector(`[data-kk="${k}"]`);
            inp.disabled = ck.checked; obj[k] = ck.checked ? '' : inp.value; recalcula();
        }));
    }

    function accionsSafates(el) {
        el.querySelectorAll('[data-stl]').forEach(b => b.addEventListener('click', () => {
            const { s, r } = safataPerId(b.dataset.stl);
            descarrega(nomSTL(r, s), FO.stlBinari(FO.mallaSafata(s, cfg()), s.id), 'model/stl');
        }));
        el.querySelectorAll('[data-stlzip]').forEach(b => b.addEventListener('click', () => {
            const { s, r } = safataPerId(b.dataset.stlzip);
            const f = [s].concat(s.caixes.map(c => c.obj)).map(o => ({ nom: nomSTL(r, o), dades: FO.stlBinari(FO.mallaSafata(o, cfg()), o.id) }));
            if (s.angle) f.push({ nom: nomSTL(r, s, '_falca'), dades: FO.stlBinari(FO.mallaFalca(s), s.id + ' falca') });
            descarrega(FO.nomFitxer(s.id) + '.zip', FO.zip(f), 'application/zip');
        }));
        el.querySelectorAll('[data-falca]').forEach(b => b.addEventListener('click', () => {
            const { s, r } = safataPerId(b.dataset.falca);
            descarrega(nomSTL(r, s, '_falca'), FO.stlBinari(FO.mallaFalca(s), s.id + ' falca'), 'model/stl');
        }));
        el.querySelectorAll('[data-etq]').forEach(b => b.addEventListener('click', () => {
            const ids = idsDe(safataPerId(b.dataset.etq).s);
            imprimeixEtiquetes(ETQ.filter(e => ids.includes(e.safata)));
        }));
    }

    function blocEtiqueta(e) {
        if (!e) return '';
        const m = FO.midaEtiqueta(e, fmtEt(), midaEt());
        return `<div class="ps"><div class="ps-t">Etiqueta <span class="fl"></span>
            <select id="fmtRapid" class="cerca" style="width:auto;height:22px">${Object.entries(FO.FORMATS_ETIQUETA).map(([k, f]) => `<option value="${k}"${k === fmtEt() ? ' selected' : ''}>${esc(f.nom)}</option>`).join('')}</select></div>
            <div class="prev-et">${svgEt(e).replace(/width="([\d.]+)mm" height="([\d.]+)mm"/, (a, w, h) => `width="${(w * 3.4).toFixed(0)}" height="${(h * 3.4).toFixed(0)}"`)}</div>
            <div class="sf-d" style="margin-top:4px">${fmt(m.w, 1)} × ${fmt(m.h, 1)} mm${e.ample ? ` · amplada del caixetí ${fmt(e.ample, 1)} mm` : ''}</div>
            ${!m.cap ? '<div class="av">⚠ L\'etiqueta és més ampla que el caixetí: tria un format més petit o enganxa-la al fons.</div>' : ''}
            ${!FO.hiHaQR() ? '<div class="av">No s\'ha pogut carregar el generador de QR (sense connexió?): les etiquetes sortiran sense QR.</div>' : ''}
            <div class="sf-d" style="margin-top:4px;word-break:break-all">Dades QR/RFID: ${esc(FO.dadesEtiqueta(e))} · EPC ${FO.epc(e.clau)}</div>
            <div class="fx" style="margin-top:6px">
                <button class="b sm" id="etqUna">🏷 Imprimir aquesta</button>
                ${FO.nfcDisponible() ? '<button class="b sm" id="etqNFC">📶 Escriure etiqueta NFC</button>' : ''}
            </div></div>`;
    }
    function enllacaEtiqueta(el, e) {
        const f = el.querySelector('#fmtRapid');
        if (f) f.addEventListener('change', () => { cfg().etiqueta = f.value; $('cartell').dataset.clau = ''; desaLocal(); renderFitxa(); actualitzaCartell(); });
        const u = el.querySelector('#etqUna'); if (u) u.addEventListener('click', () => imprimeixEtiquetes([e]));
        const n = el.querySelector('#etqNFC');
        if (n) n.addEventListener('click', async () => {
            try { hint('Apropa l\'etiqueta NFC al telèfon…', 6000); await FO.escriuNFC(e); hint('Etiqueta NFC escrita'); }
            catch (err) { hint('No s\'ha pogut escriure: ' + err.message, 4000); }
        });
    }

    function blocCaixeti(info) {
        if (!info) return '<div class="ps"><div class="av">Aquest material no té caixetí (no cap al llit de la impressora o la quantitat és 0).</div></div>';
        const c = info.caixetins[0], s = info.safata;
        const cel = c.cel ? `${c.girat ? c.cel.ny : c.cel.nx} × ${c.girat ? c.cel.nx : c.cel.ny}${c.cel.perCel > 1 ? `, ${c.cel.perCel} per pila` : ''}` : '—';
        return `<div class="ps"><div class="ps-t">Lloc a la safata</div>
            <dl class="kv"><dt>Safata</dt><dd>${esc(s.id)}</dd>
            <dt>Caixetí</dt><dd>${s.caixetins.indexOf(c) + 1} de ${s.caixetins.length}${info.caixetins.length > 1 ? ` (+${info.caixetins.length - 1} més)` : ''}</dd>
            <dt>Disposició</dt><dd>${esc(FO.DISPOSICIONS[c.mode])}</dd>
            <dt>Cel·les</dt><dd>${cel}</dd>
            <dt>Buit</dt><dd>${fmt(c.w, 1)} × ${fmt(c.d, 1)} mm</dd>
            <dt>Fondària</dt><dd>${fmt(s.H - c.z, 1)} mm</dd>
            <dt>Posició</dt><dd>X ${fmt(c.x, 1)} · Y ${fmt(c.y, 1)} mm</dd>
            <dt>Pes</dt><dd>${fmt(c.pes, 1)} g</dd></dl>
            ${c.avisos.map(a => `<div class="av">⚠ ${esc(a)}</div>`).join('')}
            <div style="margin-top:8px;text-align:center">${svgPlanta(s, info.caixetins, 290)}</div></div>`;
    }

    // Material i color de la caixa individual d'un material
    function blocCaixaMat(m, obj) {
        const esq = { material: 'color del material', conjunt: 'color del conjunt', tipus: 'color per tipus', fix: 'color fix' }[cfg().esquemaColor];
        return `<div class="ps" id="blocCaixaMat"><div class="ps-t">Caixa individual d'aquest material</div>
            <div class="fg">${selMaterial('caixaMaterial', 'Material', m.caixaMaterial, m.esd ? cfg().materialESD + ' (ESD)' : 'del conjunt / ' + cfg().materialCaixa)}
            ${selColor('caixaColor', 'Color', m.caixaColor, m.col)}</div>
            <div class="ajuda" style="margin-top:4px">Automàtic = ${esc(esq)}${cfg().ajustaFilaments ? ', ajustat al filament disponible més proper' : ''}. Només s'aplica quan el material va en caixa pròpia (formats individual, contenidor o mixt).</div>
            ${obj ? `<div class="sf-d" style="margin-top:4px">Ara: ${esc(NOM_FORMA[obj.forma])} ${esc(obj.id)} · ${swatch(obj.color)} ${esc(nomMat(obj.material))}${obj.pare ? ` · dins ${esc(obj.pare.id)}` : ''}</div>` : ''}</div>`;
    }

    function fitxaItem(el) {
        const c = FO.conjunt(P, sel.conj), m = FO.material(P, sel.mat);
        const it = c && c.items.find(i => i.mat === sel.mat);
        if (!c || !m || !it) { sel = null; return renderResum(el); }
        const r = perConj.get(c.id), k = r ? r.multiplicador : 1;
        const usos = P.conjunts.filter(x => x.items.some(i => i.mat === m.id));
        const e = sel.info ? etiquetaDe(sel.info.safata.id, sel.info.caixetins[0]) : null;
        el.innerHTML = `<div class="ps"><div class="ps-t"><span class="sw" style="width:12px;height:12px;border-radius:3px;background:${m.col}"></span> ${esc(m.codi)} a ${esc(c.codi)}</div>
            <div class="fg"><div class="fi"><label>Quantitat per unitat de conjunt</label><input type="number" min="1" step="1" id="itQty" value="${it.qty}"></div>
            <div class="fi"><label>Total a preparar</label><input type="text" disabled value="${it.qty * k}${k > 1 ? ` (${it.qty} × ${k})` : ''}"></div></div></div>
            ${blocCaixeti(sel.info)}
            ${blocEtiqueta(e)}
            ${blocCaixaMat(m, sel.info && sel.info.safata)}
            <div class="ps"><div class="ps-t">Material${usos.length > 1 ? ` · s'usa a ${usos.length} conjunts` : ''}</div>${formulari(m, CAMPS_MAT, 'm')}</div>`;
        $('itQty').addEventListener('input', function () { it.qty = Math.max(1, Math.round(FO.num(this.value, 1))); recalcula(); });
        enllaca(el.querySelector('.ps:last-child'), m, o => FO.normalitzaMaterial(o));
        enllacaImpressio(el.querySelector('#blocCaixaMat'), m);
        enllacaEtiqueta(el, e);
    }

    function fitxaMat(el, m) {
        if (!m) { sel = null; return renderResum(el); }
        const usos = P.conjunts.filter(x => x.items.some(i => i.mat === m.id));
        el.innerHTML = `<div class="ps"><div class="ps-t"><span class="sw" style="width:12px;height:12px;border-radius:3px;background:${m.col}"></span> Material del catàleg</div>${formulari(m, CAMPS_MAT, 'm')}</div>${blocCaixaMat(m, null)}
            <div class="ps"><div class="ps-t">S'usa a</div>${usos.length ? usos.map(c => `<div class="nd" data-anar="${esc(c.id)}"><span class="sw" style="background:${c.col}"></span><span class="cd">${esc(c.codi)}</span><span class="nm">${esc(c.nom)}</span><span class="q">×${c.items.find(i => i.mat === m.id).qty}</span></div>`).join('') : '<div class="ajuda">Cap conjunt. Selecciona un conjunt i fes <b>+ Existent</b> per afegir-l\'hi.</div>'}</div>`;
        enllaca(el.querySelector('.ps'), m, o => FO.normalitzaMaterial(o));
        enllacaImpressio(el.querySelector('#blocCaixaMat'), m);
        el.querySelectorAll('[data-anar]').forEach(n => n.addEventListener('click', () => selecciona({ tipus: 'item', conj: n.dataset.anar, mat: m.id }, true)));
    }

    function fitxaCaix(el) {
        const x = safataPerId(sel.safata);
        if (!x) { sel = null; return renderResum(el); }
        const e = sel.info ? etiquetaDe(x.s.id, sel.info.caixetins[0]) : null;
        el.innerHTML = `<div class="ps"><div class="ps-t">Caixa de guarda · ${esc(x.r.conj.codi)}</div>
            <div class="ajuda">Aquí es guarden les unitats del conjunt <b>${esc(x.r.conj.nom)}</b> un cop muntades, fins que es facin servir al conjunt pare. Les dades de la peça muntada es canvien a la fitxa del conjunt.</div>
            <div class="fx" style="margin-top:6px"><button class="b sm" data-anar="${esc(x.r.conj.id)}">Obrir el conjunt</button></div></div>
            ${blocCaixeti(sel.info)}${blocEtiqueta(e)}<div class="ps">${blocSafata(x.s)}</div>`;
        enllacaEtiqueta(el, e);
        accionsSafates(el);
        el.querySelector('[data-anar]').addEventListener('click', () => selecciona({ tipus: 'conj', id: x.r.conj.id }, true));
    }

    function renderEstat() {
        const objs = PLA.flatMap(r => FO.imprimibles(r));
        const pesTot = PLA.reduce((a, r) => a + r.safates.reduce((b, s) => b + s.pes, 0), 0);
        const fil = FO.resumFilament(PLA, cfg()).reduce((a, e) => a + e.grams, 0);
        $('sb').innerHTML = `<span><b>${P.conjunts.length}</b> conjunts</span><span class="sp"></span><span><b>${P.materials.length}</b> materials</span><span class="sp"></span>
            <span><b>${objs.length}</b> peces a imprimir</span><span class="sp"></span><span><b>${ETQ.length}</b> etiquetes</span><span class="sp"></span>
            <span>Filament ≈ <b>${fmt(fil / 1000, 2)} kg</b></span><span class="sp"></span>
            <span>Pes de les peces <b>${fmt(pesTot / 1000, 2)} kg</b></span><span class="sp"></span>
            <span>Llit ${cfg().llit.x}×${cfg().llit.y}×${cfg().llit.z} mm</span><span class="fl"></span><span>FOrdre ${FO.VERSIO}</span>`;
    }

    // ─── Accions de l'arbre ───
    function nouCodi(pref) {
        let i = 1; const codis = new Set(P.materials.map(m => m.codi).concat(P.conjunts.map(c => c.codi)));
        while (codis.has(pref + String(i).padStart(3, '0'))) i++;
        return pref + String(i).padStart(3, '0');
    }
    const conjSel = () => sel && (sel.tipus === 'conj' ? sel.id : sel.tipus === 'item' ? sel.conj : null);

    $('bNouConj').onclick = () => {
        const c = FO.normalitzaConjunt({ codi: nouCodi('CJ-'), nom: 'Conjunt nou', ordre: P.conjunts.length }, P.conjunts.length);
        P.conjunts.push(c); recalcula(true); selecciona({ tipus: 'conj', id: c.id });
    };
    $('bNouSub').onclick = () => {
        const pare = conjSel(); if (!pare) return hint('Selecciona primer el conjunt pare');
        const c = FO.normalitzaConjunt({ codi: nouCodi('CJ-'), nom: 'Subconjunt nou', pare, ordre: FO.fills(P, pare).length }, P.conjunts.length);
        P.conjunts.push(c); oberts.add(pare); recalcula(true); selecciona({ tipus: 'conj', id: c.id });
    };
    $('bNouMat').onclick = () => {
        const cj = conjSel(); if (!cj) return hint('Selecciona primer un conjunt');
        const m = FO.normalitzaMaterial({ codi: nouCodi('MAT-'), nom: 'Material nou', x: 20, y: 20, z: 10, pes: 5 }, P.materials.length);
        P.materials.push(m); FO.conjunt(P, cj).items.push({ mat: m.id, qty: 1 }); oberts.add(cj);
        recalcula(true); selecciona({ tipus: 'item', conj: cj, mat: m.id }, true);
    };
    $('bAfegirMat').onclick = () => {
        if (!conjSel()) return hint('Selecciona primer un conjunt');
        $('exCerca').value = ''; renderExistents(); obre('dlgExistent'); $('exCerca').focus();
    };
    function renderExistents() {
        const f = $('exCerca').value.trim().toLowerCase();
        $('exTaula').innerHTML = P.materials.filter(m => !f || (m.codi + ' ' + m.nom).toLowerCase().includes(f))
            .map(m => `<tr data-mat="${esc(m.id)}"><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${m.col}"></span></td><td style="font-family:var(--mn)">${esc(m.codi)}</td><td>${esc(m.nom)}</td><td>${FO.TIPUS[m.tipus].nom}</td></tr>`).join('')
            || '<tr><td class="buit">Cap material</td></tr>';
    }
    $('exCerca').addEventListener('input', renderExistents);
    $('exTaula').addEventListener('click', e => {
        const tr = e.target.closest('tr[data-mat]'); if (!tr) return;
        const c = FO.conjunt(P, conjSel());
        const it = c.items.find(i => i.mat === tr.dataset.mat);
        if (it) it.qty++; else c.items.push({ mat: tr.dataset.mat, qty: 1 });
        tanca('dlgExistent'); oberts.add(c.id);
        recalcula(true); selecciona({ tipus: 'item', conj: c.id, mat: tr.dataset.mat }, true);
    });
    function mou(dir) {
        if (!sel) return;
        if (sel.tipus === 'conj') {
            const c = FO.conjunt(P, sel.id), germans = FO.fills(P, c.pare);
            germans.forEach((g, i) => { g.ordre = i; });
            const i = germans.indexOf(c), j = i + dir;
            if (j < 0 || j >= germans.length) return;
            germans[j].ordre = i; c.ordre = j;
        } else if (sel.tipus === 'item') {
            const c = FO.conjunt(P, sel.conj), i = c.items.findIndex(x => x.mat === sel.mat), j = i + dir;
            if (j < 0 || j >= c.items.length) return;
            [c.items[i], c.items[j]] = [c.items[j], c.items[i]];
        } else return;
        recalcula(true);
    }
    $('bPujar').onclick = () => mou(-1);
    $('bBaixar').onclick = () => mou(1);
    $('bEliminar').onclick = () => {
        if (!sel) return;
        if (sel.tipus === 'conj') {
            const c = FO.conjunt(P, sel.id);
            if (!confirm(`Eliminar el conjunt ${c.codi}? Els seus subconjunts passaran al conjunt pare.`)) return;
            P.conjunts.forEach(x => { if (x.pare === c.id) x.pare = c.pare; });
            P.conjunts = P.conjunts.filter(x => x !== c);
        } else if (sel.tipus === 'item') {
            const c = FO.conjunt(P, sel.conj); c.items = c.items.filter(x => x.mat !== sel.mat);
        } else if (sel.tipus === 'mat') {
            const m = FO.material(P, sel.id);
            if (!confirm(`Eliminar ${m.codi} del catàleg i de tots els conjunts?`)) return;
            P.materials = P.materials.filter(x => x !== m);
            P.conjunts.forEach(c => { c.items = c.items.filter(i => i.mat !== m.id); });
        } else return;
        sel = null; recalcula(true);
    };

    // ─── Vista 3D ───
    vista = FO.Vista($('c3d'), {
        onCamera: actualitzaCartell,
        onPick(p) {
            if (!p) return selecciona(null);
            if (p.caixeti && p.caixeti.mat.tipus === 'subconjunt') return selecciona({ tipus: 'caix', safata: p.safata.id, idx: p.idx });
            if (p.caixeti) return selecciona({ tipus: 'item', conj: p.conj.id, mat: p.caixeti.mat.id });
            selecciona({ tipus: 'conj', id: p.conj.id });
        }
    });
    $('vTot').onclick = () => vista.veureTot();
    $('vSel').onclick = () => vista.enfoca();
    $('vDalt').onclick = () => vista.planta();
    $('vPeces').onclick = function () { this.classList.toggle('on'); vista.setPeces(this.classList.contains('on')); };
    $('vFalca').onclick = function () { this.classList.toggle('on'); vista.setFalca(this.classList.contains('on')); };

    // ─── Barra superior ───
    $('bNou').onclick = () => { if (confirm('Començar un projecte nou i buit? (El projecte actual es perdrà si no l\'has desat.)')) carregaProjecte(FO.nouProjecte(), 'Projecte nou'); };
    $('bExemple').onclick = () => { if (!P.conjunts.length || confirm('Carregar l\'exemple i substituir el projecte actual?')) carregaProjecte(FO.exemple(), 'Exemple carregat'); };
    $('bDesar').onclick = () => descarrega(FO.nomFitxer(P.nom) + '.fordre.json', JSON.stringify(P, null, 1), 'application/json');
    $('bObrir').onclick = () => $('fObrir').click();
    $('fObrir').addEventListener('change', function () {
        const f = this.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => { try { carregaProjecte(JSON.parse(rd.result), 'Projecte obert'); } catch (e) { alert('No és un projecte vàlid: ' + e.message); } };
        rd.readAsText(f); this.value = '';
    });
    $('nomProjecte').addEventListener('click', () => { const n = prompt('Nom del projecte', P.nom); if (n) { P.nom = n; recalcula(true); } });
    $('bPlantilla').onclick = () => descarrega('plantilla_fordre.csv', FO.plantillaCSV(), 'text/csv');
    $('bRFID').onclick = () => descarrega(FO.nomFitxer(P.nom) + '_etiquetes.csv', FO.csvEtiquetes(ETQ), 'text/csv');
    $('bEtiquetes').onclick = () => imprimeixEtiquetes(ETQ);
    $('bSTL').onclick = exportaSTL;
    $('bFulla').onclick = fullDeRuta;
    $('bTema').onclick = () => {
        const clar = document.documentElement.dataset.theme !== 'light';
        document.documentElement.dataset.theme = clar ? 'light' : 'dark';
        vista.setFons(clar);
        try { localStorage.setItem('fordre.tema', clar ? 'light' : 'dark'); } catch (e) { /* */ }
    };
    try { const t = localStorage.getItem('fordre.tema'); if (t) { document.documentElement.dataset.theme = t; vista.setFons(t === 'light'); } } catch (e) { /* */ }
    document.querySelectorAll('[data-tanca]').forEach(b => b.addEventListener('click', () => tanca(b.dataset.tanca)));
    document.querySelectorAll('.ov').forEach(o => o.addEventListener('click', e => { if (e.target === o) tanca(o.id); }));

    function imprimeixEtiquetes(llista) {
        if (!llista.length) return hint('No hi ha etiquetes');
        finestra(FO.htmlImpressio(llista, fmtEt(), { mida: midaEt() }));
    }

    function exportaSTL() {
        if (!PLA.some(r => r.safates.length)) return hint('No hi ha res per exportar');
        const fitxers = [], linies = [`FOrdre ${FO.VERSIO} — ${P.nom}`, `Llit: ${cfg().llit.x} × ${cfg().llit.y} × ${cfg().llit.z} mm`, ''];
        PLA.forEach(r => FO.imprimibles(r).forEach(s => {
            fitxers.push({ nom: nomSTL(r, s), dades: FO.stlBinari(FO.mallaSafata(s, cfg()), s.id) });
            if (s.angle > 0 && !s.pare) fitxers.push({ nom: nomSTL(r, s, '_falca'), dades: FO.stlBinari(FO.mallaFalca(s), s.id + ' falca') });
            linies.push(`Pas ${r.pas} · ${s.id} · ${NOM_FORMA[s.forma]}${s.pare ? ' (dins ' + s.pare.id + ')' : ''} · ${r.conj.nom} · ${s.W} × ${s.D} × ${s.H} mm · ${nomMat(s.material)} ${s.color}${s.angle && !s.pare ? ` · falca ${s.angle}°` : ''}`);
            s.caixetins.forEach((c, i) => linies.push(`   ${i + 1}. ${c.mat.codi} ×${c.qty}  ${c.mat.nom}`));
        }));
        linies.push('', 'FILAMENT NECESSARI (estimació)');
        FO.resumFilament(PLA, cfg()).forEach(e => linies.push(`   ${nomMat(e.material).padEnd(26)} ${e.color}  ${String(e.peces).padStart(3)} peces  ≈ ${Math.round(e.grams)} g`));
        linies.push('', 'Els noms dels fitxers porten el material i el color: NN_ID_MATERIAL_COLOR.stl', 'Recomanació: 2-3 perímetres, 10-15 % de farciment, sense suports.');
        fitxers.push({ nom: 'LLEGEIX-ME.txt', dades: linies.join('\r\n') });
        fitxers.push({ nom: FO.nomFitxer(P.nom) + '.fordre.json', dades: JSON.stringify(P) });
        descarrega(FO.nomFitxer(P.nom) + '_impressio.zip', FO.zip(fitxers), 'application/zip');
        hint(`${fitxers.length - 2} fitxers STL exportats`);
    }

    function fullDeRuta() {
        let h = `<!doctype html><html lang="ca"><head><meta charset="utf-8"><title>Full de ruta · ${esc(P.nom)}</title><style>
            body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:14mm}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 6px;padding:4px 8px;color:#fff;border-radius:4px}
            .saf{display:flex;gap:14px;align-items:flex-start;margin:8px 0 12px;page-break-inside:avoid}table{border-collapse:collapse;flex:1}td,th{border:1px solid #bbb;padding:3px 5px;text-align:left}th{background:#eee}
            .sw{display:inline-block;width:10px;height:10px;border-radius:2px;border:1px solid #0003;vertical-align:middle}.ck{width:14px}.pas{page-break-inside:avoid}.en{color:#444;margin:4px 0}
            @media print{h2{-webkit-print-color-adjust:exact;print-color-adjust:exact}.sw{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
            <h1>${esc(P.nom)} — full de ruta de muntatge</h1><div>${new Date().toLocaleDateString('ca-ES')} · ${PLA.length} passos · FOrdre ${FO.VERSIO}</div>`;
        PLA.forEach(r => {
            h += `<div class="pas"><h2 style="background:${r.conj.col}">Pas ${r.pas} · ${esc(r.conj.codi)} · ${esc(r.conj.nom)}${r.multiplicador > 1 ? ` (×${r.multiplicador})` : ''}</h2>`;
            if (r.entrades.length) h += `<div class="en"><b>Cal tenir muntat:</b> ${r.entrades.map(e => `${esc(e.conj.codi)} ${esc(e.conj.nom)} ×${e.qty}`).join(' · ')}</div>`;
            if (r.conj.notes) h += `<div class="en"><b>Notes:</b> ${esc(r.conj.notes)}</div>`;
            r.safates.forEach(s => {
                const files = s.forma === 'contenidor'
                    ? s.caixes.flatMap(q => q.obj.caixetins.map(c => [q.obj, c]))
                    : s.caixetins.map(c => [s, c]);
                h += `<div class="saf"><div>${svgPlanta(s, null, 260)}<div style="text-align:center"><b>${esc(s.id)}</b> · ${esc(NOM_FORMA[s.forma])}${s.tipus === 'esd' ? ' ⚡ESD' : s.tipus === 'muntat' ? ' ▣ guarda' : ''}</div></div>
                    <table><tr><th class="ck">✓</th><th>#</th><th>Codi</th><th>Nom</th><th>Qt.</th><th>Disposició</th>${s.forma === 'contenidor' ? '<th>Caixa</th>' : ''}</tr>` +
                    files.map(([o, c], i) => `<tr><td class="ck">☐</td><td>${i + 1}</td><td><span class="sw" style="background:${c.mat.col}"></span> ${esc(c.mat.codi)}</td><td>${esc(c.mat.nom)}${c.mat.esd ? ' ⚡' : ''}${c.mat.liquid ? ' 💧' : ''}</td><td>${c.qty}</td><td>${esc(FO.DISPOSICIONS[c.mode])}</td>${s.forma === 'contenidor' ? `<td><span class="sw" style="background:${o.color}"></span> ${esc(o.bloc ? o.id : o.material)}</td>` : ''}</tr>`).join('') + '</table></div>';
            });
            if (r.fora.length) h += `<div class="en"><b>Preparar a part (no cap a la safata):</b> ${r.fora.map(c => `${esc(c.mat.codi)} ×${c.qty}`).join(', ')}</div>`;
            h += '</div>';
        });
        h += '<script>setTimeout(()=>print(),400)<\/script></body></html>';
        finestra(h);
    }

    // ─── Configuració ───
    const CAMPS_CFG = [
        ['Impressora 3D', [['llit.x', 'Llit X (mm)'], ['llit.y', 'Llit Y (mm)'], ['llit.z', 'Alçada màx. Z (mm)']]],
        ['Safata', [['paret', 'Paret exterior (mm)'], ['terra', 'Terra (mm)'], ['separador', 'Parets entre caixetins (mm)'], ['divisor', 'Divisors de cel·les (mm)'], ['llavi', 'Llavi antivessament (mm)'], ['inclinacio', 'Inclinació de les safates (°)']]],
        ['Caixes i contenidor', [['paretCaixa', 'Paret de les caixes (mm)'], ['paretContenidor', 'Paret del contenidor (mm)'], ['jocCaixes', 'Joc entre caixes (mm)'], ['alcadaContenidor', 'Alçada contenidor / caixa més alta (0-1)'], ['factorPes', 'Plàstic real per estimar grams (0-1)']]],
        ['Caixetins', [['joc', 'Folgança al voltant de la peça (mm)'], ['dit', 'Espai per als dits (mm)'], ['minCaixeti', 'Amplada mínima (mm)'], ['profMax', 'Fondària màxima (mm)'], ['retencio', 'Part mínima dins de les peces dretes (0-1)'], ['granel', 'Ocupació a granel (0-1)'], ['omplert', 'Nivell d\'ompliment a granel (0-1)'], ['areaPetit', 'Àrea de caixetí petit (mm²)']]]
    ];
    function renderConfig() {
        const c = cfg();
        const val = k => k.includes('.') ? c[k.split('.')[0]][k.split('.')[1]] : c[k];
        $('cfgCos').innerHTML = CAMPS_CFG.map(([t, camps]) => `<div><div class="ps-t">${t}</div><div class="fg3">${camps.map(([k, l]) => `<div class="fi"><label>${esc(l)}</label><input type="number" step="any" data-cfg="${k}" value="${val(k)}"></div>`).join('')}</div></div>`).join('') +
            `<div><div class="ps-t">Format dels kits i materials</div><div class="fg3">
                <div class="fi"><label>Format per defecte</label><select data-cfgsel="formatKit">${Object.entries(FO.FORMATS_KIT).map(([k, f]) => `<option value="${k}"${c.formatKit === k ? ' selected' : ''}>${esc(f.nom)}</option>`).join('')}</select></div>
                ${['materialCaixa', 'materialESD', 'materialContenidor'].map((k, i) => `<div class="fi"><label>${['Material de caixes i safates', 'Material per a peces ESD', 'Material del contenidor'][i]}</label><select data-cfgsel="${k}">${Object.entries(FO.MATERIALS_IMPRESSIO).map(([id, m]) => `<option value="${id}"${c[k] === id ? ' selected' : ''}>${esc(m.nom)}</option>`).join('')}</select></div>`).join('')}
                <div class="fi"><label>Color de les caixes individuals</label><select data-cfgsel="esquemaColor">
                    <option value="material"${c.esquemaColor === 'material' ? ' selected' : ''}>El del material</option>
                    <option value="conjunt"${c.esquemaColor === 'conjunt' ? ' selected' : ''}>El del conjunt</option>
                    <option value="tipus"${c.esquemaColor === 'tipus' ? ' selected' : ''}>Per tipus (peça, cargoleria, consumible)</option>
                    <option value="fix"${c.esquemaColor === 'fix' ? ' selected' : ''}>Un color fix</option></select></div>
                <div class="fi"><label>Color fix / safates</label><input type="color" data-cfgcol="colorCaixa" value="${c.colorCaixa}"></div>
                <div class="fi"><label>Color del contenidor</label><input type="color" data-cfgcol="colorContenidor" value="${c.colorContenidor}"></div>
            </div>
            <div class="ajuda" style="margin-top:6px">${Object.values(FO.FORMATS_KIT).map(f => `<b>${esc(f.nom)}</b>: ${esc(f.desc)}`).join('<br>')}</div>
            <label class="ck" style="margin-top:6px"><input type="checkbox" data-cfgck="ajustaFilaments"${c.ajustaFilaments ? ' checked' : ''}> Ajustar cada color al filament disponible més proper</label>
            <div class="fx" id="cfgFilaments">${c.filaments.map((f, i) => `<span class="fx" style="gap:2px"><input type="color" data-fil="${i}" value="${f}" style="width:34px;height:24px;border:1px solid var(--bd);border-radius:4px;background:none"><button class="b sm" data-filx="${i}" title="Treure">×</button></span>`).join('')}<button class="b sm" id="filNou">+ Filament</button></div>
            </div>
            <div><div class="ps-t">Opcions</div>
            <label class="ck"><input type="checkbox" data-cfgck="esdSeparat"${c.esdSeparat ? ' checked' : ''}> Posar les peces sensibles a l'ESD en una safata a part (per imprimir amb filament antiestàtic)</label>
            <div class="fg3" style="margin-top:6px"><div class="fi"><label>Fons elevat dels caixetins</label><select data-cfgsel="fonsElevat">
                <option value="petits"${c.fonsElevat === 'petits' ? ' selected' : ''}>Només als petits (recomanat)</option>
                <option value="tots"${c.fonsElevat === 'tots' ? ' selected' : ''}>A tots</option>
                <option value="cap"${c.fonsElevat === 'cap' ? ' selected' : ''}>Cap (menys plàstic)</option></select></div></div></div>
            <div><div class="ps-t">Etiquetes</div><div class="fg3">
                <div class="fi"><label>Format</label><select data-cfgsel="etiqueta">${Object.entries(FO.FORMATS_ETIQUETA).map(([k, f]) => `<option value="${k}"${k === c.etiqueta ? ' selected' : ''}>${esc(f.nom)}</option>`).join('')}</select></div>
                <div class="fi"><label>Amplada a mida (mm)</label><input type="number" step="any" data-cfg="etiquetaW" value="${c.etiquetaW || 40}"></div>
                <div class="fi"><label>Alçada a mida (mm)</label><input type="number" step="any" data-cfg="etiquetaH" value="${c.etiquetaH || 15}"></div>
            </div><div class="ajuda" style="margin-top:6px">Les etiquetes porten el codi, el nom, la quantitat, el pas i el conjunt, els colors del material i del conjunt, un QR i (si hi caben) un codi de barres Code 128. El botó <b>RFID / CSV</b> exporta les mateixes dades amb un EPC de 96 bits per a gravadores RFID; al mòbil amb Chrome per a Android es poden escriure etiquetes NFC directament.</div></div>`;
        $('cfgCos').querySelectorAll('[data-cfg]').forEach(i => i.addEventListener('input', () => {
            const k = i.dataset.cfg, v = FO.num(i.value, NaN); if (!isFinite(v)) return;
            if (k.includes('.')) c[k.split('.')[0]][k.split('.')[1]] = v; else c[k] = v;
            $('cartell').dataset.clau = ''; recalcula();
        }));
        $('cfgCos').querySelectorAll('[data-cfgck]').forEach(i => i.addEventListener('change', () => { c[i.dataset.cfgck] = i.checked; recalcula(); }));
        $('cfgCos').querySelectorAll('[data-cfgsel]').forEach(i => i.addEventListener('change', () => { c[i.dataset.cfgsel] = i.value; $('cartell').dataset.clau = ''; recalcula(); }));
        $('cfgCos').querySelectorAll('[data-cfgcol]').forEach(i => i.addEventListener('change', () => { c[i.dataset.cfgcol] = i.value; recalcula(); }));
        $('cfgCos').querySelectorAll('[data-fil]').forEach(i => i.addEventListener('change', () => { c.filaments[+i.dataset.fil] = i.value; recalcula(); }));
        $('cfgCos').querySelectorAll('[data-filx]').forEach(b => b.addEventListener('click', () => { c.filaments.splice(+b.dataset.filx, 1); renderConfig(); recalcula(); }));
        $('filNou').addEventListener('click', () => { c.filaments.push('#808080'); renderConfig(); recalcula(); });
    }
    $('bConfig').onclick = () => { renderConfig(); obre('dlgConfig'); };
    $('cfgDefecte').onclick = () => {
        if (!confirm('Restablir tota la configuració als valors per defecte?')) return;
        P.config = JSON.parse(JSON.stringify(FO.CONFIG_DEFECTE)); renderConfig(); recalcula();
    };

    // ─── Importació ───
    const imp = { fulls: null, files: null, cap: null, map: {} };
    $('bImportar').onclick = () => {
        imp.fulls = null; imp.files = null; $('impFitxer').value = ''; $('impFullBox').style.display = 'none';
        $('impMapa').innerHTML = ''; $('impPrev').innerHTML = ''; $('impRes').textContent = ''; $('impOk').disabled = true;
        ajudaFormat(); obre('dlgImport');
    };
    function ajudaFormat() {
        $('impAjuda').innerHTML = $('impFormat').value === 'bom'
            ? 'BOM indentada exportada de FreeCAD, Fusion 360, SolidWorks, Inventor, Onshape… Cal una columna de <b>nivell</b> (1, 2, 3 · 1.2.3 · o el nom sagnat), una de <b>codi</b> i una de <b>quantitat</b>. Les files que tenen fills es converteixen en conjunts; si porten mides, són la peça muntada.'
            : 'Una fila per material, amb la columna <b>conjunt</b> on es munta (i opcionalment el <b>pare</b> del conjunt). Una fila amb conjunt però sense codi de material defineix el conjunt: la quantitat i les mides de la peça muntada. Descarrega la <b>Plantilla CSV</b> per veure un exemple.';
    }
    $('impFitxer').addEventListener('change', async function () {
        const f = this.files[0]; if (!f) return;
        try {
            const r = await FO.llegeixFitxer(f);
            if (r.json) { tanca('dlgImport'); carregaProjecte(r.json, 'Projecte obert'); return; }
            imp.fulls = r;
            $('impFull').innerHTML = r.map((s, i) => `<option value="${i}">${esc(s.nom)}</option>`).join('');
            $('impFullBox').style.display = r.length > 1 ? 'block' : 'none';
            triaFull(0);
        } catch (e) { $('impRes').innerHTML = `<span class="av er">⚠ ${esc(e.message)}</span>`; }
    });
    $('impFull').addEventListener('change', function () { triaFull(+this.value); });
    function triaFull(i) {
        const files = imp.fulls[i].files || [];
        const h = FO.trobaCapcalera(files);
        imp.cap = (files[h] || []).map(String);
        imp.files = files.slice(h + 1);
        imp.map = FO.detectaColumnes(imp.cap);
        $('impFormat').value = FO.formatProbable(imp.map);
        ajudaFormat(); renderMapa(); previsualitza();
    }
    function renderMapa() {
        $('impMapa').innerHTML = Object.entries(FO.CAMPS_IMPORT).map(([k, d]) => `<div class="fi"><label>${esc(d.nom)}</label><select data-camp="${k}"><option value="">—</option>${imp.cap.map((c, i) => `<option value="${i}"${imp.map[k] === i ? ' selected' : ''}>${esc(c || '(col. ' + (i + 1) + ')')}</option>`).join('')}</select></div>`).join('');
        $('impMapa').querySelectorAll('select').forEach(s => s.addEventListener('change', () => {
            if (s.value === '') delete imp.map[s.dataset.camp]; else imp.map[s.dataset.camp] = +s.value;
            previsualitza();
        }));
    }
    function previsualitza() {
        if (!imp.files) return;
        $('impPrev').innerHTML = `<table><tr>${imp.cap.map(c => `<th>${esc(c)}</th>`).join('')}</tr>${imp.files.slice(0, 8).map(f => `<tr>${imp.cap.map((_, i) => `<td>${esc(f[i])}</td>`).join('')}</tr>`).join('')}</table>`;
        try {
            const r = FO.construeixImport(imp.files, imp.map, $('impFormat').value, { mida: $('impMida').value, pes: $('impPes').value });
            imp.res = r;
            $('impRes').innerHTML = `Es llegiran <b>${r.conjunts.length}</b> conjunts i <b>${r.materials.length}</b> materials (${imp.files.length} files).` +
                (r.avisos.length ? `<div class="av">${r.avisos.slice(0, 6).map(esc).join('<br>')}${r.avisos.length > 6 ? `<br>… i ${r.avisos.length - 6} avisos més` : ''}</div>` : '');
            $('impOk').disabled = !(r.materials.length || r.conjunts.length);
        } catch (e) { $('impRes').innerHTML = `<span class="av er">⚠ ${esc(e.message)}</span>`; $('impOk').disabled = true; }
    }
    ['impFormat', 'impMida', 'impPes'].forEach(id => $(id).addEventListener('change', () => { ajudaFormat(); previsualitza(); }));
    $('impOk').onclick = () => {
        const mode = document.querySelector('input[name=impMode]:checked').value;
        const nou = FO.incorporaImport(P, imp.res, mode);
        tanca('dlgImport');
        carregaProjecte(nou, `Importats ${imp.res.conjunts.length} conjunts i ${imp.res.materials.length} materials`);
    };

    // ─── Teclat ───
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { document.querySelectorAll('.ov.on').forEach(o => tanca(o.id)); return; }
        if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
        if (e.key === 'f' || e.key === 'F') vista.enfoca();
        if (e.key === 'Home') vista.veureTot();
        if (e.key === 'Delete') $('bEliminar').click();
    });

    // ─── Inici ───
    const desat = llegeixLocal();
    carregaProjecte(desat && desat.conjunts && desat.conjunts.length ? desat : FO.exemple());
    G.FOrdreApp = { get projecte() { return P; }, get pla() { return PLA; }, selecciona, vista };
})(window);
