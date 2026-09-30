// ═══════════════════════════════════════════════════════════════
// FOrdre — Interfície: arbre, fitxes, importació, exportacions
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO;
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (v, d) => (Math.round(v * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toLocaleString('ca-ES');
    const CLAU_LOCAL = 'fordre.projecte.v1';   // compartida amb l'app del taller

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
        if (taller.url) actualitzaTaller();
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
                ${['muntat', 'verificat', 'rebutjat', 'en curs'].includes(estatConjTaller(c.id)) ? xipPas(estatConjTaller(c.id)) : ''}
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

    const SUFIX = { objecte: '', tapa: '_tapa', falca: '_falca' };

    function blocSafata(s, marcats) {
        const g = FO.gramsFilament(s, cfg());
        const tots = s.forma === 'contenidor' ? s.caixes.map(c => c.obj) : [];
        const av = s.avisos.concat(...s.caixetins.map(c => c.avisos.map(a => `${c.mat.codi}: ${a}`)), ...tots.map(o => o.avisos.map(a => `${o.id}: ${a}`)));
        const tipus = s.tipus === 'esd' ? '⚡ ESD' : s.tipus === 'muntat' ? '▣ Guarda' : s.bloc ? 'Bloc de petits' : NOM_FORMA[s.forma];
        const nCaix = s.forma === 'contenidor' ? `${s.caixes.length} caixes` : `${s.caixetins.length} caixetins`;
        return `<div class="sf${marcats ? ' sel' : ''}">
            <div class="sf-h"><span>${esc(s.id)}</span><span class="bd mt">${tipus}</span></div>
            <div class="sf-d">${fmt(s.W, 1)} × ${fmt(s.D, 1)} × ${fmt(s.H, 1)} mm · ${nCaix} · peces ${fmt(s.pes, 0)} g${s.angle ? ` · inclinada ${s.angle}°` : ''}</div>
            <div class="sf-d">${swatch(s.color)} ${esc(nomMat(s.material))} · ≈ ${fmt(g, 0)} g de filament${s.forma !== 'contenidor' || s.tancament !== 'llavi' ? ` · ${esc(FO.TANCAMENTS[s.tancament || 'cap'].nom)}${s.tancament === 'llavi' ? ' ' + fmt(cfg().llaviAmple, 1) + ' mm' : ''}` : ''}</div>
            <div style="margin:6px 0;text-align:center">${svgPlanta(s, marcats, 290)}</div>
            ${tots.length ? `<table class="tt" style="margin-bottom:4px">${tots.map(o => `<tr><td>${swatch(o.color)}</td><td style="font-family:var(--mn)">${esc(o.id)}</td><td>${esc(o.bloc ? 'bloc de petits' : o.caixetins[0].mat.nom)}</td><td>${esc(o.material)}</td><td><button class="b sm" data-stl="${esc(o.id)}" title="STL d'aquesta caixa">STL</button>${FO.opsTapa(o, cfg()) ? ` <button class="b sm" data-tapa="${esc(o.id)}" title="STL de la tapa">Tapa</button>` : ''}</td></tr>`).join('')}</table>` : ''}
            ${av.map(a => `<div class="av">⚠ ${esc(a)}</div>`).join('')}
            <div class="fx" style="margin-top:6px">
                <button class="b sm" data-stl="${esc(s.id)}">⬇ STL${s.forma === 'contenidor' ? ' contenidor' : ''}</button>
                ${FO.opsTapa(s, cfg()) ? `<button class="b sm" data-tapa="${esc(s.id)}">⬇ Tapa</button>` : ''}
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
            ${(P.revisions || []).length ? `<div class="ps"><div class="ps-t">Revisions de la llista de materials</div>${P.revisions.slice().reverse().map(r => `<details style="margin-bottom:4px"><summary style="cursor:pointer">${esc(new Date(r.data).toLocaleString('ca-ES'))}${r.origen ? ' · ' + esc(r.origen) : ''} · ${r.reimprimir.length} a imprimir</summary><ul style="margin:4px 0 0 18px;font-size:11px">${r.canvis.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>`).join('')}</div>` : ''}
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
                    <div class="fi full"><label>Tancament</label><select data-kk="tancament"><option value="">Per defecte del projecte (${esc(FO.TANCAMENTS[cfg().tancament].nom)})</option>${Object.entries(FO.TANCAMENTS).map(([k, t]) => `<option value="${k}"${c.tancament === k ? ' selected' : ''}>${esc(t.nom)}</option>`).join('')}</select></div>
                    ${selMaterial('materialCaixa', 'Material de caixes i safates', c.materialCaixa, cfg().materialCaixa)}
                    ${selColor('colorCaixa', 'Color de safates / fix', c.colorCaixa, cfg().colorCaixa)}
                    ${selMaterial('materialContenidor', 'Material del contenidor', c.materialContenidor, cfg().materialContenidor)}
                    ${selColor('colorContenidor', 'Color del contenidor', c.colorContenidor, cfg().colorContenidor)}
                </div></div>
            <div class="ps" id="psMuntatge"><div class="ps-t">Instruccions de muntatge</div>
                <div class="fg">
                    <div class="fi full"><label>Passos (un per línia; a l'app del mòbil es marquen un a un)</label><textarea id="cjInstr" style="height:90px">${esc(c.instruccions)}</textarea></div>
                    <div class="fi full"><label>Eines necessàries</label><input type="text" id="cjEines" value="${esc(c.eines)}"></div>
                    <div class="fi full"><label>Imatge de referència (resultat esperat)</label>
                        <div class="fx">${c.imatge ? `<img src="${esc(c.imatge)}" alt="" style="max-width:120px;max-height:90px;border-radius:4px;border:1px solid var(--bd)">` : ''}
                        <input type="file" id="cjImatge" accept="image/*" style="max-width:200px">${c.imatge ? '<button class="b sm dg" id="cjImatgeX">Treure</button>' : ''}</div></div>
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
        $('cjInstr').addEventListener('input', function () { c.instruccions = this.value; desaLocal(); });
        $('cjEines').addEventListener('input', function () { c.eines = this.value; desaLocal(); });
        $('cjImatge').addEventListener('change', async function () {
            const f = this.files[0]; if (!f) return;
            try { c.imatge = await redueixImatge(f, 900); desaLocal(); renderFitxa(); } catch (e) { hint('No s\'ha pogut llegir la imatge'); }
        });
        if ($('cjImatgeX')) $('cjImatgeX').addEventListener('click', () => { c.imatge = ''; desaLocal(); renderFitxa(); });
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

    // Redueix una imatge a un JPEG de com a màxim `mx` píxels (per guardar-la dins el projecte)
    function redueixImatge(f, mx) {
        return new Promise((ok, ko) => {
            const img = new Image(), url = URL.createObjectURL(f);
            img.onload = () => {
                const k = Math.min(1, mx / Math.max(img.width, img.height));
                const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = ko; img.src = url;
        });
    }

    function accionsSafates(el) {
        el.querySelectorAll('[data-stl]').forEach(b => b.addEventListener('click', () => {
            const { s, r } = safataPerId(b.dataset.stl);
            descarrega(nomSTL(r, s), FO.stlBinari(FO.mallaSafata(s, cfg()), s.id), 'model/stl');
        }));
        el.querySelectorAll('[data-tapa]').forEach(b => b.addEventListener('click', () => {
            const { s, r } = safataPerId(b.dataset.tapa);
            descarrega(nomSTL(r, s, '_tapa'), FO.stlBinari(FO.mallaTapa(s, cfg()), s.id + ' tapa'), 'model/stl');
        }));
        el.querySelectorAll('[data-stlzip]').forEach(b => b.addEventListener('click', () => {
            const { s, r } = safataPerId(b.dataset.stlzip);
            const f = [];
            [s].concat(s.caixes.map(c => c.obj)).forEach(o => FO.pecesImpressio(o, cfg()).forEach(pc => f.push({ nom: nomSTL(r, o, SUFIX[pc.tipus]), dades: FO.stlBinari(pc.tri, pc.nom) })));
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

    // Forma real de la peça (STL) per fer-ne el niu
    function blocNiu(m) {
        return `<div class="ps" id="blocNiu"><div class="ps-t">Forma real de la peça (niu a mida)</div>
            ${m.niu ? `<div class="fx" style="align-items:flex-start"><canvas id="niuPrev" width="${m.niu.nx}" height="${m.niu.ny}" style="width:140px;image-rendering:pixelated;border:1px solid var(--bd);border-radius:4px;background:#000"></canvas>
                <div class="ajuda" style="flex:1">${esc(m.niu.fitxer || 'STL')}<br>${fmt(m.x, 1)} × ${fmt(m.y, 1)} × ${fmt(m.z, 1)} mm · graella ${m.niu.nx} × ${m.niu.ny} (${m.niu.res} mm)<br>Cada unitat té la seva cel·la amb el fons fet amb la forma de la cara de sota de la peça. La peça es col·loca tal com està orientada a l'STL.</div></div>
                <div class="fx" style="margin-top:6px"><button class="b sm dg" id="niuX">Treure la forma real</button></div>`
            : `<div class="ajuda">Carrega l'STL de la peça (tal com vols que reposi a la caixa) i el fons de la cel·la tindrà la seva forma: ideal per a plaques amb components, peces corbades o fràgils.</div>
                <input type="file" id="niuFitxer" accept=".stl,model/stl" style="margin-top:6px">`}</div>`;
    }
    function enllacaNiu(el, m) {
        const cv = el.querySelector('#niuPrev');
        if (cv && m.niu) {
            const x = cv.getContext('2d'), img = x.createImageData(m.niu.nx, m.niu.ny), mx = Math.max(...m.niu.h) || 1;
            for (let i = 0; i < m.niu.nx; i++) for (let j = 0; j < m.niu.ny; j++) {
                const v = m.niu.h[i * m.niu.ny + j], k = ((m.niu.ny - 1 - j) * m.niu.nx + i) * 4, g = v < 0 ? 0 : 255 - Math.round(v / mx * 200);
                img.data[k] = v < 0 ? 30 : g * 0.55; img.data[k + 1] = v < 0 ? 30 : g * 0.8; img.data[k + 2] = v < 0 ? 40 : g; img.data[k + 3] = 255;
            }
            x.putImageData(img, 0, 0);
        }
        const f = el.querySelector('#niuFitxer');
        if (f) f.addEventListener('change', async () => {
            const fitxer = f.files[0]; if (!fitxer) return;
            try {
                const r = FO.rasteritzaNiu(FO.llegeixSTL(await fitxer.arrayBuffer()));
                Object.assign(m, { x: r.x, y: r.y, z: r.z, niu: Object.assign(r.niu, { fitxer: fitxer.name }) });
                recalcula(true); renderFitxa(); hint(`Forma real carregada: ${r.triangles} triangles`);
            } catch (e) { hint('No s\'ha pogut llegir l\'STL: ' + e.message, 4000); }
        });
        const x = el.querySelector('#niuX');
        if (x) x.addEventListener('click', () => { m.niu = null; recalcula(true); renderFitxa(); });
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
            <div class="fi"><label>Total a preparar</label><input type="text" disabled value="${it.qty * k}${k > 1 ? ` (${it.qty} × ${k})` : ''}"></div>
            <div class="fi"><label title="Parell de collada per a aquest element (0 = no s'aplica)">Parell de collada (N·m) ⓘ</label><input type="number" min="0" step="0.1" id="itParell" value="${it.parell || 0}"></div>
            <div class="fi full"><label>Nota de muntatge</label><input type="text" id="itNota" value="${esc(it.nota || '')}" placeholder="p. ex. una gota de frenafils, en creu…"></div></div></div>
            ${blocCaixeti(sel.info)}
            ${blocEtiqueta(e)}
            ${blocCaixaMat(m, sel.info && sel.info.safata)}
            ${blocNiu(m)}
            <div class="ps"><div class="ps-t">Material${usos.length > 1 ? ` · s'usa a ${usos.length} conjunts` : ''}</div>${formulari(m, CAMPS_MAT, 'm')}</div>`;
        $('itQty').addEventListener('input', function () { it.qty = Math.max(1, Math.round(FO.num(this.value, 1))); recalcula(); });
        $('itParell').addEventListener('input', function () { it.parell = Math.max(0, FO.num(this.value, 0)); desaLocal(); });
        $('itNota').addEventListener('input', function () { it.nota = this.value; desaLocal(); });
        enllaca(el.querySelector('.ps:last-child'), m, o => FO.normalitzaMaterial(o));
        enllacaImpressio(el.querySelector('#blocCaixaMat'), m);
        enllacaNiu(el, m);
        enllacaEtiqueta(el, e);
    }

    function fitxaMat(el, m) {
        if (!m) { sel = null; return renderResum(el); }
        const usos = P.conjunts.filter(x => x.items.some(i => i.mat === m.id));
        el.innerHTML = `<div class="ps"><div class="ps-t"><span class="sw" style="width:12px;height:12px;border-radius:3px;background:${m.col}"></span> Material del catàleg</div>${formulari(m, CAMPS_MAT, 'm')}</div>${blocCaixaMat(m, null)}${blocNiu(m)}
            <div class="ps"><div class="ps-t">S'usa a</div>${usos.length ? usos.map(c => `<div class="nd" data-anar="${esc(c.id)}"><span class="sw" style="background:${c.col}"></span><span class="cd">${esc(c.codi)}</span><span class="nm">${esc(c.nom)}</span><span class="q">×${c.items.find(i => i.mat === m.id).qty}</span></div>`).join('') : '<div class="ajuda">Cap conjunt. Selecciona un conjunt i fes <b>+ Existent</b> per afegir-l\'hi.</div>'}</div>`;
        enllaca(el.querySelector('.ps'), m, o => FO.normalitzaMaterial(o));
        enllacaImpressio(el.querySelector('#blocCaixaMat'), m);
        enllacaNiu(el, m);
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
    $('vTapes').onclick = function () { this.classList.toggle('on'); vista.setTapes(this.classList.contains('on')); };

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
            FO.pecesImpressio(s, cfg()).forEach(pc => fitxers.push({ nom: nomSTL(r, s, SUFIX[pc.tipus]), dades: FO.stlBinari(pc.tri, pc.nom) }));
            linies.push(`Pas ${r.pas} · ${s.id} · ${NOM_FORMA[s.forma]}${s.pare ? ' (dins ' + s.pare.id + ')' : ''} · ${r.conj.nom} · ${s.W} × ${s.D} × ${s.H} mm · ${nomMat(s.material)} ${s.color} · ${FO.TANCAMENTS[s.tancament || 'cap'].nom}${s.angle && !s.pare ? ` · falca ${s.angle}°` : ''}`);
            s.caixetins.forEach((c, i) => linies.push(`   ${i + 1}. ${c.mat.codi} ×${c.qty}  ${c.mat.nom}`));
        }));
        linies.push('', 'FILAMENT NECESSARI (estimació)');
        FO.resumFilament(PLA, cfg()).forEach(e => linies.push(`   ${nomMat(e.material).padEnd(26)} ${e.color}  ${String(e.peces).padStart(3)} peces  ≈ ${Math.round(e.grams)} g`));
        if (cfg().tancament === 'imants' || P.conjunts.some(c => c.tancament === 'imants')) linies.push('', `IMANTS: disc de ${cfg().imantD} × ${cfg().imantH} mm, fixats amb una gota de cianoacrilat. Compte amb la polaritat entre caixa i tapa.`);
        linies.push('', 'Els noms dels fitxers porten el material i el color: NN_ID_MATERIAL_COLOR.stl (les tapes acaben en _tapa: s\'imprimeixen amb la placa a sota).', 'Recomanació: 2-3 perímetres, 10-15 % de farciment, sense suports.');
        fitxers.push({ nom: 'LLEGEIX-ME.txt', dades: linies.join('\r\n') });
        fitxers.push({ nom: FO.nomFitxer(P.nom) + '.fordre.json', dades: JSON.stringify(P) });
        descarrega(FO.nomFitxer(P.nom) + '_impressio.zip', FO.zip(fitxers), 'application/zip');
        hint(`${fitxers.length - 2} fitxers STL exportats`);
    }

    // ─── App del taller (mòbil / tauleta) ───
    const urlMuntatge = () => location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '') + 'muntatge.html';
    async function obreMobil() {
        desaLocal();
        const lleu = FO.projecteLleuger(P, false);
        const codi = await FO.comprimeix(JSON.stringify(lleu));
        const url = urlMuntatge() + '#p=' + codi;
        let qr = '';
        if (FO.hiHaQR()) {
            try { const q = G.qrcode(0, 'L'); q.addData(url); q.make(); qr = q.createSvgTag({ cellSize: 3, margin: 2, scalable: true }); }
            catch (e) { qr = ''; }   // massa gran per a un QR
        }
        const cabQR = !!qr;
        const teImatges = P.conjunts.some(c => c.imatge);
        $('mobilCos').innerHTML = `<div class="ajuda">L'app del taller té una pantalla per a cada rol: Magatzem (omplir les caixes), Muntador (passos, caixes, instruccions i parells de collada), Qualitat (verificació) i Responsable (ordres i resultats). Llegeix els QR de les etiquetes amb la càmera i funciona sense connexió (es pot instal·lar com una app).</div>
            <div><div class="ps-t">En aquest dispositiu</div><a class="b pr" href="${esc(urlMuntatge())}" target="_blank" rel="noopener">Obrir l'app del taller</a>
                <div class="ajuda" style="margin-top:4px">Fa servir el projecte que tens obert ara.</div></div>
            <div><div class="ps-t">En un altre dispositiu</div>
            ${cabQR ? `<div class="fx" style="align-items:flex-start;gap:14px"><div style="width:220px;background:#fff;padding:6px;border-radius:6px">${qr}</div>
                <div class="ajuda" style="flex:1">Escaneja aquest QR amb la càmera del mòbil o la tauleta: s'obrirà l'app amb el projecte carregat.${teImatges ? '<br>Les imatges de referència no hi caben: envia el fitxer si les necessites.' : ''}</div></div>`
                : `<div class="ajuda">El projecte és massa gran per a un QR (${fmt(url.length / 1000, 1)} kB). Fes servir l'enllaç o el fitxer.</div>`}
            <div class="fx" style="margin-top:8px"><button class="b" id="mobCopia">Copiar l'enllaç</button>${navigator.share ? '<button class="b" id="mobShare">Compartir…</button>' : ''}<button class="b" id="mobFitxer">⬇ Fitxer del projecte</button></div>
            <div class="ajuda" style="margin-top:4px">Amb el fitxer: obre l'app del taller al mòbil i tria <b>Obrir fitxer</b>. Inclou les imatges.</div></div>`;
        $('mobCopia').onclick = async () => { try { await navigator.clipboard.writeText(url); hint('Enllaç copiat'); } catch (e) { prompt('Copia l\'enllaç:', url); } };
        if ($('mobShare')) $('mobShare').onclick = async () => {
            const nom = FO.nomFitxer(P.nom) + '.fordre.json';
            const f = new File([JSON.stringify(P)], nom, { type: 'application/json' });
            try {
                if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: P.nom });
                else await navigator.share({ url, title: P.nom });
            } catch (e) { /* cancel·lat */ }
        };
        $('mobFitxer').onclick = () => descarrega(FO.nomFitxer(P.nom) + '.fordre.json', JSON.stringify(P), 'application/json');
        obre('dlgMobil');
    }
    $('bMobil').onclick = () => { obreMobil().catch(e => hint('Error: ' + e.message)); };

    // ─── Servidor del taller ───
    // Des de l'ordinador, el Responsable publica el projecte, obre ordres de
    // fabricació i segueix en directe l'estat de cada pas (el mateix que veuen
    // els mòbils). Cal entrar amb nom i PIN, com a l'app del dispositiu.
    const llegeixLS = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
    const escriuLS = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* */ } };
    const taller = {
        url: '', info: null, prog: null, es: null, projectes: [], ordres: [], ordre: '',
        ses: llegeixLS('fordre.taller.sessio'),
        clau: (() => { try { return localStorage.getItem('fordre.taller.clau') || ''; } catch (e) { return ''; } })()
    };
    const esResp = () => !!(taller.ses && taller.ses.rols.includes('responsable'));
    const qAuth = () => { const q = []; if (taller.ses) q.push('token=' + encodeURIComponent(taller.ses.token)); if (taller.clau) q.push('clau=' + encodeURIComponent(taller.clau)); return q.length ? '?' + q.join('&') : ''; };
    // Petició a l'API del taller amb la clau i la sessió
    async function apiTaller(ruta, opcions) {
        opcions = opcions || {};
        const cap = { 'Content-Type': 'application/json' };
        if (taller.clau) cap['X-FOrdre-Clau'] = taller.clau;
        if (taller.ses) { cap['X-FOrdre-Token'] = taller.ses.token; cap['X-FOrdre-Rol'] = 'responsable'; }
        const r = await fetch(taller.url + ruta, Object.assign({ cache: 'no-store' }, opcions, { headers: cap }));
        let d = null;
        try { d = await r.json(); } catch (e) { /* sense cos */ }
        if (!r.ok) {
            if (r.status === 401 && /sessió/i.test((d && d.error) || '')) { taller.ses = null; escriuLS('fordre.taller.sessio', null); }
            throw new Error((d && d.error) || 'Error ' + r.status);
        }
        return d;
    }
    async function estatTaller() {
        const d = await apiTaller('/api/estat');
        if (d.clau && !taller.clau) {
            const c = prompt('Aquest taller té clau. Escriu-la:');
            if (c) { taller.clau = c; try { localStorage.setItem('fordre.taller.clau', c); } catch (e) { /* */ } }
        }
        return d;
    }
    // L'app d'escriptori s'ha obert des del servidor del taller? Llavors apareix el botó 🏭 Taller
    async function detectaTaller() {
        try {
            const d = await (await fetch('api/estat', { cache: 'no-store' })).json();
            if (d && d.app === 'FOrdre') {
                taller.url = location.origin + location.pathname.replace(/[^/]*$/, '').replace(/\/$/, '');
                taller.info = d; $('bTaller').hidden = false;
                await actualitzaTaller();
            }
        } catch (e) { /* sense servidor: l'app funciona igual */ }
    }
    // Llegeix projectes i ordres del servidor i es connecta a l'ordre triada
    async function actualitzaTaller() {
        if (!taller.url || !taller.ses) return;
        try {
            taller.projectes = await apiTaller('/api/projectes');
            const pub = taller.projectes.find(x => x.id === P.id);
            taller.ordres = pub ? pub.ordres : [];
            if (!taller.ordres.some(o => o.id === taller.ordre)) taller.ordre = taller.ordres.length ? taller.ordres[taller.ordres.length - 1].id : '';
        } catch (e) { taller.projectes = []; taller.ordres = []; }
        escoltaTaller();
    }
    function escoltaTaller() {
        if (taller.es) { taller.es.close(); taller.es = null; }
        taller.prog = null;
        if (!taller.url || !taller.ses || !taller.ordre || typeof EventSource !== 'function') return;
        taller.es = new EventSource(`${taller.url}/api/progres/${encodeURIComponent(P.id)}/${encodeURIComponent(taller.ordre)}/flux${qAuth()}`);
        taller.es.addEventListener('estat', ev => {
            try { taller.prog = FO.normalitzaProgres(JSON.parse(ev.data)); } catch (e) { return; }
            renderArbre();
            if ($('dlgTaller').classList.contains('on')) pintaTaller();
        });
        taller.es.addEventListener('ordres', ev => { try { taller.ordres = JSON.parse(ev.data); } catch (e) { /* */ } });
    }
    // Estat d'un conjunt a l'ordre que se segueix (per a l'arbre)
    function estatConjTaller(conjId) {
        if (!taller.prog) return '';
        const r = perConj.get(conjId);
        return r ? FO.estatPas(taller.prog, conjId, false) : '';
    }
    const xipPas = e => `<span class="bd" style="background:${FO.ESTATS_PAS[e].col};color:#fff">${esc(FO.ESTATS_PAS[e].nom)}</span>`;

    function pintaTaller() {
        const c = $('tallerCos'), I = taller.info || {};
        $('tallerPublica').hidden = $('tallerInforme').hidden = true;
        // 1 · Primer ús: cal crear el Responsable
        if (!I.configurat) {
            c.innerHTML = `<div class="ajuda">Connectat a <b>${esc(taller.url)}</b>. És el primer ús d'aquest servidor: crea el <b>Responsable</b>, que és qui publica projectes, obre ordres i dona d'alta la resta de persones.</div>
                <label class="f">Nom<input id="tlNom"></label><label class="f">PIN (de 4 a 8 xifres)<input id="tlPin" type="password" inputmode="numeric"></label>
                <button class="b pr" id="tlCrea">Crear el Responsable i entrar</button>`;
            $('tlCrea').onclick = async () => {
                try {
                    await apiTaller('/api/persones', { method: 'POST', body: JSON.stringify({ nom: $('tlNom').value.trim(), rols: ['responsable'], pin: $('tlPin').value.trim() }) });
                    taller.info = await estatTaller();
                    await entraTaller($('tlNom').value.trim(), $('tlPin').value.trim());
                } catch (e) { hint(e.message, 4000); }
            };
            return;
        }
        // 2 · Cal entrar amb nom i PIN
        if (!taller.ses) {
            c.innerHTML = `<div class="ajuda">Connectat a <b>${esc(taller.url)}</b>. Entra amb el teu nom i PIN per publicar projectes i seguir les ordres.</div>
                <label class="f">Nom<select id="tlNom"></select></label><label class="f">PIN<input id="tlPin" type="password" inputmode="numeric"></label>
                <button class="b pr" id="tlEntra">Entrar</button>`;
            apiTaller('/api/persones').then(l => { $('tlNom').innerHTML = l.map(x => `<option>${esc(x.nom)}</option>`).join(''); }).catch(() => { });
            const entra = () => entraTaller($('tlNom').value, $('tlPin').value.trim()).catch(e => hint(e.message, 4000));
            $('tlEntra').onclick = entra;
            $('tlPin').onkeydown = e => { if (e.key === 'Enter') entra(); };
            return;
        }
        // 3 · Amb sessió: publicar, ordres i seguiment
        const pub = taller.projectes.find(x => x.id === P.id), pr = taller.prog;
        const ord = taller.ordres.find(o => o.id === taller.ordre);
        const canviat = pub && ord && ord.empremta && pub.empremta !== ord.empremta;
        $('tallerPublica').hidden = !esResp();
        $('tallerInforme').hidden = !pr;
        let res = null;
        if (pr) res = FO.resumOrdre(FO.modelTaller(P), pr);
        c.innerHTML = `<div class="ajuda">Connectat a <b>${esc(taller.url)}</b> (FOrdre ${esc(I.versio)}) com a <b>${esc(taller.ses.nom)}</b> (${taller.ses.rols.map(r => FO.ROLS[r].nom).join(', ')}) · <a href="#" id="tlSurt">sortir</a>.
                Els mòbils i les tauletes obren <b>${esc(taller.url)}/muntatge.html</b>.</div>
            <div class="${pub ? 'ajuda' : 'av'}">${pub ? '✓ Aquest projecte ja és al taller. Si l\'has canviat, torna\'l a publicar: els mòbils rebran l\'avís per actualitzar-lo.' : esResp() ? 'Aquest projecte encara no és al taller: publica\'l perquè es pugui fabricar.' : 'Aquest projecte encara no és al taller: l\'ha de publicar un Responsable.'}</div>
            ${pub ? `<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
                <label class="f" style="flex:1;min-width:200px">Ordre de fabricació<select id="tlOrdre">${taller.ordres.map(o => `<option value="${esc(o.id)}"${o.id === taller.ordre ? ' selected' : ''}>${esc(o.codi)}${o.serie ? ' · ' + esc(o.serie) : ''}${o.tancada ? ' · tancada' : ''} (${o.passosFets} muntats)</option>`).join('')}</select></label>
                ${esResp() ? `<label class="f">Núm. de sèrie<input id="tlSerie" style="width:120px"></label><button class="b" id="tlNova">+ Nova ordre</button>` : ''}</div>` : ''}
            ${canviat ? '<div class="av">El projecte s\'ha tornat a publicar després de crear aquesta ordre: els passos poden no coincidir exactament.</div>' : ''}
            ${res ? `<div class="ajuda"><b>${esc(FO.textEstatOrdre(res))}</b> · ${res.verificats}/${res.total} verificats · ${res.muntats} per verificar · ${res.rebutjos} rebutjos · ${res.incidenciesObertes} incidències obertes · ${res.mancantsOberts} mancants oberts · ${res.parcials} muntats amb mancants · temps de muntatge ${FO.textDurada(res.tempsMuntatge)}</div>
            <table class="tt"><thead><tr><th>Pas</th><th>Conjunt</th><th>Estat</th><th>Muntat per</th><th class="n">Durada</th><th>Verificat per</th></tr></thead><tbody>${res.passos.map(x => `<tr><td>${x.pas}</td>
                <td><span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${x.r.conj.col}"></span> ${esc(x.codi)} · ${esc(x.nom)}${x.assignat ? ` <span class="ajuda">(👤 ${esc(x.assignat)})</span>` : ''}</td>
                <td>${xipPas(x.estat)}${x.rebutjos.length ? ` <span class="ajuda">✗${x.rebutjos.length}</span>` : ''}</td><td>${esc(x.muntador)}</td><td class="n">${FO.textDurada(x.durada)}</td><td>${esc(x.verificador)}</td></tr>`).join('')}</tbody></table>
            <div><div class="ps-t">Darrers moviments</div><div class="ajuda">${pr.registre.slice().sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 12).map(x => `${esc(new Date(x.ts).toLocaleString('ca-ES'))}${x.op ? ' · <b>' + esc(x.op) + '</b>' : ''} — ${esc(x.text)}`).join('<br>') || 'Encara no hi ha moviments.'}</div></div>` : ''}
            ${taller.projectes.length ? `<div><div class="ps-t">Projectes al taller</div>${taller.projectes.map(x => `<div class="ajuda">${esc(x.nom)} · ${x.ordres.length} ordres · ${esc(new Date(x.actualitzat).toLocaleString('ca-ES'))}</div>`).join('')}</div>` : ''}`;
        $('tlSurt').onclick = e => {
            e.preventDefault();
            apiTaller('/api/sessio', { method: 'DELETE' }).catch(() => { });
            taller.ses = null; escriuLS('fordre.taller.sessio', null); escoltaTaller(); renderArbre(); pintaTaller();
        };
        if ($('tlOrdre')) $('tlOrdre').onchange = function () { taller.ordre = this.value; escoltaTaller(); pintaTaller(); };
        if ($('tlNova')) $('tlNova').onclick = async () => {
            try {
                const o = await apiTaller('/api/ordres/' + encodeURIComponent(P.id), { method: 'POST', body: JSON.stringify({ serie: $('tlSerie').value.trim() }) });
                taller.ordre = o.id; await actualitzaTaller(); pintaTaller(); hint('Ordre ' + o.codi + ' creada');
            } catch (e) { hint(e.message, 4000); }
        };
    }
    async function entraTaller(nom, pin) {
        const d = await apiTaller('/api/sessio', { method: 'POST', body: JSON.stringify({ nom, pin }) });
        taller.ses = { token: d.token, nom: d.nom, rols: d.rols };
        escriuLS('fordre.taller.sessio', taller.ses);
        await actualitzaTaller();
        pintaTaller();
    }
    $('bTaller').onclick = async () => {
        try { taller.info = await estatTaller(); } catch (e) { /* */ }
        await actualitzaTaller();
        pintaTaller(); obre('dlgTaller');
    };
    $('tallerPublica').onclick = async () => {
        try {
            await apiTaller('/api/projectes/' + encodeURIComponent(P.id), { method: 'PUT', body: JSON.stringify(P) });
            await actualitzaTaller(); pintaTaller(); hint('Projecte publicat al taller');
        } catch (e) { hint('No s\'ha pogut publicar: ' + e.message, 4000); }
    };
    $('tallerInforme').onclick = () => {
        if (!taller.prog) return;
        const ord = taller.ordres.find(o => o.id === taller.ordre) || { codi: taller.ordre };
        const pub = taller.projectes.find(x => x.id === P.id);
        const html = FO.informeHTML(FO.modelTaller(P), taller.prog, ord, { empremtaActual: pub && pub.empremta });
        const w = window.open('', '_blank');
        if (w) { w.document.write(html); w.document.close(); } else descarrega(`informe_${ord.codi}.html`, html, 'text/html');
    };

    // ─── Tandes d'impressió ───
    let TANDES = [];
    function svgTanda(t) {
        const W = cfg().llit.x, D = cfg().llit.y, k = Math.min(160 / W, 160 / D);
        return `<svg viewBox="-2 -2 ${W + 4} ${D + 4}" width="${(W * k).toFixed(0)}" height="${(D * k).toFixed(0)}"><rect x="0" y="0" width="${W}" height="${D}" fill="none" stroke="#888" stroke-dasharray="4 3"/>` +
            t.items.map(it => { const w = it.girat ? it.p.D : it.p.W, d = it.girat ? it.p.W : it.p.D; return `<rect x="${it.x}" y="${D - it.y - d}" width="${w}" height="${d}" fill="${t.color}" fill-opacity="${it.p.tipus === 'tapa' ? 0.45 : 0.85}" stroke="#222"/>`; }).join('') + '</svg>';
    }
    function obreTandes() {
        TANDES = FO.tandes(PLA, cfg());
        const hores = TANDES.reduce((a, t) => a + t.hores, 0), g = TANDES.reduce((a, t) => a + t.grams, 0);
        $('tandesCos').innerHTML = `<div class="ajuda">Les peces (caixes, safates, contenidors, tapes i falques) s'agrupen per <b>material i color</b> i es col·loquen al llit de ${cfg().llit.x} × ${cfg().llit.y} mm. Cada tanda es descarrega en <b>3MF</b> amb les peces ja posicionades. Total: <b>${TANDES.length}</b> tandes · ≈ <b>${fmt(g, 0)} g</b> · ≈ <b>${fmt(hores, 1)} h</b> (estimació amb un cabal de ${cfg().cabal} mm³/s).</div>` +
            TANDES.map((t, i) => `<div class="sf" style="display:flex;gap:12px;align-items:flex-start">${svgTanda(t)}<div style="flex:1">
                <div class="sf-h">${swatch(t.color)} Tanda ${t.num} · ${esc(nomMat(t.material))} ${t.color}${t.massaGran ? ' <span class="bd av">no cap al llit</span>' : ''}</div>
                <div class="sf-d">${t.items.length} peces · ≈ ${fmt(t.grams, 0)} g · ≈ ${fmt(t.hores, 1)} h</div>
                <div class="ajuda" style="margin:4px 0">${t.items.map(it => esc(it.p.nom)).join(' · ')}</div>
                <button class="b sm" data-tanda="${i}">⬇ 3MF</button></div></div>`).join('');
        $('tandesCos').querySelectorAll('[data-tanda]').forEach(b => b.addEventListener('click', () => {
            const t = TANDES[+b.dataset.tanda];
            descarrega(nomTanda(t) + '.3mf', FO.tresMF(t, nomTanda(t)), 'model/3mf');
        }));
        obre('dlgTandes');
    }
    const nomTanda = t => `Tanda${String(t.num).padStart(2, '0')}_${FO.nomFitxer(t.material)}_${t.color.slice(1).toUpperCase()}`;
    $('bTandes').onclick = obreTandes;
    $('tandesZip').onclick = () => {
        const f = TANDES.map(t => ({ nom: nomTanda(t) + '.3mf', dades: FO.tresMF(t, nomTanda(t)) }));
        f.push({ nom: 'TANDES.txt', dades: TANDES.map(t => `${nomTanda(t)}: ${t.items.length} peces, ${Math.round(t.grams)} g, ${t.hores.toFixed(1)} h\r\n   ${t.items.map(it => it.p.nom).join(', ')}`).join('\r\n') });
        descarrega(FO.nomFitxer(P.nom) + '_tandes.zip', FO.zip(f), 'application/zip');
    };

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
            if (r.conj.eines) h += `<div class="en"><b>🔧 Eines:</b> ${esc(r.conj.eines)}</div>`;
            const item = m => r.conj.items.find(i => i.mat === m.id) || {};
            r.safates.forEach(s => {
                const files = s.forma === 'contenidor'
                    ? s.caixes.flatMap(q => q.obj.caixetins.map(c => [q.obj, c]))
                    : s.caixetins.map(c => [s, c]);
                h += `<div class="saf"><div>${svgPlanta(s, null, 260)}<div style="text-align:center"><b>${esc(s.id)}</b> · ${esc(NOM_FORMA[s.forma])}${s.tipus === 'esd' ? ' ⚡ESD' : s.tipus === 'muntat' ? ' ▣ guarda' : ''}</div></div>
                    <table><tr><th class="ck">✓</th><th>#</th><th>Codi</th><th>Nom</th><th>Qt.</th><th>N·m</th><th>Nota</th>${s.forma === 'contenidor' ? '<th>Caixa</th>' : ''}</tr>` +
                    files.map(([o, c], i) => { const it = item(c.mat); return `<tr><td class="ck">☐</td><td>${i + 1}</td><td><span class="sw" style="background:${c.mat.col}"></span> ${esc(c.mat.codi)}</td><td>${esc(c.mat.nom)}${c.mat.esd ? ' ⚡' : ''}${c.mat.liquid ? ' 💧' : ''}</td><td>${c.qty}</td><td><b>${it.parell ? fmt(it.parell, 1) : ''}</b></td><td>${esc(it.nota || '')}</td>${s.forma === 'contenidor' ? `<td><span class="sw" style="background:${o.color}"></span> ${esc(o.bloc ? o.id : o.material)}</td>` : ''}</tr>`; }).join('') + '</table></div>';
            });
            const instr = r.conj.instruccions.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
            if (instr.length || r.conj.imatge) h += `<div class="saf">${r.conj.imatge ? `<img src="${esc(r.conj.imatge)}" alt="" style="max-width:240px;max-height:180px;border:1px solid #bbb;border-radius:4px">` : ''}
                ${instr.length ? `<table><tr><th class="ck">✓</th><th>Muntatge</th></tr>${instr.map((t, i) => `<tr><td class="ck">☐</td><td><b>${i + 1}.</b> ${esc(t)}</td></tr>`).join('')}</table>` : ''}</div>`;
            h += `<div class="en">Muntat per: ____________________ &nbsp; Data: ____________ &nbsp; Signatura: ____________</div>`;
            if (r.fora.length) h += `<div class="en"><b>Preparar a part (no cap a la safata):</b> ${r.fora.map(c => `${esc(c.mat.codi)} ×${c.qty}`).join(', ')}</div>`;
            h += '</div>';
        });
        h += '<script>setTimeout(()=>print(),400)<\/script></body></html>';
        finestra(h);
    }

    // ─── Configuració ───
    const CAMPS_CFG = [
        ['Impressora 3D', [['llit.x', 'Llit X (mm)'], ['llit.y', 'Llit Y (mm)'], ['llit.z', 'Alçada màx. Z (mm)'], ['cabal', 'Cabal mitjà (mm³/s), per estimar temps'], ['separacioTanda', 'Separació entre peces al llit (mm)']]],
        ['Safata', [['paret', 'Paret exterior (mm)'], ['terra', 'Terra (mm)'], ['separador', 'Parets entre caixetins (mm)'], ['divisor', 'Divisors de cel·les (mm)'], ['llavi', 'Vora alta de les parets (mm)'], ['inclinacio', 'Inclinació de les safates (°)']]],
        ['Caixes i contenidor', [['paretCaixa', 'Paret de les caixes (mm)'], ['paretContenidor', 'Paret del contenidor (mm)'], ['jocCaixes', 'Joc entre caixes (mm)'], ['alcadaContenidor', 'Alçada contenidor / caixa més alta (0-1)'], ['factorPes', 'Plàstic real per estimar grams (0-1)']]],
        ['Caixetins', [['joc', 'Folgança al voltant de la peça (mm)'], ['dit', 'Espai per als dits (mm)'], ['minCaixeti', 'Amplada mínima (mm)'], ['profMax', 'Fondària màxima (mm)'], ['retencio', 'Part mínima dins de les peces dretes (0-1)'], ['granel', 'Ocupació a granel (0-1)'], ['omplert', 'Nivell d\'ompliment a granel (0-1)'], ['areaPetit', 'Àrea de caixetí petit (mm²)']]]
    ];
    function renderConfig() {
        const c = cfg();
        const val = k => k.includes('.') ? c[k.split('.')[0]][k.split('.')[1]] : c[k];
        const rang = k => FO.RANGS[k] ? ` min="${FO.RANGS[k][0]}" max="${FO.RANGS[k][1]}" title="Entre ${FO.RANGS[k][0]} i ${FO.RANGS[k][1]}"` : '';
        const lab = (k, l) => FO.RANGS[k] ? `${esc(l)} <span style="opacity:.6">${FO.RANGS[k][0]}–${FO.RANGS[k][1]}</span>` : esc(l);
        const camp = ([k, l]) => `<div class="fi"><label>${lab(k, l)}</label><input type="number" step="any" data-cfg="${k}" value="${val(k)}"${rang(k)}></div>`;
        $('cfgCos').innerHTML = CAMPS_CFG.map(([t, camps]) => `<div><div class="ps-t">${t}</div><div class="fg3">${camps.map(camp).join('')}</div></div>`).join('') +
            `<div><div class="ps-t">Tancament de caixes i safates</div><div class="fg3">
                <div class="fi"><label>Tancament per defecte</label><select data-cfgsel="tancament">${Object.entries(FO.TANCAMENTS).map(([k, t]) => `<option value="${k}"${c.tancament === k ? ' selected' : ''}>${esc(t.nom)}</option>`).join('')}</select></div>
                ${[['llaviAmple', 'Llavi interior cap al centre (mm)'], ['jocTapa', 'Joc de la tapa a pressió (mm)'], ['gruixTapa', 'Gruix de la tapa (mm)'], ['imantD', 'Diàmetre de l\'imant (mm)'], ['imantH', 'Alçada de l\'imant (mm)']].map(camp).join('')}
            </div>
            <div class="ajuda" style="margin-top:6px">${Object.values(FO.TANCAMENTS).map(t => `<b>${esc(t.nom)}</b>: ${esc(t.desc)}`).join('<br>')}<br>Amb imants, les parets es fan prou gruixudes per allotjar-los (diàmetre + 2 mm). Si hi ha peces que sobresurten, la tapa porta un marc que la fa més alta.</div>
            <label class="ck" style="margin-top:6px"><input type="checkbox" data-cfgck="tapesInternes"${c.tapesInternes ? ' checked' : ''}> Amb contenidor, tapa també a cada caixa de dins</label>
            <label class="ck"><input type="checkbox" data-cfgck="contenidorsApilables"${c.contenidorsApilables ? ' checked' : ''}> Contenidors apilables (mateixa planta, peu encastat i prou alçada per a les caixes)</label>
            <label class="ck"><input type="checkbox" data-cfgck="nanses"${c.nanses ? ' checked' : ''}> Nanses als costats curts dels contenidors</label>
            <label class="ck"><input type="checkbox" data-cfgck="qrRelleu"${c.qrRelleu ? ' checked' : ''}> QR gravat a les tapes (i a la cara posterior de les caixes sense tapa, si hi cap). Es llegeix millor si el repasses amb un retolador.</label>
            <div class="fx" style="margin-top:6px"><button class="b sm" id="bCalibratge">📐 Peça de calibratge…</button></div></div>
            <div><div class="ps-t">Identificació i ergonomia</div>
                <label class="ck"><input type="checkbox" data-cfgck="relleu"${c.relleu ? ' checked' : ''}> Codi gravat en relleu a la cara frontal</label>
                <label class="ck"><input type="checkbox" data-cfgck="rebaixEtiqueta"${c.rebaixEtiqueta ? ' checked' : ''}> Rebaix per a l'etiqueta adhesiva (a la cara posterior si ja hi ha relleu al davant)</label>
                <label class="ck"><input type="checkbox" data-cfgck="codiFons"${c.codiFons ? ' checked' : ''}> Codi del material gravat al fons de cada caixetí</label>
                <label class="ck"><input type="checkbox" data-cfgck="fonsArrodonit"${c.fonsArrodonit ? ' checked' : ''}> Fons arrodonit als caixetins a granel (per treure la cargoleria fent lliscar el dit)</label>
            </div>` +
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
        $('cfgCos').querySelectorAll('[data-cfg]').forEach(i => {
            const aplica = final => {
                const k = i.dataset.cfg; let v = FO.num(i.value, NaN); if (!isFinite(v)) return;
                const lim = FO.limita(k, v);
                if (lim !== v) { if (!final) return; v = lim; i.value = v; hint(`Valor limitat a ${v} (entre ${FO.RANGS[k][0]} i ${FO.RANGS[k][1]})`); }
                if (k.includes('.')) c[k.split('.')[0]][k.split('.')[1]] = v; else c[k] = v;
                $('cartell').dataset.clau = ''; recalcula();
            };
            i.addEventListener('input', () => aplica(false));
            i.addEventListener('change', () => aplica(true));
        });
        $('bCalibratge').addEventListener('click', obreCalibratge);
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

    // ─── Calibratge ───
    function obreCalibratge() {
        $('calJocs').innerHTML = FO.JOCS_CALIBRATGE.map(j => `<label class="ck"><input type="radio" name="calJoc" value="${j}"${Math.abs(j - cfg().jocTapa) < 1e-6 ? ' checked' : ''}> Forat <b>${Math.round(j * 100)}</b> · ${j} mm per costat</label>`).join('');
        obre('dlgCalibratge');
    }
    $('calSTL').onclick = () => descarrega('FOrdre_calibratge.stl', FO.stlBinari(FO.mallaCalibratge(), 'calibratge'), 'model/stl');
    $('calAplica').onclick = () => {
        const r = document.querySelector('input[name=calJoc]:checked'); if (!r) return hint('Tria el forat on el tac entra ajustat');
        const j = +r.value;
        cfg().jocTapa = j; cfg().jocCaixes = FO.limita('jocCaixes', Math.max(j * 2, 0.4)); cfg().joc = FO.limita('joc', Math.max(cfg().joc, j + 0.5));
        tanca('dlgCalibratge'); recalcula(); hint(`Calibratge aplicat: tapa ${j} mm, caixes ${cfg().jocCaixes} mm`);
    };

    // ─── Importació ───
    const imp = { fulls: null, files: null, cap: null, map: {} };
    $('bImportar').onclick = () => {
        imp.fulls = null; imp.files = null; imp.nomFitxer = ''; imp.exemple = false; $('impFitxer').value = ''; $('impFullBox').style.display = 'none';
        $('impMapa').innerHTML = ''; $('impPrev').innerHTML = ''; $('impRes').textContent = ''; $('impOk').disabled = true;
        ajudaFormat(); obre('dlgImport');
    };
    function ajudaFormat() {
        $('impAjuda').innerHTML = $('impFormat').value === 'bom'
            ? 'BOM indentada exportada de FreeCAD, Fusion 360, SolidWorks, Inventor, Onshape… Cal una columna de <b>nivell</b> (1, 2, 3 · 1.2.3 · o el nom sagnat), una de <b>codi</b> i una de <b>quantitat</b>. Les files que tenen fills es converteixen en conjunts; si porten mides, són la peça muntada.'
            : 'Una fila per material, amb la columna <b>conjunt</b> on es munta (i opcionalment el <b>pare</b> del conjunt). Una fila amb conjunt però sense codi de material defineix el conjunt: la quantitat i les mides de la peça muntada. Descarrega la <b>Plantilla CSV</b> per veure un exemple.';
    }
    $('impFitxer').addEventListener('change', function () { if (this.files[0]) llegeixImport(this.files[0]); });
    // Llegeix el fitxer triat (o una llista d'exemple) i en mostra la correspondència de columnes
    async function llegeixImport(f) {
        imp.nomFitxer = f.name;
        try {
            const r = await FO.llegeixFitxer(f);
            if (r.json) { tanca('dlgImport'); carregaProjecte(r.json, 'Projecte obert'); return; }
            imp.fulls = r;
            $('impFull').innerHTML = r.map((s, i) => `<option value="${i}">${esc(s.nom)}</option>`).join('');
            $('impFullBox').style.display = r.length > 1 ? 'block' : 'none';
            triaFull(0);
        } catch (e) { $('impRes').innerHTML = `<span class="av er">⚠ ${esc(e.message)}</span>`; }
    }
    // Llistes d'exemple del repositori: es carreguen com si s'haguessin triat del disc.
    // Només rutes de la carpeta exemples/ del mateix lloc (no s'obre cap adreça externa).
    async function importaExemple(ruta) {
        if (!/^exemples\/[\w.-]+\.(csv|xlsx)$/.test(ruta)) return hint('Llista d\'exemple no vàlida');
        try {
            const r = await fetch(ruta);
            if (!r.ok) throw new Error('Error ' + r.status);
            $('bImportar').onclick();
            document.querySelector('input[name=impMode][value=substitueix]').checked = true;   // l'exemple substitueix el projecte
            await llegeixImport(new File([await r.blob()], ruta.split('/').pop()));
            imp.exemple = true;
        } catch (e) { hint('No s\'ha pogut carregar la llista d\'exemple: ' + e.message, 4000); }
    }
    document.querySelectorAll('[data-exemple]').forEach(b => b.onclick = () => importaExemple(b.dataset.exemple));
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
            const mode = document.querySelector('input[name=impMode]:checked').value;
            imp.nou = FO.incorporaImport(P, r, mode);
            imp.diff = FO.diffProjectes(P, imp.nou);
            const td = FO.textDiff(imp.diff);
            $('impRes').innerHTML = `Es llegiran <b>${r.conjunts.length}</b> conjunts i <b>${r.materials.length}</b> materials (${imp.files.length} files).` +
                (r.avisos.length ? `<div class="av">${r.avisos.slice(0, 6).map(esc).join('<br>')}${r.avisos.length > 6 ? `<br>… i ${r.avisos.length - 6} avisos més` : ''}</div>` : '') +
                `<div style="margin-top:6px"><b>Canvis respecte del projecte actual</b>${td.length ? `<ul style="margin:4px 0 0 18px">${td.slice(0, 14).map(t => `<li>${esc(t)}</li>`).join('')}${td.length > 14 ? `<li>… i ${td.length - 14} més</li>` : ''}</ul>` : ': cap.'}</div>`;
            $('impOk').disabled = !(r.materials.length || r.conjunts.length);
        } catch (e) { $('impRes').innerHTML = `<span class="av er">⚠ ${esc(e.message)}</span>`; $('impOk').disabled = true; }
    }
    ['impFormat', 'impMida', 'impPes'].forEach(id => $(id).addEventListener('change', () => { ajudaFormat(); previsualitza(); }));
    document.querySelectorAll('input[name=impMode]').forEach(r => r.addEventListener('change', previsualitza));
    $('impOk').onclick = () => {
        const nou = imp.nou, d = imp.diff;
        if (!d.buit) nou.revisions = (nou.revisions || []).concat([{ data: new Date().toISOString(), origen: imp.nomFitxer || '', canvis: FO.textDiff(d), reimprimir: d.reimprimir.concat(d.nous) }]).slice(-30);
        // una llista d'exemple que substitueix el projecte en porta el nom, perquè no es confongui amb l'anterior
        if (imp.exemple && document.querySelector('input[name=impMode]:checked').value === 'substitueix') nou.nom = 'Exemple · ' + imp.nomFitxer;
        tanca('dlgImport');
        carregaProjecte(nou, d.buit ? 'Importat: sense canvis' : `Importat · ${d.reimprimir.length + d.nous.length} peces a imprimir de nou`);
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
    // Enllaç directe a una llista d'exemple (index.html?llista=exemples/…): obre la importació amb la llista carregada
    const llistaURL = new URLSearchParams(location.search).get('llista');
    if (llistaURL) importaExemple(llistaURL);
    detectaTaller();
    // Funcionament sense connexió (només en https o localhost)
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
        navigator.serviceWorker.register('sw.js').catch(() => { /* sense service worker */ });
    }
    G.FOrdreApp = { get projecte() { return P; }, get pla() { return PLA; }, selecciona, vista };
})(window);
