// ═══════════════════════════════════════════════════════════════
// FOrdre Taller — app del dispositiu (mòbil i tauleta)
// ───────────────────────────────────────────────────────────────
// Cada persona entra amb el seu rol i veu la seva part del procés:
//
//   📦 Magatzem    OMPLIR     posa el material a les caixes (escanejant les
//                             etiquetes), porta l'estoc i la llista de compra;
//                             el que no ha arribat va a la llista de MANCANTS, i
//                             el que arriba malament es registra com a DEFECTUÓS.
//   🔧 Muntador    UTILITZAR  agafa les caixes, segueix les instruccions,
//                             marca el pas com a muntat i torna les caixes. Si hi
//                             falten peces, munta la resta i ho completa quan arriben.
//                             Si una peça es trenca, la registra i se'n demana recanvi.
//   ✅ Qualitat    COMPROVAR  verifica cada pas muntat amb una llista de
//                             comprovació; aprova o rebutja amb motiu. Decideix què
//                             es fa amb les peces defectuoses (retorn, ferralla…).
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
    const t = FO.t;   // textos en l'idioma triat (js/fo-i18n.js)
    // Els textos que es desen al registre van sempre en català (fan de clau) i es
    // tradueixen en mostrar-los (FO.tMissatge): cadascú el llegeix en el seu idioma.
    const tc = (s, v) => FO.t(s, v, 'ca');
    const tm = s => FO.tMissatge(s);

    // ═══ Utilitats ═══
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (v, d) => (Math.round(v * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toLocaleString(FO.locale());
    const data = ts => ts ? new Date(ts).toLocaleString(FO.locale(), { dateStyle: 'short', timeStyle: 'short' }) : '';
    const llegeix = k => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
    const escriu = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
    const xipEstat = (e, taula) => `<span class="estat" style="background:${(taula[e] || {}).col || '#888'}">${esc((taula[e] || { nom: e }).nom)}</span>`;
    const CLAU_MOBIL = 'fordre.muntatge.projecte', CLAU_PREF = 'fordre.muntatge.pref', CLAU_SESSIO = 'fordre.muntatge.sessio';

    // Avís breu a peu de pantalla. Els missatges del servidor (sempre en català) es tradueixen aquí.
    function avis(msg, ms) {
        const a = $('avis'); a.textContent = FO.tMissatge(msg); a.classList.add('on');
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

    // Accés directe per rol: muntatge.html?rol=magatzem (o muntador, qualitat, responsable).
    // Es recorda com a rol preferit i es treu de l'adreça, perquè després es pugui canviar amb normalitat.
    const rolDemanat = (() => {
        const q = new URLSearchParams(location.search), r = q.get('rol');
        if (!r) return '';
        q.delete('rol');
        history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
        if (!FO.ROLS[r]) return '';
        pref.rol = r; desaPref();
        return r;
    })();
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
    const pot = tipus => { const v = validador(); return !v || FO.potFer(v.rols, tipus); };

    // ═══ Progrés i cua, desats per projecte i ordre ═══
    const clauProg = () => `fordre.muntatge.progres.${P.id}.${ORD.id}`;
    const clauCua = () => `fordre.muntatge.cua.${P.id}.${ORD.id}`;
    const clauOrdres = () => 'fordre.muntatge.ordres.' + P.id;
    function desaProg() { if (!escriu(clauProg(), prog)) avis(t('No s\'ha pogut desar el progrés (memòria plena?)')); }
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
    function fer(tipus, dades, text) {
        if (!prog) return null;
        pref.comptador = (pref.comptador || 0) + 1; desaPref();
        const op = FO.creaOp(pref.disp, pref.comptador, tipus, Object.assign({ text }, dades), nomPersona(), rol());
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
                        avis(t('S\'han descartat {n} canvis d\'una sessió que ja no és vàlida', { n: grup.length }), 5000);
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
            if (r.rebutjades && r.rebutjades.length) { so(false); avis(t('El servidor no ho ha acceptat: ') + FO.tMissatge(r.rebutjades[0].motiu), 6000); }
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
            avis(t('El projecte s\'ha actualitzat des de l\'ordinador. Toca ⟳ per carregar-lo.'), 5000);
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
                    avis(t('Aquest projecte no és al servidor del taller: demana al Responsable que el publiqui. Mentrestant treballes només en aquest aparell.'), 7000);
                    return;
                }
                await api('/api/projectes/' + encodeURIComponent(P.id), { method: 'PUT', body: JSON.stringify(P) });
                await carregaProjectesSrv();
                avis(t('Projecte publicat al servidor del taller'));
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
        const [col, tit] = !srv.url ? ['var(--dm)', t('Sense servidor: el progrés només es desa en aquest aparell')]
            : !srv.projecteOk ? ['var(--wr)', t('Aquest projecte no es comparteix pel servidor del taller')]
            : srv.estat === 'connectat' ? [n ? 'var(--wr)' : 'var(--ok)', n ? t('Connectat · {n} canvis per enviar', { n }) : t('Connectat al servidor del taller')]
            : srv.estat === 'clau' ? ['var(--er)', t('Cal la clau del taller (menú ⋮)')]
            : ['var(--er)', t('Sense connexió amb el servidor') + (n ? ' · ' + t('{n} canvis en cua', { n }) : '')];
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
        avis(t('Hola, {nom}', { nom: ses.nom }));   // abans d'entrar, perquè no tapi cap avís de l'arrencada
        await continuaInici();
    }
    async function surt() {
        if (ses && cua.some(x => x.tok === ses.token)) await sincronitza();
        const queden = ses ? cua.filter(x => x.tok === ses.token).length : 0;
        if (queden && !confirm(t('Hi ha {n} canvis teus sense enviar (no hi ha connexió). S\'enviaran sols quan torni. Canviar de persona igualment?', { n: queden }))) return;
        // si encara queden canvis seus a la cua, la sessió es manté al servidor perquè es puguin signar
        if (!queden) api('/api/sessio', { method: 'DELETE' }).catch(() => { });
        $('menu').hidden = true;
        tancaSessioLocal();
    }
    // Primer ús: el servidor encara no té cap Responsable
    function vistaPrimerUs() {
        pantallaSessio = true; mostraNav(false); pintaCap();
        $('vista').innerHTML = `<div class="targeta"><h2>${t('Benvinguda al taller')}</h2>
            <p class="ajuda">${t('És la primera vegada que es fa servir aquest servidor. Crea el <b>Responsable</b>: és qui dona d\'alta la resta de persones, publica els projectes i obre les ordres de fabricació.')}</p>
            <label class="camp">${t('Idioma')}${FO.selectorIdioma('')}</label>
            <label class="camp">${t('Nom')}<input id="puNom" autocomplete="name"></label>
            <label class="camp">${t('PIN (de 4 a 8 xifres)')}<input id="puPin" type="password" inputmode="numeric" autocomplete="new-password"></label>
            <label class="camp">${t('Repeteix el PIN')}<input id="puPin2" type="password" inputmode="numeric" autocomplete="new-password"></label>
            <button class="bt pr" id="puCrea">${t('Crear el Responsable i entrar')}</button></div>`;
        FO.activaSelectorsIdioma($('vista'));
        $('puCrea').onclick = async () => {
            const nom = $('puNom').value.trim(), pin = $('puPin').value.trim();
            if (!nom) return avis(t('Escriu el nom'));
            if (!/^\d{4,8}$/.test(pin)) return avis(t('El PIN ha de tenir de 4 a 8 xifres'));
            if (pin !== $('puPin2').value.trim()) return avis(t('Els dos PIN no coincideixen'));
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
            $('vista').innerHTML = !tria ? `<h2>${t('Qui ets?')}</h2>
                ${persones.map((x, i) => `<button class="bt gran" data-i="${i}"><i>${FO.ROLS[x.rols[0]] ? FO.ROLS[x.rols[0]].ico : '👤'}</i><span>${esc(x.nom)}<small>${x.rols.map(r => esc(FO.ROLS[r] ? FO.ROLS[r].nom : r)).join(' · ')}</small></span></button>`).join('')
                    || `<p class="ajuda">${t('No es pot obtenir la llista de persones. Comprova la connexió amb el servidor del taller.')}</p>`}
                <div class="idioma-peu">${FO.selectorIdioma('')}</div>`
                : `<h2>${esc(tria.nom)}</h2><p class="ajuda">${t('Escriu el teu PIN')}</p>
                <input class="pin" id="enPin" type="password" inputmode="numeric" autocomplete="current-password" value="${esc(pin)}">
                <div class="teclat">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '✓'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>
                <button class="bt" id="enAltre">‹ ${t('No soc {nom}', { nom: esc(tria.nom) })}</button>`;
            FO.activaSelectorsIdioma($('vista'));
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
            const tr = d.transaction('fotos', mode), s = tr.objectStore('fotos'), res = fn(s);
            tr.oncomplete = () => ok(res && res.result); tr.onerror = () => ko(tr.error);
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
                const op = FO.creaOp(pref.disp, pref.comptador, 'foto', { conj: f.pendent.conj, fitxer: r.fitxer, text: tc('Foto al pas {codi}', { codi: codiConj(f.pendent.conj) }) }, f.op, f.rol);
                FO.aplicaOp(prog, op); cua.push({ tok: f.pendent.tok, op }); desaCua(); desaProg();
                await idb.esborra(f.id);
                n++;
            }
        } catch (e) { /* es tornarà a provar a la sincronització següent */ }
        pujantFotos = false;
        if (n) { avis(n === 1 ? t('1 foto pujada al taller') : t('{n} fotos pujades al taller', { n })); sincronitza(); }
    }
    async function pintaFotos(conj) {
        const cont = $('pFotos'); if (!cont) return;
        const remotes = enXarxa() ? (prog.fotos[conj] || []).map(f => `<img src="${esc(srv.url + rutaFotos() + '/' + encodeURIComponent(f.fitxer) + paramsAuth())}" alt="" title="${esc(data(f.ts) + (f.op ? ' · ' + f.op : ''))}">`).join('') : '';
        try {
            const locals = await idb.del(clauFotos(conj));
            cont.innerHTML = remotes + locals.map(f => `<img src="${f.dades}" alt="" data-id="${f.id}" title="${esc(data(f.ts) + (f.pendent ? ' · ' + t('pendent de pujar') : ''))}"${f.pendent ? ' class="pendent"' : ''}>`).join('');
            cont.querySelectorAll('img[data-id]').forEach(im => im.addEventListener('click', async () => {
                if (confirm(t('Esborrar aquesta foto d\'aquest aparell?'))) { await idb.esborra(+im.dataset.id); pintaFotos(conj); }
            }));
        } catch (e) { cont.innerHTML = remotes || `<p class="ajuda">${t('Aquest navegador no permet guardar fotos.')}</p>`; }
    }
    $('fFoto').addEventListener('change', async function () {
        const f = this.files[0], conj = this.dataset.pas || pasActual; this.value = '';
        if (!f || !prog) return;
        if (!pot('foto')) return avis(t('El teu rol no permet afegir fotos'));
        try {
            const dades = await redueix(f, 1280);
            let pujada = false;
            if (enXarxa() && srv.estat === 'connectat') {
                try {
                    const r = await api(rutaFotos(), { method: 'POST', body: JSON.stringify({ conj, dades }) });
                    pujada = !!fer('foto', { conj, fitxer: r.fitxer }, tc('Foto al pas {codi}', { codi: codiConj(conj) }));
                } catch (e) { /* sense connexió: es guarda al mòbil i es pujarà després */ }
            }
            if (!pujada) {
                await idb.afegeix({
                    pas: clauFotos(conj), ts: new Date().toISOString(), op: nomPersona(), rol: rol(), dades,
                    pendent: enXarxa() ? { proj: P.id, ordre: ORD.id, conj, tok: ses ? ses.token : '' } : null
                });
            }
            pintaFotos(conj);
            avis(pujada ? t('Foto desada al taller') : enXarxa() ? t('Foto desada: es pujarà quan hi hagi connexió') : t('Foto desada en aquest aparell'));
        } catch (e) { avis(t('No s\'ha pogut desar la foto')); }
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
        const perDefecte = !ORDRES.length;
        if (perDefecte) {
            ORDRES = [{ id: 'OF-1', codi: FO.codiOrdreSeguent([]), serie: '', notes: '', creada: new Date().toISOString(), creador: nomPersona() }];
            escriu(clauOrdres(), ORDRES);
        }
        srv.projecteOk = false;
        // Amb servidor, l'ordre provisional no es recorda com a triada: en connectar,
        // un aparell nou s'ha de posar a l'ordre més recent del taller, no a la primera.
        triaOrdre(!(perDefecte && srv.url));
        carregaProgres();
        if (origen) avis(t('Projecte carregat: {nom}', { nom: P.nom }));
    }
    // Ordre de treball: la darrera triada en aquest aparell, o la més recent
    function triaOrdre(recorda) {
        ORD = ORDRES.find(o => o.id === pref.ordres[P.id]) || ORDRES[ORDRES.length - 1];
        if (recorda !== false) { pref.ordres[P.id] = ORD.id; desaPref(); }
    }
    function canviaOrdre(id) {
        const o = ORDRES.find(x => x.id === id);
        if (!o) return;
        if (srv.es) { srv.es.close(); srv.es = null; }
        ORD = o; pref.ordres[P.id] = o.id; desaPref();
        carregaProgres();
        if (enXarxa()) { sincronitza(); escolta(); }
        avis(t('Ordre {codi}', { codi: o.codi }));
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
            } catch (e) { avis(t('L\'enllaç del projecte no és vàlid')); }
        }
        const q = new URLSearchParams(location.search).get('f');
        if (q) {
            try { const r = await fetch(q); usaProjecte(await r.json(), 'fitxer'); return; } catch (e) { avis(t('No s\'ha pogut descarregar {f}', { f: q })); }
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
        // amb el servidor, només es pot fer servir un rol que la persona tingui
        if (rolDemanat && srv.url && ses && !rolsDisponibles().includes(rolDemanat))
            avis(t('No tens el rol de {rol}: treballes com a {actual}', { rol: FO.ROLS[rolDemanat].nom, actual: FO.ROLS[rol()].nom }), 5000);
        ruta();
    }

    // ═══ Navegació: pestanyes segons el rol ═══
    const NAV = {
        magatzem: [['omplir', '📦', 'Omplir'], ['mancants', '❗', 'Mancants'], ['estoc', '▦', 'Estoc'], ['compra', '🛒', 'Compra'], ['incidencies', '⚠', 'Incidències']],
        muntador: [['passos', '☰', 'Passos'], ['incidencies', '⚠', 'Incidències'], ['registre', '🕘', 'Registre']],
        qualitat: [['verificar', '✅', 'Verificar'], ['defectes', '💥', 'Defectes'], ['incidencies', '⚠', 'Incidències'], ['registre', '🕘', 'Registre']],
        responsable: [['tauler', '📋', 'Tauler'], ['ordres', '🏭', 'Ordres'], ['mancants', '❗', 'Mancants'], ['incidencies', '⚠', 'Incidències'], ['resultats', '📊', 'Resultats']]
    };
    // Pantalles de detall i la pestanya a què tornen
    const PARE = { pas: 'passos', caixa: 'omplir', verif: 'verificar', persones: 'tauler', defectes: 'mancants' };
    function mostraNav(v) { $('peu').hidden = !v; document.body.classList.toggle('sense-peu', !v); }
    function pintaNav(actual) {
        // comptadors a les pestanyes: incidències i mancants oberts
        const compta = { incidencies: prog ? prog.incidencies.filter(i => !i.resolta).length : 0, mancants: prog ? FO.mancantsOberts(prog).length : 0, defectes: prog ? FO.defectesPendents(prog).length : 0 };
        $('peu').innerHTML = NAV[rol()].map(([r, ico, nom]) => `<button data-ruta="${r}" class="${r === actual || PARE[actual] === r ? 'on' : ''}"><i>${ico}</i>${t(nom)}${compta[r] ? ` (${compta[r]})` : ''}</button>`).join('');
        $('peu').querySelectorAll('button').forEach(b => b.onclick = () => { location.hash = '#/' + b.dataset.ruta; });
        mostraNav(true);
    }
    function pintaCap() {
        $('nomProj').textContent = P ? P.nom : t('Taller');
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
        $('llistaRols').innerHTML = (!srv.url ? `<label class="camp">${t('El teu nom (surt al registre)')}<input id="trNom" value="${esc(pref.nomLocal)}" autocomplete="name"></label>` : `<p class="ajuda">${esc(nomPersona())}</p>`) +
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
    ['menu', 'triaRol', 'fullForm'].forEach(id => $(id).addEventListener('click', e => { if (e.target.id === id) $(id).hidden = true; }));
    // Obre un formulari curt a la part de baix de la pantalla i en retorna el contenidor
    function obreFull(html) { $('fullFormCos').innerHTML = html; $('fullForm').hidden = false; return $('fullFormCos'); }
    const tancaFull = () => { $('fullForm').hidden = true; };

    // Avís comú a totes les pantalles quan l'ordre està tancada
    const bannerTancada = () => prog.tancada ? `<div class="banner er">🔒 ${t('L\'ordre <b>{codi}</b> està tancada ({quan}). Només es pot consultar.', { codi: esc(ORD.codi), quan: esc(data(prog.tancada.ts)) + (prog.tancada.op ? ' · ' + esc(prog.tancada.op) : '') })}</div>` : '';

    function vistaBuida() {
        const llista = srv.projectes || [];
        $('vista').innerHTML = `<div class="buit"><h2>FOrdre Taller</h2>
            <p>${llista.length ? t('Tria un projecte del taller') : t('Encara no hi ha cap projecte. El Responsable el prepara a l\'app de l\'ordinador i el publica al servidor (botó <b>🏭 Taller</b>), o bé obre\'l aquí:')}</p>
            ${llista.map(x => `<button class="bt gran" data-psrv="${esc(x.id)}"><i>🏭</i><span>${esc(x.nom)}<small>${x.ordres.length === 1 ? t('1 ordre') : t('{n} ordres', { n: x.ordres.length })}</small></span></button>`).join('')}
            <div class="grup"><button class="bt pr" data-acc="fitxer">📂 ${t('Obrir fitxer')}</button><button class="bt" data-acc="exemple">🧪 ${t('Projecte d\'exemple')}</button></div>
            <div class="idioma-peu">${FO.selectorIdioma('')}</div></div>`;
        FO.activaSelectorsIdioma($('vista'));
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
    const icones = m => (m.esd ? ' <span class="xip esd">⚡ ESD</span>' : '') + (m.liquid ? ' <span class="xip liq">💧</span>' : '') + (m.angleMax < 90 ? ` <span class="xip">⬆ ${t('vertical')}</span>` : '');
    // Caixes que omple el magatzem (les de guarda s'omplen muntant)
    const caixesKit = () => M.caixes.filter(c => !c.guarda && c.claus.length);
    const estatCaixa = c => FO.estatCaixa(prog, c.id, c.claus);
    const caixaDeClau = clau => M.caixes.find(c => c.claus.includes(clau));

    VISTES.omplir = function (filtre) {
        const totes = caixesKit(), plenes = totes.filter(c => ['plena', 'en ús', 'retornada'].includes(estatCaixa(c))).length;
        const perOmplir = filtre !== 'totes';
        $('vista').innerHTML = `${bannerTancada()}<div class="kpi"><div>${t('Caixes plenes')}<b>${plenes} / ${totes.length}</b></div><div>${t('Mancants oberts')}<b>${FO.mancantsOberts(prog).length}</b></div><div>${t('Ordre')}<b style="font-size:16px">${esc(ORD.codi)}</b></div></div>
            <button class="bt pr" id="oEsc">⌖ ${t('Escanejar etiquetes per omplir')}</button>
            <div class="fx" style="margin:4px 0 8px"><button class="bt${perOmplir ? ' pr' : ''}" data-f="">${t('Per omplir')}</button><button class="bt${perOmplir ? '' : ' pr'}" data-f="totes">${t('Totes')}</button></div>
            ${M.PLA.map(r => {
                const cx = totes.filter(c => c.r === r && (!perOmplir || ['buida', 'parcial', 'mancant'].includes(estatCaixa(c))));
                if (!cx.length) return '';
                return `<h3>${t('Pas {n}', { n: r.pas })} · ${esc(r.conj.codi)} ${esc(r.conj.nom)}</h3>` + cx.map(c => {
                    const n = c.claus.filter(k => prog.omplert[k]).length;
                    return `<div class="targeta pas" data-caixa="${esc(c.id)}" style="border-left-color:${c.o.color}">
                        <div class="info"><div class="nom">${esc(c.id)}</div><div class="sub">${c.o.forma === 'contenidor' ? t('Contenidor') + ' · ' + t('{n} caixes', { n: c.o.caixes.length }) : c.o.forma === 'caixa' ? t('Caixa individual') : t('Safata')} · ${t('{n}/{t} caixetins', { n, t: c.claus.length })}</div>
                        <div class="barra"><div style="width:${n / c.claus.length * 100}%"></div></div></div>${xipEstat(estatCaixa(c), FO.ESTATS_CAIXA)}</div>`;
                }).join('');
            }).join('') || `<div class="buit">✓ ${t('Totes les caixes d\'aquesta ordre estan plenes.')}</div>`}`;
        $('oEsc').onclick = () => obreEscaner();
        $('vista').querySelectorAll('[data-f]').forEach(b => b.onclick = () => { location.hash = '#/omplir' + (b.dataset.f ? '/' + b.dataset.f : ''); });
        $('vista').querySelectorAll('[data-caixa]').forEach(n => n.onclick = () => { location.hash = '#/caixa/' + encodeURIComponent(n.dataset.caixa); });
    };

    VISTES.caixa = function (id) {
        const c = M.caixes.find(x => x.id === id);
        if (!c) { location.hash = '#/omplir'; return; }
        const est = estatCaixa(c);
        const files = c.claus.map(k => {
            const e = M.perClau.get(k), m = e.caixeti.mat, om = prog.omplert[k], estoc = prog.estoc[m.id], mc = FO.esMancant(prog, k) && prog.mancants[k];
            return `<div class="fila${om && !mc ? ' fet' : ''}${mc ? ' mancant' : ''}" data-clau="${esc(k)}"><div class="chk">${mc ? '!' : '✓'}</div><span class="sw" style="background:${m.col}"></span>
                <div class="txt"><div class="cd">${esc(m.codi)}${icones(m)}</div><div class="nm">${esc(m.nom)}</div>${c.o.forma === 'contenidor' ? `<div class="ajuda">${esc(e.safata)}</div>` : ''}
                ${om ? `<div class="ajuda">${t('Omplert')} ${esc(data(om.ts))}${om.op ? ' · ' + esc(om.op) : ''}${om.qty !== e.qty ? ` · ${t('<b>{n}</b> de {t}', { n: om.qty, t: e.qty })}` : ''}</div>` : ''}
                ${mc ? `<div class="nota">❗ ${t('Falten {n}', { n: mc.falten })}${mc.nota ? ' · ' + esc(tm(mc.nota)) : ''} · ${t('toca quan arribi')}</div>` : ''}</div>
                <div class="q">×${e.qty}${estoc != null ? `<small class="${estoc < e.qty && !om ? 'falta' : ''}">${t('estoc')} ${estoc}</small>` : ''}</div>
                ${!prog.tancada ? `<button class="bt-falta" data-problema="${esc(k)}" title="${t('Problema: no ha arribat, o ha arribat defectuosa')}" aria-label="${t('Problema amb aquest caixetí')}">⚠</button>` : ''}</div>`;
        }).join('');
        $('vista').innerHTML = `${bannerTancada()}<div class="cap-pas" style="background:${c.o.color}"><div class="sub">${t('Pas {n}', { n: c.r.pas })} · ${esc(c.r.conj.codi)} ${esc(c.r.conj.nom)}</div><h2>${esc(c.id)}</h2><div class="sub">${xipEstat(est, FO.ESTATS_CAIXA)}</div></div>
            <p class="ajuda">${t('Toca cada caixetí quan hi hagis posat el material, o escaneja\'n l\'etiqueta. Si no ha arribat o ha arribat malament, prem <b>⚠</b>: va a la llista de mancants i el muntatge pot continuar amb la resta.')}</p>
            <div class="fx"><button class="bt pr" id="cEsc">⌖ ${t('Escanejar')}</button><button class="bt" id="cTot">${t('Omplir-ho tot')}</button></div>
            <div class="objecte">${files}</div>
            <div class="fx"><button class="bt" id="cRet"${est === 'retornada' ? ' disabled' : ''}>↩ ${t('Caixa retornada al magatzem')}</button><button class="bt" id="cInc">⚠ ${t('Incidència')}</button></div>`;
        $('vista').querySelectorAll('[data-clau]').forEach(f => f.onclick = () => { commutaOmplert(f.dataset.clau); VISTES.caixa(id); });
        $('vista').querySelectorAll('[data-problema]').forEach(b => b.onclick = ev => { ev.stopPropagation(); triaProblema(b.dataset.problema, () => VISTES.caixa(id)); });
        $('cEsc').onclick = () => obreEscaner();
        // «Omplir-ho tot» no toca els mancants: aquells caixetins esperen el material
        $('cTot').onclick = () => { c.claus.filter(k => !prog.omplert[k] && !FO.esMancant(prog, k)).forEach(k => omple(k, M.perClau.get(k).qty, true)); VISTES.caixa(id); };
        $('cRet').onclick = () => { if (fer('retorna', { obj: c.id }, tc('{caixa}: caixa retornada al magatzem', { caixa: c.id }))) VISTES.caixa(id); };
        $('cInc').onclick = () => { obreIncidencia(c.r.conj.id, c.id); };
    };
    // Omple un caixetí. Si l'estoc no n'hi ha prou, pregunta quants se n'hi posen.
    function omple(clau, qty, silenci) {
        const e = M.perClau.get(clau), m = e.caixeti.mat, estoc = prog.estoc[m.id];
        // Només es pregunta si es porta l'estoc i no n'hi ha prou. Amb 0 o menys (estoc no registrat,
        // o que ja ha quedat en negatiu) no es pregunta: qui omple la caixa té el material a la mà.
        if (!silenci && estoc > 0 && estoc < qty) {
            const r = prompt(t('A l\'estoc només n\'hi ha {n} de {mat}. Quants n\'has posat a la caixa?', { n: estoc, mat: m.codi }), String(Math.max(0, estoc)));
            if (r === null) return null;
            qty = Math.round(FO.num(r, 0));
            if (qty <= 0) return null;
        }
        // `cal`: el que hi ha d'anar; si se n'hi posa menys, la diferència queda com a mancant
        const eraMancant = FO.esMancant(prog, clau);
        const v = { mat: m.codi, q: qty, caixa: e.safata, n: e.qty - qty };
        const text = qty < e.qty ? tc('{mat} ×{q}: omplert a {caixa} (en falten {n}: mancant)', v)
            : eraMancant ? tc('{mat} ×{q}: ha arribat el que faltava, omplert a {caixa}', v)
            : tc('{mat} ×{q}: omplert a {caixa}', v);
        return fer('omple', { clau, mat: m.id, qty, cal: e.qty }, text);
    }
    // Tocar un caixetí: omplir-lo; si ja és ple, buidar-lo; si té un mancant, és que el material ha arribat
    function commutaOmplert(clau) {
        const e = M.perClau.get(clau);
        if (FO.esMancant(prog, clau)) {
            const mc = prog.mancants[clau];
            if (confirm(t('Ha arribat {mat}? Es completarà el caixetí fins a {q} (hi faltaven {n}).', { mat: e.codi, q: e.qty, n: mc.falten }))) omple(clau, e.qty);
        } else if (prog.omplert[clau]) { if (confirm(t('Buidar {mat} de {caixa}? El material torna a l\'estoc.', { mat: e.codi, caixa: e.safata }))) fer('buida', { clau }, tc('{mat}: buidat de {caixa}', { mat: e.codi, caixa: e.safata })); }
        else omple(clau, e.qty);
    }
    // «Problema» en un caixetí: no ha arribat (mancant) o ha arribat defectuós
    function triaProblema(clau, despres) {
        const e = M.perClau.get(clau), om = prog.omplert[clau], complet = om && om.qty >= e.qty && !FO.esMancant(prog, clau);
        const cos = obreFull(`<h2>${esc(e.codi)} · ${esc(e.nom)}</h2><p class="ajuda">${esc(e.safata)} · ${t('en calen {n}', { n: e.qty })}</p>
            <button class="bt gran" id="prFalta"${complet ? ' disabled' : ''}><i>❗</i><span>${t('No ha arribat, o no n\'hi ha prou')}<small>${t('Va a la llista de mancants. El muntatge continua amb la resta.')}</small></span></button>
            <button class="bt gran" id="prDefecte"><i>💥</i><span>${t('Ha arribat defectuosa')}<small>${t('No es pot muntar: es registra per retornar-la i se\'n demana recanvi.')}</small></span></button>
            <button class="bt" id="prTanca">${t('Cancel·lar')}</button>`);
        cos.querySelector('#prTanca').onclick = tancaFull;
        cos.querySelector('#prFalta').onclick = () => { tancaFull(); marcaMancant(clau); despres(); };
        cos.querySelector('#prDefecte').onclick = () => formDefecte({ claus: [clau], origen: 'arribada', despres });
    }
    // Formulari de peça defectuosa o trencada. `claus`: caixetins on pot ser (si n'hi ha més d'un, es tria)
    function formDefecte(opc) {
        const claus = opc.claus.filter(k => M.perClau.get(k));
        if (!claus.length) return avis(t('Aquest pas no té caixetins propis'));
        const cos = obreFull(`<h2>💥 ${t('Peça defectuosa o trencada')}</h2>
            <label class="camp">${t('Peça')}<select id="dfClau">${claus.map(k => { const e = M.perClau.get(k); return `<option value="${esc(k)}">${esc(e.codi)} · ${esc(e.nom)} (${esc(e.safata)})</option>`; }).join('')}</select></label>
            <label class="camp">${t('Quantes peces')}<input id="dfQty" type="number" inputmode="numeric" min="1" value="1"></label>
            <div class="camp">${t('Què ha passat')}
                ${Object.entries(FO.ORIGENS_DEFECTE).map(([k, o]) => `<label class="ck"><input type="radio" name="dfOrigen" value="${k}"${k === opc.origen ? ' checked' : ''}> ${o.ico} ${esc(o.nom)}</label>`).join('')}</div>
            <label class="camp">${t('Què li passa')}<select id="dfTipus">${FO.TIPUS_DEFECTE.map(x => `<option value="${esc(x)}">${esc(t(x))}</option>`).join('')}</select></label>
            <label class="camp">${t('Descripció (opcional)')}<textarea id="dfDesc" placeholder="${t('Rosca passada, esquerda al lateral, forats desplaçats…')}"></textarea></label>
            <p class="ajuda">${t('Se\'n demanarà recanvi automàticament (llista de mancants) i Qualitat decidirà què es fa amb la peça dolenta.')}</p>
            <div class="fx"><button class="bt pr" id="dfDesa">${t('Registrar i demanar recanvi')}</button><button class="bt" id="dfTanca">${t('Cancel·lar')}</button></div>`);
        cos.querySelector('#dfTanca').onclick = tancaFull;
        cos.querySelector('#dfDesa').onclick = () => {
            const clau = cos.querySelector('#dfClau').value, e = M.perClau.get(clau);
            const qty = Math.round(FO.num(cos.querySelector('#dfQty').value, 0));
            if (!(qty >= 1 && qty <= e.qty)) return avis(t('Han de ser entre 1 i {n} peces', { n: e.qty }));
            const origen = cos.querySelector('input[name=dfOrigen]:checked').value, tipus = cos.querySelector('#dfTipus').value, descripcio = cos.querySelector('#dfDesc').value.trim();
            const conj = M.pasDe(e) || '', m = e.caixeti.mat;
            if (!fer('defecte', { clau, mat: m.id, conj, qty, origen, tipus, descripcio },
                tc(descripcio ? '💥 {mat} ×{q}: {origen} ({tipus}: {desc}) · es demana recanvi' : '💥 {mat} ×{q}: {origen} ({tipus}) · es demana recanvi',
                    { mat: m.codi, q: qty, origen: { arribada: 'venia defectuosa', muntatge: 'trencada en muntar' }[origen], tipus, desc: descripcio }))) return;
            tancaFull(); so(true);
            avis(t('Registrada. S\'ha demanat recanvi (llista de mancants) i el muntatge pot continuar amb la resta.'), 4500);
            if (opc.despres) opc.despres(); else ruta();
        };
    }
    // «Falta»: el material no ha arribat o no n'hi ha prou. S'hi posa el que hi ha i la resta queda com a mancant.
    function marcaMancant(clau) {
        const e = M.perClau.get(clau), m = e.caixeti.mat, ja = prog.omplert[clau] ? prog.omplert[clau].qty : 0;
        const r = prompt(`${m.codi} · ${m.nom}\n` + t('En calen {n}. Quants n\'has pogut posar a la caixa? (0 si no n\'ha arribat cap)', { n: e.qty }), String(ja));
        if (r === null) return;
        const posats = Math.max(0, Math.min(e.qty, Math.round(FO.num(r, 0))));
        if (posats >= e.qty) { omple(clau, e.qty, true); return; }
        const nota = prompt(t('Nota per a la llista de mancants (proveïdor, data prevista…). Opcional:'), '') || '';
        if (posats > ja) omple(clau, posats, true);
        fer('manca', { clau, mat: m.id, falten: e.qty - posats, nota }, tc(nota ? '❗ Mancant: {mat} · falten {n} de {q} a {caixa} · {nota}' : '❗ Mancant: {mat} · falten {n} de {q} a {caixa}', { mat: m.codi, n: e.qty - posats, q: e.qty, caixa: e.safata, nota }));
        avis(t('Afegit a la llista de mancants. El muntatge pot continuar amb la resta.'), 3500);
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
        $('vista').innerHTML = `${bannerTancada()}<h2>${t('Estoc')}</h2><p class="ajuda">${t('«Cal» és el que encara falta posar a les caixes dels passos pendents. Quan omples una caixa, el material surt de l\'estoc.')}</p>
            <div class="fx" style="margin:8px 0"><button class="bt${nomesFalta ? '' : ' pr'}" data-f="">${t('Tots')}</button><button class="bt${nomesFalta ? ' pr' : ''}" data-f="falta">${t('Només el que falta')}</button></div>
            <input class="cerca" id="eCerca" type="search" placeholder="${t('Cerca…')}">
            <div class="targeta" style="padding:4px 8px"><table class="taula"><tr><th>${t('Material')}</th><th class="n">${t('Cal')}</th><th class="n">${t('Tinc')}</th></tr>
            ${mats.map(m => {
                const n = nec.get(m.id) || 0, tinc = prog.estoc[m.id] || 0;
                return `<tr data-cerca="${esc((m.codi + ' ' + m.nom).toLowerCase())}"><td><span class="sw" style="background:${m.col}"></span> <b>${esc(m.codi)}</b><div class="ajuda">${esc(m.nom)}</div></td>
                    <td class="n ${tinc < n ? 'falta' : ''}">${n}</td>
                    <td>${editable ? `<div class="num-in"><button data-m="${esc(m.id)}" data-d="-1">−</button><input type="number" inputmode="numeric" data-mi="${esc(m.id)}" value="${tinc}"><button data-m="${esc(m.id)}" data-d="1">+</button></div>` : `<div class="n">${tinc}</div>`}</td></tr>`;
            }).join('')}</table></div>`;
        const v = $('vista');
        v.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { location.hash = '#/estoc' + (b.dataset.f ? '/' + b.dataset.f : ''); });
        v.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
            const m = FO.material(P, b.dataset.m), d = +b.dataset.d;
            fer('estoc', { mat: b.dataset.m, delta: d }, tc('Estoc {mat}: {d}', { mat: m ? m.codi : b.dataset.m, d: (d > 0 ? '+' : '') + d })); VISTES.estoc(filtre);
        });
        v.querySelectorAll('[data-mi]').forEach(i => i.onchange = () => {
            const id = i.dataset.mi, m = FO.material(P, id), a = prog.estoc[id] || 0, nou = Math.round(FO.num(i.value, 0));
            if (a !== nou) fer('estocFix', { mat: id, valor: nou }, tc('Estoc {mat}: {a} → {b} (recompte)', { mat: m ? m.codi : id, a, b: nou }));
            VISTES.estoc(filtre);
        });
        $('eCerca').oninput = function () { const f = this.value.toLowerCase(); v.querySelectorAll('tr[data-cerca]').forEach(tr => { tr.style.display = tr.dataset.cerca.includes(f) ? '' : 'none'; }); };
    };

    // ─── Llista de compra (per proveïdor) ───
    function llistaCompra() {
        const nec = necessari(), grups = new Map();
        const urgents = new Set(FO.mancantsOberts(prog).map(x => x.mat));   // els mancants aturen feina: primer
        P.materials.forEach(m => {
            const falta = (nec.get(m.id) || 0) - Math.max(0, prog.estoc[m.id] || 0);
            if (falta <= 0) return;
            const g = m.origen === 'propi' ? t('Fabricació pròpia') : (m.proveidor || t('Sense proveïdor'));
            if (!grups.has(g)) grups.set(g, []);
            grups.get(g).push({ m, falta, urgent: urgents.has(m.id) });
        });
        grups.forEach(l => l.sort((a, b) => b.urgent - a.urgent));
        return grups;
    }
    VISTES.compra = function () {
        const grups = llistaCompra();
        $('vista').innerHTML = `<h2>${t('Llista de compra')}</h2><p class="ajuda">${t('El que falta per omplir les caixes i acabar els passos pendents, descomptant l\'estoc, agrupat per proveïdor.')}</p>
            ${grups.size ? Array.from(grups).map(([g, l]) => `<h3>${esc(g)}</h3><div class="targeta" style="padding:4px 8px"><table class="taula">${l.map(x => `<tr><td><span class="sw" style="background:${x.m.col}"></span> <b>${esc(x.m.codi)}</b>${x.urgent ? ` <span class="xip er">❗ ${t('mancant')}</span>` : ''}<div class="ajuda">${esc(x.m.nom)}</div></td><td class="n falta">${x.falta}</td></tr>`).join('')}</table></div>`).join('')
                + botonsCompartir('c')
                : `<div class="buit">✓ ${t('No falta res.')}</div>`}`;
        if (!grups.size) return;
        let txt = `${t('Llista de compra')} · ${P.nom} · ${ORD.codi} · ${new Date().toLocaleDateString(FO.locale())}\n`;
        grups.forEach((l, g) => { txt += `\n${g}\n` + l.map(x => `  ${x.falta} × ${x.m.codi}  ${x.m.nom}${x.urgent ? '  (' + t('URGENT: mancant') + ')' : ''}`).join('\n') + '\n'; });
        activaCompartir('c', t('Llista de compra'), txt);
        $('cCSV').onclick = () => {
            const files = []; grups.forEach((l, g) => l.forEach(x => files.push([g, x.m.codi, x.m.nom, x.falta, x.urgent ? 'si' : ''])));
            baixa('compra.csv', csv('proveidor;codi;nom;quantitat;urgent', files), 'text/csv');
        };
    };

    // Botons Copiar / Compartir / CSV d'una llista (prefix dels id: c, m, d)
    const botonsCompartir = p => `<div class="fx"><button class="bt" id="${p}Copia">${t('Copiar')}</button>${navigator.share ? `<button class="bt" id="${p}Comparteix">${t('Compartir…')}</button>` : ''}<button class="bt" id="${p}CSV">⬇ CSV</button></div>`;
    function activaCompartir(p, titol, txt) {
        $(p + 'Copia').onclick = async () => { try { await navigator.clipboard.writeText(txt); avis(t('Copiat')); } catch (e) { prompt(t('Copia:'), txt); } };
        if ($(p + 'Comparteix')) $(p + 'Comparteix').onclick = () => navigator.share({ title: titol, text: txt }).catch(() => { });
    }

    // ─── Llista de mancants ───
    // El material que no ha arribat en omplir les caixes, agrupat per material, per enviar-lo a compres.
    // El muntatge no s'atura: els passos es munten amb la resta i es completen quan arriba.
    function llistaMancants() {
        const perMat = new Map();
        FO.mancantsOberts(prog).forEach(x => {
            const e = M.perClau.get(x.clau), m = FO.material(P, x.mat) || { id: x.mat, codi: x.mat, nom: '', col: '#888' };
            const g = perMat.get(m.id) || { m, falten: 0, llocs: [], des: x.ts, notes: new Set() };
            g.falten += x.falten; g.llocs.push({ x, e, caixa: caixaDeClau(x.clau), pas: e ? M.perConj.get(M.pasDe(e)) : null });
            if (x.ts < g.des) g.des = x.ts;
            if (x.nota) g.notes.add(x.nota);
            perMat.set(m.id, g);
        });
        return Array.from(perMat.values()).sort((a, b) => String(a.des).localeCompare(b.des));
    }
    function textMancants(l) {
        return `${t('Llista de mancants')} · ${P.nom} · ${ORD.codi}${ORD.serie ? ' · ' + ORD.serie : ''} · ${new Date().toLocaleDateString(FO.locale())}\n\n` +
            l.map(g => `${g.falten} × ${g.m.codi}  ${g.m.nom}${g.m.proveidor ? '  [' + g.m.proveidor + ']' : ''}\n    ${t('per a:')} ${g.llocs.map(y => (y.pas ? t('pas {n}', { n: y.pas.pas }) + ' ' + y.pas.conj.codi : '') + ' (' + y.x.falten + ')').join(', ')}${g.notes.size ? '\n    ' + t('nota:') + ' ' + Array.from(g.notes).map(tm).join(' · ') : ''}`).join('\n') + '\n';
    }
    VISTES.mancants = function () {
        const l = llistaMancants();
        const resolts = Object.entries(prog.mancants).filter(([, x]) => x.resolt).sort((a, b) => String(b[1].resolt.ts).localeCompare(a[1].resolt.ts)).slice(0, 15);
        const nDef = prog.defectes.length, nPend = FO.defectesPendents(prog).length;
        $('vista').innerHTML = `${bannerTancada()}<h2>${t('Mancants')} · ${esc(ORD.codi)}</h2>
            ${nDef ? `<button class="bt gran" id="mDefectes"><i>💥</i><span>${t('Peces defectuoses: {n}', { n: prog.defectes.reduce((a, d) => a + d.qty, 0) })}<small>${nPend ? t('{n} pendents de decisió de Qualitat', { n: nPend }) : t('totes decidides')} · ${t('devolucions al proveïdor')}</small></span></button>` : ''}
            <p class="ajuda">${t('Material que no ha arribat. <b>El muntatge no s\'atura:</b> els passos es munten amb la resta i queden «muntats amb mancants»; quan arriba el material, el magatzem l\'omple i el muntador ho completa.')}</p>
            ${l.length ? l.map(g => `<div class="targeta"><div class="fx"><span class="sw" style="background:${g.m.col}"></span><b style="flex:1">${esc(g.m.codi)} <span style="font-weight:400">${esc(g.m.nom)}</span></b><span class="xip er">${t('falten {n}', { n: g.falten })}</span></div>
                <div class="ajuda">${t('Des del {data}', { data: esc(data(g.des)) })}${g.m.proveidor ? ' · ' + esc(g.m.proveidor) : ''}${g.notes.size ? ' · ' + esc(Array.from(g.notes).map(tm).join(' · ')) : ''}</div>
                ${g.llocs.map(y => `<div class="fx" style="margin-top:6px"><span style="flex:1;font-size:14px">${y.pas ? `${t('Pas {n}', { n: y.pas.pas })} · ${esc(y.pas.conj.codi)} ${esc(y.pas.conj.nom)}` : ''} · <b>${esc(y.x.clau)}</b> · ${t('{n} de {t}', { n: y.x.falten, t: y.e ? y.e.qty : '?' })}</span>
                    ${y.caixa && pot('omple') ? `<button class="bt" style="width:auto;min-height:36px;margin:0" data-caixa="${esc(y.caixa.id)}">${t('Ha arribat')} ›</button>` : ''}</div>`).join('')}</div>`).join('')
                + botonsCompartir('m')
                : `<div class="buit">✓ ${t('No hi ha cap mancant obert.')}</div>`}
            ${resolts.length ? `<h3>${t('Arribats')}</h3><div class="targeta" style="padding:4px 8px"><table class="taula">${resolts.map(([clau, x]) => { const m = FO.material(P, x.mat); return `<tr><td><b>${esc(m ? m.codi : x.mat)}</b> · ${esc(clau)}<div class="ajuda">${t('faltaven {n}', { n: x.inicial || '' })} · ${t('arribat {data}', { data: esc(data(x.resolt.ts)) })}${x.resolt.op ? ' · ' + esc(x.resolt.op) : ''}</div></td></tr>`; }).join('')}</table></div>` : ''}`;
        $('vista').querySelectorAll('[data-caixa]').forEach(b => b.onclick = () => { location.hash = '#/caixa/' + encodeURIComponent(b.dataset.caixa); });
        if ($('mDefectes')) $('mDefectes').onclick = () => { location.hash = '#/defectes'; };
        if (!l.length) return;
        activaCompartir('m', t('Llista de mancants'), textMancants(l));
        $('mCSV').onclick = () => {
            const files = [];
            l.forEach(g => g.llocs.forEach(y => files.push([g.m.codi, g.m.nom, g.m.proveidor || '', y.x.falten, y.x.clau, y.pas ? y.pas.conj.codi : '', y.x.ts, y.x.nota || ''])));
            baixa(`mancants_${ORD.codi}.csv`, csv('codi;nom;proveidor;falten;caixeti;pas;des_de;nota', files), 'text/csv');
        };
    };

    // ─── Peces defectuoses ───
    // Totes les peces que han arribat malament o s'han trencat, amb la decisió de Qualitat.
    // Les que es retornen formen la llista de devolucions per proveïdor.
    function devolucions() {
        const grups = new Map();
        prog.defectes.filter(d => d.decisio ? d.decisio.tipus === 'retorn' : d.origen === 'arribada').forEach(d => {
            const m = FO.material(P, d.mat) || { codi: d.mat, nom: '', proveidor: '' };
            const g = m.proveidor || t('Sense proveïdor');
            if (!grups.has(g)) grups.set(g, []);
            grups.get(g).push({ d, m });
        });
        return grups;
    }
    VISTES.defectes = function () {
        const l = prog.defectes.slice().sort((a, b) => (!!a.decisio - !!b.decisio) || String(b.ts).localeCompare(a.ts));
        const dev = devolucions(), decideix = pot('decideix') && !prog.tancada;
        const fitxa = d => {
            const m = FO.material(P, d.mat), o = FO.ORIGENS_DEFECTE[d.origen], dc = d.decisio && FO.DECISIONS_DEFECTE[d.decisio.tipus];
            const r = M.perConj.get(d.conj);
            return `<div class="targeta"${d.decisio ? ' style="opacity:.75"' : ''}><div class="fx"><span class="sw" style="background:${m ? m.col : '#888'}"></span><b style="flex:1">${esc(m ? m.codi : d.mat)} <span style="font-weight:400">${esc(m ? m.nom : '')}</span></b><span class="xip er">×${d.qty}</span></div>
                <div style="margin:6px 0">${o.ico} ${esc(o.nom)} · <b>${esc(tm(d.tipus))}</b>${d.descripcio ? ' — ' + esc(d.descripcio) : ''}</div>
                <div class="ajuda">${esc(data(d.ts))}${d.op ? ' · ' + esc(d.op) : ''}${r ? ` · ${t('pas {n}', { n: r.pas })} ${esc(r.conj.codi)}` : ''}${m && m.proveidor ? ' · ' + esc(m.proveidor) : ''}</div>
                ${dc ? `<div class="ajuda" style="margin-top:4px">${dc.ico} <b>${esc(dc.nom)}</b>${d.decisio.nota ? ' · ' + esc(d.decisio.nota) : ''} · ${esc(d.decisio.op)} · ${esc(data(d.decisio.ts))}</div>`
                    : decideix ? `<div class="fx" style="margin-top:6px">${Object.entries(FO.DECISIONS_DEFECTE).map(([k, x]) => `<button class="bt" style="min-width:120px" data-def="${esc(d.id)}" data-dec="${k}">${x.ico} ${esc(x.nom)}</button>`).join('')}</div>`
                    : `<div class="ajuda" style="margin-top:4px">⏳ ${t('Pendent de la decisió de Qualitat')}</div>`}</div>`;
        };
        $('vista').innerHTML = `${bannerTancada()}<h2>${t('Peces defectuoses')} · ${esc(ORD.codi)}</h2>
            <p class="ajuda">${t('Peces que han arribat malament o que s\'han trencat en muntar. De cadascuna ja s\'ha demanat recanvi (llista de mancants); Qualitat decideix què es fa amb la peça dolenta.')}</p>
            ${l.length ? l.map(fitxa).join('') : `<div class="buit">✓ ${t('Cap peça defectuosa.')}</div>`}
            ${dev.size ? `<h3>${t('Devolucions al proveïdor')}</h3>${Array.from(dev).map(([g, x]) => `<div class="targeta"><b>${esc(g)}</b>${x.map(y => `<div class="ajuda">${y.d.qty} × ${esc(y.m.codi)} ${esc(y.m.nom)} · ${esc(tm(y.d.tipus))}${y.d.decisio ? '' : ' (' + t('pendent de decidir') + ')'}</div>`).join('')}</div>`).join('')}
                <div class="fx"><button class="bt" id="dCopia">${t('Copiar')}</button>${navigator.share ? `<button class="bt" id="dComparteix">${t('Compartir…')}</button>` : ''}<button class="bt" id="dCSV">⬇ ${t('CSV de totes')}</button></div>` : l.length ? `<div class="fx"><button class="bt" id="dCSV">⬇ ${t('CSV de totes')}</button></div>` : ''}`;
        $('vista').querySelectorAll('[data-dec]').forEach(b => b.onclick = () => {
            const d = prog.defectes.find(x => x.id === b.dataset.def), m = FO.material(P, d.mat), dc = FO.DECISIONS_DEFECTE[b.dataset.dec];
            const nota = prompt(`${dc.nom}: ${d.qty} × ${m ? m.codi : d.mat}\n` + t('Nota (opcional: núm. de devolució, qui ho repara…):'), '');
            if (nota === null) return;
            const decCa = { retorn: 'retornar al proveïdor', ferralla: 'ferralla', reparar: 'reparar / recuperar', acceptada: 'acceptar tal com està' }[b.dataset.dec];
            if (fer('decideix', { def: d.id, decisio: b.dataset.dec, nota: nota.trim() }, tc(nota.trim() ? '💥 {mat} ×{q}: {decisio} · {nota}' : '💥 {mat} ×{q}: {decisio}', { mat: m ? m.codi : d.mat, q: d.qty, decisio: decCa, nota: nota.trim() }))) VISTES.defectes();
        });
        if (dev.size) {
            let txt = `${t('Devolucions al proveïdor')} · ${P.nom} · ${ORD.codi} · ${new Date().toLocaleDateString(FO.locale())}\n`;
            dev.forEach((x, g) => { txt += `\n${g}\n` + x.map(y => `  ${y.d.qty} × ${y.m.codi}  ${y.m.nom} · ${tm(y.d.tipus)}${y.d.descripcio ? ': ' + y.d.descripcio : ''}`).join('\n') + '\n'; });
            activaCompartir('d', t('Devolucions al proveïdor'), txt);
        }
        if ($('dCSV')) $('dCSV').onclick = () => baixa(`defectes_${ORD.codi}.csv`, csv('data;codi;nom;proveidor;peces;origen;tipus;descripcio;pas;decisio;nota_decisio',
            prog.defectes.map(d => { const m = FO.material(P, d.mat) || {}; return [d.ts, m.codi || d.mat, m.nom || '', m.proveidor || '', d.qty, FO.ORIGENS_DEFECTE[d.origen].nom, tm(d.tipus), d.descripcio, codiConj(d.conj), d.decisio ? FO.DECISIONS_DEFECTE[d.decisio.tipus].nom : '', d.decisio ? d.decisio.nota : '']; })), 'text/csv');
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
        $('vista').innerHTML = `${bannerTancada()}<div class="targeta"><div class="fx"><b style="flex:1">${esc(P.nom)} · ${esc(ORD.codi)}</b><span class="xip ${fets === M.PLA.length ? 'ok' : ''}">${t('{n} / {t} muntats', { n: fets, t: M.PLA.length })}</span></div>
            <div class="barra"><div style="width:${M.PLA.length ? fets / M.PLA.length * 100 : 0}%"></div></div>
            ${seguent ? `<button class="bt pr" style="margin-top:10px" data-anar="${esc(seguent.conj.id)}">${t('Continuar: pas {n}', { n: seguent.pas })} · ${esc(seguent.conj.nom)}</button>` : fets === M.PLA.length && M.PLA.length ? `<p class="ajuda" style="margin-top:8px">🎉 ${t('Tots els passos estan muntats.')}</p>` : ''}</div>
            ${M.PLA.map(r => {
                const e = estatDe(r), falten = r.entrades.filter(x => !prog.fets[x.conj.id]), qui = prog.assignacions[r.conj.id];
                const llista = M.aAgafar(r), n = llista.filter(x => prog.agafat[x.clau]).length;
                return `<div class="targeta pas${prog.fets[r.conj.id] ? ' fet' : ''}${falten.length ? ' bloquejat' : ''}" data-anar="${esc(r.conj.id)}" style="border-left-color:${r.conj.col}">
                    <div class="num">${prog.fets[r.conj.id] ? '✓' : r.pas}</div>
                    <div class="info"><div class="nom">${esc(r.conj.nom)}</div><div class="sub">${esc(r.conj.codi)}${r.multiplicador > 1 ? ` · ×${r.multiplicador}` : ''}${qui ? ` · 👤 ${esc(qui)}${qui === nomPersona() ? ' (' + t('tu') + ')' : ''}` : ''}${falten.length ? ` · ${t('falta')} ${falten.map(f => esc(f.conj.codi)).join(', ')}` : ''}</div>
                    ${llista.length && !prog.fets[r.conj.id] && n ? `<div class="barra"><div style="width:${n / llista.length * 100}%"></div></div>` : ''}</div>${xipEstat(e, FO.ESTATS_PAS)}</div>`;
            }).join('')}`;
        $('vista').querySelectorAll('[data-anar]').forEach(n => n.onclick = () => { location.hash = '#/pas/' + encodeURIComponent(n.dataset.anar); });
    };

    // Fila d'un caixetí a agafar
    function filaCaixeti(e, conjId) {
        const c = e.caixeti, m = c.mat, it = itemDe(conjId, m.id), mc = FO.esMancant(prog, e.clau), fet = !mc && !!prog.agafat[e.clau];
        return `<div class="fila${fet ? ' fet' : ''}${mc ? ' mancant no' : ''}"${mc ? '' : ` data-clau="${esc(e.clau)}"`}>
            <div class="chk">${mc ? '!' : '✓'}</div><span class="sw" style="background:${m.col}"></span>
            <div class="txt"><div class="cd">${esc(m.codi)}${it && it.parell ? `<span class="parell">${fmt(it.parell, 1)} N·m</span>` : ''}${icones(m)}</div>
            <div class="nm">${esc(m.nom)}</div>${it && it.nota ? `<div class="nota">▸ ${esc(it.nota)}</div>` : ''}
            ${mc ? `<div class="nota">❗ ${t('No ha arribat: en falten {n}. Munta la resta.', { n: prog.mancants[e.clau].falten })}</div>` : ''}</div>
            <div class="q">×${c.qty}</div></div>`;
    }
    // Bloc d'una caixa (o contenidor amb les seves caixes) amb els caixetins a agafar
    function blocObjecte(o, conjId, llista) {
        const etq = obj => llista.filter(e => e.safata === obj.id);
        const cap = (obj, tipus) => `<span class="sw" style="background:${obj.color}"></span><span class="fl">${esc(obj.id)}</span><span class="xip">${esc(tipus)}</span>`;
        const nomF = { safata: t('Safata'), caixa: t('Caixa'), contenidor: t('Contenidor') };
        if (o.forma === 'contenidor') {
            const fills = o.caixes.map(q => q.obj).filter(b => etq(b).length);
            if (!fills.length) return '';
            return `<div class="objecte"><div class="t">${cap(o, t('Contenidor') + ' · ' + t('{n} caixes', { n: o.caixes.length }))}</div>` +
                fills.map(b => `<div class="subcaixa"><span class="sw" style="background:${b.color}"></span>${esc(b.id)}${b.bloc ? ' · ' + t('bloc de petits') : ''}</div>` + etq(b).map(e => filaCaixeti(e, conjId)).join('')).join('') + '</div>';
        }
        const files = etq(o);
        if (!files.length) return '';
        return `<div class="objecte"><div class="t">${cap(o, o.tipus === 'muntat' ? t('Guarda') : nomF[o.forma] || '')}</div>${files.map(e => filaCaixeti(e, conjId)).join('')}</div>`;
    }

    VISTES.pas = function (id) {
        const r = M.perConj.get(id);
        if (!r) { location.hash = '#/passos'; return; }
        // els caixetins mancants (el material no ha arribat) no es poden agafar: no compten a la preparació
        const c = r.conj, llista = M.aAgafar(r).filter(e => !FO.esMancant(prog, e.clau)), agafats = llista.filter(e => prog.agafat[e.clau]).length;
        const nMancantsAgafar = M.aAgafar(r).length - llista.length;
        const f = prog.fets[c.id], v = prog.verificacions[c.id], ini = prog.inicis[c.id];
        const falten = r.entrades.filter(e => !prog.fets[e.conj.id]);
        const senseOmplir = FO.usaMagatzem(prog) ? M.aOmplir(r).filter(e => !prog.omplert[e.clau] && !FO.esMancant(prog, e.clau)) : [];
        // Mancants: peces d'aquest pas que no han arribat. No aturen el muntatge.
        const mancantsPas = M.aOmplir(r).filter(e => FO.esMancant(prog, e.clau));
        const pend = f && f.pendents ? f.pendents : [];                       // muntat amb mancants: què falta posar
        const arribats = pend.filter(x => !FO.esMancant(prog, x.clau));        // … i què ja ha arribat
        const subParcials = r.entrades.filter(e => prog.fets[e.conj.id] && (prog.fets[e.conj.id].pendents || []).length);
        const nomPend = x => { const e = M.perClau.get(x.clau); return esc(e ? e.codi : x.mat) + ' ×' + x.qty; };
        const instr = c.instruccions.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        const fetsI = prog.instr[c.id] || [];
        const parells = c.items.filter(i => i.parell > 0).map(i => ({ i, m: FO.material(P, i.mat) })).filter(x => x.m);
        const guarda = r.safates.filter(o => o.tipus === 'muntat');
        const propies = r.safates.filter(o => o.tipus !== 'muntat');
        const perTornar = propies.filter(o => !prog.retornat[o.id]);
        const qui = prog.assignacions[c.id];
        $('vista').innerHTML = `${bannerTancada()}<div class="cap-pas" style="background:${c.col}"><div class="sub">${t('Pas {n} de {t}', { n: r.pas, t: M.PLA.length })}${r.multiplicador > 1 ? ` · ${t('muntar-ne {n}', { n: r.multiplicador })}` : ''}</div><h2>${esc(c.nom)}</h2><div class="sub">${esc(c.codi)} · ${xipEstat(estatDe(r), FO.ESTATS_PAS)}${qui ? ' · 👤 ' + esc(qui) : ''}</div></div>
            ${v && v.resultat === 'ko' && !f ? `<div class="banner er">✗ <b>${t('Rebutjat per Qualitat')}</b> (${esc(v.op)}, ${esc(data(v.ts))}): ${esc(tm(v.motiu))}<br><small>${t('Corregeix-ho i torna a marcar el pas com a muntat.')}</small></div>` : ''}
            ${pend.length ? `<div class="banner er">❗ <b>${t('Muntat amb mancants.')}</b> ${t('Queden per posar:')} ${pend.map(nomPend).join(', ')}.
                ${arribats.length ? `<br>✓ ${t('Ja han arribat:')} ${arribats.map(nomPend).join(', ')}. ${t('Posa-les i prem «Completar».')}` : `<br><small>${t('Quan arribin, el magatzem les posarà a la caixa i aquí es podrà completar.')}</small>`}</div>` : ''}
            ${subParcials.length && !f ? `<div class="banner in">ℹ ${t(subParcials.length === 1 ? '{llista} està muntat amb mancants: pots continuar aquest pas; les peces que falten es posaran després.' : '{llista} estan muntats amb mancants: pots continuar aquest pas; les peces que falten es posaran després.', { llista: subParcials.map(e => esc(e.conj.codi)).join(', ') })}</div>` : ''}
            ${mancantsPas.length && !f ? `<div class="banner wr">❗ <b>${t('Falten peces que no han arribat:')}</b> ${mancantsPas.map(e => esc(e.codi) + ' ×' + prog.mancants[e.clau].falten).join(', ')}.<br><small>${t('Pots muntar la resta: el pas quedarà «muntat amb mancants», no aturarà el conjunt següent i el completaràs quan arribin.')}</small></div>` : ''}
            ${f && !v && !pend.length ? `<div class="banner in">${t('Muntat')} ${esc(data(f.ts))}${f.op ? ' · ' + esc(f.op) : ''} · <b>${t('pendent de verificar')}</b> (${t('Qualitat')}).</div>` : ''}
            ${f && v && v.resultat === 'ok' ? `<div class="banner ok">✓ ${t('Verificat per {nom}', { nom: esc(v.op) })} · ${esc(data(v.ts))}</div>` : ''}
            ${falten.length && !f ? `<div class="banner er"><b>${t('Abans cal muntar:')}</b> ${falten.map(x => `<a href="#/pas/${encodeURIComponent(x.conj.id)}">${esc(x.conj.codi)} ${esc(x.conj.nom)}</a>`).join(', ')}</div>` : ''}
            ${senseOmplir.length && !f ? `<div class="banner wr">📦 ${t('El magatzem encara no ha omplert {n} caixetí(ns) d\'aquest pas:', { n: senseOmplir.length })} ${senseOmplir.slice(0, 6).map(e => esc(e.codi)).join(', ')}${senseOmplir.length > 6 ? '…' : ''}</div>` : ''}
            <div class="dues"><div>
            <h3>1 · ${t('Preparació: agafa les caixes')} (${agafats}/${llista.length}${nMancantsAgafar ? ` · ❗ ${t('{n} no ha(n) arribat', { n: nMancantsAgafar })}` : ''})</h3>
            <div class="fx"><button class="bt pr" id="pEsc">⌖ ${t('Escanejar etiquetes')}</button><button class="bt" id="pTots">${agafats === llista.length && llista.length ? t('Desmarcar tot') : t('Marcar-ho tot')}</button></div>
            ${M.objectesPas(r).map(o => blocObjecte(o, c.id, M.aAgafar(r))).join('') || `<p class="ajuda">${t('Aquest pas no té caixes pròpies.')}</p>`}
            ${r.fora.length ? `<div class="targeta"><b>${t('Preparar a part')}</b> (${t('no cap a cap caixa')}): ${r.fora.map(x => esc(x.mat.codi) + ' ×' + x.qty).join(', ')}</div>` : ''}
            </div><div>
            <h3>2 · ${t('Muntatge')}</h3>
            ${!ini && !f ? `<button class="bt pr" id="pInicia"${falten.length ? ' disabled' : ''}>▶ ${t('Començar el pas')}</button>` : ini && !f ? `<p class="ajuda">${t('Començat')} ${esc(data(ini.ts))}${ini.op ? ' · ' + esc(ini.op) : ''}</p>` : ''}
            ${c.eines ? `<div class="targeta"><b>🔧 ${t('Eines:')}</b> ${esc(c.eines)}</div>` : ''}
            ${c.imatge ? `<img class="imatge" src="${esc(c.imatge)}" alt="${t('Resultat esperat')}">` : ''}
            ${instr.length ? `<div class="objecte">${instr.map((x, i) => `<div class="fila${fetsI[i] ? ' fet' : ''}" data-instr="${i}"><div class="chk">✓</div><div class="txt"><div class="nm"><b>${i + 1}.</b> ${esc(x)}</div></div></div>`).join('')}</div>` : `<p class="ajuda">${t('Sense instruccions: es poden afegir a la fitxa del conjunt a l\'app de l\'ordinador.')}</p>`}
            ${parells.length ? `<h3>${t('Parells de collada')}</h3><div class="targeta"><table class="taula"><tr><th>${t('Element')}</th><th class="n">N·m</th></tr>${parells.map(x => `<tr><td><b>${esc(x.m.codi)}</b> ${esc(x.m.nom)}${x.i.nota ? `<div class="ajuda">${esc(x.i.nota)}</div>` : ''}</td><td class="n"><b>${fmt(x.i.parell, 1)}</b></td></tr>`).join('')}</table></div>` : ''}
            ${c.notes ? `<div class="targeta"><b>${t('Notes:')}</b> ${esc(c.notes)}</div>` : ''}
            <h3>${t('Fotos')}</h3><div class="fx"><button class="bt" id="pFoto">📷 ${t('Fer una foto')}</button><button class="bt" id="pInc">⚠ ${t('Incidència')}</button></div>
            ${M.aOmplir(r).length && !prog.tancada ? `<button class="bt" id="pDefecte">💥 ${t('Peça trencada o defectuosa')}</button>` : ''}<div class="fotos" id="pFotos"></div>
            <h3>3 · ${t('Final')}</h3>
            ${guarda.length ? `<div class="targeta">${r.multiplicador > 1 ? t('Guarda les {n} unitats a:', { n: r.multiplicador }) : t('Guarda el conjunt a:')} <b>${guarda.map(o => esc(o.id)).join(', ')}</b></div>` : ''}
            ${pend.length ? `<button class="bt ok" id="pCompleta"${arribats.length ? '' : ' disabled'}>✓ ${t('Completar: he posat les peces que han arribat')}${arribats.length ? ` (${arribats.length})` : ''}</button>
                <button class="bt" id="pCompletaTot">${t('Completar-ho tot (he trobat les peces)')}</button>` : ''}
            ${f ? (v && v.resultat === 'ok' ? '' : `<button class="bt" id="pDesfer">${t('Desfer «muntat»')}</button>`) : `<button class="bt ok" id="pFet"${falten.length ? ' disabled' : ''}>${mancantsPas.length ? `✓ ${t('Muntar sense les peces que falten ({n})', { n: mancantsPas.length })}` : `✓ ${t('Marcar el pas com a muntat')}`}</button>`}
            ${f && perTornar.length ? `<button class="bt" id="pTorna">↩ ${t('Tornar les caixes buides al magatzem ({n})', { n: perTornar.length })}</button>` : ''}
            </div></div>`;
        const vi = $('vista');
        vi.querySelectorAll('[data-clau]').forEach(n => n.onclick = () => { commutaAgafat(n.dataset.clau); VISTES.pas(id); });
        vi.querySelectorAll('[data-instr]').forEach(n => n.onclick = () => {
            const i = +n.dataset.instr, val = !((prog.instr[c.id] || [])[i]);
            iniciaSiCal(r);
            if (fer('instr', { conj: c.id, i, v: val }, tc(val ? '{conj}: instrucció {n} feta' : '{conj}: instrucció {n} desmarcada', { conj: c.codi, n: i + 1 }))) n.classList.toggle('fet', val);
        });
        $('pEsc').onclick = () => obreEscaner();
        $('pTots').onclick = () => {
            const tots = agafats === llista.length;
            if (!tots) iniciaSiCal(r);
            llista.forEach((x, i) => { if (!!prog.agafat[x.clau] !== !tots) fer('agafa', { clau: x.clau, v: !tots }, i ? '' : tc(tots ? '{conj}: desmarcat tot' : '{conj}: tot agafat', { conj: c.codi })); });
            VISTES.pas(id);
        };
        if ($('pInicia')) $('pInicia').onclick = () => { iniciaSiCal(r); VISTES.pas(id); };
        $('pFoto').onclick = () => { $('fFoto').dataset.pas = c.id; $('fFoto').click(); };
        $('pInc').onclick = () => { obreIncidencia(c.id); };
        if ($('pDefecte')) $('pDefecte').onclick = () => formDefecte({ claus: M.aOmplir(r).map(e => e.clau), origen: 'muntatge', despres: () => VISTES.pas(id) });
        if ($('pFet')) $('pFet').onclick = () => marcaFet(r, agafats, llista.length, mancantsPas);
        const completa = (claus, text) => { if (fer('completa', { conj: c.id, claus }, text)) { so(true); avis(claus ? t('Peces posades') : t('Pas complet ✓ · ara el verificarà Qualitat')); VISTES.pas(id); } };
        if ($('pCompleta')) $('pCompleta').onclick = () => {
            const claus = arribats.map(x => x.clau), tot = claus.length === pend.length;
            completa(tot ? null : claus, tc(tot ? 'Pas {n} · {conj}: posades les peces que faltaven ({llista}) · pas complet' : 'Pas {n} · {conj}: posades les peces que faltaven ({llista})', { n: r.pas, conj: c.codi, llista: arribats.map(x => { const e = M.perClau.get(x.clau); return (e ? e.codi : x.mat) + ' ×' + x.qty; }).join(', ') }));
        };
        if ($('pCompletaTot')) $('pCompletaTot').onclick = () => {
            if (confirm(t('Marcar el pas com a complet? Fes-ho només si ja hi has posat totes les peces que faltaven.'))) completa(null, tc('Pas {n} · {conj}: completat (peces trobades)', { n: r.pas, conj: c.codi }));
        };
        if ($('pDesfer')) $('pDesfer').onclick = () => { if (fer('desfet', { conj: c.id }, tc('Pas {n} · {conj}: desfet', { n: r.pas, conj: c.codi }))) VISTES.pas(id); };
        if ($('pTorna')) $('pTorna').onclick = () => { perTornar.forEach(o => fer('retorna', { obj: o.id }, tc('{caixa}: caixa tornada al magatzem', { caixa: o.id }))); avis(t('Caixes tornades')); VISTES.pas(id); };
        pintaFotos(c.id);
    };
    // El primer cop que es toca un pas, es marca l'inici (per mesurar el temps de muntatge)
    function iniciaSiCal(r) {
        if (!prog.inicis[r.conj.id] && !prog.fets[r.conj.id] && pot('inicia')) fer('inicia', { conj: r.conj.id }, tc('Pas {n} · {conj}: començat', { n: r.pas, conj: r.conj.codi }));
    }
    function commutaAgafat(clau) {
        const e = M.perClau.get(clau), v = !prog.agafat[clau], pas = M.pasDe(e);
        if (v && pas) iniciaSiCal(M.perConj.get(pas));
        fer('agafa', { clau, v }, v ? tc('{mat} ×{q}: agafat ({caixa})', { mat: e.codi, q: e.qty, caixa: e.safata }) : tc('{mat}: desmarcat', { mat: e.codi }));
    }
    function marcaFet(r, agafats, total, mancantsPas) {
        mancantsPas = mancantsPas || [];
        // amb mancants: es munta la resta i el pas queda «muntat amb mancants», sense aturar el conjunt següent
        const pendents = mancantsPas.map(e => ({ clau: e.clau, mat: e.caixeti.mat.id, qty: prog.mancants[e.clau].falten }));
        if (pendents.length && !confirm(t('Falten {llista}.', { llista: pendents.map(x => M.perClau.get(x.clau).codi + ' ×' + x.qty).join(', ') }) + '\n' + t('Muntar el pas sense aquestes peces? Quedarà «muntat amb mancants» i el completaràs quan arribin.'))) return;
        else if (!pendents.length && agafats < total && !confirm(t('Només hi ha {n} de {t} caixetins marcats com a agafats. Marcar igualment el pas com a muntat?', { n: agafats, t: total }))) return;
        // Consum d'estoc: només el material que NO ha passat pel magatzem (el de les caixes ja va sortir en omplir-les)
        const consum = {};
        if (pref.consumAuto) r.conj.items.forEach(it => {
            const posat = M.aOmplir(r).filter(e => e.caixeti.mat.id === it.mat).reduce((a, e) => a + (prog.omplert[e.clau] ? prog.omplert[e.clau].qty : 0), 0);
            const falta = pendents.filter(x => x.mat === it.mat).reduce((a, x) => a + x.qty, 0);   // el que no s'hi ha posat no es consumeix
            const q = Math.min(Math.max(0, prog.estoc[it.mat] || 0), Math.max(0, it.qty * r.multiplicador - posat - falta));
            if (q > 0) consum[it.mat] = q;
        });
        iniciaSiCal(r);
        const vt = { n: r.pas, conj: r.conj.codi + ' ' + r.conj.nom + (r.multiplicador > 1 ? ' (×' + r.multiplicador + ')' : ''), llista: pendents.map(x => M.perClau.get(x.clau).codi + ' ×' + x.qty).join(', ') };
        const text = pendents.length ? tc('Pas {n} · {conj} muntat amb mancants: falten {llista}', vt) : tc('Pas {n} · {conj} muntat', vt);
        if (!fer('fet', { conj: r.conj.id, consum, pendents }, text)) return;
        so(true); avis(pendents.length ? t('Muntat amb mancants: el conjunt següent ja pot continuar') : t('Pas muntat ✓ · ara el verificarà Qualitat'), 3500);
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
                <div class="info"><div class="nom">${esc(r.conj.nom)}</div><div class="sub">${esc(r.conj.codi)}${f ? ` · ${t('muntat per {nom}', { nom: esc(f.op || '?') })} ${esc(data(f.ts))}` : ''}${v && v.resultat === 'ko' ? ` · ${esc(tm(v.motiu))}` : ''}${meu ? ' · ⚠ ' + t('l\'has muntat tu') : ''}</div></div>
                ${xipEstat(estatDe(r), FO.ESTATS_PAS)}</div>`;
        }).join('') : `<p class="ajuda">${buit}</p>`);
        const est = r => estatDe(r);
        $('vista').innerHTML = bannerTancada() +
            grup(t('Per verificar'), M.PLA.filter(r => est(r) === 'muntat'), t('Cap pas espera verificació.')) +
            grup(t('Muntats amb mancants (encara no es poden aprovar)'), M.PLA.filter(r => est(r) === 'parcial'), t('Cap.')) +
            grup(t('Rebutjats, pendents de refer'), M.PLA.filter(r => est(r) === 'rebutjat'), t('Cap.')) +
            grup(t('Verificats'), M.PLA.filter(r => est(r) === 'verificat'), t('Encara cap.'));
        $('vista').querySelectorAll('[data-anar]').forEach(n => n.onclick = () => { location.hash = '#/verif/' + encodeURIComponent(n.dataset.anar); });
    };
    // Llista de comprovació d'un pas: cada instrucció, cada parell de collada i dues comprovacions generals
    function comprovacions(r) {
        const c = r.conj, l = [];
        c.instruccions.split(/\r?\n/).map(x => x.trim()).filter(Boolean).forEach((x, i) => l.push(t('Instrucció {n}: {text}', { n: i + 1, text: x })));
        c.items.filter(i => i.parell > 0).forEach(i => { const m = FO.material(P, i.mat); if (m) l.push(t('Parell de {mat}: {nm} N·m', { mat: m.codi + ' ' + m.nom, nm: fmt(i.parell, 1) })); });
        const n = c.items.reduce((a, i) => a + i.qty * r.multiplicador, 0);
        l.push(r.entrades.length ? t('Hi són totes les peces ({n} elements i {s} subconjunts)', { n, s: r.entrades.length }) : t('Hi són totes les peces ({n} elements)', { n }));
        l.push(t('Sense danys, restes ni peces soltes; zona neta'));
        return l;
    }
    VISTES.verif = function (id) {
        const r = M.perConj.get(id);
        if (!r) { location.hash = '#/verificar'; return; }
        const c = r.conj, f = prog.fets[id], v = prog.verificacions[id], ini = prog.inicis[id];
        const llista = comprovacions(r), marcats = verifChecks[id] || (verifChecks[id] = new Set());
        const meu = f && f.op && f.op === nomPersona() && !esResponsable();
        const pend = f && f.pendents ? f.pendents : [];   // muntat amb mancants: no es pot aprovar
        const rebutjos = prog.historial.filter(h => h.conj === id);
        $('vista').innerHTML = `${bannerTancada()}<div class="cap-pas" style="background:${c.col}"><div class="sub">${t('Verificació')} · ${t('pas {n}', { n: r.pas })}</div><h2>${esc(c.nom)}</h2><div class="sub">${esc(c.codi)} · ${xipEstat(estatDe(r), FO.ESTATS_PAS)}</div></div>
            ${!f ? `<div class="banner wr">${t('Aquest pas encara no està muntat')}${v && v.resultat === 'ko' ? ` (${t('rebutjat:')} ${esc(tm(v.motiu))})` : ''}.</div>` : `<div class="targeta">${t('Muntat per <b>{nom}</b>', { nom: esc(f.op || '?') })} · ${esc(data(f.ts))}${ini ? ` · ${t('durada')} ${FO.textDurada(new Date(f.ts) - new Date(ini.ts))}` : ''}</div>`}
            ${meu ? `<div class="banner er">⚠ ${t('Aquest pas l\'has muntat tu: l\'ha de verificar una altra persona (regla dels quatre ulls).')}</div>` : ''}
            ${v && v.resultat === 'ok' && f ? `<div class="banner ok">✓ ${t('Verificat per {nom}', { nom: esc(v.op) })} · ${esc(data(v.ts))}</div>` : ''}
            ${rebutjos.length ? `<div class="targeta"><b>${t('Rebutjos anteriors:')}</b>${rebutjos.map(h => `<div class="ajuda">${esc(data(h.ts))} · ${esc(h.op)}: ${esc(tm(h.motiu))}</div>`).join('')}</div>` : ''}
            ${c.imatge ? `<img class="imatge" src="${esc(c.imatge)}" alt="${t('Resultat esperat')}">` : ''}
            <h3>${t('Llista de comprovació')} (${marcats.size}/${llista.length})</h3>
            <div class="objecte">${llista.map((x, i) => `<div class="fila${marcats.has(i) ? ' fet' : ''}" data-chk="${i}"><div class="chk">✓</div><div class="txt"><div class="nm">${esc(x)}</div></div></div>`).join('')}</div>
            <h3>${t('Fotos')}</h3><div class="fx"><button class="bt" id="vFoto">📷 ${t('Fer una foto')}</button><button class="bt" id="vInc">⚠ ${t('Incidència')}</button></div>
            ${M.aOmplir(r).length && !prog.tancada ? `<button class="bt" id="vDefecte">💥 ${t('Peça defectuosa')}</button>` : ''}<div class="fotos" id="pFotos"></div>
            ${f && !(v && v.resultat === 'ok') ? `<h3>${t('Resultat')}</h3>
            ${pend.length ? `<div class="banner er">❗ ${t('Muntat amb mancants: hi falten {llista}. Es podrà aprovar quan el muntador ho completi.', { llista: pend.map(x => { const e = M.perClau.get(x.clau); return esc(e ? e.codi : x.mat) + ' ×' + x.qty; }).join(', ') })}</div>` : ''}
            <button class="bt ok" id="vOk"${marcats.size < llista.length || meu || pend.length ? ' disabled' : ''}>✓ ${t('Aprovar')}${pend.length ? ' (' + t('hi falten peces') + ')' : marcats.size < llista.length ? ` (${t('falten {n} comprovacions', { n: llista.length - marcats.size })})` : ''}</button>
            <label class="camp">${t('Motiu del rebuig')}<textarea id="vMotiu" placeholder="${t('Què s\'ha de corregir?')}"></textarea></label>
            <button class="bt perill" id="vKo"${meu ? ' disabled' : ''}>✗ ${t('Rebutjar i tornar-lo al muntador')}</button>` : ''}`;
        $('vista').querySelectorAll('[data-chk]').forEach(n => n.onclick = () => {
            const i = +n.dataset.chk;
            if (marcats.has(i)) marcats.delete(i); else marcats.add(i);
            VISTES.verif(id);
        });
        $('vFoto').onclick = () => { $('fFoto').dataset.pas = id; $('fFoto').click(); };
        $('vInc').onclick = () => { obreIncidencia(id); };
        if ($('vDefecte')) $('vDefecte').onclick = () => formDefecte({ claus: M.aOmplir(r).map(e => e.clau), origen: 'muntatge', despres: () => VISTES.verif(id) });
        if ($('vOk')) $('vOk').onclick = () => {
            if (!fer('verifica', { conj: id, resultat: 'ok', checks: Array.from(marcats) }, tc('Pas {n} · {conj}: verificat ✓', { n: r.pas, conj: c.codi }))) return;
            delete verifChecks[id]; so(true); avis(t('Pas verificat ✓'));
            location.hash = '#/verificar';
        };
        if ($('vKo')) $('vKo').onclick = () => {
            const motiu = $('vMotiu').value.trim();
            if (!motiu) { so(false); avis(t('Escriu el motiu del rebuig')); $('vMotiu').focus(); return; }
            if (!fer('verifica', { conj: id, resultat: 'ko', motiu, checks: Array.from(marcats) }, tc('Pas {n} · {conj}: rebutjat · {motiu}', { n: r.pas, conj: c.codi, motiu }))) return;
            delete verifChecks[id]; avis(t('Pas rebutjat: torna al muntador'));
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
        $('vista').innerHTML = `${bannerTancada()}<h2>${t('Incidències')}</h2>
            <button class="bt pr" id="iNova"${pot('incidencia') ? '' : ' disabled'}>⚠ ${t('Nova incidència')}</button><div id="iForm"></div>
            ${l.length ? l.map(i => `<div class="targeta"${i.resolta ? ' style="opacity:.65"' : ''}>
                <div class="fx"><span class="estat" style="background:${GRAVETATS[i.gravetat] || '#888'}">${esc(t(i.gravetat))}</span><b style="flex:1">${i.conj ? esc(codiConj(i.conj)) : t('General')}${i.clau ? ' · ' + esc(i.clau) : ''}</b>${i.resolta ? `<span class="xip ok">${t('Resolta')}</span>` : ''}</div>
                <p style="margin:6px 0">${esc(tm(i.text))}</p><div class="ajuda">${esc(data(i.ts))}${i.op ? ' · ' + esc(i.op) : ''}</div>
                ${i.resolta ? `<div class="ajuda">✓ ${esc(tm(i.resolta.text))} · ${esc(i.resolta.op)} · ${esc(data(i.resolta.ts))}</div>` : pot('resol') ? `<button class="bt" data-resol="${esc(i.id)}">${t('Marcar com a resolta')}</button>` : ''}</div>`).join('')
                : `<div class="buit">${t('Cap incidència.')} 👍</div>`}`;
        $('iNova').onclick = () => obreFormIncidencia(pasActual || '');
        $('vista').querySelectorAll('[data-resol]').forEach(b => b.onclick = () => {
            const s = prompt(t('Com s\'ha resolt?'));
            if (s === null) return;
            if (fer('resol', { inc: b.dataset.resol, solucio: s.trim() }, tc('Incidència resolta: {text}', { text: s.trim() }))) VISTES.incidencies();
        });
        if (formPendent) { obreFormIncidencia(formPendent.conj, formPendent.clau); formPendent = null; }
    };
    // Des d'una altra pantalla: va a Incidències amb el formulari obert per a aquell pas
    let formPendent = null;
    function obreIncidencia(conj, clau) { formPendent = { conj, clau }; location.hash = '#/incidencies'; }
    function obreFormIncidencia(conj, clau) {
        const f = $('iForm'); if (!f) return;
        f.innerHTML = `<div class="targeta"><label class="camp">${t('Pas')}<select id="iPas"><option value="">${t('General')}</option>${M.PLA.map(r => `<option value="${esc(r.conj.id)}"${r.conj.id === conj ? ' selected' : ''}>${r.pas} · ${esc(r.conj.codi)} ${esc(r.conj.nom)}</option>`).join('')}</select></label>
            <label class="camp">${t('Què passa?')}<textarea id="iText" placeholder="${t('Peça defectuosa, falta material, plànol confús…')}"></textarea></label>
            <label class="camp">${t('Gravetat')}<select id="iGrav"><option value="baixa">${t('Baixa')}</option><option value="mitjana" selected>${t('Mitjana')}</option><option value="alta">${t('Alta (atura el muntatge)')}</option></select></label>
            <div class="fx"><button class="bt pr" id="iDesa">${t('Desar')}</button><button class="bt" id="iCancel">${t('Cancel·lar')}</button></div></div>`;
        $('iText').focus();
        $('iCancel').onclick = () => { f.innerHTML = ''; };
        $('iDesa').onclick = () => {
            const text = $('iText').value.trim();
            if (!text) return avis(t('Descriu la incidència'));
            const c = $('iPas').value;
            if (fer('incidencia', { conj: c, clau: clau || '', textInc: text, gravetat: $('iGrav').value }, c ? tc('Incidència a {conj}: {text}', { conj: codiConj(c), text }) : tc('Incidència: {text}', { text }))) { avis(t('Incidència registrada')); VISTES.incidencies(); }
        };
    }

    // ─── Registre de traçabilitat ───
    VISTES.registre = function () {
        const r = prog.registre.slice().sort((a, b) => String(b.ts).localeCompare(a.ts));   // per hora real, encara que s'hagi sincronitzat tard
        $('vista').innerHTML = `<h2>${t('Registre')} · ${esc(ORD.codi)}</h2><div class="fx"><button class="bt" id="rCSV">⬇ ${t('Exportar CSV')}</button></div>
            ${r.length ? `<div class="targeta" style="padding:4px 8px"><table class="taula">${r.slice(0, 400).map(x => `<tr><td style="white-space:nowrap;font-size:12px">${esc(data(x.ts))}${x.op ? '<br>' + esc(x.op) : ''}${x.rol && FO.ROLS[x.rol] ? ' ' + FO.ROLS[x.rol].ico : ''}</td><td>${esc(tm(x.text))}</td></tr>`).join('')}</table></div>` : `<div class="buit">${t('Encara no hi ha res.')}</div>`}`;
        $('rCSV').onclick = () => baixa(`registre_${FO.nomFitxer(P.nom)}_${ORD.codi}.csv`, csv('data;persona;rol;tipus;text', prog.registre.map(x => [x.ts, x.op, x.rol || '', x.tipus, tm(x.text)])), 'text/csv');
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
        const plenes = cx.filter(x => !['buida', 'parcial', 'mancant'].includes(x.estat)).length;
        // per assignar: al servidor, les persones amb rol de muntador; sol, text lliure
        const muntadors = (personesSrv || []).filter(x => x.rols.includes('muntador') || x.rols.includes('responsable')).map(x => x.nom);
        $('vista').innerHTML = `${bannerTancada()}<div class="kpi">
                <div>${t('Verificats')}<b>${res.verificats} / ${res.total}</b></div><div>${t('En curs')}<b>${res.enCurs}</b></div>
                <div>${t('Per verificar')}<b>${res.muntats}</b></div><div>${t('Rebutjats')}<b>${res.rebutjats}</b></div>
                <div>${t('Caixes plenes')}<b>${plenes} / ${cx.length}</b></div><div>${t('Incidències obertes')}<b>${res.incidenciesObertes}</b></div>
                <div>${t('Mancants oberts')}<b>${res.mancantsOberts}</b></div><div>${t('Muntats amb mancants')}<b>${res.parcials}</b></div>
                <div>${t('Peces defectuoses')}<b>${res.pecesDefectuoses}</b></div><div>${t('Defectes per decidir')}<b>${res.defectesPendents}</b></div></div>
            <div class="barra"><div style="width:${res.total ? res.verificats / res.total * 100 : 0}%"></div></div>
            <div class="fx" style="margin-top:8px">${srv.url ? `<button class="bt" id="tPers">👥 ${t('Persones')}</button>` : ''}<button class="bt" id="tRes">📊 ${t('Resultats')}</button><button class="bt" id="tDef">💥 ${t('Defectes')}${res.defectesPendents ? ` (${res.defectesPendents})` : ''}</button></div>
            ${prog.tancada ? `<button class="bt" id="tReobre">🔓 ${t('Reobrir l\'ordre')}</button>` : `<button class="bt${res.acabada ? ' ok' : ''}" id="tTanca">🔒 ${t('Tancar l\'ordre')}${res.acabada ? '' : ' (' + t('encara no està acabada') + ')'}</button>`}
            <h3>${t('Passos')}</h3>
            ${res.passos.map(x => `<div class="targeta"><div class="fx"><b style="flex:1"><a href="#/pas/${encodeURIComponent(x.id)}">${x.pas} · ${esc(x.codi)}</a> ${esc(x.nom)}</b>${xipEstat(x.estat, FO.ESTATS_PAS)}</div>
                <div class="ajuda">${x.muntador ? '🔧 ' + esc(x.muntador) + (x.durada ? ' · ' + FO.textDurada(x.durada) : '') : ''}${x.verificador ? ' · ✅ ' + esc(x.verificador) : ''}${x.rebutjos.length ? ` · ✗ ${t('{n} rebuig(s)', { n: x.rebutjos.length })}` : ''}${x.incidencies ? ` · ⚠ ${x.incidencies}` : ''}</div>
                <label class="camp" style="margin:6px 0 0">${t('Assignat a')}${muntadors.length
                    ? `<select data-assigna="${esc(x.id)}"><option value="">—</option>${muntadors.map(n => `<option${n === x.assignat ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`
                    : `<input data-assigna="${esc(x.id)}" value="${esc(x.assignat)}" placeholder="${t('Nom de la persona')}">`}</label></div>`).join('')}`;
        $('vista').querySelectorAll('[data-assigna]').forEach(i => i.onchange = () => {
            const persona = i.value.trim(), r = M.perConj.get(i.dataset.assigna);
            fer('assigna', { conj: i.dataset.assigna, persona }, persona ? tc('{conj} assignat a {persona}', { conj: r.conj.codi, persona }) : tc('{conj}: sense assignar', { conj: r.conj.codi }));
        });
        if ($('tPers')) $('tPers').onclick = () => { location.hash = '#/persones'; };
        $('tRes').onclick = () => { location.hash = '#/resultats'; };
        $('tDef').onclick = () => { location.hash = '#/defectes'; };
        if ($('tTanca')) $('tTanca').onclick = () => {
            if (!res.acabada && !confirm(t('Només hi ha {n} de {t} passos verificats. Tancar igualment l\'ordre?', { n: res.verificats, t: res.total }))) return;
            if (res.incidenciesObertes && !confirm(t('Hi ha {n} incidències obertes. Tancar igualment?', { n: res.incidenciesObertes }))) return;
            if (res.mancantsOberts && !confirm(t('Hi ha {n} mancants oberts (material que no ha arribat). Tancar igualment?', { n: res.mancantsOberts }))) return;
            if (res.defectesPendents && !confirm(t('Hi ha {n} peces defectuoses sense decidir què se\'n fa. Tancar igualment?', { n: res.defectesPendents }))) return;
            if (fer('tanca', {}, tc('Ordre {codi} tancada', { codi: ORD.codi }))) { avis(t('Ordre tancada')); ruta(); }
        };
        if ($('tReobre')) $('tReobre').onclick = () => { if (confirm(t('Reobrir l\'ordre?')) && fer('reobre', {}, tc('Ordre {codi} reoberta', { codi: ORD.codi }))) ruta(); };
        if (srv.url && !personesSrv) carregaPersones().then(() => { if (location.hash.startsWith('#/tauler') || location.hash.replace(/^#\/?/, '') === '') refresca(); });
    };

    // ─── Ordres de fabricació ───
    VISTES.ordres = function () {
        // estat de cada ordre: del servidor (resum) o del progrés desat en aquest aparell
        const info = o => {
            const s = srv.projectes && (srv.projectes.find(x => x.id === P.id) || { ordres: [] }).ordres.find(x => x.id === o.id);
            if (s) return t('{n} / {t} muntats', { n: s.passosFets, t: M.PLA.length }) + (s.tancada ? ' · 🔒 ' + t('tancada') : '');
            const p = o.id === ORD.id ? prog : llegeix(`fordre.muntatge.progres.${P.id}.${o.id}`);
            if (!p) return t('sense començar');
            return FO.textEstatOrdre(FO.resumOrdre(M, p));
        };
        const potCrear = esResponsable() && (!srv.url || enXarxa());
        $('vista').innerHTML = `<h2>${t('Ordres de fabricació')}</h2>
            <p class="ajuda">${t('Cada unitat que es fabrica és una ordre, amb el seu progrés, registre i informe. El projecte fa de plantilla: es pot fabricar tantes vegades com calgui.')}</p>
            ${ORDRES.slice().reverse().map(o => `<button class="bt gran${o.id === ORD.id ? ' pr' : ''}" data-ordre="${esc(o.id)}"><i>🏭</i><span>${esc(o.codi)}${o.serie ? ' · ' + esc(o.serie) : ''}<small>${esc(info(o))} · ${esc(data(o.creada))}${o.notes ? ' · ' + esc(o.notes) : ''}</small></span></button>`).join('')}
            ${potCrear ? `<h3>${t('Nova ordre')}</h3><div class="targeta">
                <label class="camp">${t('Codi')}<input id="oCodi" placeholder="${esc(FO.codiOrdreSeguent(ORDRES))}"></label>
                <label class="camp">${t('Número de sèrie (opcional)')}<input id="oSerie"></label>
                <label class="camp">${t('Notes (client, comanda…)')}<input id="oNotes"></label>
                <button class="bt pr" id="oCrea">+ ${t('Crear l\'ordre i començar-hi')}</button></div>` : ''}`;
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
        $('vista').innerHTML = `<h2>${t('Resultats')} · ${esc(ORD.codi)}</h2>
            <div class="kpi"><div>${t('Estat')}<b style="font-size:16px">${esc(FO.textEstatOrdre(res))}</b></div><div>${t('Verificats')}<b>${res.verificats} / ${res.total}</b></div>
                <div>${t('Bé a la primera')}<b>${pct(res.primeraPassada)}</b></div><div>${t('Rebutjos')}<b>${res.rebutjos}</b></div>
                <div>${t('Temps de muntatge')}<b style="font-size:16px">${FO.textDurada(res.tempsMuntatge)}</b></div><div>${t('Incidències obertes')}<b>${res.incidenciesObertes}</b></div></div>
            <div class="fx"><button class="bt pr" id="rInf">📄 ${t('Informe complet (imprimir / PDF)')}</button><button class="bt" id="rDesa">⬇ ${t('Desar l\'informe')}</button></div>
            <div class="fx"><button class="bt" id="rReg">🕘 ${t('Registre')}</button><button class="bt" id="rCSV">⬇ ${t('Registre CSV')}</button></div>
            ${res.persones.length ? `<h3>${t('Persones')}</h3><div class="targeta" style="padding:4px 8px"><table class="taula"><tr><th>${t('Persona')}</th><th class="n">${t('Omplerts')}</th><th class="n">${t('Muntats')}</th><th class="n">${t('Verificats')}</th><th class="n">${t('Rebutjats')}</th></tr>
                ${res.persones.map(q => `<tr><td>${esc(q.nom)}</td><td class="n">${q.omplerts || ''}</td><td class="n">${q.muntats || ''}</td><td class="n">${q.verificats || ''}</td><td class="n">${q.rebutjats || ''}</td></tr>`).join('')}</table></div>` : ''}
            ${prog.historial.length ? `<h3>${t('Rebutjos')}</h3>${prog.historial.map(h => `<div class="targeta"><b>${esc(codiConj(h.conj))}</b> · ${esc(tm(h.motiu))}<div class="ajuda">${esc(data(h.ts))} · ${esc(h.op)}${h.muntador ? ' · ' + t('muntat per {nom}', { nom: esc(h.muntador) }) : ''}</div></div>`).join('')}` : ''}`;
        const html = () => FO.informeHTML(M, prog, ORD, { empremtaActual: srv.projectes && (srv.projectes.find(x => x.id === P.id) || {}).empremta });
        $('rInf').onclick = () => {
            const url = URL.createObjectURL(new Blob([html()], { type: 'text/html' }));
            if (!G.open(url, '_blank')) baixa(`informe_${ORD.codi}.html`, html(), 'text/html');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        };
        $('rDesa').onclick = () => baixa(`informe_${FO.nomFitxer(P.nom)}_${ORD.codi}.html`, html(), 'text/html');
        $('rReg').onclick = () => { location.hash = '#/registre'; };
        $('rCSV').onclick = () => baixa(`registre_${FO.nomFitxer(P.nom)}_${ORD.codi}.csv`, csv('data;persona;rol;tipus;text', prog.registre.map(x => [x.ts, x.op, x.rol || '', x.tipus, tm(x.text)])), 'text/csv');
    };

    // ─── Persones (només amb servidor) ───
    VISTES.persones = async function () {
        if (!srv.url) { location.hash = '#/tauler'; return; }
        $('vista').innerHTML = `<p class="ajuda">${t('Carregant…')}</p>`;
        const l = await carregaPersones();
        let edita = null;   // persona que s'està editant (null = nova)
        const pinta = () => {
            $('vista').innerHTML = `<h2>${t('Persones del taller')}</h2>
                <p class="ajuda">${t('Cada persona entra amb el seu nom i PIN i pot tenir un o més rols. El PIN no es guarda mai en clar.')}</p>
                ${l.map((x, i) => `<button class="bt gran" data-i="${i}"><i>${FO.ROLS[x.rols[0]] ? FO.ROLS[x.rols[0]].ico : '👤'}</i><span>${esc(x.nom)}<small>${x.rols.map(r => FO.ROLS[r] ? FO.ROLS[r].nom : r).join(' · ')}</small></span></button>`).join('')}
                <h3>${edita ? t('Editar {nom}', { nom: esc(edita.nom) }) : t('Persona nova')}</h3><div class="targeta">
                ${edita ? '' : `<label class="camp">${t('Nom')}<input id="peNom"></label>`}
                ${TOTS_ROLS.map(r => `<label class="ck"><input type="checkbox" data-rol="${r}"${edita && edita.rols.includes(r) ? ' checked' : ''}> ${FO.ROLS[r].ico} ${FO.ROLS[r].nom} <small class="ajuda">${esc(FO.ROLS[r].desc)}</small></label>`).join('')}
                <label class="camp">${edita ? t('PIN nou (buit = no el canvia)') : t('PIN (de 4 a 8 xifres)')}<input id="pePin" type="password" inputmode="numeric" autocomplete="new-password"></label>
                <button class="bt pr" id="peDesa">${t('Desar')}</button>
                ${edita ? `<button class="bt perill" id="peBaixa"${edita.nom === ses.nom ? ' disabled' : ''}>${t('Donar de baixa')}</button><button class="bt" id="peNova">+ ${t('Persona nova')}</button>` : ''}</div>`;
            $('vista').querySelectorAll('[data-i]').forEach(b => b.onclick = () => { edita = l[+b.dataset.i]; pinta(); });
            const desa = async actiu => {
                const nom = edita ? edita.nom : $('peNom').value.trim();
                const rols = Array.from($('vista').querySelectorAll('[data-rol]:checked')).map(c => c.dataset.rol);
                const pin = $('pePin').value.trim();
                try {
                    await api('/api/persones', { method: 'POST', body: JSON.stringify({ nom, rols, pin: pin || undefined, actiu }) });
                    avis(actiu ? t('Desat') : t('Persona donada de baixa'));
                    VISTES.persones();
                } catch (e) { avis(e.message, 4000); }
            };
            $('peDesa').onclick = () => desa(true);
            if ($('peBaixa')) $('peBaixa').onclick = () => { if (confirm(t('Donar de baixa {nom}? Ja no podrà entrar.', { nom: edita.nom }))) desa(false); };
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
            resultat('in', t('No es pot obrir la càmera (permís o connexió no segura). Escriu el codi o fes servir un lector USB/Bluetooth.'));
            setTimeout(() => $('codiManual').focus(), 100);
        }
    }
    function tancaEscaner() {
        esc_.actiu = false;
        if (esc_.stream) esc_.stream.getTracks().forEach(tr => tr.stop());
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
            return resultat('in', `${t('Tapa de <b>{caixa}</b>', { caixa: esc(valor.split('|')[1]) })}${x ? `<br><small>${t('Pas {n}', { n: x.r.pas })} · ${esc(x.r.conj.nom)}</small>` : ''}`);
        }
        let e = null;
        if (valor.startsWith('FO1|')) {
            const [, safata, conjunt, codi] = valor.split('|');
            e = M.ETQ.find(x => x.safata === safata && x.codi === codi && x.tipus === 'caixeti') || M.ETQ.find(x => x.clau === safata && x.tipus !== 'caixeti');
            if (!e) { so(false); return resultat('er', `${t('Etiqueta d\'un altre projecte o d\'una versió anterior')}<br><small>${esc(safata)} · ${esc(conjunt)}</small>`); }
        } else {
            // codi de barres simple (codi del material): el més probable segons el context
            const cand = M.caixetins.filter(x => x.codi === valor);
            const ctx = x => (caixaActual ? caixaDeClau(x.clau) && caixaDeClau(x.clau).id === caixaActual : pasActual ? M.pasDe(x) === pasActual : true);
            const lliure = x => r0 === 'magatzem' ? !prog.omplert[x.clau] : !prog.agafat[x.clau];
            e = cand.find(x => ctx(x) && lliure(x)) || cand.find(ctx) || cand.find(lliure) || cand[0];
            if (!e) { so(false); return resultat('er', t('Codi desconegut: {codi}', { codi: esc(valor) })); }
        }
        // etiqueta d'una caixa o d'un contenidor
        if (e.tipus !== 'caixeti') {
            const c = M.caixes.find(x => x.id === e.clau) || M.caixes.find(x => x.o.forma === 'contenidor' && x.o.caixes.some(q => q.obj.id === e.clau));
            so(true);
            if (!c) return resultat('in', esc(e.clau));
            if (r0 === 'magatzem') { tancaEscaner(); location.hash = '#/caixa/' + encodeURIComponent(c.id); return; }
            return resultat('in', `<b>${esc(c.id)}</b> · ${esc((FO.ESTATS_CAIXA[estatCaixa(c)] || {}).nom)}<br><small>${t('Pas {n}', { n: c.r.pas })} · ${esc(c.r.conj.nom)} · ${t('{n}/{t} agafats', { n: c.claus.filter(k => prog.agafat[k]).length, t: c.claus.length })}</small>`);
        }
        const pas = M.pasDe(e), r = M.perConj.get(pas), m = e.caixeti.mat;
        if (r0 === 'magatzem') {
            const c = caixaDeClau(e.clau);
            if (c && c.guarda) { so(false); return resultat('er', t('{caixa} és una caixa de guarda: s\'omple en muntar el conjunt, no des del magatzem', { caixa: esc(c.id) })); }
            if (caixaActual && c && c.id !== caixaActual) { so(false); return resultat('er', `✗ ${t('No és d\'aquesta caixa')}<br>${t('{mat} va a {caixa}', { mat: esc(e.codi), caixa: esc(c.id) })}`); }
            const arriba = FO.esMancant(prog, e.clau);   // escanejar un mancant = el material ha arribat
            if (prog.omplert[e.clau] && !arriba) { so(true); return resultat('ok', `${t('Ja estava omplert:')} ${esc(e.codi)} ×${prog.omplert[e.clau].qty}<br><small>${esc(e.safata)}</small>`); }
            if (!omple(e.clau, e.qty)) return resultat('er', t('No s\'ha omplert'));
            if (arriba && !FO.esMancant(prog, e.clau)) { so(true); return resultat('ok', `✓ ${t('Ha arribat:')} ${esc(e.codi)} ×${e.qty}<br><small>${t('Mancant resolt · {caixa}. El muntador ja ho pot completar.', { caixa: esc(e.safata) })}</small>`); }
            so(true);
            const n = c ? c.claus.filter(k => prog.omplert[k]).length : 0;
            return resultat('ok', `✓ ${t('Omplert:')} ${esc(e.codi)} ×${prog.omplert[e.clau].qty}<br><small>${esc(m.nom)} · ${esc(e.safata)}${c ? ` · ${n}/${c.claus.length}${n === c.claus.length ? ' · ' + t('caixa plena!') : ''}` : ''}</small>`);
        }
        if (r0 === 'muntador') {
            if (pasActual && pas !== pasActual) { so(false); return resultat('er', `✗ ${t('No és d\'aquest pas')}<br>${esc(e.codi)} ×${e.qty} · ${r ? t('Pas {n}', { n: r.pas }) + ' · ' + esc(r.conj.nom) : '?'}`); }
            if (FO.esMancant(prog, e.clau)) { so(false); return resultat('er', `❗ ${t('{mat} no ha arribat (mancant)', { mat: esc(e.codi) })}<br><small>${t('Munta la resta: el pas quedarà «muntat amb mancants».')}</small>`); }
            const ja = !!prog.agafat[e.clau];
            if (!ja) { if (r) iniciaSiCal(r); if (!fer('agafa', { clau: e.clau, v: true }, tc('{mat} ×{q}: agafat per escaneig ({caixa})', { mat: e.codi, q: e.qty, caixa: e.safata }))) return resultat('er', t('No s\'ha pogut marcar')); }
            const it = itemDe(pas, m.id), llista = r ? M.aAgafar(r) : [], n = llista.filter(x => prog.agafat[x.clau]).length;
            so(true);
            return resultat('ok', `${ja ? t('Ja estava agafat') : '✓ ' + t('Agafat')}: ${esc(e.codi)} ×${e.qty}<br><small>${esc(e.nom)}${it && it.parell ? ' · ' + fmt(it.parell, 1) + ' N·m' : ''}${it && it.nota ? '<br>▸ ' + esc(it.nota) : ''}</small>` +
                (r ? `<br><small>${t('Pas {n}', { n: r.pas })}: ${n}/${llista.length}${n === llista.length ? ' · ' + t('complet!') : ''}</small>` : ''));
        }
        so(true);
        resultat('in', `${esc(e.codi)} ×${e.qty} · ${esc(e.nom)}<br><small>${esc(e.safata)} · ${r ? t('pas {n}', { n: r.pas }) + ' ' + esc(r.conj.codi) + ' · ' + esc((FO.ESTATS_PAS[estatDe(r)] || {}).nom) : '?'}${prog.omplert[e.clau] ? ' · ' + t('omplert') : ''}${prog.agafat[e.clau] ? ' · ' + t('agafat') : ''}</small>`);
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
            ? (ses ? `<div class="targeta"><b>${esc(ses.nom)}</b><div class="ajuda">${ses.rols.map(r => FO.ROLS[r].ico + ' ' + FO.ROLS[r].nom).join(' · ')}</div><button class="bt" id="bSurt">👤 ${t('Canviar de persona')}</button></div>` : '')
            : `<label class="camp">${t('El teu nom (surt al registre)')}<input id="nomLocal" value="${esc(pref.nomLocal)}" autocomplete="name"></label>`;
        if ($('bSurt')) $('bSurt').onclick = surt;
        if ($('nomLocal')) $('nomLocal').oninput = function () { pref.nomLocal = this.value.trim(); desaPref(); };
        $('consumAuto').checked = pref.consumAuto;
        $('urlSrv').value = pref.servidor || ''; $('clauSrv').value = pref.clau || '';
        $('infoSrv').textContent = srv.url
            ? `${srv.fora ? t('Sense connexió amb {url}', { url: srv.url }) : t('Connectat a {url}', { url: srv.url })}${cua.length ? ` · ${t('{n} canvis per enviar', { n: cua.length })}` : ''}. ${srv.projecteOk ? t('El progrés, l\'estoc i les fotos d\'aquesta ordre es comparteixen amb tot el taller.') : t('Aquest projecte no és al servidor.')}`
            : t('Sense servidor: el progrés es desa només en aquest aparell. Si al taller hi ha una Raspberry Pi o un PC amb FOrdre, obre l\'app des d\'allà o escriu-ne l\'adreça.');
        const llista = srv.projectes || [];
        $('projSrv').innerHTML = llista.length ? `<h3>${t('Projectes del taller')}</h3>` + llista.map(x => `<button class="bt" data-psrv="${esc(x.id)}">${esc(x.nom)} <small style="opacity:.7">· ${x.ordres.length === 1 ? t('1 ordre') : t('{n} ordres', { n: x.ordres.length })}</small></button>`).join('') : '';
        $('projSrv').querySelectorAll('[data-psrv]').forEach(b => b.onclick = async () => {
            try { await recarregaDelServidor(b.dataset.psrv); $('menu').hidden = true; location.hash = '#/'; } catch (e) { avis(e.message); }
        });
        // el progrés compartit no es pot importar ni reiniciar des d'un mòbil
        $('bImportaProg').disabled = $('bReinicia').disabled = enXarxa();
        $('infoApp').textContent = `FOrdre ${FO.VERSIO}${P ? ' · ' + P.nom : ''}${ORD ? ' · ' + ORD.codi : ''}${navigator.onLine ? '' : ' · ' + t('sense connexió')}`;
    }
    $('bMenu').onclick = () => { pintaMenu(); $('menu').hidden = false; };
    $('consumAuto').onchange = function () { pref.consumAuto = this.checked; desaPref(); };
    $('bConnecta').onclick = async () => {
        pref.servidor = $('urlSrv').value.trim().replace(/\/$/, ''); pref.clau = $('clauSrv').value.trim(); desaPref();
        const d = await detectaServidor();
        if (!d) { avis(t('No es troba el servidor. Comprova l\'adreça i que aquest aparell confiï en el certificat (obre l\'adreça una vegada al navegador).'), 6000); pintaMenu(); pintaEstatSrv(); return; }
        $('menu').hidden = true;
        inicia();
    };
    $('bSrv').onclick = async () => {
        if (srv.projecteNou) { try { await recarregaDelServidor(); avis(t('Projecte actualitzat')); } catch (e) { avis(e.message); } return; }
        if (enXarxa()) sincronitza();
        avis($('bSrv').title, 3000);
    };
    $('bObrirFitxer').onclick = () => $('fProjecte').click();
    $('fProjecte').addEventListener('change', function () {
        const f = this.files[0]; this.value = ''; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => { let p; try { p = JSON.parse(rd.result); } catch (e) { return avis(t('Fitxer no vàlid')); } obreProjecte(p, 'fitxer'); };
        rd.readAsText(f);
    });
    $('bEnganxa').onclick = async () => {
        const enllac = prompt(t('Enganxa l\'enllaç del projecte (…muntatge.html#p=…)'));
        if (!enllac) return;
        try { obreProjecte(JSON.parse(await FO.descomprimeix(enllac.slice(enllac.indexOf('#p=') + 3))), 'enllaç'); } catch (e) { avis(t('Enllaç no vàlid')); }
    };
    $('bOrdinador').onclick = () => {
        const d = llegeix(FO.CLAU_PROJECTE);
        if (!d) return avis(t('No hi ha cap projecte de l\'app d\'escriptori en aquest navegador'));
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
                if (d.projecte !== P.id && !confirm(t('Aquest progrés és d\'un altre projecte. Importar-lo igualment?'))) return;
                prog = FO.normalitzaProgres(d.progres); desaProg(); $('menu').hidden = true; ruta(); avis(t('Progrés importat a {codi}', { codi: ORD.codi }));
            } catch (e) { avis(t('Fitxer no vàlid')); }
        };
        rd.readAsText(f);
    });
    $('bReinicia').onclick = () => {
        if (!P || !confirm(t('Esborrar tot el progrés, l\'estoc i el registre de l\'ordre {codi} en aquest aparell?', { codi: ORD.codi }))) return;
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
    // Textos fixos de l'HTML en l'idioma triat i selector d'idioma al menú
    FO.traduiexDOM();
    $('selIdiomaMenu').innerHTML = FO.selectorIdioma('');
    FO.activaSelectorsIdioma();
    inicia();
    // Accés per a les proves automàtiques
    G.FOrdreMuntatge = {
        get projecte() { return P; }, get progres() { return prog; }, get ordre() { return ORD; }, get ordres() { return ORDRES; },
        get servidor() { return srv; }, get cua() { return cua; }, get sessio() { return ses; }, get rol() { return rol(); },
        get etiquetes() { return M ? M.ETQ : []; }, processaCodi, canviaOrdre
    };
})(window);
