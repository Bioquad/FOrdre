// ═══════════════════════════════════════════════════════════════
// FOrdre Muntatge — app per a mòbil i tauleta
// ───────────────────────────────────────────────────────────────
// Calcula el mateix pla que l'app d'escriptori i en fa una guia de taller:
//  · passos en ordre de muntatge, bloquejats fins que els subconjunts estan fets
//  · caixes i caixetins a agafar, amb quantitat, parell de collada i notes;
//    es marquen tocant-los o escanejant el QR / codi de barres de l'etiqueta
//  · instruccions pas a pas, eines, imatge de referència i fotos
//  · estoc, llista de compra per proveïdor i registre amb data i operari
// El progrés es desa al dispositiu (localStorage + IndexedDB per a les fotos).
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO;
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (v, d) => (Math.round(v * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toLocaleString('ca-ES');
    const CLAU_MOBIL = 'fordre.muntatge.projecte', CLAU_PREF = 'fordre.muntatge.pref';
    const llegeix = k => { try { const t = localStorage.getItem(k); return t ? JSON.parse(t) : null; } catch (e) { return null; } };
    const escriu = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

    let P = null, PLA = [], ETQ = [], perConj = new Map(), perObj = new Map(), itemsDe = new Map();
    let prog = null;       // progrés del projecte actual
    let pref = Object.assign({ operari: '', consumAuto: true }, llegeix(CLAU_PREF) || {});
    let pasActual = null;  // conjunt obert (context de l'escàner)

    function avis(msg, ms) {
        const a = $('avis'); a.textContent = msg; a.classList.add('on');
        clearTimeout(avis.t); avis.t = setTimeout(() => a.classList.remove('on'), ms || 2200);
    }
    function so(ok) {
        try {
            const ctx = so.ctx || (so.ctx = new (G.AudioContext || G.webkitAudioContext)());
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.frequency.value = ok ? 1320 : 220; o.type = ok ? 'sine' : 'square';
            g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination);
            o.start(); o.stop(ctx.currentTime + (ok ? 0.12 : 0.35));
        } catch (e) { /* sense àudio */ }
        if (navigator.vibrate) navigator.vibrate(ok ? 60 : [120, 60, 120]);
    }

    // ─── Progrés ───
    const clauProg = () => 'fordre.muntatge.progres.' + P.id;
    function nouProg() { return { agafat: {}, instr: {}, fets: {}, estoc: {}, registre: [] }; }
    function desaProg() { if (!escriu(clauProg(), prog)) avis('No s\'ha pogut desar el progrés (memòria plena?)'); }
    function registra(tipus, text) {
        prog.registre.push({ ts: new Date().toISOString(), op: pref.operari || '', tipus, text });
        if (prog.registre.length > 3000) prog.registre.splice(0, prog.registre.length - 3000);
    }

    // ─── Fotos (IndexedDB) ───
    const idb = (() => {
        let db = null;
        const obre = () => new Promise((ok, ko) => {
            if (db) return ok(db);
            if (!G.indexedDB) return ko(new Error('sense IndexedDB'));
            const r = indexedDB.open('fordre-muntatge', 1);
            r.onupgradeneeded = () => { const s = r.result.createObjectStore('fotos', { keyPath: 'id', autoIncrement: true }); s.createIndex('pas', 'pas'); };
            r.onsuccess = () => { db = r.result; ok(db); };
            r.onerror = () => ko(r.error);
        });
        const tx = (mode, fn) => obre().then(d => new Promise((ok, ko) => {
            const t = d.transaction('fotos', mode), s = t.objectStore('fotos'), res = fn(s);
            t.oncomplete = () => ok(res && res.result); t.onerror = () => ko(t.error);
        }));
        return {
            afegeix: f => tx('readwrite', s => s.add(f)),
            esborra: id => tx('readwrite', s => s.delete(id)),
            del: pas => tx('readonly', s => s.index('pas').getAll(pas))
        };
    })();

    // ─── Càrrega del projecte ───
    function usaProjecte(p, origen) {
        P = FO.normalitzaProjecte(p);
        PLA = FO.calculaPla(P);
        ETQ = FO.etiquetesPla(PLA);
        perConj = new Map(PLA.map(r => [r.conj.id, r]));
        perObj = new Map();
        PLA.forEach(r => FO.imprimibles(r).forEach(o => perObj.set(o.id, { o, r })));
        itemsDe = new Map(P.conjunts.map(c => [c.id, new Map(c.items.map(i => [i.mat, i]))]));
        prog = Object.assign(nouProg(), llegeix(clauProg()) || {});
        escriu(CLAU_MOBIL, P);
        $('nomProj').textContent = P.nom;
        if (origen) avis('Projecte carregat: ' + P.nom);
    }

    async function carregaInicial() {
        const h = location.hash;
        if (h.startsWith('#p=')) {
            try {
                usaProjecte(JSON.parse(await FO.descomprimeix(h.slice(3))), 'enllaç');
                history.replaceState(null, '', location.pathname + location.search + '#/passos');
                return true;
            } catch (e) { avis('L\'enllaç del projecte no és vàlid'); }
        }
        const q = new URLSearchParams(location.search).get('f');
        if (q) {
            try { const r = await fetch(q); usaProjecte(await r.json(), 'fitxer'); return true; } catch (e) { avis('No s\'ha pogut descarregar ' + q); }
        }
        const m = llegeix(CLAU_MOBIL) || llegeix(FO.CLAU_PROJECTE);
        if (m && m.conjunts) { usaProjecte(m); return true; }
        return false;
    }

    // ─── Dades derivades ───
    const conjDeCodi = codi => P.conjunts.find(c => c.codi === codi);
    // A quin pas s'agafa una etiqueta: la caixa de guarda d'un subconjunt s'agafa al pas del pare
    function pasDe(e) {
        const x = perObj.get(e.safata);
        if (!x) return null;
        if (x.o.tipus === 'muntat' && x.r.conj.pare) return x.r.conj.pare;
        return x.r.conj.id;
    }
    // Llista de coses a agafar en un pas: el kit propi + les caixes de guarda dels subconjunts
    function aAgafar(r) {
        return ETQ.filter(e => e.tipus === 'caixeti' && pasDe(e) === r.conj.id);
    }
    const estaFet = id => !!prog.fets[id];
    const bloquejat = r => r.entrades.filter(e => !estaFet(e.conj.id));
    function estatPas(r) {
        const llista = aAgafar(r), n = llista.filter(e => prog.agafat[e.clau]).length;
        return { total: llista.length, agafats: n, fet: estaFet(r.conj.id), falten: bloquejat(r) };
    }
    function necessari() {
        const m = new Map();
        PLA.forEach(r => { if (estaFet(r.conj.id)) return; r.conj.items.forEach(it => m.set(it.mat, (m.get(it.mat) || 0) + it.qty * r.multiplicador)); });
        return m;
    }

    // ─── Rutes ───
    function ruta() {
        const h = location.hash.replace(/^#\/?/, '') || 'passos';
        const [nom, arg] = h.split('/');
        document.querySelectorAll('.peu button').forEach(b => b.classList.toggle('on', b.dataset.ruta === nom || (nom === 'pas' && b.dataset.ruta === 'passos')));
        $('bEnrere').hidden = nom !== 'pas';
        pasActual = nom === 'pas' ? decodeURIComponent(arg || '') : null;
        if (!P) return vistaBuida();
        ({ passos: vistaPassos, pas: vistaPas, estoc: vistaEstoc, compra: vistaCompra, registre: vistaRegistre }[nom] || vistaPassos)(arg && decodeURIComponent(arg));
        window.scrollTo(0, 0);
    }
    G.addEventListener('hashchange', ruta);
    document.querySelectorAll('.peu button').forEach(b => b.addEventListener('click', () => { location.hash = '#/' + b.dataset.ruta; }));
    $('bEnrere').addEventListener('click', () => { location.hash = '#/passos'; });

    function vistaBuida() {
        $('vista').innerHTML = `<div class="buit"><h2>FOrdre Muntatge</h2>
            <p>Obre un projecte per començar: escaneja el QR que mostra l'app de l'ordinador (botó <b>📱 Muntatge</b>), obre el fitxer <b>.fordre.json</b> o prova l'exemple.</p>
            <div class="grup"><button class="bt pr" data-acc="fitxer">📂 Obrir fitxer</button><button class="bt" data-acc="exemple">🧪 Projecte d'exemple</button></div></div>`;
        $('vista').querySelector('[data-acc=fitxer]').onclick = () => $('fProjecte').click();
        $('vista').querySelector('[data-acc=exemple]').onclick = () => { usaProjecte(FO.exemple(), 'exemple'); ruta(); };
    }

    // ─── Llista de passos ───
    function vistaPassos() {
        const est = PLA.map(r => ({ r, e: estatPas(r) }));
        const fets = est.filter(x => x.e.fet).length;
        const seguent = est.find(x => !x.e.fet && !x.e.falten.length);
        $('vista').innerHTML = `<div class="targeta"><div class="fx"><b style="flex:1">${esc(P.nom)}</b><span class="xip ${fets === PLA.length ? 'ok' : ''}">${fets} / ${PLA.length} passos</span></div>
            <div class="barra"><div style="width:${PLA.length ? fets / PLA.length * 100 : 0}%"></div></div>
            ${seguent ? `<button class="bt pr" style="margin-top:10px" data-anar="${esc(seguent.r.conj.id)}">Continuar: pas ${seguent.r.pas} · ${esc(seguent.r.conj.nom)}</button>` : fets === PLA.length && PLA.length ? '<p class="ajuda" style="margin-top:8px">🎉 Tots els passos estan muntats.</p>' : ''}</div>
            ${est.map(({ r, e }) => {
                const estat = e.fet ? '<span class="xip ok">Muntat</span>' : e.falten.length ? `<span class="xip er">Falta ${e.falten.map(f => esc(f.conj.codi)).join(', ')}</span>`
                    : e.total ? `<span class="xip ${e.agafats === e.total ? 'ok' : e.agafats ? 'wr' : ''}">${e.agafats}/${e.total}</span>` : '<span class="xip">Llest</span>';
                return `<div class="targeta pas${e.fet ? ' fet' : ''}${e.falten.length && !e.fet ? ' bloquejat' : ''}" data-anar="${esc(r.conj.id)}" style="border-left-color:${r.conj.col}">
                    <div class="num">${e.fet ? '✓' : r.pas}</div>
                    <div class="info"><div class="nom">${esc(r.conj.nom)}</div><div class="sub">${esc(r.conj.codi)}${r.multiplicador > 1 ? ` · ×${r.multiplicador}` : ''} · ${esc(FO.FORMATS_KIT[r.format] ? FO.FORMATS_KIT[r.format].nom : '')}</div>
                    ${e.total && !e.fet ? `<div class="barra"><div style="width:${e.agafats / e.total * 100}%"></div></div>` : ''}</div>${estat}</div>`;
            }).join('')}`;
        $('vista').querySelectorAll('[data-anar]').forEach(n => n.addEventListener('click', () => { location.hash = '#/pas/' + encodeURIComponent(n.dataset.anar); }));
    }

    // ─── Detall d'un pas ───
    const icones = m => (m.esd ? ' <span class="xip esd">⚡ ESD</span>' : '') + (m.liquid ? ' <span class="xip liq">💧</span>' : '') + (m.angleMax < 90 ? ' <span class="xip">⬆ vertical</span>' : '');
    function filaCaixeti(e, conjId) {
        const c = e.caixeti, m = c.mat;
        const it = itemsDe.get(conjId) && itemsDe.get(conjId).get(m.id);
        const fet = !!prog.agafat[e.clau];
        return `<div class="fila${fet ? ' fet' : ''}" data-clau="${esc(e.clau)}">
            <div class="chk">✓</div><span class="sw" style="background:${m.col}"></span>
            <div class="txt"><div class="cd">${esc(m.codi)}${it && it.parell ? `<span class="parell">${fmt(it.parell, 1)} N·m</span>` : ''}${icones(m)}</div>
            <div class="nm">${esc(m.nom)}</div>${it && it.nota ? `<div class="nota">▸ ${esc(it.nota)}</div>` : ''}</div>
            <div class="q">×${c.qty}</div></div>`;
    }
    function blocObjecte(o, conjId, llista) {
        const etq = obj => llista.filter(e => e.safata === obj.id);
        const cap = (obj, tipus) => `<span class="sw" style="background:${obj.color}"></span><span class="fl">${esc(obj.id)}</span><span class="xip">${esc(tipus)}</span>`;
        const nomF = { safata: 'Safata', caixa: 'Caixa', contenidor: 'Contenidor' };
        if (o.forma === 'contenidor') {
            const fills = o.caixes.map(q => q.obj).filter(b => etq(b).length);
            if (!fills.length) return '';
            return `<div class="objecte"><div class="t">${cap(o, 'Contenidor · ' + o.caixes.length + ' caixes')}</div>` +
                fills.map(b => `<div class="subcaixa"><span class="sw" style="background:${b.color}"></span>${esc(b.id)}${b.bloc ? ' · bloc de petits' : ''}</div>` + etq(b).map(e => filaCaixeti(e, conjId)).join('')).join('') + '</div>';
        }
        const files = etq(o);
        if (!files.length) return '';
        return `<div class="objecte"><div class="t">${cap(o, o.tipus === 'muntat' ? 'Guarda' : nomF[o.forma] || '')}</div>${files.map(e => filaCaixeti(e, conjId)).join('')}</div>`;
    }

    async function vistaPas(id) {
        const r = perConj.get(id);
        if (!r) { location.hash = '#/passos'; return; }
        const c = r.conj, e = estatPas(r), llista = aAgafar(r);
        const instr = c.instruccions.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
        const fetsI = prog.instr[c.id] || [];
        const parells = c.items.filter(i => i.parell > 0).map(i => ({ i, m: FO.material(P, i.mat) })).filter(x => x.m);
        const guarda = r.safates.filter(o => o.tipus === 'muntat');
        // objectes d'on s'agafa: kit propi + caixes de guarda dels fills
        const objs = r.safates.filter(o => o.tipus !== 'muntat');
        r.entrades.forEach(en => { const rf = perConj.get(en.conj.id); if (rf) rf.safates.filter(o => o.tipus === 'muntat').forEach(o => objs.push(o)); });
        $('vista').innerHTML = `<div class="cap-pas" style="background:${c.col}"><div class="sub">Pas ${r.pas} de ${PLA.length}${r.multiplicador > 1 ? ` · muntar-ne ${r.multiplicador}` : ''}</div><h2>${esc(c.nom)}</h2><div class="sub">${esc(c.codi)}</div></div>
            ${e.fet ? `<div class="targeta"><span class="xip ok">Muntat</span> ${esc(new Date(prog.fets[c.id].ts).toLocaleString('ca-ES'))}${prog.fets[c.id].op ? ' · ' + esc(prog.fets[c.id].op) : ''}</div>` : ''}
            ${e.falten.length && !e.fet ? `<div class="targeta" style="border-color:var(--er)"><b>Abans cal muntar:</b> ${e.falten.map(f => `<a href="#/pas/${encodeURIComponent(f.conj.id)}">${esc(f.conj.codi)} ${esc(f.conj.nom)}</a>`).join(', ')}</div>` : ''}
            <div class="dues"><div>
            <h3>1 · Preparació: agafa les caixes (${e.agafats}/${e.total})</h3>
            <div class="fx"><button class="bt pr" id="pEsc">⌖ Escanejar etiquetes</button><button class="bt" id="pTots">${e.agafats === e.total && e.total ? 'Desmarcar tot' : 'Marcar-ho tot'}</button></div>
            ${objs.map(o => blocObjecte(o, c.id, llista)).join('') || '<p class="ajuda">Aquest pas no té caixes pròpies.</p>'}
            ${r.fora.length ? `<div class="targeta"><b>Preparar a part</b> (no cap a cap caixa): ${r.fora.map(x => esc(x.mat.codi) + ' ×' + x.qty).join(', ')}</div>` : ''}
            </div><div>
            <h3>2 · Muntatge</h3>
            ${c.eines ? `<div class="targeta"><b>🔧 Eines:</b> ${esc(c.eines)}</div>` : ''}
            ${c.imatge ? `<img class="imatge" src="${esc(c.imatge)}" alt="Resultat esperat">` : ''}
            ${instr.length ? `<div class="objecte">${instr.map((t, i) => `<div class="fila${fetsI[i] ? ' fet' : ''}" data-instr="${i}"><div class="chk">✓</div><div class="txt"><div class="nm"><b>${i + 1}.</b> ${esc(t)}</div></div></div>`).join('')}</div>` : '<p class="ajuda">Sense instruccions: es poden afegir a la fitxa del conjunt a l\'app de l\'ordinador.</p>'}
            ${parells.length ? `<h3>Parells de collada</h3><div class="targeta"><table class="taula"><tr><th>Element</th><th class="n">N·m</th></tr>${parells.map(x => `<tr><td><b>${esc(x.m.codi)}</b> ${esc(x.m.nom)}${x.i.nota ? `<div class="ajuda">${esc(x.i.nota)}</div>` : ''}</td><td class="n"><b>${fmt(x.i.parell, 1)}</b></td></tr>`).join('')}</table></div>` : ''}
            ${c.notes ? `<div class="targeta"><b>Notes:</b> ${esc(c.notes)}</div>` : ''}
            <h3>Fotos</h3><div class="fx"><button class="bt" id="pFoto">📷 Fer una foto</button></div><div class="fotos" id="pFotos"></div>
            <h3>3 · Final</h3>
            ${guarda.length ? `<div class="targeta">Guarda ${r.multiplicador > 1 ? 'les ' + r.multiplicador + ' unitats' : 'el conjunt'} a: <b>${guarda.map(o => esc(o.id)).join(', ')}</b></div>` : ''}
            ${e.fet ? '<button class="bt" id="pDesfer">Desfer «muntat»</button>' : `<button class="bt ok" id="pFet"${e.falten.length ? ' disabled' : ''}>✓ Marcar el pas com a muntat</button>`}
            </div></div>`;
        const v = $('vista');
        v.querySelectorAll('[data-clau]').forEach(f => f.addEventListener('click', () => { commuta(f.dataset.clau); vistaPas(id); }));
        v.querySelectorAll('[data-instr]').forEach(f => f.addEventListener('click', () => {
            const a = prog.instr[c.id] || (prog.instr[c.id] = []), i = +f.dataset.instr;
            a[i] = !a[i]; desaProg(); f.classList.toggle('fet', !!a[i]);
        }));
        $('pEsc').onclick = () => obreEscaner();
        $('pTots').onclick = () => {
            const tots = e.agafats === e.total;
            llista.forEach(x => { if (tots) delete prog.agafat[x.clau]; else prog.agafat[x.clau] = new Date().toISOString(); });
            registra('preparacio', `${c.codi}: ${tots ? 'desmarcat tot' : 'marcat tot com a agafat'}`); desaProg(); vistaPas(id);
        };
        $('pFoto').onclick = () => { $('fFoto').dataset.pas = c.id; $('fFoto').click(); };
        if ($('pFet')) $('pFet').onclick = () => marcaFet(r, e);
        if ($('pDesfer')) $('pDesfer').onclick = () => desfesFet(r);
        pintaFotos(c.id);
    }

    function commuta(clau) {
        const e = ETQ.find(x => x.clau === clau);
        if (prog.agafat[clau]) { delete prog.agafat[clau]; registra('preparacio', `${e ? e.codi : clau}: desmarcat`); }
        else { prog.agafat[clau] = new Date().toISOString(); registra('preparacio', `${e ? e.codi + ' ×' + e.qty : clau}: agafat (${e ? e.safata : ''})`); }
        desaProg();
    }

    function marcaFet(r, e) {
        if (e.agafats < e.total && !confirm(`Només hi ha ${e.agafats} de ${e.total} caixetins marcats com a agafats. Marcar igualment el pas com a muntat?`)) return;
        const consum = {};
        if (pref.consumAuto) r.conj.items.forEach(it => {
            // es descompta el que hi ha (mai per sota de zero) i es recorda per poder desfer-ho
            const tinc = prog.estoc[it.mat] || 0, q = Math.min(tinc, it.qty * r.multiplicador);
            if (q > 0) { consum[it.mat] = q; prog.estoc[it.mat] = tinc - q; }
        });
        prog.fets[r.conj.id] = { ts: new Date().toISOString(), op: pref.operari || '', consum };
        registra('muntat', `Pas ${r.pas} · ${r.conj.codi} ${r.conj.nom} muntat${r.multiplicador > 1 ? ' (×' + r.multiplicador + ')' : ''}`);
        desaProg(); so(true); avis('Pas muntat ✓');
        vistaPas(r.conj.id);
    }
    function desfesFet(r) {
        const f = prog.fets[r.conj.id]; if (!f) return;
        Object.entries(f.consum || {}).forEach(([m, q]) => { prog.estoc[m] = (prog.estoc[m] || 0) + q; });
        delete prog.fets[r.conj.id];
        registra('muntat', `Pas ${r.pas} · ${r.conj.codi}: desfet`);
        desaProg(); vistaPas(r.conj.id);
    }

    async function pintaFotos(pas) {
        const cont = $('pFotos'); if (!cont) return;
        try {
            const fotos = await idb.del(P.id + '|' + pas);
            cont.innerHTML = fotos.map(f => `<img src="${f.dades}" alt="" data-id="${f.id}" title="${esc(new Date(f.ts).toLocaleString('ca-ES'))}">`).join('');
            cont.querySelectorAll('img').forEach(im => im.addEventListener('click', async () => {
                if (confirm('Esborrar aquesta foto?')) { await idb.esborra(+im.dataset.id); pintaFotos(pas); }
            }));
        } catch (e) { cont.innerHTML = '<p class="ajuda">Aquest navegador no permet guardar fotos.</p>'; }
    }
    $('fFoto').addEventListener('change', async function () {
        const f = this.files[0], pas = this.dataset.pas; this.value = '';
        if (!f) return;
        try {
            const dades = await redueix(f, 1280);
            await idb.afegeix({ pas: P.id + '|' + pas, ts: new Date().toISOString(), op: pref.operari, dades });
            registra('foto', `Foto al pas ${perConj.get(pas) ? perConj.get(pas).conj.codi : pas}`); desaProg();
            pintaFotos(pas); avis('Foto desada');
        } catch (e) { avis('No s\'ha pogut desar la foto'); }
    });
    function redueix(f, mx) {
        return new Promise((ok, ko) => {
            const img = new Image(), url = URL.createObjectURL(f);
            img.onload = () => {
                const k = Math.min(1, mx / Math.max(img.width, img.height)), c = document.createElement('canvas');
                c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = ko; img.src = url;
        });
    }

    // ─── Estoc ───
    function vistaEstoc(filtre) {
        const nec = necessari();
        const mats = P.materials.slice().sort((a, b) => a.codi.localeCompare(b.codi));
        const nomesFalta = filtre === 'falta';
        const files = mats.filter(m => !nomesFalta || (nec.get(m.id) || 0) > (prog.estoc[m.id] || 0));
        $('vista').innerHTML = `<h2>Estoc</h2><p class="ajuda">«Cal» és el que encara necessiten els passos que no estan muntats. ${pref.consumAuto ? 'En marcar un pas com a muntat, es descompta de l\'estoc.' : ''}</p>
            <div class="fx" style="margin:8px 0"><button class="bt${nomesFalta ? '' : ' pr'}" data-f="">Tots</button><button class="bt${nomesFalta ? ' pr' : ''}" data-f="falta">Només el que falta</button></div>
            <input class="cerca" id="eCerca" type="search" placeholder="Cerca…">
            <div class="targeta" style="padding:4px 8px"><table class="taula"><tr><th>Material</th><th class="n">Cal</th><th class="n">Tinc</th></tr>
            ${files.map(m => {
                const n = nec.get(m.id) || 0, t = prog.estoc[m.id] || 0;
                return `<tr data-cerca="${esc((m.codi + ' ' + m.nom).toLowerCase())}"><td><span class="sw" style="background:${m.col}"></span> <b>${esc(m.codi)}</b><div class="ajuda">${esc(m.nom)}</div></td>
                    <td class="n ${t < n ? 'falta' : ''}">${n}</td>
                    <td><div class="num-in"><button data-m="${esc(m.id)}" data-d="-1">−</button><input type="number" inputmode="numeric" data-mi="${esc(m.id)}" value="${t}"><button data-m="${esc(m.id)}" data-d="1">+</button></div></td></tr>`;
            }).join('')}</table></div>`;
        const v = $('vista');
        v.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { location.hash = '#/estoc' + (b.dataset.f ? '/' + b.dataset.f : ''); });
        v.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { canviaEstoc(b.dataset.m, (prog.estoc[b.dataset.m] || 0) + +b.dataset.d); vistaEstoc(filtre); });
        v.querySelectorAll('[data-mi]').forEach(i => i.onchange = () => { canviaEstoc(i.dataset.mi, Math.round(FO.num(i.value, 0))); vistaEstoc(filtre); });
        $('eCerca').oninput = function () { const f = this.value.toLowerCase(); v.querySelectorAll('tr[data-cerca]').forEach(tr => { tr.style.display = tr.dataset.cerca.includes(f) ? '' : 'none'; }); };
    }
    function canviaEstoc(id, v) {
        const m = FO.material(P, id), a = prog.estoc[id] || 0;
        prog.estoc[id] = v;
        registra('estoc', `${m ? m.codi : id}: ${a} → ${v}`); desaProg();
    }

    // ─── Llista de compra ───
    function llistaCompra() {
        const nec = necessari(), grups = new Map();
        P.materials.forEach(m => {
            const falta = (nec.get(m.id) || 0) - (prog.estoc[m.id] || 0);
            if (falta <= 0) return;
            const g = m.origen === 'propi' ? 'Fabricació pròpia' : (m.proveidor || 'Sense proveïdor');
            if (!grups.has(g)) grups.set(g, []);
            grups.get(g).push({ m, falta });
        });
        return grups;
    }
    function textCompra(grups) {
        let t = `Llista de compra · ${P.nom} · ${new Date().toLocaleDateString('ca-ES')}\n`;
        grups.forEach((l, g) => { t += `\n${g}\n` + l.map(x => `  ${x.falta} × ${x.m.codi}  ${x.m.nom}`).join('\n') + '\n'; });
        return t;
    }
    function vistaCompra() {
        const grups = llistaCompra();
        $('vista').innerHTML = `<h2>Llista de compra</h2><p class="ajuda">El que falta per acabar els passos pendents, descomptant l'estoc, agrupat per proveïdor.</p>
            ${grups.size ? Array.from(grups).map(([g, l]) => `<h3>${esc(g)}</h3><div class="targeta" style="padding:4px 8px"><table class="taula">${l.map(x => `<tr><td><span class="sw" style="background:${x.m.col}"></span> <b>${esc(x.m.codi)}</b><div class="ajuda">${esc(x.m.nom)}</div></td><td class="n falta">${x.falta}</td></tr>`).join('')}</table></div>`).join('')
                + `<div class="fx"><button class="bt" id="cCopia">Copiar</button>${navigator.share ? '<button class="bt" id="cComparteix">Compartir…</button>' : ''}<button class="bt" id="cCSV">⬇ CSV</button></div>`
                : '<div class="buit">✓ No falta res.</div>'}`;
        if (!grups.size) return;
        const t = textCompra(grups);
        $('cCopia').onclick = async () => { try { await navigator.clipboard.writeText(t); avis('Copiat'); } catch (e) { prompt('Copia:', t); } };
        if ($('cComparteix')) $('cComparteix').onclick = () => navigator.share({ title: 'Llista de compra', text: t }).catch(() => { });
        $('cCSV').onclick = () => {
            const q = v => /[";\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
            const files = []; grups.forEach((l, g) => l.forEach(x => files.push([g, x.m.codi, x.m.nom, x.falta].map(q).join(';'))));
            baixa('compra.csv', '﻿proveidor;codi;nom;quantitat\n' + files.join('\n') + '\n', 'text/csv');
        };
    }

    // ─── Registre ───
    function vistaRegistre() {
        const r = prog.registre.slice().reverse();
        $('vista').innerHTML = `<h2>Registre</h2><div class="fx"><button class="bt" id="rCSV">⬇ Exportar CSV</button></div>
            ${r.length ? `<div class="targeta" style="padding:4px 8px"><table class="taula">${r.slice(0, 400).map(x => `<tr><td style="white-space:nowrap;font-size:12px">${esc(new Date(x.ts).toLocaleString('ca-ES'))}${x.op ? '<br>' + esc(x.op) : ''}</td><td>${esc(x.text)}</td></tr>`).join('')}</table></div>` : '<div class="buit">Encara no hi ha res.</div>'}`;
        $('rCSV').onclick = () => {
            const q = v => /[";\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
            baixa('registre_muntatge.csv', '﻿data;operari;tipus;text\n' + prog.registre.map(x => [x.ts, x.op, x.tipus, x.text].map(q).join(';')).join('\n') + '\n', 'text/csv');
        };
    }

    function baixa(nom, dades, tipus) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([dades], { type: tipus })); a.download = nom;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }

    // ─── Escàner (QR / Code 128) ───
    const esc_ = { stream: null, det: null, actiu: false, ultim: '', tUltim: 0, canvas: null };
    async function obreEscaner() {
        $('escaner').hidden = false; $('resEsc').className = 'resultat'; $('codiManual').value = '';
        esc_.actiu = true;
        try {
            esc_.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
            const v = $('video'); v.srcObject = esc_.stream; await v.play();
            if ('BarcodeDetector' in G) {
                const fmts = await G.BarcodeDetector.getSupportedFormats().catch(() => []);
                const vol = ['qr_code', 'code_128'].filter(f => !fmts.length || fmts.includes(f));
                esc_.det = new G.BarcodeDetector({ formats: vol });
            }
            bucleEscaner();
        } catch (e) {
            resultat('in', 'No es pot obrir la càmera (permís o connexió no segura). Escriu el codi o fes servir un lector USB/Bluetooth.');
            setTimeout(() => $('codiManual').focus(), 100);
        }
    }
    function tancaEscaner() {
        esc_.actiu = false;
        if (esc_.stream) esc_.stream.getTracks().forEach(t => t.stop());
        esc_.stream = null; $('escaner').hidden = true;
        if (pasActual) vistaPas(pasActual);
    }
    async function bucleEscaner() {
        if (!esc_.actiu) return;
        const v = $('video');
        try {
            let valor = null;
            if (v.readyState >= 2) {
                if (esc_.det) { const r = await esc_.det.detect(v); if (r.length) valor = r[0].rawValue; }
                else if (G.jsQR) {
                    const c = esc_.canvas || (esc_.canvas = document.createElement('canvas'));
                    const k = Math.min(1, 720 / v.videoWidth); c.width = v.videoWidth * k; c.height = v.videoHeight * k;
                    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(v, 0, 0, c.width, c.height);
                    const d = x.getImageData(0, 0, c.width, c.height), q = G.jsQR(d.data, c.width, c.height, { inversionAttempts: 'dontInvert' });
                    if (q) valor = q.data;
                }
            }
            if (valor) processaCodi(valor);
        } catch (e) { /* segueix */ }
        setTimeout(() => requestAnimationFrame(bucleEscaner), 120);
    }
    function resultat(tipus, html) { const r = $('resEsc'); r.className = 'resultat ' + tipus; r.innerHTML = html; }

    function processaCodi(valor) {
        valor = String(valor).trim(); if (!valor) return;
        const ara = Date.now();
        if (valor === esc_.ultim && ara - esc_.tUltim < 2500) return;
        esc_.ultim = valor; esc_.tUltim = ara;
        let e = null;
        if (valor.startsWith('FO1|')) {
            const [, safata, conjunt, codi] = valor.split('|');
            e = ETQ.find(x => x.safata === safata && x.codi === codi && x.tipus === 'caixeti')
                || ETQ.find(x => x.clau === safata && x.tipus !== 'caixeti');
            if (!e) { so(false); return resultat('er', `Etiqueta d'un altre projecte o d'una versió anterior<br><small>${esc(safata)} · ${esc(conjunt)}</small>`); }
        } else {
            const cand = ETQ.filter(x => x.tipus === 'caixeti' && x.codi === valor);
            e = cand.find(x => pasDe(x) === pasActual && !prog.agafat[x.clau]) || cand.find(x => pasDe(x) === pasActual) || cand.find(x => !prog.agafat[x.clau]) || cand[0];
            if (!e) { so(false); return resultat('er', `Codi desconegut: ${esc(valor)}`); }
        }
        if (e.tipus !== 'caixeti') {
            const x = perObj.get(e.clau), fills = x && x.o.caixes ? x.o.caixes.map(q => q.obj.id) : [e.clau];
            const l = ETQ.filter(y => y.tipus === 'caixeti' && fills.includes(y.safata));
            so(true);
            return resultat('in', `${esc(e.clau)} · ${l.filter(y => prog.agafat[y.clau]).length}/${l.length} caixetins agafats`);
        }
        const pas = pasDe(e), r = perConj.get(pas);
        if (pasActual && pas !== pasActual) {
            so(false);
            return resultat('er', `✗ No és d'aquest pas<br>${esc(e.codi)} ×${e.qty} és del pas ${r ? r.pas + ' · ' + esc(r.conj.nom) : '?'}`);
        }
        const ja = !!prog.agafat[e.clau];
        if (!ja) { prog.agafat[e.clau] = new Date().toISOString(); registra('preparacio', `${e.codi} ×${e.qty}: agafat per escaneig (${e.safata})`); desaProg(); }
        const it = itemsDe.get(pas) && itemsDe.get(pas).get(e.caixeti.mat.id);
        const est = r ? estatPas(r) : null;
        so(true);
        resultat('ok', `${ja ? 'Ja estava agafat' : '✓ Agafat'}: ${esc(e.codi)} ×${e.qty}<br><small>${esc(e.nom)}${it && it.parell ? ' · ' + fmt(it.parell, 1) + ' N·m' : ''}${it && it.nota ? '<br>▸ ' + esc(it.nota) : ''}</small>` +
            (est ? `<br><small>Pas ${r.pas}: ${est.agafats}/${est.total}${est.agafats === est.total ? ' · complet!' : ''}</small>` : ''));
    }
    $('bEscaneja').onclick = () => obreEscaner();
    $('bTancaEsc').onclick = tancaEscaner;
    $('codiManual').addEventListener('keydown', e => { if (e.key === 'Enter') { processaCodi(e.target.value); e.target.value = ''; esc_.ultim = ''; } });
    // lector de codis USB / Bluetooth (fa de teclat): tecles molt ràpides acabades en Enter
    const teclat = { buf: '', t: 0 };
    document.addEventListener('keydown', e => {
        if (!P || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
        const ara = Date.now();
        if (ara - teclat.t > 80) teclat.buf = '';
        teclat.t = ara;
        if (e.key === 'Enter' && teclat.buf.length >= 3) {
            const v = teclat.buf; teclat.buf = '';
            esc_.ultim = ''; $('escaner').hidden = false; processaCodi(v);
        } else if (e.key.length === 1) teclat.buf += e.key;
    });

    // ─── Menú ───
    $('bMenu').onclick = () => {
        $('operari').value = pref.operari; $('consumAuto').checked = pref.consumAuto;
        $('infoApp').textContent = `FOrdre ${FO.VERSIO}${P ? ' · ' + P.nom : ''}${navigator.onLine ? '' : ' · sense connexió'}`;
        $('menu').hidden = false;
    };
    $('bTancaMenu').onclick = () => { $('menu').hidden = true; };
    $('menu').addEventListener('click', e => { if (e.target.id === 'menu') $('menu').hidden = true; });
    $('operari').oninput = function () { pref.operari = this.value.trim(); escriu(CLAU_PREF, pref); };
    $('consumAuto').onchange = function () { pref.consumAuto = this.checked; escriu(CLAU_PREF, pref); };
    $('bObrirFitxer').onclick = () => $('fProjecte').click();
    $('fProjecte').addEventListener('change', function () {
        const f = this.files[0]; this.value = ''; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => { try { usaProjecte(JSON.parse(rd.result), 'fitxer'); $('menu').hidden = true; location.hash = '#/passos'; ruta(); } catch (e) { avis('Fitxer no vàlid'); } };
        rd.readAsText(f);
    });
    $('bEnganxa').onclick = async () => {
        const t = prompt('Enganxa l\'enllaç del projecte (…muntatge.html#p=…)');
        if (!t) return;
        const i = t.indexOf('#p=');
        try { usaProjecte(JSON.parse(await FO.descomprimeix(t.slice(i + 3))), 'enllaç'); $('menu').hidden = true; location.hash = '#/passos'; ruta(); }
        catch (e) { avis('Enllaç no vàlid'); }
    };
    $('bOrdinador').onclick = () => {
        const d = llegeix(FO.CLAU_PROJECTE);
        if (!d) return avis('No hi ha cap projecte de l\'app d\'escriptori en aquest navegador');
        usaProjecte(d, 'navegador'); $('menu').hidden = true; location.hash = '#/passos'; ruta();
    };
    $('bExemple').onclick = () => { usaProjecte(FO.exemple(), 'exemple'); $('menu').hidden = true; location.hash = '#/passos'; ruta(); };
    $('bExportaProg').onclick = () => { if (P) baixa(FO.nomFitxer(P.nom) + '_progres.json', JSON.stringify({ projecte: P.id, nom: P.nom, progres: prog }, null, 1), 'application/json'); };
    $('bImportaProg').onclick = () => $('fProgres').click();
    $('fProgres').addEventListener('change', function () {
        const f = this.files[0]; this.value = ''; if (!f || !P) return;
        const rd = new FileReader();
        rd.onload = () => {
            try {
                const d = JSON.parse(rd.result);
                if (d.projecte !== P.id && !confirm('Aquest progrés és d\'un altre projecte. Importar-lo igualment?')) return;
                prog = Object.assign(nouProg(), d.progres); desaProg(); $('menu').hidden = true; ruta(); avis('Progrés importat');
            } catch (e) { avis('Fitxer no vàlid'); }
        };
        rd.readAsText(f);
    });
    $('bReinicia').onclick = () => {
        if (!P || !confirm('Esborrar tot el progrés, l\'estoc i el registre d\'aquest projecte en aquest dispositiu?')) return;
        prog = nouProg(); desaProg(); $('menu').hidden = true; ruta();
    };

    // Instal·lació com a app
    let promptInstal = null;
    G.addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptInstal = e; $('bInstal·la').hidden = false; });
    $('bInstal·la').onclick = async () => { if (!promptInstal) return; promptInstal.prompt(); await promptInstal.userChoice.catch(() => { }); promptInstal = null; $('bInstal·la').hidden = true; };
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
        navigator.serviceWorker.register('sw.js').catch(() => { });
    }

    // ─── Inici ───
    carregaInicial().then(() => { if (!location.hash || location.hash === '#') location.hash = '#/passos'; else ruta(); if (!P) ruta(); });
    G.FOrdreMuntatge = { get projecte() { return P; }, get progres() { return prog; }, processaCodi, get etiquetes() { return ETQ; } };
})(window);
