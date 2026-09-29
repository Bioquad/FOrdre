// ═══════════════════════════════════════════════════════════════
// FOrdre — Model del taller i resultats d'una ordre de fabricació
// ───────────────────────────────────────────────────────────────
// Dues parts, compartides per l'app del dispositiu i la d'escriptori:
//
//  1. FO.modelTaller(projecte): a partir del pla calculat, sap quines caixes
//     i caixetins té cada pas, a quin pas s'agafa cada etiqueta i quins
//     caixetins formen cada caixa. És la «foto fixa» del projecte.
//
//  2. FO.resumOrdre(model, progres) i FO.informeHTML(...): el resultat d'una
//     ordre: estat de cada pas i de cada caixa, temps de muntatge, rebutjos,
//     incidències, material mogut i activitat de cada persona. L'informe és
//     una pàgina HTML autònoma, llesta per imprimir o desar en PDF.
// ═══════════════════════════════════════════════════════════════
(function (G) {
    'use strict';
    const FO = G.FO || (G.FO = {});
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // ═══ 1. Model del taller ═══
    FO.modelTaller = function (P) {
        const PLA = FO.calculaPla(P);
        const ETQ = FO.etiquetesPla(PLA);
        const perConj = new Map(PLA.map(r => [r.conj.id, r]));
        const perObj = new Map();                        // id d'objecte imprès → { o, r }
        PLA.forEach(r => FO.imprimibles(r).forEach(o => perObj.set(o.id, { o, r })));
        const caixetins = ETQ.filter(e => e.tipus === 'caixeti');
        const perClau = new Map(ETQ.map(e => [e.clau, e]));

        // A quin pas s'agafa una etiqueta. La caixa de guarda d'un subconjunt
        // (on es desa un cop muntat) s'agafa al pas del conjunt pare.
        const pasDe = e => {
            const x = perObj.get(e.safata);
            if (!x) return null;
            return x.o.tipus === 'muntat' && x.r.conj.pare ? x.r.conj.pare : x.r.conj.id;
        };
        // Caixetins que cal agafar en un pas
        const aAgafar = r => caixetins.filter(e => pasDe(e) === r.conj.id);
        // Caixetins que ha d'omplir el magatzem per a un pas (les guardes s'omplen muntant, no des del magatzem)
        const aOmplir = r => caixetins.filter(e => e.safata && perObj.get(e.safata) && perObj.get(e.safata).r === r && perObj.get(e.safata).o.tipus !== 'muntat');
        // Caixes «físiques» (les que es porten d'un lloc a l'altre): safates, caixes i contenidors, amb els seus caixetins
        const caixes = [];
        PLA.forEach(r => r.safates.forEach(o => {
            const fills = o.forma === 'contenidor' ? o.caixes.map(q => q.obj.id) : [o.id];
            caixes.push({ id: o.id, o, r, guarda: o.tipus === 'muntat', claus: caixetins.filter(e => fills.includes(e.safata)).map(e => e.clau) });
        }));
        // Objectes des d'on s'agafa en un pas: el kit propi + les guardes dels subconjunts
        const objectesPas = r => {
            const l = r.safates.filter(o => o.tipus !== 'muntat');
            r.entrades.forEach(en => { const rf = perConj.get(en.conj.id); if (rf) rf.safates.filter(o => o.tipus === 'muntat').forEach(o => l.push(o)); });
            return l;
        };
        return { P, PLA, ETQ, perConj, perObj, perClau, caixetins, caixes, pasDe, aAgafar, aOmplir, objectesPas };
    };

    // Un pas està «preparat» si els seus subconjunts ja estan muntats i
    // el magatzem ha omplert totes les seves caixes. Si en aquesta ordre ningú
    // fa servir el procés d'omplir (taller petit), només compten els subconjunts.
    FO.usaMagatzem = p => Object.keys(p.omplert).length > 0;
    FO.pasPreparat = (m, p, r) => r.entrades.every(e => p.fets[e.conj.id]) && (!FO.usaMagatzem(p) || m.aOmplir(r).every(e => p.omplert[e.clau]));

    // ═══ 2. Resum d'una ordre ═══
    const durada = (a, b) => (a && b ? Math.max(0, new Date(b) - new Date(a)) : 0);
    FO.textDurada = function (ms) {
        if (!ms) return '—';
        const min = Math.round(ms / 60000);
        if (min < 1) return '< 1 min';
        if (min < 60) return min + ' min';
        const h = Math.floor(min / 60);
        return h < 24 ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
    };

    FO.resumOrdre = function (m, p) {
        p = FO.normalitzaProgres(p);
        // — Passos —
        const passos = m.PLA.map(r => {
            const id = r.conj.id, f = p.fets[id], ini = p.inicis[id], v = p.verificacions[id];
            const rebutjos = p.historial.filter(h => h.conj === id);
            return {
                r, id, pas: r.pas, codi: r.conj.codi, nom: r.conj.nom,
                estat: FO.estatPas(p, id, FO.pasPreparat(m, p, r)),
                muntador: f ? f.op : ini ? ini.op : '', muntat: f ? f.ts : '',
                durada: f && ini ? durada(ini.ts, f.ts) : 0,
                verificador: v ? v.op : '', verificat: v ? v.ts : '', resultat: v ? v.resultat : '',
                rebutjos, assignat: p.assignacions[id] || '',
                incidencies: p.incidencies.filter(i => i.conj === id && !i.resolta).length
            };
        });
        const n = e => passos.filter(x => x.estat === e).length;
        const verificats = n('verificat');
        const ambRebuig = new Set(p.historial.map(h => h.conj));
        // — Caixes —
        const caixes = m.caixes.map(c => ({ c, estat: FO.estatCaixa(p, c.id, c.claus) }));
        // — Material: el que s'ha posat a les caixes i el que s'ha consumit —
        const posat = {}, consumit = {};
        Object.values(p.omplert).forEach(x => { if (x.mat) posat[x.mat] = (posat[x.mat] || 0) + x.qty; });
        Object.values(p.fets).forEach(f => Object.entries(f.consum || {}).forEach(([k, q]) => { consumit[k] = (consumit[k] || 0) + q; }));
        // — Persones: què ha fet cadascú (segons el registre) —
        const persones = {};
        p.registre.forEach(x => {
            if (!x.op) return;
            const q = persones[x.op] || (persones[x.op] = { nom: x.op, rols: new Set(), accions: 0, muntats: 0, verificats: 0, rebutjats: 0, omplerts: 0 });
            if (x.rol) q.rols.add(x.rol);
            q.accions++;
        });
        const compta = (nom, camp) => { if (nom) (persones[nom] || (persones[nom] = { nom, rols: new Set(), accions: 0, muntats: 0, verificats: 0, rebutjats: 0, omplerts: 0 }))[camp]++; };
        Object.values(p.fets).forEach(f => compta(f.op, 'muntats'));
        Object.values(p.verificacions).forEach(v => { if (v.resultat === 'ok') compta(v.op, 'verificats'); });
        p.historial.forEach(h => compta(h.op, 'rebutjats'));   // cada rebuig queda a l'historial
        Object.values(p.omplert).forEach(x => compta(x.op, 'omplerts'));
        // — Dates —
        const hores = p.registre.map(x => x.ts).filter(Boolean).sort();
        const tempsMuntatge = passos.reduce((a, x) => a + x.durada, 0);
        return {
            passos, caixes, posat, consumit,
            persones: Object.values(persones).map(q => Object.assign(q, { rols: Array.from(q.rols) })).sort((a, b) => b.accions - a.accions),
            total: passos.length, verificats, muntats: n('muntat'), enCurs: n('en curs'), rebutjats: n('rebutjat'),
            // rendiment a la primera: passos verificats que no han estat mai rebutjats
            primeraPassada: verificats ? passos.filter(x => x.estat === 'verificat' && !ambRebuig.has(x.id)).length / verificats : null,
            rebutjos: p.historial.length,
            incidenciesObertes: p.incidencies.filter(i => !i.resolta).length, incidencies: p.incidencies,
            inici: hores[0] || '', final: p.tancada ? p.tancada.ts : hores[hores.length - 1] || '',
            tempsMuntatge, tancada: p.tancada,
            acabada: passos.length > 0 && verificats === passos.length
        };
    };

    // Text curt de l'estat global d'una ordre (per a llistes)
    FO.textEstatOrdre = function (res) {
        if (res.tancada) return 'Tancada';
        if (res.acabada) return 'Llesta per tancar';
        if (!res.inici) return 'Sense començar';
        return `${res.verificats}/${res.total} verificats`;
    };

    // ═══ Informe imprimible ═══
    // ordre = { codi, serie, notes, creada, creador, empremta }; opcions.empremtaActual
    // per avisar si el projecte ha canviat des que es va crear l'ordre.
    FO.informeHTML = function (m, p, ordre, opcions) {
        opcions = opcions || {};
        const P = m.P, res = FO.resumOrdre(m, p);
        p = FO.normalitzaProgres(p);
        const data = t => t ? new Date(t).toLocaleString('ca-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
        const mat = id => FO.material(P, id);
        const pct = x => x == null ? '—' : Math.round(x * 100) + ' %';
        const xip = e => `<span class="x" style="background:${(FO.ESTATS_PAS[e] || {}).col || '#888'}">${esc((FO.ESTATS_PAS[e] || { nom: e }).nom)}</span>`;
        const materials = Array.from(new Set(Object.keys(res.posat).concat(Object.keys(res.consumit)))).map(mat).filter(Boolean).sort((a, b) => a.codi.localeCompare(b.codi));
        const canviat = opcions.empremtaActual && ordre.empremta && opcions.empremtaActual !== ordre.empremta;

        return `<!doctype html><html lang="ca"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Informe ${esc(ordre.codi || '')} · ${esc(P.nom)}</title>
<style>
 body{font-family:system-ui,'Segoe UI',sans-serif;color:#222;margin:24px auto;max-width:980px;padding:0 16px;font-size:13px;background:#fff}
 h1{font-size:22px;margin:0}h2{font-size:15px;margin:22px 0 8px;border-bottom:2px solid #333;padding-bottom:3px}
 .sub{color:#666}.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:14px 0}
 .kpi div{border:1px solid #ccc;border-radius:8px;padding:8px}.kpi b{display:block;font-size:20px}
 table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}
 th{background:#f2f2f2;font-size:11px;text-transform:uppercase}.n{text-align:right;font-variant-numeric:tabular-nums}
 .x{color:#fff;border-radius:8px;padding:1px 7px;font-size:11px;white-space:nowrap}.av{background:#fff3cd;border:1px solid #e0b000;padding:8px;border-radius:6px;margin:10px 0}
 .ok{color:#2e7d32;font-weight:600}.ko{color:#c62828;font-weight:600}.firma{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:40px}
 .firma div{border-top:1px solid #333;padding-top:4px}@media print{body{margin:0}h2{break-after:avoid}tr{break-inside:avoid}}
</style></head><body>
<h1>Informe de fabricació · ${esc(ordre.codi || '')}</h1>
<div class="sub">${esc(P.nom)}${ordre.serie ? ' · Núm. de sèrie <b>' + esc(ordre.serie) + '</b>' : ''} · Ordre creada ${data(ordre.creada)}${ordre.creador ? ' per ' + esc(ordre.creador) : ''}${ordre.empremta ? ' · Versió del projecte ' + esc(ordre.empremta) : ''}</div>
${ordre.notes ? `<p>${esc(ordre.notes)}</p>` : ''}
${canviat ? '<div class="av">⚠ El projecte s\'ha modificat després de crear aquesta ordre: els passos i les caixes poden no coincidir exactament amb els que es van fer servir.</div>' : ''}
<div class="kpi">
 <div>Estat<b>${esc(FO.textEstatOrdre(res))}</b></div>
 <div>Passos verificats<b>${res.verificats} / ${res.total}</b></div>
 <div>Bé a la primera<b>${pct(res.primeraPassada)}</b></div>
 <div>Rebutjos<b>${res.rebutjos}</b></div>
 <div>Incidències obertes<b>${res.incidenciesObertes}</b></div>
 <div>Temps de muntatge<b>${FO.textDurada(res.tempsMuntatge)}</b></div>
 <div>Inici → final<b style="font-size:13px">${data(res.inici)}<br>${data(res.final)}</b></div>
</div>

<h2>Passos</h2>
<table><tr><th>Pas</th><th>Conjunt</th><th>Estat</th><th>Muntat per</th><th class="n">Durada</th><th>Verificat per</th><th class="n">Rebutjos</th></tr>
${res.passos.map(x => `<tr><td>${x.pas}</td><td><b>${esc(x.codi)}</b> ${esc(x.nom)}</td><td>${xip(x.estat)}</td><td>${esc(x.muntador)}<div class="sub">${data(x.muntat)}</div></td><td class="n">${FO.textDurada(x.durada)}</td><td>${esc(x.verificador)}${x.verificat ? `<div class="sub">${data(x.verificat)}</div>` : ''}</td><td class="n">${x.rebutjos.length || ''}</td></tr>`).join('')}
</table>

${p.historial.length ? `<h2>Rebutjos de qualitat</h2><table><tr><th>Data</th><th>Pas</th><th>Motiu</th><th>Muntador</th><th>Qualitat</th></tr>
${p.historial.map(h => { const r = m.perConj.get(h.conj); return `<tr><td>${data(h.ts)}</td><td>${r ? esc(r.conj.codi) : esc(h.conj)}</td><td class="ko">${esc(h.motiu)}</td><td>${esc(h.muntador)}</td><td>${esc(h.op)}</td></tr>`; }).join('')}</table>` : ''}

${res.incidencies.length ? `<h2>Incidències</h2><table><tr><th>Data</th><th>On</th><th>Gravetat</th><th>Descripció</th><th>Resolució</th></tr>
${res.incidencies.map(i => { const r = m.perConj.get(i.conj); return `<tr><td>${data(i.ts)}<div class="sub">${esc(i.op)}</div></td><td>${r ? esc(r.conj.codi) : ''}${i.clau ? ' · ' + esc(i.clau) : ''}</td><td>${esc(i.gravetat)}</td><td>${esc(i.text)}</td><td>${i.resolta ? `<span class="ok">✓</span> ${esc(i.resolta.text)}<div class="sub">${data(i.resolta.ts)} · ${esc(i.resolta.op)}</div>` : '<span class="ko">Oberta</span>'}</td></tr>`; }).join('')}</table>` : ''}

${materials.length ? `<h2>Material</h2><table><tr><th>Codi</th><th>Material</th><th class="n">Posat a caixes</th><th class="n">Consumit</th><th class="n">Estoc ara</th></tr>
${materials.map(x => `<tr><td><b>${esc(x.codi)}</b></td><td>${esc(x.nom)}</td><td class="n">${res.posat[x.id] || ''}</td><td class="n">${res.consumit[x.id] || ''}</td><td class="n">${p.estoc[x.id] != null ? p.estoc[x.id] : ''}</td></tr>`).join('')}</table>` : ''}

${res.persones.length ? `<h2>Persones</h2><table><tr><th>Persona</th><th>Rols</th><th class="n">Caixetins omplerts</th><th class="n">Passos muntats</th><th class="n">Verificats</th><th class="n">Rebutjats</th><th class="n">Accions</th></tr>
${res.persones.map(q => `<tr><td>${esc(q.nom)}</td><td>${q.rols.map(r => esc((FO.ROLS[r] || { nom: r }).nom)).join(', ')}</td><td class="n">${q.omplerts || ''}</td><td class="n">${q.muntats || ''}</td><td class="n">${q.verificats || ''}</td><td class="n">${q.rebutjats || ''}</td><td class="n">${q.accions}</td></tr>`).join('')}</table>` : ''}

<h2>Registre de traçabilitat</h2>
<table><tr><th>Data</th><th>Persona</th><th>Rol</th><th>Acció</th></tr>
${p.registre.slice().sort((a, b) => String(a.ts).localeCompare(b.ts)).map(x => `<tr><td style="white-space:nowrap">${data(x.ts)}</td><td>${esc(x.op)}</td><td>${esc((FO.ROLS[x.rol] || { nom: '' }).nom)}</td><td>${esc(x.text)}</td></tr>`).join('') || '<tr><td colspan="4">Encara no hi ha res.</td></tr>'}
</table>

<div class="firma"><div>Responsable${p.tancada ? ': ' + esc(p.tancada.op) + ' · ' + data(p.tancada.ts) : ''}</div><div>Qualitat</div></div>
<p class="sub" style="margin-top:20px">Generat per FOrdre ${esc(FO.VERSIO || '')} · ${data(new Date().toISOString())}</p>
</body></html>`;
    };
})(typeof window !== 'undefined' ? window : globalThis);
