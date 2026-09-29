// ═══════════════════════════════════════════════════════════════
// FOrdre Taller — app del dispositiu (mòbil i tauleta)
// ───────────────────────────────────────────────────────────────
// Cada persona entra amb el seu rol i veu la seva part del procés:
//
//   📦 Magatzem    OMPLIR     posa el material a les caixes (escanejant les
//                             etiquetes), porta l'estoc i la llista de compra.
//   🔧 Muntador    UTILITZAR  agafa les caixes, segueix les instruccions,
//                             marca el pas com a muntat i torna les caixes.
//   ✅ Qualitat    COMPROVAR  verifica cada pas muntat amb una llista de
//                             comprovació; aprova o rebutja amb motiu.
//   📋 Responsable GESTIONAR  ordres de fabricació, tauler, assignacions,
//                             incidències, persones i RESULTATS (informe).
//
// Dues maneres de treballar:
//  · Amb el servidor del taller (Raspberry Pi o PC): cada persona entra amb
//    nom i PIN, tot es comparteix en temps real i el servidor comprova les
//    regles (permisos i «quatre ulls»). Sense connexió, els canvis es
//    guarden i s'envien quan torna (també les fotos).
//  · Sense servidor: l'aparell treballa sol i es pot triar qualsevol rol.
//
// Tot canvi és una operació (js/fo-progres.js); els estats, el model del
// taller i l'informe surten de js/fo-informe.js.
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO;

    // ═══ Utilitats ═══
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (v, d) => (Math.round(v * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toLocaleString('ca-ES');
    const data = t => t ? new Date(t).toLocaleString('ca-ES', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const llegeix = k => { try { const t = localStorage.getItem(k); return t ? JSON.parse(t) : null; } catch (e) { return null; } };
    const escriu = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
    const xipEstat = (e, taula) => `<span class="estat" style="background:${(taula[e] || {}).col || '#888'}">${esc((taula[e] || { nom: e }).nom)}</span>`;
    const CLAU_MOBIL = 'fordre.muntatge.projecte', CLAU_PREF = 'fordre.muntatge.pref', CLAU_SESSIO = 'fordre.muntatge.sessio';

    function avis(msg, ms) {
        const a = $('avis'); a.textContent = msg; a.classList.add('on');
        clearTimeout(avis.t); avis.t = setTimeout(() => a.classList.remove('on'), ms || 2200);
    }
    // So i vibració: curt i agut si va bé, llarg i greu si no
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
    function baixa(nom, dades, tipus) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([dades], { type: tipus })); a.download = nom;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    const csv = (cap, files) => '﻿' + cap + '\n' + files.map(f => f.map(v => /[";\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(';')).join('\n') + '\n';

    // ═══ Estat de l'app ═══
    let P = null, M = null;      // projecte i model del taller (caixes, passos, etiquetes)
    let ORDRES = [], ORD = null; // ordres de fabricació del projecte i l'actual
    let prog = null;             // progrés de l'ordre actual
    let cua = [];                // operacions pendents d'enviar: [{ tok, op }]
    let ses = llegeix(CLAU_SESSIO);   // sessió al servidor: { token, nom, rols, servidor }
    const pref = Object.assign({ consumAuto: true, rol: '', nomLocal: '', ordres: {}, comptador: 0 }, llegeix(CLAU_PREF) || {});
    if (!pref.disp) pref.disp = FO.nouDispositiu();
    const desaPref = () => escriu(CLAU_PREF, pref);
    desaPref();
    let pasActual = null, caixaActual = null, pantallaSessio = false;
    const verifChecks = {};      // comprovacions marcades a la pantalla de Qualitat (per pas)

    // ═══ Qui treballa i amb quin rol ═══
    const TOTS_ROLS = Object.keys(FO.ROLS);
    // Rols que pot fer servir la persona: al servidor, els seus (el Responsable, tots); sol, tots
    const rolsDisponibles = () => !srv.url ? TOTS_ROLS : !ses ? [] : ses.rols.includes('responsable') ? TOTS_ROLS : ses.rols;
    const rol = () => { const r = rolsDisponibles(); return r.includes(pref.rol) ? pref.rol : r[0] || 'muntador'; };
    const nomPersona = () => srv.url ? (ses ? ses.nom : '') : pref.nomLocal;
    const esResponsable = () => srv.url ? !!(ses && ses.rols.includes('responsable')) : rol() === 'responsable';
    // Qui comprova les regles abans d'aplicar una operació. Al servidor, la persona amb
    // tots els seus rols (igual que ho fa el servidor); sol, el rol que s'ha triat.
    const validador = () => srv.url ? (ses ? { nom: ses.nom, rols: ses.rols } : null) : { nom: pref.nomLocal, rols: [rol()] };
    const pot = t => { const v = validador(); return !v || FO.potFer(v.rols, t); };

    // ═══ Progrés i cua, desats per projecte i ordre ═══
    const clauProg = () => `fordre.muntatge.progres.${P.id}.${ORD.id}`;
    const clauCua = () => `fordre.muntatge.cua.${P.id}.${ORD.id}`;
    const clauOrdres = () => 'fordre.muntatge.ordres.' + P.id;
    function desaProg() { if (!escriu(clauProg(), prog)) avis('No s\'ha pogut desar el progrés (memòria plena?)'); }
    const desaCua = () => escriu(clauCua(), cua);
    function carregaProgres() {
        let p = llegeix(clauProg());
        // progrés d'una versió anterior (sense ordres): passa a la primera ordre
        if (!p && ORD.id === 'OF-1') p = llegeix('fordre.muntatge.progres.' + P.id);
        prog = FO.normalitzaProgres(p);
        cua = (llegeix(clauCua()) || []).map(x => x.op ? x : { tok: ses ? ses.token : '', op: x });
    }

    // Crea una operació, comprova que es pot fer, l'aplica i (si hi ha servidor) l'envia.
    // Retorna l'operació, o null si les regles no la permeten.
    function fer(t, dades, text) {
        if (!prog) return null;
        pref.comptador = (pref.comptador || 0) + 1; desaPref();
        const op = FO.creaOp(pref.disp, pref.comptador, t, Object.assign({ text }, dades), nomPersona(), rol());
        const motiu = FO.validaOp(prog, op, validador());
        if (motiu) { so(false); avis(motiu, 4500); return null; }
        FO.aplicaOp(prog, op);
        desaProg();
        if (enXarxa()) { cua.push({ tok: ses ? ses.token : '', op }); desaCua(); sincronitza(); }
        pintaEstatSrv();
        return op;
    }

    // ═══ Servidor del taller ═══
    const srv = { url: '', info: null, estat: 'local', es: null, enCurs: false, reintent: null, projectes: [], projecteOk: false, projecteNou: false, fora: false };
    // El projecte actual es comparteix pel servidor (encara que ara no hi hagi connexió)
    const enXarxa = () => !!(srv.url && srv.projecteOk && ORD);
    const rutaOrdre = sufix => `/api/progres/${encodeURIComponent(P.id)}/${encodeURIComponent(ORD.id)}${sufix || ''}`;
    const paramsAuth = () => { const q = []; if (ses) q.push('token=' + encodeURIComponent(ses.token)); if (pref.clau) q.push('clau=' + encodeURIComponent(pref.clau)); return q.length ? '?' + q.join('&') : ''; };

    // Petició a l'API amb la clau del taller i la sessió. Si falla, llança un error amb .codi
    async function api(ruta, opcions) {
        opcions = opcions || {};
        const cap = { 'Content-Type': 'application/json' };
        if (pref.clau) cap['X-FOrdre-Clau'] = pref.clau;
        if (ses) { cap['X-FOrdre-Token'] = ses.token; cap['X-FOrdre-Rol'] = rol(); }
        const r = await fetch(srv.url + ruta, Object.assign({ cache: 'no-store' }, opcions, { headers: Object.assign(cap, opcions.headers || {}) }));
        let d = null;
        try { d = await r.json(); } catch (e) { /* sense cos */ }
        if (!r.ok) {
            const e = new Error((d && d.error) || 'Error ' + r.status); e.codi = r.status;
            if (r.status === 401 && /clau/i.test(e.message)) { srv.estat = 'clau'; pintaEstatSrv(); }
            throw e;
        }
        return d;
    }
    // Hi ha servidor? Primer el lloc des d'on s'ha obert l'app, després l'adreça configurada.
    // Si no respon però ja s'hi treballava, es continua «fora de línia» amb la cua.
    async function detectaServidor() {
        const base = (location.origin + location.pathname.replace(/[^/]*$/, '')).replace(/\/$/, '');
        srv.fora = false;
        for (const url of [base, pref.servidor].filter(Boolean)) {
            try {
                const r = await fetch(url.replace(/\/$/, '') + '/api/estat', { cache: 'no-store' });
                const d = await r.json();
                if (d && d.app === 'FOrdre') {
                    srv.url = url.replace(/\/$/, ''); srv.info = d;
                    pref.darrerServidor = srv.url; desaPref();
                    return d;
                }
            } catch (e) { /* no hi és */ }
        }
        if (pref.darrerServidor && ses && ses.servidor === pref.darrerServidor) {
            srv.url = pref.darrerServidor; srv.fora = true; srv.estat = 'error';
            return null;
        }
        srv.url = ''; srv.info = null;
        return null;
    }
    async function carregaProjectesSrv() {
        try { srv.projectes = await api('/api/projectes'); } catch (e) { srv.projectes = []; }
        return srv.projectes;
    }

    // Envia la cua. Les operacions de cada sessió s'envien amb la seva fitxa: si algú
    // canvia de persona abans de tenir connexió, cadascú signa el que ha fet.
    async function sincronitza() {
        if (!enXarxa() || srv.enCurs) return;
        srv.enCurs = true;
        let continua = false;
        try {
            const tok = cua.length ? cua[0].tok : '';
            const grup = cua.filter(x => x.tok === tok);
            let r;
            try {
                r = await api(rutaOrdre('/ops'), { method: 'POST', body: JSON.stringify({ ops: grup.map(x => x.op) }), headers: tok ? { 'X-FOrdre-Token': tok } : {} });
            } catch (e) {
                if (e.codi === 401 && !/clau/i.test(e.message)) {
                    if (tok && (!ses || tok !== ses.token)) {
                        // sessió antiga ja tancada: aquests canvis ja no es poden signar
                        cua = cua.filter(x => x.tok !== tok); desaCua();
                        avis(`S'han descartat ${grup.length} canvis d'una sessió que ja no és vàlida`, 5000);
                        continua = cua.length > 0;
                        return;
                    }
                    tancaSessioLocal();
                    return;
                }
                throw e;
            }
            srv.estat = 'connectat'; srv.fora = false;
            const enviades = new Set(grup.map(x => x.op.id));
            cua = cua.filter(x => !enviades.has(x.op.id));   // aplicades o rebutjades: ja no s'envien més
            if (r.rebutjades && r.rebutjades.length) { so(false); avis('El servidor no ho ha acceptat: ' + r.rebutjades[0].motiu, 6000); }
            nouEstat(r.estat);
            continua = cua.length > 0;
            pujaFotosPendents();
        } catch (e) {
            if (srv.estat !== 'clau') srv.estat = 'error';
            clearTimeout(srv.reintent); srv.reintent = setTimeout(sincronitza, 8000);
        } finally { srv.enCurs = false; pintaEstatSrv(); }
        if (continua) setTimeout(sincronitza, 150);
    }
    // Estat nou des del servidor: s'hi tornen a aplicar els canvis locals encara no enviats
    function nouEstat(est) {
        const revAntiga = prog ? prog.rev : -1;
        prog = FO.normalitzaProgres(est);
        cua = cua.filter(x => !prog.vist.includes(x.op.id));
        cua.forEach(x => FO.aplicaOp(prog, x.op));
        desaProg(); desaCua();
        if (revAntiga !== prog.rev) refresca();
    }
    // Temps real: el servidor avisa de cada canvi de l'ordre, del projecte i de les ordres
    function escolta() {
        if (srv.es) { srv.es.close(); srv.es = null; }
        if (!enXarxa() || typeof EventSource !== 'function') return;
        const es = new EventSource(srv.url + rutaOrdre('/flux') + paramsAuth());
        es.addEventListener('estat', ev => { srv.estat = 'connectat'; srv.fora = false; try { nouEstat(JSON.parse(ev.data)); } catch (e) { /* */ } pintaEstatSrv(); });
        es.addEventListener('projecte', () => {
            avis('El projecte s\'ha actualitzat des de l\'ordinador. Toca ⟳ per carregar-lo.', 5000);
            srv.projecteNou = true; pintaEstatSrv();
        });
        es.addEventListener('ordres', ev => { try { ORDRES = JSON.parse(ev.data); escriu(clauOrdres(), ORDRES); } catch (e) { /* */ } });
        es.onerror = () => { srv.estat = 'error'; pintaEstatSrv(); };
        es.onopen = () => { srv.estat = 'connectat'; pintaEstatSrv(); if (cua.length) sincronitza(); };
        srv.es = es;
    }
    // Enllaça el projecte actual amb el servidor: si no hi és, el Responsable el publica;
    // després es carreguen les ordres i el progrés de l'ordre triada.
    async function connectaProjecte() {
        srv.projecteOk = false;
        if (!srv.url || !ses) return;
        if (srv.fora) {
            // sense connexió: si ja s'hi havia treballat, es continua amb la còpia i la cua
            srv.projecteOk = (llegeix(clauOrdres()) || []).some(o => o.id === ORD.id);
            return;
        }
        try {
            if (!srv.projectes.some(x => x.id === P.id)) {
                if (!ses.rols.includes('responsable')) {
                    avis('Aquest projecte no és al servidor del taller: demana al Responsable que el publiqui. Mentrestant treballes només en aquest aparell.', 7000);
                    return;
                }
                await api('/api/projectes/' + encodeURIComponent(P.id), { method: 'PUT', body: JSON.stringify(P) });
                await carregaProjectesSrv();
                avis('Projecte publicat al servidor del taller');
            }
            ORDRES = await api('/api/ordres/' + encodeURIComponent(P.id));
            escriu(clauOrdres(), ORDRES);
            triaOrdre();
            srv.projecteOk = true; srv.estat = 'connectat';
            carregaProgres();
            await sincronitza();
            escolta();
        } catch (e) { srv.estat = 'error'; }
        pintaEstatSrv();
    }
    async function recarregaDelServidor(id) {
        const p = await api('/api/projectes/' + encodeURIComponent(id || P.id));
        srv.projecteNou = false;
        usaProjecte(p);
        await connectaProjecte();
        ruta();
    }
    function pintaEstatSrv() {
        const b = $('bSrv'); if (!b) return;
        const n = cua.length;
        const [col, tit] = !srv.url ? ['var(--dm)', 'Sense servidor: el progrés només es desa en aquest aparell']
            : !srv.projecteOk ? ['var(--wr)', 'Aquest projecte no es comparteix pel servidor del taller']
            : srv.estat === 'connectat' ? [n ? 'var(--wr)' : 'var(--ok)', n ? `Connectat · ${n} canvis per enviar` : 'Connectat al servidor del taller']
            : srv.estat === 'clau' ? ['var(--er)', 'Cal la clau del taller (menú ⋮)']
            : ['var(--er)', `Sense connexió amb el servidor${n ? ` · ${n} canvis en cua` : ''}`];
        b.style.color = col; b.title = tit;
        b.textContent = srv.projecteNou ? '⟳' : '●';
    }
    G.addEventListener('online', () => { if (srv.url) { sincronitza(); escolta(); } });
    // Torna a pintar la vista actual amb el progrés nou (sense trepitjar un camp que s'està escrivint)
    function refresca() {
        if (!P || pantallaSessio) return;
        const a = document.activeElement;
        if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && $('vista').contains(a)) return;
        ruta();
    }

    // ═══ Sessió: primer ús, entrar amb PIN i canviar de persona ═══
    function tancaSessioLocal() {
        ses = null; localStorage.removeItem(CLAU_SESSIO);
        if (srv.es) { srv.es.close(); srv.es = null; }
        srv.projecteOk = false;
        vistaEntrar();
    }
    async function entra(nom, pin) {
        const d = await api('/api/sessio', { method: 'POST', body: JSON.stringify({ nom, pin }) });
        ses = { token: d.token, nom: d.nom, rols: d.rols, servidor: srv.url };
        escriu(CLAU_SESSIO, ses);
        if (!rolsDisponibles().includes(pref.rol)) { pref.rol = ses.rols[0]; desaPref(); }
        await continuaInici();
        avis('Hola, ' + ses.nom);
    }
    async function surt() {
        if (ses && cua.some(x => x.tok === ses.token)) await sincronitza();
        const queden = ses ? cua.filter(x => x.tok === ses.token).length : 0;
        if (queden && !confirm(`Hi ha ${queden} canvis teus sense enviar (no hi ha connexió). S'enviaran sols quan torni. Canviar de persona igualment?`)) return;
        // si encara queden canvis seus a la cua, la sessió es manté al servidor perquè es puguin signar
        if (!queden) api('/api/sessio', { method: 'DELETE' }).catch(() => { });
        $('menu').hidden = true;
        tancaSessioLocal();
    }
    // Primer ús: el servidor encara no té cap Responsable
    function vistaPrimerUs() {
        pantallaSessio = true; mostraNav(false); pintaCap();
        $('vista').innerHTML = `<div class="targeta"><h2>Benvinguda al taller</h2>
            <p class="ajuda">És la primera vegada que es fa servir aquest servidor. Crea el <b>Responsable</b>: és qui dona d'alta la resta de persones, publica els projectes i obre les ordres de fabricació.</p>
            <label class="camp">Nom<input id="puNom" autocomplete="name"></label>
            <label class="camp">PIN (de 4 a 8 xifres)<input id="puPin" type="password" inputmode="numeric" autocomplete="new-password"></label>
            <label class="camp">Repeteix el PIN<input id="puPin2" type="password" inputmode="numeric" autocomplete="new-password"></label>
            <button class="bt pr" id="puCrea">Crear el Responsable i entrar</button></div>`;
        $('puCrea').onclick = async () => {
            const nom = $('puNom').value.trim(), pin = $('puPin').value.trim();
            if (!nom) return avis('Escriu el nom');
            if (!/^\d{4,8}$/.test(pin)) return avis('El PIN ha de tenir de 4 a 8 xifres');
            if (pin !== $('puPin2').value.trim()) return avis('Els dos PIN no coincideixen');
            try {
                await api('/api/persones', { method: 'POST', body: JSON.stringify({ nom, rols: ['responsable'], pin }) });
                srv.info.configurat = true;
                await entra(nom, pin);
            } catch (e) { avis(e.message, 4000); }
        };
    }
    // Entrada: es tria el nom i s'escriu el PIN (teclat gran, pensat per a guants i pantalles tàctils)
    async function vistaEntrar() {
        pantallaSessio = true; mostraNav(false); pintaCap();
        let persones = [];
        try { persones = await api('/api/persones'); } catch (e) { /* sense connexió */ }
        let tria = null, pin = '';
        const pinta = () => {
            $('vista').innerHTML = !tria ? `<h2>Qui ets?</h2>
                ${persones.map((x, i) => `<button class="bt gran" data-i="${i}"><i>${FO.ROLS[x.rols[0]] ? FO.ROLS[x.rols[0]].ico : '👤'}</i><span>${esc(x.nom)}<small>${x.rols.map(r => esc(FO.ROLS[r] ? FO.ROLS[r].nom : r)).join(' · ')}</small></span></button>`).join('')
                    || '<p class="ajuda">No es pot obtenir la llista de persones. Comprova la connexió amb el servidor del taller.</p>'}`
                : `<h2>${esc(tria.nom)}</h2><p class="ajuda">Escriu el teu PIN</p>
                <input class="pin" id="enPin" type="password" inputmode="numeric" autocomplete="current-password" value="${esc(pin)}">
                <div class="teclat">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '✓'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>
                <button class="bt" id="enAltre">‹ No soc ${esc(tria.nom)}</button>`;
            $('vista').querySelectorAll('[data-i]').forEach(b => b.onclick = () => { tria = persones[+b.dataset.i]; pin = ''; pinta(); });
            if (!tria) return;
            const envia = async () => {
                try { await entra(tria.nom, pin); } catch (e) { so(false); avis(e.message, 3500); pin = ''; pinta(); }
            };
            $('enPin').oninput = function () { pin = this.value.replace(/\D/g, '').slice(0, 8); };
            $('enPin').onkeydown = e => { if (e.key === 'Enter') envia(); };
            $('vista').querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
                const k = b.dataset.k;
                if (k === '⌫') pin = pin.slice(0, -1); else if (k === '✓') return envia(); else if (pin.length < 8) pin += k;
                $('enPin').value = pin;
            });
            $('enAltre').onclick = () => { tria = null; pinta(); };
        };
        pinta();
    }

    // ═══ Fotos (IndexedDB) ═══
    // Sense connexió es guarden al mòbil i es pugen soles quan torna.
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
            del: pas => tx('readonly', s => s.index('pas').getAll(pas)),
            totes: () => tx('readonly', s => s.getAll())
        };
    })();
    const clauFotos = conj => `${P.id}|${ORD.id}|${conj}`;
    const rutaFotos = () => `/api/fotos/${encodeURIComponent(P.id)}/${encodeURIComponent(ORD.id)}`;
    let pujantFotos = false;
    async function pujaFotosPendents() {
        if (pujantFotos || !enXarxa() || srv.estat !== 'connectat') return;
        pujantFotos = true;
        let n = 0;
        try {
            const pendents = (await idb.totes()).filter(f => f.pendent && f.pendent.proj === P.id && f.pendent.ordre === ORD.id);
            for (const f of pendents) {
                const r = await api(rutaFotos(), { method: 'POST', body: JSON.stringify({ conj: f.pendent.conj, dades: f.dades }), headers: f.pendent.tok ? { 'X-FOrdre-Token': f.pendent.tok } : {} });
                // l'operació la signa qui va fer la foto, amb la seva sessió
                pref.comptador++; desaPref();
                const op = FO.creaOp(pref.disp, pref.comptador, 'foto', { conj: f.pendent.conj, fitxer: r.fitxer, text: `Foto al pas ${codiConj(f.pendent.conj)}` }, f.op, f.rol);
                FO.aplicaOp(prog, op); cua.push({ tok: f.pendent.tok, op }); desaCua(); desaProg();
                await idb.esborra(f.id);
                n++;
            }
        } catch (e) { /* es tornarà a provar a la sincronització següent */ }
        pujantFotos = false;
        if (n) { avis(`${n} ${n === 1 ? 'foto pujada' : 'fotos pujades'} al taller`); sincronitza(); }
    }
    async function pintaFotos(conj) {
        const cont = $('pFotos'); if (!cont) return;
        const remotes = enXarxa() ? (prog.fotos[conj] || []).map(f => `<img src="${esc(srv.url + rutaFotos() + '/' + encodeURIComponent(f.fitxer) + paramsAuth())}" alt="" title="${esc(data(f.ts) + (f.op ? ' · ' + f.op : ''))}">`).join('') : '';
        try {
            const locals = await idb.del(clauFotos(conj));
            cont.innerHTML = remotes + locals.map(f => `<img src="${f.dades}" alt="" data-id="${f.id}" title="${esc(data(f.ts) + (f.pendent ? ' · pendent de pujar' : ''))}"${f.pendent ? ' class="pendent"' : ''}>`).join('');
            cont.querySelectorAll('img[data-id]').forEach(im => im.addEventListener('click', async () => {
                if (confirm('Esborrar aquesta foto d\'aquest aparell?')) { await idb.esborra(+im.dataset.id); pintaFotos(conj); }
            }));
        } catch (e) { cont.innerHTML = remotes || '<p class="ajuda">Aquest navegador no permet guardar fotos.</p>'; }
    }
    $('fFoto').addEventListener('change', async function () {
        const f = this.files[0], conj = this.dataset.pas || pasActual; this.value = '';
        if (!f || !prog) return;
        if (!pot('foto')) return avis('El teu rol no permet afegir fotos');
        try {
            const dades = await redueix(f, 1280);
            let pujada = false;
            if (enXarxa() && srv.estat === 'connectat') {
                try {
                    const r = await api(rutaFotos(), { method: 'POST', body: JSON.stringify({ conj, dades }) });
                    pujada = !!fer('foto', { conj, fitxer: r.fitxer }, `Foto al pas ${codiConj(conj)}`);
                } catch (e) { /* sense connexió: es guarda al mòbil i es pujarà després */ }
            }
            if (!pujada) {
                await idb.afegeix({
                    pas: clauFotos(conj), ts: new Date().toISOString(), op: nomPersona(), rol: rol(), dades,
                    pendent: enXarxa() ? { proj: P.id, ordre: ORD.id, conj, tok: ses ? ses.token : '' } : null
                });
            }
            pintaFotos(conj);
            avis(pujada ? 'Foto desada al taller' : enXarxa() ? 'Foto desada: es pujarà quan hi hagi connexió' : 'Foto desada en aquest aparell');
        } catch (e) { avis('No s\'ha pogut desar la foto'); }
    });
    // Redueix una foto a `mx` píxels de costat (JPEG) perquè ocupi poc
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

    // ═══ Projecte i ordre de fabricació ═══
    function usaProjecte(p, origen) {
        if (srv.es) { srv.es.close(); srv.es = null; }
        P = FO.normalitzaProjecte(p);
        M = FO.modelTaller(P);
        escriu(CLAU_MOBIL, P);
        pref.projecte = P.id; desaPref();
        // ordres guardades a l'aparell (sense servidor, o còpia de les del servidor per treballar sense connexió)
        ORDRES = llegeix(clauOrdres()) || [];
        if (!ORDRES.length) {
            ORDRES = [{ id: 'OF-1', codi: FO.codiOrdreSeguent([]), serie: '', notes: '', creada: new Date().toISOString(), creador: nomPersona() }];
            escriu(clauOrdres(), ORDRES);
        }
        srv.projecteOk = false;
        triaOrdre();
        carregaProgres();
        if (origen) avis('Projecte carregat: ' + P.nom);
    }
    // Ordre de treball: la darrera triada en aquest aparell, o la més recent
    function triaOrdre() {
        ORD = ORDRES.find(o => o.id === pref.ordres[P.id]) || ORDRES[ORDRES.length - 1];
        pref.ordres[P.id] = ORD.id; desaPref();
    }
    function canviaOrdre(id) {
        const o = ORDRES.find(x => x.id === id);
        if (!o) return;
        if (srv.es) { srv.es.close(); srv.es = null; }
        ORD = o; pref.ordres[P.id] = o.id; desaPref();
        carregaProgres();
        if (enXarxa()) { sincronitza(); escolta(); }
        avis('Ordre ' + o.codi);
    }
    async function novaOrdre(dades) {
        if (enXarxa()) {
            const o = await api('/api/ordres/' + encodeURIComponent(P.id), { method: 'POST', body: JSON.stringify(dades) });
            ORDRES = await api('/api/ordres/' + encodeURIComponent(P.id));
            escriu(clauOrdres(), ORDRES);
            return o;
        }
        const o = { id: 'OF-' + (ORDRES.length + 1) + '-' + Date.now().toString(36), codi: dades.codi || FO.codiOrdreSeguent(ORDRES), serie: dades.serie || '', notes: dades.notes || '', creada: new Date().toISOString(), creador: nomPersona() };
        ORDRES.push(o); escriu(clauOrdres(), ORDRES);
        return o;
    }
    const codiConj = id => { const r = M && M.perConj.get(id); return r ? r.conj.codi : id; };

    // Projecte en arrencar: enllaç, fitxer, servidor o el darrer que es va fer servir
    async function projecteInicial() {
        const h = location.hash;
        if (h.startsWith('#p=')) {
            try {
                usaProjecte(JSON.parse(await FO.descomprimeix(h.slice(3))), 'enllaç');
                history.replaceState(null, '', location.pathname + location.search + '#/');
                return;
            } catch (e) { avis('L\'enllaç del projecte no és vàlid'); }
        }
        const q = new URLSearchParams(location.search).get('f');
        if (q) {
            try { const r = await fetch(q); usaProjecte(await r.json(), 'fitxer'); return; } catch (e) { avis('No s\'ha pogut descarregar ' + q); }
        }
        const m = llegeix(CLAU_MOBIL) || llegeix(FO.CLAU_PROJECTE);
        if (srv.url && ses && !srv.fora) {
            await carregaProjectesSrv();
            if (srv.projectes.length) {
                // la versió del servidor del projecte que ja es feia servir, o el més recent
                const ja = srv.projectes.find(x => x.id === pref.projecte) || (m && srv.projectes.find(x => x.id === m.id));
                const tria = ja || srv.projectes.slice().sort((a, b) => new Date(b.actualitzat) - new Date(a.actualitzat))[0];
                try { usaProjecte(await api('/api/projectes/' + encodeURIComponent(tria.id))); return; } catch (e) { /* segueix */ }
            }
        }
        if (m && m.conjunts) usaProjecte(m);
    }
    // Arrencada: servidor → sessió → projecte → ordre → vista del rol
    async function inicia() {
        await detectaServidor();
        if (srv.url && !srv.fora) {
            if (!srv.info.configurat) return vistaPrimerUs();
            if (ses && ses.servidor !== srv.url) ses = null;
            if (ses) {
                try { const jo = await api('/api/jo'); ses.rols = jo.rols; escriu(CLAU_SESSIO, ses); } catch (e) { if (e.codi === 401 && !/clau/i.test(e.message)) ses = null; }
            }
            if (!ses) return vistaEntrar();
        }
        await continuaInici();
    }
    async function continuaInici() {
        pantallaSessio = false;
        await projecteInicial();
        if (P) await connectaProjecte();
        pintaEstatSrv();
        if (P && !srv.url && !pref.rol) obreTriaRol();
        ruta();
    }

    // ═══ Navegació: pestanyes segons el rol ═══
    const NAV = {
        magatzem: [['omplir', '📦', 'Omplir'], ['estoc', '▦', 'Estoc'], ['compra', '🛒', 'Compra'], ['incidencies', '⚠', 'Incidències']],
        muntador: [['passos', '☰', 'Passos'], ['incidencies', '⚠', 'Incidències'], ['registre', '🕘', 'Registre']],
        qualitat: [['verificar', '✅', 'Verificar'], ['incidencies', '⚠', 'Incidències'], ['registre', '🕘', 'Registre']],
        responsable: [['tauler', '📋', 'Tauler'], ['ordres', '🏭', 'Ordres'], ['incidencies', '⚠', 'Incidències'], ['resultats', '📊', 'Resultats']]
    };
    // Pantalles de detall i la pestanya a què tornen
    const PARE = { pas: 'passos', caixa: 'omplir', verif: 'verificar', persones: 'tauler' };
    function mostraNav(v) { $('peu').hidden = !v; document.body.classList.toggle('sense-peu', !v); }
    function pintaNav(actual) {
        const oberts = prog ? prog.incidencies.filter(i => !i.resolta).length : 0;
        $('peu').innerHTML = NAV[rol()].map(([r, ico, nom]) => `<button data-ruta="${r}" class="${r === actual || PARE[actual] === r ? 'on' : ''}"><i>${ico}</i>${nom}${r === 'incidencies' && oberts ? ` (${oberts})` : ''}</button>`).join('');
        $('peu').querySelectorAll('button').forEach(b => b.onclick = () => { location.hash = '#/' + b.dataset.ruta; });
        mostraNav(true);
    }
    function pintaCap() {
        $('nomProj').textContent = P ? P.nom : 'Taller';
        const bo = $('bOrdre'), br = $('bRol');
        bo.hidden = !P || !ORD || pantallaSessio;
        if (ORD) { bo.textContent = ORD.codi + (prog && prog.tancada ? ' 🔒' : ''); bo.classList.toggle('tancada', !!(prog && prog.tancada)); }
        br.hidden = pantallaSessio || !rolsDisponibles().length;
        const r = FO.ROLS[rol()];
        br.innerHTML = `${r.ico}<span> ${r.nom}</span>`;
        br.title = (nomPersona() ? nomPersona() + ' · ' : '') + r.desc;
    }
    const VISTES = {};   // s'omple més avall: nom de ruta → funció que pinta la pantalla
    function ruta() {
        if (pantallaSessio) return;
        pintaCap();
        if (!P) { mostraNav(false); return vistaBuida(); }
        const h = location.hash.replace(/^#\/?/, '');
        let [nom, arg] = h.split('/');
        arg = arg ? decodeURIComponent(arg) : '';
        if (!VISTES[nom]) nom = NAV[rol()][0][0];
        pintaNav(nom);
        $('bEnrere').hidden = NAV[rol()].some(x => x[0] === nom);   // a les pestanyes no cal «enrere»
        pasActual = nom === 'pas' || nom === 'verif' ? arg : null;
        caixaActual = nom === 'caixa' ? arg : null;
        VISTES[nom](arg);
        window.scrollTo(0, 0);
    }
    G.addEventListener('hashchange', ruta);
    $('bEnrere').onclick = () => {
        const nom = location.hash.replace(/^#\/?/, '').split('/')[0];
        location.hash = '#/' + (PARE[nom] || NAV[rol()][0][0]);
    };
    $('bOrdre').onclick = () => { location.hash = '#/ordres'; };

    // Tria del rol (i, sense servidor, del nom que surt al registre)
    function obreTriaRol() {
        const l = rolsDisponibles();
        $('llistaRols').innerHTML = (!srv.url ? `<label class="camp">El teu nom (surt al registre)<input id="trNom" value="${esc(pref.nomLocal)}" autocomplete="name"></label>` : `<p class="ajuda">${esc(nomPersona())}</p>`) +
            l.map(r => `<button class="bt gran${r === rol() ? ' pr' : ''}" data-rol="${r}"><i>${FO.ROLS[r].ico}</i><span>${FO.ROLS[r].nom}<small>${esc(FO.ROLS[r].desc)}</small></span></button>`).join('');
        if ($('trNom')) $('trNom').oninput = function () { pref.nomLocal = this.value.trim(); desaPref(); };
        $('llistaRols').querySelectorAll('[data-rol]').forEach(b => b.onclick = () => {
            pref.rol = b.dataset.rol; desaPref();
            $('triaRol').hidden = true;
            location.hash = '#/' + NAV[rol()][0][0];
            ruta();
        });
        $('triaRol').hidden = false;
    }
    $('bRol').onclick = obreTriaRol;
    document.querySelectorAll('[data-tanca]').forEach(b => b.onclick = () => { $(b.dataset.tanca).hidden = true; });
    ['menu', 'triaRol'].forEach(id => $(id).addEventListener('click', e => { if (e.target.id === id) $(id).hidden = true; }));

    // Avís comú a totes les pantalles quan l'ordre està tancada
    const bannerTancada = () => prog.tancada ? `<div class="banner er">🔒 L'ordre <b>${esc(ORD.codi)}</b> està tancada (${esc(data(prog.tancada.ts))}${prog.tancada.op ? ' · ' + esc(prog.tancada.op) : ''}). Només es pot consultar.</div>` : '';

    function vistaBuida() {
        const llista = srv.projectes || [];
        $('vista').innerHTML = `<div class="buit"><h2>FOrdre Taller</h2>
            <p>${llista.length ? 'Tria un projecte del taller' : 'Encara no hi ha cap projecte. El Responsable el prepara a l\'app de l\'ordinador i el publica al servidor (botó <b>🏭 Taller</b>), o bé obre\'l aquí:'}</p>
            ${llista.map(x => `<button class="bt gran" data-psrv="${esc(x.id)}"><i>🏭</i><span>${esc(x.nom)}<small>${x.ordres.length} ${x.ordres.length === 1 ? 'ordre' : 'ordres'}</small></span></button>`).join('')}
            <div class="grup"><button class="bt pr" data-acc="fitxer">📂 Obrir fitxer</button><button class="bt" data-acc="exemple">🧪 Projecte d'exemple</button></div></div>`;
        $('vista').querySelector('[data-acc=fitxer]').onclick = () => $('fProjecte').click();
        $('vista').querySelector('[data-acc=exemple]').onclick = () => obreProjecte(FO.exemple(), 'exemple');
        $('vista').querySelectorAll('[data-psrv]').forEach(b => b.onclick = () => recarregaDelServidor(b.dataset.psrv).catch(e => avis(e.message)));
    }
    async function obreProjecte(p, origen) {
        usaProjecte(p, origen);
        await connectaProjecte();
        $('menu').hidden = true;
        location.hash = '#/';
        ruta();
        if (!srv.url && !pref.rol) obreTriaRol();   // primer cop en aquest aparell: qui ets i quin rol
    }

    // ═══════════════════════════════════════════════════════════
    // 📦 MAGATZEM · Omplir les caixes, estoc i compra
    // ═══════════════════════════════════════════════════════════
    const icones = m => (m.esd ? ' <span class="xip esd">⚡ ESD</span>' : '') + (m.liquid ? ' <span class="xip liq">💧</span>' : '') + (m.angleMax < 90 ? ' <span class="xip">⬆ vertical</span>' : '');
    // Caixes que omple el magatzem (les de guarda s'omplen muntant)
    const caixesKit = () => M.caixes.filter(c => !c.guarda && c.claus.length);
    const estatCaixa = c => FO.estatCaixa(prog, c.id, c.claus);
    const caixaDeClau = clau => M.caixes.find(c => c.claus.includes(clau));

    VISTES.omplir = function (filtre) {
        const totes = caixesKit(), plenes = totes.filter(c => ['plena', 'en ús', 'retornada'].includes(estatCaixa(c))).length;
        const perOmplir = filtre !== 'totes';
        $('vista').innerHTML = `${bannerTancada()}<div class="kpi"><div>Caixes plenes<b>${plenes} / ${totes.length}</b></div><div>Ordre<b style="font-size:16px">${esc(ORD.codi)}</b></div></div>
            <button class="bt pr" id="oEsc">⌖ Escanejar etiquetes per omplir</button>
            <div class="fx" style="margin:4px 0 8px"><button class="bt${perOmplir ? ' pr' : ''}" data-f="">Per omplir</button><button class="bt${perOmplir ? '' : ' pr'}" data-f="totes">Totes</button></div>
            ${M.PLA.map(r => {
                const cx = totes.filter(c => c.r === r && (!perOmplir || ['buida', 'parcial'].includes(estatCaixa(c))));
                if (!cx.length) return '';
                return `<h3>Pas ${r.pas} · ${esc(r.conj.codi)} ${esc(r.conj.nom)}</h3>` + cx.map(c => {
                    const n = c.claus.filter(k => prog.omplert[k]).length;
                    return `<div class="targeta pas" data-caixa="${esc(c.id)}" style="border-left-color:${c.o.color}">
                        <div class="info"><div class="nom">${esc(c.id)}</div><div class="sub">${c.o.forma === 'contenidor' ? 'Contenidor · ' + c.o.caixes.length + ' caixes' : c.o.forma === 'caixa' ? 'Caixa individual' : 'Safata'} · ${n}/${c.claus.length} caixetins</div>
                        <div class="barra"><div style="width:${n / c.claus.length * 100}%"></div></div></div>${xipEstat(estatCaixa(c), FO.ESTATS_CAIXA)}</div>`;
                }).join('');
            }).join('') || '<div class="buit">✓ Totes les caixes d\'aquesta ordre estan plenes.</div>'}`;
        $('oEsc').onclick = () => obreEscaner();
        $('vista').querySelectorAll('[data-f]').forEach(b => b.onclick = () => { location.hash = '#/omplir' + (b.dataset.f ? '/' + b.dataset.f : ''); });
        $('vista').querySelectorAll('[data-caixa]').forEach(n => n.onclick = () => { location.hash = '#/caixa/' + encodeURIComponent(n.dataset.caixa); });
    };

    VISTES.caixa = function (id) {
        const c = M.caixes.find(x => x.id === id);
        if (!c) { location.hash = '#/omplir'; return; }
        const est = estatCaixa(c);
        const files = c.claus.map(k => {
            const e = M.perClau.get(k), m = e.caixeti.mat, om = prog.omplert[k], estoc = prog.estoc[m.id];
            return `<div class="fila${om ? ' fet' : ''}" data-clau="${esc(k)}"><div class="chk">✓</div><span class="sw" style="background:${m.col}"></span>
                <div class="txt"><div class="cd">${esc(m.codi)}${icones(m)}</div><div class="nm">${esc(m.nom)}</div>${c.o.forma === 'contenidor' ? `<div class="ajuda">${esc(e.safata)}</div>` : ''}
                ${om ? `<div class="ajuda">Omplert ${esc(data(om.ts))}${om.op ? ' · ' + esc(om.op) : ''}${om.qty !== e.qty ? ` · <b>${om.qty}</b> de ${e.qty}` : ''}</div>` : ''}</div>
                <div class="q">×${e.qty}${estoc != null ? `<small class="${estoc < e.qty && !om ? 'falta' : ''}">estoc ${estoc}</small>` : ''}</div></div>`;
        }).join('');
        $('vista').innerHTML = `${bannerTancada()}<div class="cap-pas" style="background:${c.o.color}"><div class="sub">Pas ${c.r.pas} · ${esc(c.r.conj.codi)} ${esc(c.r.conj.nom)}</div><h2>${esc(c.id)}</h2><div class="sub">${xipEstat(est, FO.ESTATS_CAIXA)}</div></div>
            <p class="ajuda">Toca cada caixetí quan hi hagis posat el material, o escaneja'n l'etiqueta. Toca'l un altre cop per buidar-lo.</p>
            <div class="fx"><button class="bt pr" id="cEsc">⌖ Escanejar</button><button class="bt" id="cTot">Omplir-ho tot</button></div>
            <div class="objecte">${files}</div>
            <div class="fx"><button class="bt" id="cRet"${est === 'retornada' ? ' disabled' : ''}>↩ Caixa retornada al magatzem</button><button class="bt" id="cInc">⚠ Incidència</button></div>`;
        $('vista').querySelectorAll('[data-clau]').forEach(f => f.onclick = () => { commutaOmplert(f.dataset.clau); VISTES.caixa(id); });
        $('cEsc').onclick = () => obreEscaner();
        $('cTot').onclick = () => { c.claus.filter(k => !prog.omplert[k]).forEach(k => omple(k, M.perClau.get(k).qty, true)); VISTES.caixa(id); };
        $('cRet').onclick = () => { if (fer('retorna', { obj: c.id }, `${c.id}: caixa retornada al magatzem`)) VISTES.caixa(id); };
        $('cInc').onclick = () => { obreIncidencia(c.r.conj.id, c.id); };
    };
    // Omple un caixetí. Si l'estoc no n'hi ha prou, pregunta quants se n'hi posen.
    function omple(clau, qty, silenci) {
        const e = M.perClau.get(clau), m = e.caixeti.mat, estoc = prog.estoc[m.id];
        if (!silenci && estoc != null && estoc < qty) {
            const r = prompt(`A l'estoc només n'hi ha ${estoc} de ${m.codi}. Quants n'has posat a la caixa?`, String(Math.max(0, estoc)));
            if (r === null) return null;
            qty = Math.round(FO.num(r, 0));
            if (qty <= 0) return null;
        }
        return fer('omple', { clau, mat: m.id, qty }, `${m.codi} ×${qty}: omplert a ${e.safata}${qty < e.qty ? ` (en falten ${e.qty - qty})` : ''}`);
    }
    function commutaOmplert(clau) {
        const e = M.perClau.get(clau);
        if (prog.omplert[clau]) { if (confirm(`Buidar ${e.codi} de ${e.safata}? El material torna a l'estoc.`)) fer('buida', { clau }, `${e.codi}: buidat de ${e.safata}`); }
        else omple(clau, e.qty);
    }

    // ─── Estoc ───
    // El que encara necessiten els passos no muntats, descomptant el que ja és a les caixes
    function necessari() {
        const nec = new Map();
        M.PLA.forEach(r => {
            if (prog.fets[r.conj.id]) return;
            r.conj.items.forEach(it => {
                const posat = M.aOmplir(r).filter(e => e.caixeti.mat.id === it.mat).reduce((a, e) => a + (prog.omplert[e.clau] ? prog.omplert[e.clau].qty : 0), 0);
                const q = Math.max(0, it.qty * r.multiplicador - posat);
                if (q) nec.set(it.mat, (nec.get(it.mat) || 0) + q);
            });
        });
        return nec;
    }
    VISTES.estoc = function (filtre) {
        const nec = necessari(), editable = pot('estoc') && !prog.tancada;
        const nomesFalta = filtre === 'falta';
        const mats = P.materials.slice().sort((a, b) => a.codi.localeCompare(b.codi)).filter(m => !nomesFalta || (nec.get(m.id) || 0) > (prog.estoc[m.id] || 0));
        $('vista').innerHTML = `${bannerTancada()}<h2>Estoc</h2><p class="ajuda">«Cal» és el que encara falta posar a les caixes dels passos pendents. Quan omples una caixa, el material surt de l'estoc.</p>
            <div class="fx" style="margin:8px 0"><button class="bt${nomesFalta ? '' : ' pr'}" data-f="">Tots</button><button class="bt${nomesFalta ? ' pr' : ''}" data-f="falta">Només el que falta</button></div>
            <input class="cerca" id="eCerca" type="search" placeholder="Cerca…">
            <div class="targeta" style="padding:4px 8px"><table class="taula"><tr><th>Material</th><th class="n">Cal</th><th class="n">Tinc</th></tr>
            ${mats.map(m => {
                const n = nec.get(m.id) || 0, t = prog.estoc[m.id] || 0;
                return `<tr data-cerca="${esc((m.codi + ' ' + m.nom).toLowerCase())}"><td><span class="sw" style="background:${m.col}"></span> <b>${esc(m.codi)}</b><div class="ajuda">${esc(m.nom)}</div></td>
                    <td class="n ${t < n ? 'falta' : ''}">${n}</td>
                    <td>${editable ? `<div class="num-in"><button data-m="${esc(m.id)}" data-d="-1">−</button><input type="number" inputmode="numeric" data-mi="${esc(m.id)}" value="${t}"><button data-m="${esc(m.id)}" data-d="1">+</button></div>` : `<div class="n">${t}</div>`}</td></tr>`;
            }).join('')}</table></div>`;
        const v = $('vista');
        v.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { location.hash = '#/estoc' + (b.dataset.f ? '/' + b.dataset.f : ''); });
        v.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
            const m = FO.material(P, b.dataset.m), d = +b.dataset.d;
            fer('estoc', { mat: b.dataset.m, delta: d }, `Estoc ${m ? m.codi : b.dataset.m}: ${d > 0 ? '+' : ''}${d}`); VISTES.estoc(filtre);
        });
        v.querySelectorAll('[data-mi]').forEach(i => i.onchange = () => {
            const id = i.dataset.mi, m = FO.material(P, id), a = prog.estoc[id] || 0, nou = Math.round(FO.num(i.value, 0));
            if (a !== nou) fer('estocFix', { mat: id, valor: nou }, `Estoc ${m ? m.codi : id}: ${a} → ${nou} (recompte)`);
            VISTES.estoc(filtre);
        });
        $('eCerca').oninput = function () { const f = this.value.toLowerCase(); v.querySelectorAll('tr[data-cerca]').forEach(tr => { tr.style.display = tr.dataset.cerca.includes(f) ? '' : 'none'; }); };
    };

    // ─── Llista de compra (per proveïdor) ───
    function llistaCompra() {
        const nec = necessari(), grups = new Map();
        P.materials.forEach(m => {
            const falta = (nec.get(m.id) || 0) - Math.max(0, prog.estoc[m.id] || 0);
            if (falta <= 0) return;
            const g = m.origen === 'propi' ? 'Fabricació pròpia' : (m.proveidor || 'Sense proveïdor');
            if (!grups.has(g)) grups.set(g, []);
            grups.get(g).push({ m, falta });
        });
        return grups;
    }
    VISTES.compra = function () {
        const grups = llistaCompra();
        $('vista').innerHTML = `<h2>Llista de compra</h2><p class="ajuda">El que falta per omplir les caixes i acabar els passos pendents, descomptant l'estoc, agrupat per proveïdor.</p>
            ${grups.size ? Array.from(grups).map(([g, l]) => `<h3>${esc(g)}</h3><div class="targeta" style="padding:4px 8px"><table class="taula">${l.map(x => `<tr><td><span class="sw" style="background:${x.m.col}"></span> <b>${esc(x.m.codi)}</b><div class="ajuda">${esc(x.m.nom)}</div></td><td class="n falta">${x.falta}</td></tr>`).join('')}</table></div>`).join('')
                + `<div class="fx"><button class="bt" id="cCopia">Copiar</button>${navigator.share ? '<button class="bt" id="cComparteix">Compartir…</button>' : ''}<button class="bt" id="cCSV">⬇ CSV</button></div>`
                : '<div class="buit">✓ No falta res.</div>'}`;
        if (!grups.size) return;
        let t = `Llista de compra · ${P.nom} · ${ORD.codi} · ${new Date().toLocaleDateString('ca-ES')}\n`;
        grups.forEach((l, g) => { t += `\n${g}\n` + l.map(x => `  ${x.falta} × ${x.m.codi}  ${x.m.nom}`).join('\n') + '\n'; });
        $('cCopia').onclick = async () => { try { await navigator.clipboard.writeText(t); avis('Copiat'); } catch (e) { prompt('Copia:', t); } };
        if ($('cComparteix')) $('cComparteix').onclick = () => navigator.share({ title: 'Llista de compra', text: t }).catch(() => { });
        $('cCSV').onclick = () => {
            const files = []; grups.forEach((l, g) => l.forEach(x => files.push([g, x.m.codi, x.m.nom, x.falta])));
            baixa('compra.csv', csv('proveidor;codi;nom;quantitat', files), 'text/csv');
        };
    };

    // ═══════════════════════════════════════════════════════════
    // 🔧 MUNTADOR · Agafar les caixes, muntar i tornar-les
    // ═══════════════════════════════════════════════════════════
    const itemDe = (conjId, matId) => { const r = M.perConj.get(conjId); return r && r.conj.items.find(i => i.mat === matId); };
    const estatDe = r => FO.estatPas(prog, r.conj.id, FO.pasPreparat(M, prog, r));
    const perAMi = r => !!(prog.assignacions[r.conj.id] && prog.assignacions[r.conj.id] === nomPersona());

    VISTES.passos = function () {
        const fets = M.PLA.filter(r => prog.fets[r.conj.id]).length;
        // següent pas: primer els assignats a mi, després qualsevol amb els subconjunts fets
        const disponibles = M.PLA.filter(r => !prog.fets[r.conj.id] && r.entrades.every(e => prog.fets[e.conj.id]));
        const seguent = disponibles.find(perAMi) || disponibles.find(r => !prog.assignacions[r.conj.id]) || disponibles[0];
        $('vista').innerHTML = `${bannerTancada()}<div class="targeta"><div class="fx"><b style="flex:1">${esc(P.nom)} · ${esc(ORD.codi)}</b><span class="xip ${fets === M.PLA.length ? 'ok' : ''}">${fets} / ${M.PLA.length} muntats</span></div>
            <div class="barra"><div style="width:${M.PLA.length ? fets / M.PLA.length * 100 : 0}%"></div></div>
            ${seguent ? `<button class="bt pr" style="margin-top:10px" data-anar="${esc(seguent.conj.id)}">Continuar: pas ${seguent.pas} · ${esc(seguent.conj.nom)}</button>` : fets === M.PLA.length && M.PLA.length ? '<p class="ajuda" style="margin-top:8px">🎉 Tots els passos estan muntats.</p>' : ''}</div>
            ${M.PLA.map(r => {
                const e = estatDe(r), falten = r.entrades.filter(x => !prog.fets[x.conj.id]), qui = prog.assignacions[r.conj.id];
                const llista = M.aAgafar(r), n = llista.filter(x => prog.agafat[x.clau]).length;
                return `<div class="targeta pas${prog.fets[r.conj.id] ? ' fet' : ''}${falten.length ? ' bloquejat' : ''}" data-anar="${esc(r.conj.id)}" style="border-left-color:${r.conj.col}">
                    <div class="num">${prog.fets[r.conj.id] ? '✓' : r.pas}</div>
                    <div class="info"><div class="nom">${esc(r.conj.nom)}</div><div class="sub">${esc(r.conj.codi)}${r.multiplicador > 1 ? ` · ×${r.multiplicador}` : ''}${qui ? ` · 👤 ${esc(qui)}${qui === nomPersona() ? ' (tu)' : ''}` : ''}${falten.length ? ` · falta ${falten.map(f => esc(f.conj.codi)).join(', ')}` : ''}</div>
                    ${llista.length && !prog.fets[r.conj.id] && n ? `<div class="barra"><div style="width:${n / llista.length * 100}%"></div></div>` : ''}</div>${xipEstat(e, FO.ESTATS_PAS)}</div>`;
            }).join('')}`;
        $('vista').querySelectorAll('[data-anar]').forEach(n => n.onclick = () => { location.hash = '#/pas/' + encodeURIComponent(n.dataset.anar); });
    };

    // Fila d'un caixetí a agafar
    function filaCaixeti(e, conjId) {
        const c = e.caixeti, m = c.mat, it = itemDe(conjId, m.id), fet = !!prog.agafat[e.clau];
        return `<div class="fila${fet ? ' fet' : ''}" data-clau="${esc(e.clau)}">
            <div class="chk">✓</div><span class="sw" style="background:${m.col}"></span>
            <div class="txt"><div class="cd">${esc(m.codi)}${it && it.parell ? `<span class="parell">${fmt(it.parell, 1)} N·m</span>` : ''}${icones(m)}</div>
            <div class="nm">${esc(m.nom)}</div>${it && it.nota ? `<div class="nota">▸ ${esc(it.nota)}</div>` : ''}</div>
            <div class="q">×${c.qty}</div></div>`;
    }
    // Bloc d'una caixa (o contenidor amb les seves caixes) amb els caixetins a agafar
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

    VISTES.pas = function (id) {
        const r = M.perConj.get(id);
        if (!r) { location.hash = '#/passos'; return; }
        const c = r.conj, llista = M.aAgafar(r), agafats = llista.filter(e => prog.agafat[e.clau]).length;
        const f = prog.fets[c.id], v = prog.verificacions[c.id], ini = prog.inicis[c.id];
        const falten = r.entrades.filter(e => !prog.fets[e.conj.id]);
        const senseOmplir = FO.usaMagatzem(prog) ? M.aOmplir(r).filter(e => !prog.omplert[e.clau]) : [];
        const instr = c.instruccions.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
        const fetsI = prog.instr[c.id] || [];
        const parells = c.items.filter(i => i.parell > 0).map(i => ({ i, m: FO.material(P, i.mat) })).filter(x => x.m);
        const guarda = r.safates.filter(o => o.tipus === 'muntat');
        const propies = r.safates.filter(o => o.tipus !== 'muntat');
        const perTornar = propies.filter(o => !prog.retornat[o.id]);
        const qui = prog.assignacions[c.id];
        $('vista').innerHTML = `${bannerTancada()}<div class="cap-pas" style="background:${c.col}"><div class="sub">Pas ${r.pas} de ${M.PLA.length}${r.multiplicador > 1 ? ` · muntar-ne ${r.multiplicador}` : ''}</div><h2>${esc(c.nom)}</h2><div class="sub">${esc(c.codi)} · ${xipEstat(estatDe(r), FO.ESTATS_PAS)}${qui ? ' · 👤 ' + esc(qui) : ''}</div></div>
            ${v && v.resultat === 'ko' && !f ? `<div class="banner er">✗ <b>Rebutjat per Qualitat</b> (${esc(v.op)}, ${esc(data(v.ts))}): ${esc(v.motiu)}<br><small>Corregeix-ho i torna a marcar el pas com a muntat.</small></div>` : ''}
            ${f && !v ? `<div class="banner in">Muntat ${esc(data(f.ts))}${f.op ? ' per ' + esc(f.op) : ''} · <b>pendent de verificar</b> per Qualitat.</div>` : ''}
            ${f && v && v.resultat === 'ok' ? `<div class="banner ok">✓ Verificat per ${esc(v.op)} · ${esc(data(v.ts))}</div>` : ''}
            ${falten.length && !f ? `<div class="banner er"><b>Abans cal muntar:</b> ${falten.map(x => `<a href="#/pas/${encodeURIComponent(x.conj.id)}">${esc(x.conj.codi)} ${esc(x.conj.nom)}</a>`).join(', ')}</div>` : ''}
            ${senseOmplir.length && !f ? `<div class="banner wr">📦 El magatzem encara no ha omplert ${senseOmplir.length} caixetí(ns) d'aquest pas: ${senseOmplir.slice(0, 6).map(e => esc(e.codi)).join(', ')}${senseOmplir.length > 6 ? '…' : ''}</div>` : ''}
            <div class="dues"><div>
            <h3>1 · Preparació: agafa les caixes (${agafats}/${llista.length})</h3>
            <div class="fx"><button class="bt pr" id="pEsc">⌖ Escanejar etiquetes</button><button class="bt" id="pTots">${agafats === llista.length && llista.length ? 'Desmarcar tot' : 'Marcar-ho tot'}</button></div>
            ${M.objectesPas(r).map(o => blocObjecte(o, c.id, llista)).join('') || '<p class="ajuda">Aquest pas no té caixes pròpies.</p>'}
            ${r.fora.length ? `<div class="targeta"><b>Preparar a part</b> (no cap a cap caixa): ${r.fora.map(x => esc(x.mat.codi) + ' ×' + x.qty).join(', ')}</div>` : ''}
            </div><div>
            <h3>2 · Muntatge</h3>
            ${!ini && !f ? `<button class="bt pr" id="pInicia"${falten.length ? ' disabled' : ''}>▶ Començar el pas</button>` : ini && !f ? `<p class="ajuda">Començat ${esc(data(ini.ts))}${ini.op ? ' per ' + esc(ini.op) : ''}</p>` : ''}
            ${c.eines ? `<div class="targeta"><b>🔧 Eines:</b> ${esc(c.eines)}</div>` : ''}
            ${c.imatge ? `<img class="imatge" src="${esc(c.imatge)}" alt="Resultat esperat">` : ''}
            ${instr.length ? `<div class="objecte">${instr.map((t, i) => `<div class="fila${fetsI[i] ? ' fet' : ''}" data-instr="${i}"><div class="chk">✓</div><div class="txt"><div class="nm"><b>${i + 1}.</b> ${esc(t)}</div></div></div>`).join('')}</div>` : '<p class="ajuda">Sense instruccions: es poden afegir a la fitxa del conjunt a l\'app de l\'ordinador.</p>'}
            ${parells.length ? `<h3>Parells de collada</h3><div class="targeta"><table class="taula"><tr><th>Element</th><th class="n">N·m</th></tr>${parells.map(x => `<tr><td><b>${esc(x.m.codi)}</b> ${esc(x.m.nom)}${x.i.nota ? `<div class="ajuda">${esc(x.i.nota)}</div>` : ''}</td><td class="n"><b>${fmt(x.i.parell, 1)}</b></td></tr>`).join('')}</table></div>` : ''}
            ${c.notes ? `<div class="targeta"><b>Notes:</b> ${esc(c.notes)}</div>` : ''}
            <h3>Fotos</h3><div class="fx"><button class="bt" id="pFoto">📷 Fer una foto</button><button class="bt" id="pInc">⚠ Incidència</button></div><div class="fotos" id="pFotos"></div>
            <h3>3 · Final</h3>
            ${guarda.length ? `<div class="targeta">Guarda ${r.multiplicador > 1 ? 'les ' + r.multiplicador + ' unitats' : 'el conjunt'} a: <b>${guarda.map(o => esc(o.id)).join(', ')}</b></div>` : ''}
            ${f ? (v && v.resultat === 'ok' ? '' : '<button class="bt" id="pDesfer">Desfer «muntat»</button>') : `<button class="bt ok" id="pFet"${falten.length ? ' disabled' : ''}>✓ Marcar el pas com a muntat</button>`}
            ${f && perTornar.length ? `<button class="bt" id="pTorna">↩ Tornar les caixes buides al magatzem (${perTornar.length})</button>` : ''}
            </div></div>`;
        const vi = $('vista');
        vi.querySelectorAll('[data-clau]').forEach(n => n.onclick = () => { commutaAgafat(n.dataset.clau); VISTES.pas(id); });
        vi.querySelectorAll('[data-instr]').forEach(n => n.onclick = () => {
            const i = +n.dataset.instr, val = !((prog.instr[c.id] || [])[i]);
            iniciaSiCal(r);
            if (fer('instr', { conj: c.id, i, v: val }, `${c.codi}: instrucció ${i + 1} ${val ? 'feta' : 'desmarcada'}`)) n.classList.toggle('fet', val);
        });
        $('pEsc').onclick = () => obreEscaner();
        $('pTots').onclick = () => {
            const tots = agafats === llista.length;
            if (!tots) iniciaSiCal(r);
            llista.forEach((x, i) => { if (!!prog.agafat[x.clau] !== !tots) fer('agafa', { clau: x.clau, v: !tots }, i ? '' : `${c.codi}: ${tots ? 'desmarcat tot' : 'tot agafat'}`); });
            VISTES.pas(id);
        };
        if ($('pInicia')) $('pInicia').onclick = () => { iniciaSiCal(r); VISTES.pas(id); };
        $('pFoto').onclick = () => { $('fFoto').dataset.pas = c.id; $('fFoto').click(); };
        $('pInc').onclick = () => { obreIncidencia(c.id); };
        if ($('pFet')) $('pFet').onclick = () => marcaFet(r, agafats, llista.length);
        if ($('pDesfer')) $('pDesfer').onclick = () => { if (fer('desfet', { conj: c.id }, `Pas ${r.pas} · ${c.codi}: desfet`)) VISTES.pas(id); };
        if ($('pTorna')) $('pTorna').onclick = () => { perTornar.forEach(o => fer('retorna', { obj: o.id }, `${o.id}: caixa tornada al magatzem`)); avis('Caixes tornades'); VISTES.pas(id); };
        pintaFotos(c.id);
    };
    // El primer cop que es toca un pas, es marca l'inici (per mesurar el temps de muntatge)
    function iniciaSiCal(r) {
        if (!prog.inicis[r.conj.id] && !prog.fets[r.conj.id] && pot('inicia')) fer('inicia', { conj: r.conj.id }, `Pas ${r.pas} · ${r.conj.codi}: començat`);
    }
    function commutaAgafat(clau) {
        const e = M.perClau.get(clau), v = !prog.agafat[clau], pas = M.pasDe(e);
        if (v && pas) iniciaSiCal(M.perConj.get(pas));
        fer('agafa', { clau, v }, v ? `${e.codi} ×${e.qty}: agafat (${e.safata})` : `${e.codi}: desmarcat`);
    }
    function marcaFet(r, agafats, total) {
        if (agafats < total && !confirm(`Només hi ha ${agafats} de ${total} caixetins marcats com a agafats. Marcar igualment el pas com a muntat?`)) return;
        // Consum d'estoc: només el material que NO ha passat pel magatzem (el de les caixes ja va sortir en omplir-les)
        const consum = {};
        if (pref.consumAuto) r.conj.items.forEach(it => {
            const posat = M.aOmplir(r).filter(e => e.caixeti.mat.id === it.mat).reduce((a, e) => a + (prog.omplert[e.clau] ? prog.omplert[e.clau].qty : 0), 0);
            const q = Math.min(Math.max(0, prog.estoc[it.mat] || 0), Math.max(0, it.qty * r.multiplicador - posat));
            if (q > 0) consum[it.mat] = q;
        });
        iniciaSiCal(r);
        if (!fer('fet', { conj: r.conj.id, consum }, `Pas ${r.pas} · ${r.conj.codi} ${r.conj.nom} muntat${r.multiplicador > 1 ? ' (×' + r.multiplicador + ')' : ''}`)) return;
        so(true); avis('Pas muntat ✓ · ara el verificarà Qualitat');
        VISTES.pas(r.conj.id);
    }

    // ═══════════════════════════════════════════════════════════
    // ✅ QUALITAT · Comprovar els passos muntats
    // ═══════════════════════════════════════════════════════════
    VISTES.verificar = function () {
        const grup = (titol, l, buit) => `<h3>${titol} (${l.length})</h3>` + (l.length ? l.map(r => {
            const f = prog.fets[r.conj.id], v = prog.verificacions[r.conj.id];
            const meu = f && f.op && f.op === nomPersona();
            return `<div class="targeta pas" data-anar="${esc(r.conj.id)}" style="border-left-color:${r.conj.col}"><div class="num">${r.pas}</div>
                <div class="info"><div class="nom">${esc(r.conj.nom)}</div><div class="sub">${esc(r.conj.codi)}${f ? ` · muntat per ${esc(f.op || '?')} ${esc(data(f.ts))}` : ''}${v && v.resultat === 'ko' ? ` · ${esc(v.motiu)}` : ''}${meu ? ' · ⚠ l\'has muntat tu' : ''}</div></div>
                ${xipEstat(estatDe(r), FO.ESTATS_PAS)}</div>`;
        }).join('') : `<p class="ajuda">${buit}</p>`);
        const est = r => estatDe(r);
        $('vista').innerHTML = bannerTancada() +
            grup('Per verificar', M.PLA.filter(r => est(r) === 'muntat'), 'Cap pas espera verificació.') +
            grup('Rebutjats, pendents de refer', M.PLA.filter(r => est(r) === 'rebutjat'), 'Cap.') +
            grup('Verificats', M.PLA.filter(r => est(r) === 'verificat'), 'Encara cap.');
        $('vista').querySelectorAll('[data-anar]').forEach(n => n.onclick = () => { location.hash = '#/verif/' + encodeURIComponent(n.dataset.anar); });
    };
    // Llista de comprovació d'un pas: cada instrucció, cada parell de collada i dues comprovacions generals
    function comprovacions(r) {
        const c = r.conj, l = [];
        c.instruccions.split(/\r?\n/).map(t => t.trim()).filter(Boolean).forEach((t, i) => l.push(`Instrucció ${i + 1}: ${t}`));
        c.items.filter(i => i.parell > 0).forEach(i => { const m = FO.material(P, i.mat); if (m) l.push(`Parell de ${m.codi} ${m.nom}: ${fmt(i.parell, 1)} N·m`); });
        const n = c.items.reduce((a, i) => a + i.qty * r.multiplicador, 0);
        l.push(`Hi són totes les peces (${n} elements${r.entrades.length ? ' i ' + r.entrades.length + ' subconjunts' : ''})`);
        l.push('Sense danys, restes ni peces soltes; zona neta');
        return l;
    }
    VISTES.verif = function (id) {
        const r = M.perConj.get(id);
        if (!r) { location.hash = '#/verificar'; return; }
        const c = r.conj, f = prog.fets[id], v = prog.verificacions[id], ini = prog.inicis[id];
        const llista = comprovacions(r), marcats = verifChecks[id] || (verifChecks[id] = new Set());
        const meu = f && f.op && f.op === nomPersona() && !esResponsable();
        const rebutjos = prog.historial.filter(h => h.conj === id);
        $('vista').innerHTML = `${bannerTancada()}<div class="cap-pas" style="background:${c.col}"><div class="sub">Verificació · pas ${r.pas}</div><h2>${esc(c.nom)}</h2><div class="sub">${esc(c.codi)} · ${xipEstat(estatDe(r), FO.ESTATS_PAS)}</div></div>
            ${!f ? `<div class="banner wr">Aquest pas encara no està muntat${v && v.resultat === 'ko' ? ` (rebutjat: ${esc(v.motiu)})` : ''}.</div>` : `<div class="targeta">Muntat per <b>${esc(f.op || '?')}</b> · ${esc(data(f.ts))}${ini ? ` · durada ${FO.textDurada(new Date(f.ts) - new Date(ini.ts))}` : ''}</div>`}
            ${meu ? '<div class="banner er">⚠ Aquest pas l\'has muntat tu: l\'ha de verificar una altra persona (regla dels quatre ulls).</div>' : ''}
            ${v && v.resultat === 'ok' && f ? `<div class="banner ok">✓ Verificat per ${esc(v.op)} · ${esc(data(v.ts))}</div>` : ''}
            ${rebutjos.length ? `<div class="targeta"><b>Rebutjos anteriors:</b>${rebutjos.map(h => `<div class="ajuda">${esc(data(h.ts))} · ${esc(h.op)}: ${esc(h.motiu)}</div>`).join('')}</div>` : ''}
            ${c.imatge ? `<img class="imatge" src="${esc(c.imatge)}" alt="Resultat esperat">` : ''}
            <h3>Llista de comprovació (${marcats.size}/${llista.length})</h3>
            <div class="objecte">${llista.map((t, i) => `<div class="fila${marcats.has(i) ? ' fet' : ''}" data-chk="${i}"><div class="chk">✓</div><div class="txt"><div class="nm">${esc(t)}</div></div></div>`).join('')}</div>
            <h3>Fotos</h3><div class="fx"><button class="bt" id="vFoto">📷 Fer una foto</button><button class="bt" id="vInc">⚠ Incidència</button></div><div class="fotos" id="pFotos"></div>
            ${f && !(v && v.resultat === 'ok') ? `<h3>Resultat</h3>
            <button class="bt ok" id="vOk"${marcats.size < llista.length || meu ? ' disabled' : ''}>✓ Aprovar${marcats.size < llista.length ? ` (falten ${llista.length - marcats.size} comprovacions)` : ''}</button>
            <label class="camp">Motiu del rebuig<textarea id="vMotiu" placeholder="Què s'ha de corregir?"></textarea></label>
            <button class="bt perill" id="vKo"${meu ? ' disabled' : ''}>✗ Rebutjar i tornar-lo al muntador</button>` : ''}`;
        $('vista').querySelectorAll('[data-chk]').forEach(n => n.onclick = () => {
            const i = +n.dataset.chk;
            if (marcats.has(i)) marcats.delete(i); else marcats.add(i);
            VISTES.verif(id);
        });
        $('vFoto').onclick = () => { $('fFoto').dataset.pas = id; $('fFoto').click(); };
        $('vInc').onclick = () => { obreIncidencia(id); };
        if ($('vOk')) $('vOk').onclick = () => {
            if (!fer('verifica', { conj: id, resultat: 'ok', checks: Array.from(marcats) }, `Pas ${r.pas} · ${c.codi}: verificat ✓`)) return;
            delete verifChecks[id]; so(true); avis('Pas verificat ✓');
            location.hash = '#/verificar';
        };
        if ($('vKo')) $('vKo').onclick = () => {
            const motiu = $('vMotiu').value.trim();
            if (!motiu) { so(false); avis('Escriu el motiu del rebuig'); $('vMotiu').focus(); return; }
            if (!fer('verifica', { conj: id, resultat: 'ko', motiu, checks: Array.from(marcats) }, `Pas ${r.pas} · ${c.codi}: rebutjat · ${motiu}`)) return;
            delete verifChecks[id]; avis('Pas rebutjat: torna al muntador');
            location.hash = '#/verificar';
        };
        pintaFotos(id);
    };

    // ═══════════════════════════════════════════════════════════
    // ⚠ INCIDÈNCIES (tothom les pot obrir; Qualitat i Responsable les resolen)
    // ═══════════════════════════════════════════════════════════
    const GRAVETATS = { baixa: '#8888A0', mitjana: '#E8A838', alta: '#E53935' };
    VISTES.incidencies = function () {
        const l = prog.incidencies.slice().sort((a, b) => (!!a.resolta - !!b.resolta) || String(b.ts).localeCompare(a.ts));
        $('vista').innerHTML = `${bannerTancada()}<h2>Incidències</h2>
            <button class="bt pr" id="iNova"${pot('incidencia') ? '' : ' disabled'}>⚠ Nova incidència</button><div id="iForm"></div>
            ${l.length ? l.map(i => `<div class="targeta"${i.resolta ? ' style="opacity:.65"' : ''}>
                <div class="fx"><span class="estat" style="background:${GRAVETATS[i.gravetat] || '#888'}">${esc(i.gravetat)}</span><b style="flex:1">${i.conj ? esc(codiConj(i.conj)) : 'General'}${i.clau ? ' · ' + esc(i.clau) : ''}</b>${i.resolta ? '<span class="xip ok">Resolta</span>' : ''}</div>
                <p style="margin:6px 0">${esc(i.text)}</p><div class="ajuda">${esc(data(i.ts))}${i.op ? ' · ' + esc(i.op) : ''}</div>
                ${i.resolta ? `<div class="ajuda">✓ ${esc(i.resolta.text)} · ${esc(i.resolta.op)} · ${esc(data(i.resolta.ts))}</div>` : pot('resol') ? `<button class="bt" data-resol="${esc(i.id)}">Marcar com a resolta</button>` : ''}</div>`).join('')
                : '<div class="buit">Cap incidència. 👍</div>'}`;
        $('iNova').onclick = () => obreFormIncidencia(pasActual || '');
        $('vista').querySelectorAll('[data-resol]').forEach(b => b.onclick = () => {
            const s = prompt('Com s\'ha resolt?');
            if (s === null) return;
            if (fer('resol', { inc: b.dataset.resol, solucio: s.trim() }, 'Incidència resolta: ' + s.trim())) VISTES.incidencies();
        });
        if (formPendent) { obreFormIncidencia(formPendent.conj, formPendent.clau); formPendent = null; }
    };
    // Des d'una altra pantalla: va a Incidències amb el formulari obert per a aquell pas
    let formPendent = null;
    function obreIncidencia(conj, clau) { formPendent = { conj, clau }; location.hash = '#/incidencies'; }
    function obreFormIncidencia(conj, clau) {
        const f = $('iForm'); if (!f) return;
        f.innerHTML = `<div class="targeta"><label class="camp">Pas<select id="iPas"><option value="">General</option>${M.PLA.map(r => `<option value="${esc(r.conj.id)}"${r.conj.id === conj ? ' selected' : ''}>${r.pas} · ${esc(r.conj.codi)} ${esc(r.conj.nom)}</option>`).join('')}</select></label>
            <label class="camp">Què passa?<textarea id="iText" placeholder="Peça defectuosa, falta material, plànol confús…"></textarea></label>
            <label class="camp">Gravetat<select id="iGrav"><option value="baixa">Baixa</option><option value="mitjana" selected>Mitjana</option><option value="alta">Alta (atura el muntatge)</option></select></label>
            <div class="fx"><button class="bt pr" id="iDesa">Desar</button><button class="bt" id="iCancel">Cancel·lar</button></div></div>`;
        $('iText').focus();
        $('iCancel').onclick = () => { f.innerHTML = ''; };
        $('iDesa').onclick = () => {
            const text = $('iText').value.trim();
            if (!text) return avis('Descriu la incidència');
            const c = $('iPas').value;
            if (fer('incidencia', { conj: c, clau: clau || '', textInc: text, gravetat: $('iGrav').value }, `Incidència${c ? ' a ' + codiConj(c) : ''}: ${text}`)) { avis('Incidència registrada'); VISTES.incidencies(); }
        };
    }

    // ─── Registre de traçabilitat ───
    VISTES.registre = function () {
        const r = prog.registre.slice().sort((a, b) => String(b.ts).localeCompare(a.ts));   // per hora real, encara que s'hagi sincronitzat tard
        $('vista').innerHTML = `<h2>Registre · ${esc(ORD.codi)}</h2><div class="fx"><button class="bt" id="rCSV">⬇ Exportar CSV</button></div>
            ${r.length ? `<div class="targeta" style="padding:4px 8px"><table class="taula">${r.slice(0, 400).map(x => `<tr><td style="white-space:nowrap;font-size:12px">${esc(data(x.ts))}${x.op ? '<br>' + esc(x.op) : ''}${x.rol && FO.ROLS[x.rol] ? ' ' + FO.ROLS[x.rol].ico : ''}</td><td>${esc(x.text)}</td></tr>`).join('')}</table></div>` : '<div class="buit">Encara no hi ha res.</div>'}`;
        $('rCSV').onclick = () => baixa(`registre_${FO.nomFitxer(P.nom)}_${ORD.codi}.csv`, csv('data;persona;rol;tipus;text', prog.registre.map(x => [x.ts, x.op, x.rol || '', x.tipus, x.text])), 'text/csv');
    };

    // ═══════════════════════════════════════════════════════════
    // 📋 RESPONSABLE · Tauler, ordres, persones i resultats
    // ═══════════════════════════════════════════════════════════
    let personesSrv = null;   // persones del servidor (per assignar i gestionar)
    async function carregaPersones() {
        if (!srv.url || srv.fora) return [];
        try { personesSrv = await api('/api/persones'); } catch (e) { personesSrv = personesSrv || []; }
        return personesSrv;
    }
    VISTES.tauler = function () {
        const res = FO.resumOrdre(M, prog);
        const cx = res.caixes.filter(x => !x.c.guarda && x.c.claus.length);
        const plenes = cx.filter(x => x.estat !== 'buida' && x.estat !== 'parcial').length;
        // per assignar: al servidor, les persones amb rol de muntador; sol, text lliure
        const muntadors = (personesSrv || []).filter(x => x.rols.includes('muntador') || x.rols.includes('responsable')).map(x => x.nom);
        $('vista').innerHTML = `${bannerTancada()}<div class="kpi">
                <div>Verificats<b>${res.verificats} / ${res.total}</b></div><div>En curs<b>${res.enCurs}</b></div>
                <div>Per verificar<b>${res.muntats}</b></div><div>Rebutjats<b>${res.rebutjats}</b></div>
                <div>Caixes plenes<b>${plenes} / ${cx.length}</b></div><div>Incidències obertes<b>${res.incidenciesObertes}</b></div></div>
            <div class="barra"><div style="width:${res.total ? res.verificats / res.total * 100 : 0}%"></div></div>
            <div class="fx" style="margin-top:8px">${srv.url ? '<button class="bt" id="tPers">👥 Persones</button>' : ''}<button class="bt" id="tRes">📊 Resultats</button></div>
            ${prog.tancada ? '<button class="bt" id="tReobre">🔓 Reobrir l\'ordre</button>' : `<button class="bt${res.acabada ? ' ok' : ''}" id="tTanca">🔒 Tancar l'ordre${res.acabada ? '' : ' (encara no està acabada)'}</button>`}
            <h3>Passos</h3>
            ${res.passos.map(x => `<div class="targeta"><div class="fx"><b style="flex:1"><a href="#/pas/${encodeURIComponent(x.id)}">${x.pas} · ${esc(x.codi)}</a> ${esc(x.nom)}</b>${xipEstat(x.estat, FO.ESTATS_PAS)}</div>
                <div class="ajuda">${x.muntador ? '🔧 ' + esc(x.muntador) + (x.durada ? ' · ' + FO.textDurada(x.durada) : '') : ''}${x.verificador ? ' · ✅ ' + esc(x.verificador) : ''}${x.rebutjos.length ? ` · ✗ ${x.rebutjos.length} rebuig(s)` : ''}${x.incidencies ? ` · ⚠ ${x.incidencies}` : ''}</div>
                <label class="camp" style="margin:6px 0 0">Assignat a${muntadors.length
                    ? `<select data-assigna="${esc(x.id)}"><option value="">—</option>${muntadors.map(n => `<option${n === x.assignat ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`
                    : `<input data-assigna="${esc(x.id)}" value="${esc(x.assignat)}" placeholder="Nom de la persona">`}</label></div>`).join('')}`;
        $('vista').querySelectorAll('[data-assigna]').forEach(i => i.onchange = () => {
            const persona = i.value.trim(), r = M.perConj.get(i.dataset.assigna);
            fer('assigna', { conj: i.dataset.assigna, persona }, persona ? `${r.conj.codi} assignat a ${persona}` : `${r.conj.codi}: sense assignar`);
        });
        if ($('tPers')) $('tPers').onclick = () => { location.hash = '#/persones'; };
        $('tRes').onclick = () => { location.hash = '#/resultats'; };
        if ($('tTanca')) $('tTanca').onclick = () => {
            if (!res.acabada && !confirm(`Només hi ha ${res.verificats} de ${res.total} passos verificats. Tancar igualment l'ordre?`)) return;
            if (res.incidenciesObertes && !confirm(`Hi ha ${res.incidenciesObertes} incidències obertes. Tancar igualment?`)) return;
            if (fer('tanca', {}, `Ordre ${ORD.codi} tancada`)) { avis('Ordre tancada'); ruta(); }
        };
        if ($('tReobre')) $('tReobre').onclick = () => { if (confirm('Reobrir l\'ordre?') && fer('reobre', {}, `Ordre ${ORD.codi} reoberta`)) ruta(); };
        if (srv.url && !personesSrv) carregaPersones().then(() => { if (location.hash.startsWith('#/tauler') || location.hash.replace(/^#\/?/, '') === '') refresca(); });
    };

    // ─── Ordres de fabricació ───
    VISTES.ordres = function () {
        // estat de cada ordre: del servidor (resum) o del progrés desat en aquest aparell
        const info = o => {
            const s = srv.projectes && (srv.projectes.find(x => x.id === P.id) || { ordres: [] }).ordres.find(x => x.id === o.id);
            if (s) return `${s.passosFets}/${M.PLA.length} muntats${s.tancada ? ' · 🔒 tancada' : ''}`;
            const p = o.id === ORD.id ? prog : llegeix(`fordre.muntatge.progres.${P.id}.${o.id}`);
            if (!p) return 'sense començar';
            return FO.textEstatOrdre(FO.resumOrdre(M, p));
        };
        const potCrear = esResponsable() && (!srv.url || enXarxa());
        $('vista').innerHTML = `<h2>Ordres de fabricació</h2>
            <p class="ajuda">Cada unitat que es fabrica és una ordre, amb el seu progrés, registre i informe. El projecte fa de plantilla: es pot fabricar tantes vegades com calgui.</p>
            ${ORDRES.slice().reverse().map(o => `<button class="bt gran${o.id === ORD.id ? ' pr' : ''}" data-ordre="${esc(o.id)}"><i>🏭</i><span>${esc(o.codi)}${o.serie ? ' · ' + esc(o.serie) : ''}<small>${esc(info(o))} · ${esc(data(o.creada))}${o.notes ? ' · ' + esc(o.notes) : ''}</small></span></button>`).join('')}
            ${potCrear ? `<h3>Nova ordre</h3><div class="targeta">
                <label class="camp">Codi<input id="oCodi" placeholder="${esc(FO.codiOrdreSeguent(ORDRES))}"></label>
                <label class="camp">Número de sèrie (opcional)<input id="oSerie"></label>
                <label class="camp">Notes (client, comanda…)<input id="oNotes"></label>
                <button class="bt pr" id="oCrea">+ Crear l'ordre i començar-hi</button></div>` : ''}`;
        $('vista').querySelectorAll('[data-ordre]').forEach(b => b.onclick = () => { canviaOrdre(b.dataset.ordre); location.hash = '#/' + NAV[rol()][0][0]; });
        if ($('oCrea')) $('oCrea').onclick = async () => {
            try {
                const o = await novaOrdre({ codi: $('oCodi').value.trim(), serie: $('oSerie').value.trim(), notes: $('oNotes').value.trim() });
                canviaOrdre(o.id);
                location.hash = '#/' + NAV[rol()][0][0];
            } catch (e) { avis(e.message, 4000); }
        };
        if (enXarxa()) carregaProjectesSrv();
    };

    // ─── Resultats ───
    VISTES.resultats = function () {
        const res = FO.resumOrdre(M, prog);
        const pct = x => x == null ? '—' : Math.round(x * 100) + ' %';
        $('vista').innerHTML = `<h2>Resultats · ${esc(ORD.codi)}</h2>
            <div class="kpi"><div>Estat<b style="font-size:16px">${esc(FO.textEstatOrdre(res))}</b></div><div>Verificats<b>${res.verificats} / ${res.total}</b></div>
                <div>Bé a la primera<b>${pct(res.primeraPassada)}</b></div><div>Rebutjos<b>${res.rebutjos}</b></div>
                <div>Temps de muntatge<b style="font-size:16px">${FO.textDurada(res.tempsMuntatge)}</b></div><div>Incidències obertes<b>${res.incidenciesObertes}</b></div></div>
            <div class="fx"><button class="bt pr" id="rInf">📄 Informe complet (imprimir / PDF)</button><button class="bt" id="rDesa">⬇ Desar l'informe</button></div>
            <div class="fx"><button class="bt" id="rReg">🕘 Registre</button><button class="bt" id="rCSV">⬇ Registre CSV</button></div>
            ${res.persones.length ? `<h3>Persones</h3><div class="targeta" style="padding:4px 8px"><table class="taula"><tr><th>Persona</th><th class="n">Omplerts</th><th class="n">Muntats</th><th class="n">Verificats</th><th class="n">Rebutjats</th></tr>
                ${res.persones.map(q => `<tr><td>${esc(q.nom)}</td><td class="n">${q.omplerts || ''}</td><td class="n">${q.muntats || ''}</td><td class="n">${q.verificats || ''}</td><td class="n">${q.rebutjats || ''}</td></tr>`).join('')}</table></div>` : ''}
            ${prog.historial.length ? `<h3>Rebutjos</h3>${prog.historial.map(h => `<div class="targeta"><b>${esc(codiConj(h.conj))}</b> · ${esc(h.motiu)}<div class="ajuda">${esc(data(h.ts))} · ${esc(h.op)}${h.muntador ? ' · muntat per ' + esc(h.muntador) : ''}</div></div>`).join('')}` : ''}`;
        const html = () => FO.informeHTML(M, prog, ORD, { empremtaActual: srv.projectes && (srv.projectes.find(x => x.id === P.id) || {}).empremta });
        $('rInf').onclick = () => {
            const url = URL.createObjectURL(new Blob([html()], { type: 'text/html' }));
            if (!G.open(url, '_blank')) baixa(`informe_${ORD.codi}.html`, html(), 'text/html');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        };
        $('rDesa').onclick = () => baixa(`informe_${FO.nomFitxer(P.nom)}_${ORD.codi}.html`, html(), 'text/html');
        $('rReg').onclick = () => { location.hash = '#/registre'; };
        $('rCSV').onclick = () => baixa(`registre_${FO.nomFitxer(P.nom)}_${ORD.codi}.csv`, csv('data;persona;rol;tipus;text', prog.registre.map(x => [x.ts, x.op, x.rol || '', x.tipus, x.text])), 'text/csv');
    };

    // ─── Persones (només amb servidor) ───
    VISTES.persones = async function () {
        if (!srv.url) { location.hash = '#/tauler'; return; }
        $('vista').innerHTML = '<p class="ajuda">Carregant…</p>';
        const l = await carregaPersones();
        let edita = null;   // persona que s'està editant (null = nova)
        const pinta = () => {
            $('vista').innerHTML = `<h2>Persones del taller</h2>
                <p class="ajuda">Cada persona entra amb el seu nom i PIN i pot tenir un o més rols. El PIN no es guarda mai en clar.</p>
                ${l.map((x, i) => `<button class="bt gran" data-i="${i}"><i>${FO.ROLS[x.rols[0]] ? FO.ROLS[x.rols[0]].ico : '👤'}</i><span>${esc(x.nom)}<small>${x.rols.map(r => FO.ROLS[r] ? FO.ROLS[r].nom : r).join(' · ')}</small></span></button>`).join('')}
                <h3>${edita ? 'Editar ' + esc(edita.nom) : 'Persona nova'}</h3><div class="targeta">
                ${edita ? '' : '<label class="camp">Nom<input id="peNom"></label>'}
                ${TOTS_ROLS.map(r => `<label class="ck"><input type="checkbox" data-rol="${r}"${edita && edita.rols.includes(r) ? ' checked' : ''}> ${FO.ROLS[r].ico} ${FO.ROLS[r].nom} <small class="ajuda">${esc(FO.ROLS[r].desc)}</small></label>`).join('')}
                <label class="camp">${edita ? 'PIN nou (buit = no el canvia)' : 'PIN (de 4 a 8 xifres)'}<input id="pePin" type="password" inputmode="numeric" autocomplete="new-password"></label>
                <button class="bt pr" id="peDesa">Desar</button>
                ${edita ? `<button class="bt perill" id="peBaixa"${edita.nom === ses.nom ? ' disabled' : ''}>Donar de baixa</button><button class="bt" id="peNova">+ Persona nova</button>` : ''}</div>`;
            $('vista').querySelectorAll('[data-i]').forEach(b => b.onclick = () => { edita = l[+b.dataset.i]; pinta(); });
            const desa = async actiu => {
                const nom = edita ? edita.nom : $('peNom').value.trim();
                const rols = Array.from($('vista').querySelectorAll('[data-rol]:checked')).map(c => c.dataset.rol);
                const pin = $('pePin').value.trim();
                try {
                    await api('/api/persones', { method: 'POST', body: JSON.stringify({ nom, rols, pin: pin || undefined, actiu }) });
                    avis(actiu ? 'Desat' : 'Persona donada de baixa');
                    VISTES.persones();
                } catch (e) { avis(e.message, 4000); }
            };
            $('peDesa').onclick = () => desa(true);
            if ($('peBaixa')) $('peBaixa').onclick = () => { if (confirm(`Donar de baixa ${edita.nom}? Ja no podrà entrar.`)) desa(false); };
            if ($('peNova')) $('peNova').onclick = () => { edita = null; pinta(); };
        };
        pinta();
    };

    // ═══════════════════════════════════════════════════════════
    // ⌖ ESCÀNER (QR / Code 128, càmera o lector USB/Bluetooth)
    // ═══════════════════════════════════════════════════════════
    const esc_ = { stream: null, det: null, actiu: false, ultim: '', tUltim: 0, canvas: null };
    async function obreEscaner() {
        if (!P) return;
        $('escaner').hidden = false; $('resEsc').className = 'resultat'; $('codiManual').value = '';
        esc_.actiu = true;
        try {
            esc_.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
            const v = $('video'); v.srcObject = esc_.stream; await v.play();
            if ('BarcodeDetector' in G) {
                const fmts = await G.BarcodeDetector.getSupportedFormats().catch(() => []);
                esc_.det = new G.BarcodeDetector({ formats: ['qr_code', 'code_128'].filter(f => !fmts.length || fmts.includes(f)) });
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
        ruta();
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
                    const q = G.jsQR(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'dontInvert' });
                    if (q) valor = q.data;
                }
            }
            if (valor) processaCodi(valor);
        } catch (e) { /* segueix provant */ }
        setTimeout(() => requestAnimationFrame(bucleEscaner), 120);
    }
    function resultat(tipus, html) { const r = $('resEsc'); r.className = 'resultat ' + tipus; r.innerHTML = html; }

    // Interpreta un codi llegit i hi reacciona segons el rol:
    //  · Magatzem: omple el caixetí (o obre la caixa escanejada)
    //  · Muntador: marca el caixetí com a agafat (només si és del pas obert)
    //  · Qualitat i Responsable: mostra de quin pas és i en quin estat està
    function processaCodi(valor) {
        valor = String(valor).trim(); if (!valor || !P) return;
        const ara = Date.now();
        if (valor === esc_.ultim && ara - esc_.tUltim < 2500) return;   // la càmera llegeix el mateix codi molts cops
        esc_.ultim = valor; esc_.tUltim = ara;
        const r0 = rol();
        // tapa: només informa de quina caixa és
        if (valor.startsWith('FO1|') && valor.endsWith('|TAPA')) {
            const x = M.perObj.get(valor.split('|')[1]);
            so(true);
            return resultat('in', `Tapa de <b>${esc(valor.split('|')[1])}</b>${x ? `<br><small>Pas ${x.r.pas} · ${esc(x.r.conj.nom)}</small>` : ''}`);
        }
        let e = null;
        if (valor.startsWith('FO1|')) {
            const [, safata, conjunt, codi] = valor.split('|');
            e = M.ETQ.find(x => x.safata === safata && x.codi === codi && x.tipus === 'caixeti') || M.ETQ.find(x => x.clau === safata && x.tipus !== 'caixeti');
            if (!e) { so(false); return resultat('er', `Etiqueta d'un altre projecte o d'una versió anterior<br><small>${esc(safata)} · ${esc(conjunt)}</small>`); }
        } else {
            // codi de barres simple (codi del material): el més probable segons el context
            const cand = M.caixetins.filter(x => x.codi === valor);
            const ctx = x => (caixaActual ? caixaDeClau(x.clau) && caixaDeClau(x.clau).id === caixaActual : pasActual ? M.pasDe(x) === pasActual : true);
            const lliure = x => r0 === 'magatzem' ? !prog.omplert[x.clau] : !prog.agafat[x.clau];
            e = cand.find(x => ctx(x) && lliure(x)) || cand.find(ctx) || cand.find(lliure) || cand[0];
            if (!e) { so(false); return resultat('er', `Codi desconegut: ${esc(valor)}`); }
        }
        // etiqueta d'una caixa o d'un contenidor
        if (e.tipus !== 'caixeti') {
            const c = M.caixes.find(x => x.id === e.clau) || M.caixes.find(x => x.o.forma === 'contenidor' && x.o.caixes.some(q => q.obj.id === e.clau));
            so(true);
            if (!c) return resultat('in', esc(e.clau));
            if (r0 === 'magatzem') { tancaEscaner(); location.hash = '#/caixa/' + encodeURIComponent(c.id); return; }
            return resultat('in', `<b>${esc(c.id)}</b> · ${esc((FO.ESTATS_CAIXA[estatCaixa(c)] || {}).nom)}<br><small>Pas ${c.r.pas} · ${esc(c.r.conj.nom)} · ${c.claus.filter(k => prog.agafat[k]).length}/${c.claus.length} agafats</small>`);
        }
        const pas = M.pasDe(e), r = M.perConj.get(pas), m = e.caixeti.mat;
        if (r0 === 'magatzem') {
            const c = caixaDeClau(e.clau);
            if (c && c.guarda) { so(false); return resultat('er', `${esc(c.id)} és una caixa de guarda: s'omple en muntar el conjunt, no des del magatzem`); }
            if (caixaActual && c && c.id !== caixaActual) { so(false); return resultat('er', `✗ No és d'aquesta caixa<br>${esc(e.codi)} va a ${esc(c.id)}`); }
            if (prog.omplert[e.clau]) { so(true); return resultat('ok', `Ja estava omplert: ${esc(e.codi)} ×${prog.omplert[e.clau].qty}<br><small>${esc(e.safata)}</small>`); }
            if (!omple(e.clau, e.qty)) return resultat('er', 'No s\'ha omplert');
            so(true);
            const n = c ? c.claus.filter(k => prog.omplert[k]).length : 0;
            return resultat('ok', `✓ Omplert: ${esc(e.codi)} ×${prog.omplert[e.clau].qty}<br><small>${esc(m.nom)} · ${esc(e.safata)}${c ? ` · ${n}/${c.claus.length}${n === c.claus.length ? ' · caixa plena!' : ''}` : ''}</small>`);
        }
        if (r0 === 'muntador') {
            if (pasActual && pas !== pasActual) { so(false); return resultat('er', `✗ No és d'aquest pas<br>${esc(e.codi)} ×${e.qty} és del pas ${r ? r.pas + ' · ' + esc(r.conj.nom) : '?'}`); }
            const ja = !!prog.agafat[e.clau];
            if (!ja) { if (r) iniciaSiCal(r); if (!fer('agafa', { clau: e.clau, v: true }, `${e.codi} ×${e.qty}: agafat per escaneig (${e.safata})`)) return resultat('er', 'No s\'ha pogut marcar'); }
            const it = itemDe(pas, m.id), llista = r ? M.aAgafar(r) : [], n = llista.filter(x => prog.agafat[x.clau]).length;
            so(true);
            return resultat('ok', `${ja ? 'Ja estava agafat' : '✓ Agafat'}: ${esc(e.codi)} ×${e.qty}<br><small>${esc(e.nom)}${it && it.parell ? ' · ' + fmt(it.parell, 1) + ' N·m' : ''}${it && it.nota ? '<br>▸ ' + esc(it.nota) : ''}</small>` +
                (r ? `<br><small>Pas ${r.pas}: ${n}/${llista.length}${n === llista.length ? ' · complet!' : ''}</small>` : ''));
        }
        so(true);
        resultat('in', `${esc(e.codi)} ×${e.qty} · ${esc(e.nom)}<br><small>${esc(e.safata)} · pas ${r ? r.pas + ' ' + esc(r.conj.codi) + ' · ' + esc((FO.ESTATS_PAS[estatDe(r)] || {}).nom) : '?'}${prog.omplert[e.clau] ? ' · omplert' : ''}${prog.agafat[e.clau] ? ' · agafat' : ''}</small>`);
    }
    $('bEscaneja').onclick = () => obreEscaner();
    $('bTancaEsc').onclick = tancaEscaner;
    $('codiManual').addEventListener('keydown', e => { if (e.key === 'Enter') { processaCodi(e.target.value); e.target.value = ''; esc_.ultim = ''; } });
    // Lector de codis USB / Bluetooth (fa de teclat): tecles molt ràpides acabades en Enter
    const teclat = { buf: '', t: 0 };
    document.addEventListener('keydown', e => {
        if (!P || pantallaSessio || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
        const ara = Date.now();
        if (ara - teclat.t > 80) teclat.buf = '';
        teclat.t = ara;
        if (e.key === 'Enter' && teclat.buf.length >= 3) {
            const v = teclat.buf; teclat.buf = '';
            esc_.ultim = ''; $('escaner').hidden = false; processaCodi(v);
        } else if (e.key.length === 1) teclat.buf += e.key;
    });

    // ═══ Menú ═══
    function pintaMenu() {
        $('grupPersona').innerHTML = srv.url
            ? (ses ? `<div class="targeta"><b>${esc(ses.nom)}</b><div class="ajuda">${ses.rols.map(r => FO.ROLS[r].ico + ' ' + FO.ROLS[r].nom).join(' · ')}</div><button class="bt" id="bSurt">👤 Canviar de persona</button></div>` : '')
            : `<label class="camp">El teu nom (surt al registre)<input id="nomLocal" value="${esc(pref.nomLocal)}" autocomplete="name"></label>`;
        if ($('bSurt')) $('bSurt').onclick = surt;
        if ($('nomLocal')) $('nomLocal').oninput = function () { pref.nomLocal = this.value.trim(); desaPref(); };
        $('consumAuto').checked = pref.consumAuto;
        $('urlSrv').value = pref.servidor || ''; $('clauSrv').value = pref.clau || '';
        $('infoSrv').textContent = srv.url
            ? `${srv.fora ? 'Sense connexió amb' : 'Connectat a'} ${srv.url}${cua.length ? ` · ${cua.length} canvis per enviar` : ''}. ${srv.projecteOk ? 'El progrés, l\'estoc i les fotos d\'aquesta ordre es comparteixen amb tot el taller.' : 'Aquest projecte no és al servidor.'}`
            : 'Sense servidor: el progrés es desa només en aquest aparell. Si al taller hi ha una Raspberry Pi o un PC amb FOrdre, obre l\'app des d\'allà o escriu-ne l\'adreça.';
        const llista = srv.projectes || [];
        $('projSrv').innerHTML = llista.length ? '<h3>Projectes del taller</h3>' + llista.map(x => `<button class="bt" data-psrv="${esc(x.id)}">${esc(x.nom)} <small style="opacity:.7">· ${x.ordres.length} ${x.ordres.length === 1 ? 'ordre' : 'ordres'}</small></button>`).join('') : '';
        $('projSrv').querySelectorAll('[data-psrv]').forEach(b => b.onclick = async () => {
            try { await recarregaDelServidor(b.dataset.psrv); $('menu').hidden = true; location.hash = '#/'; } catch (e) { avis(e.message); }
        });
        // el progrés compartit no es pot importar ni reiniciar des d'un mòbil
        $('bImportaProg').disabled = $('bReinicia').disabled = enXarxa();
        $('infoApp').textContent = `FOrdre ${FO.VERSIO}${P ? ' · ' + P.nom : ''}${ORD ? ' · ' + ORD.codi : ''}${navigator.onLine ? '' : ' · sense connexió'}`;
    }
    $('bMenu').onclick = () => { pintaMenu(); $('menu').hidden = false; };
    $('consumAuto').onchange = function () { pref.consumAuto = this.checked; desaPref(); };
    $('bConnecta').onclick = async () => {
        pref.servidor = $('urlSrv').value.trim().replace(/\/$/, ''); pref.clau = $('clauSrv').value.trim(); desaPref();
        const d = await detectaServidor();
        if (!d) { avis('No es troba el servidor. Comprova l\'adreça i que aquest aparell confiï en el certificat (obre l\'adreça una vegada al navegador).', 6000); pintaMenu(); pintaEstatSrv(); return; }
        $('menu').hidden = true;
        inicia();
    };
    $('bSrv').onclick = async () => {
        if (srv.projecteNou) { try { await recarregaDelServidor(); avis('Projecte actualitzat'); } catch (e) { avis(e.message); } return; }
        if (enXarxa()) sincronitza();
        avis($('bSrv').title, 3000);
    };
    $('bObrirFitxer').onclick = () => $('fProjecte').click();
    $('fProjecte').addEventListener('change', function () {
        const f = this.files[0]; this.value = ''; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => { let p; try { p = JSON.parse(rd.result); } catch (e) { return avis('Fitxer no vàlid'); } obreProjecte(p, 'fitxer'); };
        rd.readAsText(f);
    });
    $('bEnganxa').onclick = async () => {
        const t = prompt('Enganxa l\'enllaç del projecte (…muntatge.html#p=…)');
        if (!t) return;
        try { obreProjecte(JSON.parse(await FO.descomprimeix(t.slice(t.indexOf('#p=') + 3))), 'enllaç'); } catch (e) { avis('Enllaç no vàlid'); }
    };
    $('bOrdinador').onclick = () => {
        const d = llegeix(FO.CLAU_PROJECTE);
        if (!d) return avis('No hi ha cap projecte de l\'app d\'escriptori en aquest navegador');
        obreProjecte(d, 'navegador');
    };
    $('bExemple').onclick = () => obreProjecte(FO.exemple(), 'exemple');
    $('bExportaProg').onclick = () => { if (P) baixa(`${FO.nomFitxer(P.nom)}_${ORD.codi}_progres.json`, JSON.stringify({ projecte: P.id, nom: P.nom, ordre: ORD, progres: prog }, null, 1), 'application/json'); };
    $('bImportaProg').onclick = () => $('fProgres').click();
    $('fProgres').addEventListener('change', function () {
        const f = this.files[0]; this.value = ''; if (!f || !P) return;
        const rd = new FileReader();
        rd.onload = () => {
            try {
                const d = JSON.parse(rd.result);
                if (d.projecte !== P.id && !confirm('Aquest progrés és d\'un altre projecte. Importar-lo igualment?')) return;
                prog = FO.normalitzaProgres(d.progres); desaProg(); $('menu').hidden = true; ruta(); avis('Progrés importat a ' + ORD.codi);
            } catch (e) { avis('Fitxer no vàlid'); }
        };
        rd.readAsText(f);
    });
    $('bReinicia').onclick = () => {
        if (!P || !confirm(`Esborrar tot el progrés, l'estoc i el registre de l'ordre ${ORD.codi} en aquest aparell?`)) return;
        prog = FO.progresBuit(); desaProg(); $('menu').hidden = true; ruta();
    };

    // ═══ Instal·lació com a app i funcionament sense connexió ═══
    let promptInstal = null;
    G.addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptInstal = e; $('bInstal·la').hidden = false; });
    $('bInstal·la').onclick = async () => { if (!promptInstal) return; promptInstal.prompt(); await promptInstal.userChoice.catch(() => { }); promptInstal = null; $('bInstal·la').hidden = true; };
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
        navigator.serviceWorker.register('sw.js').catch(() => { });
    }

    // ═══ Inici ═══
    inicia();
    // Accés per a les proves automàtiques
    G.FOrdreMuntatge = {
        get projecte() { return P; }, get progres() { return prog; }, get ordre() { return ORD; }, get ordres() { return ORDRES; },
        get servidor() { return srv; }, get cua() { return cua; }, get sessio() { return ses; }, get rol() { return rol(); },
        get etiquetes() { return M ? M.ETQ : []; }, processaCodi, canviaOrdre
    };
})(window);
