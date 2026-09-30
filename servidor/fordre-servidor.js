#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// FOrdre — Servidor del taller
// ───────────────────────────────────────────────────────────────
// Per a una Raspberry Pi o qualsevol ordinador (Linux, Windows, macOS)
// amb Node.js 18 o superior. Sense dependències: només aquest fitxer.
//
//  · Serveix les dues apps (disseny i muntatge) per la xarxa del taller,
//    sense necessitat d'internet.
//  · Sincronitza el progrés entre tots els mòbils, tauletes i ordinadors:
//    cada canvi és una operació que s'aplica una sola vegada (js/fo-progres.js)
//    i s'envia a l'instant a la resta d'aparells (Server-Sent Events).
//  · Persones amb PIN i rols (Magatzem, Muntador, Qualitat, Responsable):
//    el servidor comprova que cada operació la fa qui la pot fer i que qui
//    verifica un pas no és qui l'ha muntat.
//  · Ordres de fabricació: cada unitat fabricada té el seu progrés propi.
//  · Guarda projectes, ordres, progrés, persones i fotos a servidor/dades.
//  · HTTPS amb un certificat propi generat la primera vegada: els navegadors
//    només deixen fer servir la càmera (escàner) en connexions segures.
//
// Ús:   node servidor/fordre-servidor.js [--port 8443] [--port-http 8080]
//                                         [--dades carpeta] [--clau PIN] [--nou-certificat]
// ═══════════════════════════════════════════════════════════════
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ─── Opcions ───
const arg = (nom, def) => { const i = process.argv.indexOf('--' + nom); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes('--' + nom) ? true : def); };
const ARREL = path.resolve(__dirname, '..');
const DADES = path.resolve(arg('dades', process.env.FORDRE_DADES || path.join(__dirname, 'dades')));
const PORT = +arg('port', process.env.FORDRE_PORT || 8443);
const PORT_HTTP = +arg('port-http', process.env.FORDRE_PORT_HTTP || 8080);
const CLAU = String(arg('clau', process.env.FORDRE_CLAU || '') || '');
global.FO = {};
require(path.join(ARREL, 'js', 'fo-i18n.js'));      // idiomes: les respostes de l'API van en català (les apps les tradueixen)
require(path.join(ARREL, 'js', 'fo-idiomes.js'));   // diccionaris castellà i anglès (per a la pàgina d'ajuda)
require(path.join(ARREL, 'js', 'fo-dades.js'));     // model i número de versió (el mateix que les apps)
require(path.join(ARREL, 'js', 'fo-progres.js'));   // operacions, rols i permisos
const FO = global.FO;
const VERSIO = FO.VERSIO;

for (const d of ['projectes', 'progres', 'fotos', 'certificat', 'ordres']) fs.mkdirSync(path.join(DADES, d), { recursive: true });

// ═══ Certificat autosignat (X.509 v3 codificat a mà, sense OpenSSL) ═══
const der = {
    len(n) { if (n < 128) return Buffer.from([n]); const b = []; while (n) { b.unshift(n & 255); n >>= 8; } return Buffer.from([0x80 | b.length, ...b]); },
    tlv(tag, ...parts) { const c = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), der.len(c.length), c]); },
    seq: (...p) => der.tlv(0x30, ...p),
    set: (...p) => der.tlv(0x31, ...p),
    int(buf) { if (typeof buf === 'number') buf = Buffer.from([buf]); if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0]), buf]); return der.tlv(0x02, buf); },
    oid(s) {
        const p = s.split('.').map(Number), out = [40 * p[0] + p[1]];
        for (const v of p.slice(2)) { const b = [v & 127]; let x = v >> 7; while (x) { b.unshift((x & 127) | 128); x >>= 7; } out.push(...b); }
        return der.tlv(0x06, Buffer.from(out));
    },
    nul: () => Buffer.from([0x05, 0x00]),
    utf8: s => der.tlv(0x0c, Buffer.from(s, 'utf8')),
    time(d) { const s = d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'; return der.tlv(0x17, Buffer.from(s)); },
    bits: b => der.tlv(0x03, Buffer.from([0]), b),
    octet: b => der.tlv(0x04, b),
    ctx: (n, ...p) => der.tlv(0xa0 + n, ...p),
    bool: v => Buffer.from([0x01, 0x01, v ? 0xff : 0x00])
};
function ipsLocals() {
    const out = [];
    Object.values(os.networkInterfaces()).forEach(l => (l || []).forEach(a => { if (a.family === 'IPv4' || a.family === 4) out.push(a.address); }));
    return Array.from(new Set(out.concat(['127.0.0.1'])));
}
function generaCertificat() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const nom = os.hostname();
    const noms = Array.from(new Set([nom, nom + '.local', 'localhost', 'raspberrypi.local', 'fordre.local']));
    const ips = ipsLocals();
    const ara = new Date(Date.now() - 86400000), fi = new Date(Date.now() + 397 * 86400000);
    const dn = der.seq(der.set(der.seq(der.oid('2.5.4.3'), der.utf8('FOrdre taller ' + nom))), der.set(der.seq(der.oid('2.5.4.10'), der.utf8('FOrdre'))));
    const alg = der.seq(der.oid('1.2.840.113549.1.1.11'), der.nul());
    const san = der.seq(...noms.map(n => der.tlv(0x82, Buffer.from(n))), ...ips.map(ip => der.tlv(0x87, Buffer.from(ip.split('.').map(Number)))));
    const ext = der.ctx(3, der.seq(
        der.seq(der.oid('2.5.29.19'), der.bool(true), der.octet(der.seq(der.bool(true)))),                      // basicConstraints CA
        der.seq(der.oid('2.5.29.15'), der.bool(true), der.octet(der.bits(Buffer.from([0xa4])))),                // keyUsage: signatura, xifratge, certificats
        der.seq(der.oid('2.5.29.37'), der.octet(der.seq(der.oid('1.3.6.1.5.5.7.3.1')))),                        // extKeyUsage: servidor TLS
        der.seq(der.oid('2.5.29.17'), der.octet(san))                                                            // subjectAltName
    ));
    const tbs = der.seq(der.ctx(0, der.int(2)), der.int(crypto.randomBytes(12)), alg, dn, der.seq(der.time(ara), der.time(fi)), dn,
        publicKey.export({ type: 'spki', format: 'der' }), ext);
    const sig = crypto.sign('sha256', tbs, privateKey);
    const cert = der.seq(tbs, alg, der.bits(sig));
    const pem = (tipus, b) => `-----BEGIN ${tipus}-----\n${b.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${tipus}-----\n`;
    return { cert: pem('CERTIFICATE', cert), clau: privateKey.export({ type: 'pkcs8', format: 'pem' }), ips, noms, fi };
}
function certificat() {
    const fc = path.join(DADES, 'certificat', 'fordre.crt'), fk = path.join(DADES, 'certificat', 'fordre.key'), fm = path.join(DADES, 'certificat', 'info.json');
    let info = null;
    try { info = JSON.parse(fs.readFileSync(fm, 'utf8')); } catch (e) { /* no n'hi ha */ }
    const ips = ipsLocals();
    const caduca = info && new Date(info.fi) - Date.now() < 30 * 86400000;
    const ipNova = info && ips.some(ip => !info.ips.includes(ip));
    if (arg('nou-certificat') || !info || !fs.existsSync(fc) || !fs.existsSync(fk) || caduca || ipNova) {
        const c = generaCertificat();
        fs.writeFileSync(fc, c.cert); fs.writeFileSync(fk, c.clau, { mode: 0o600 });
        fs.writeFileSync(fm, JSON.stringify({ ips: c.ips, noms: c.noms, fi: c.fi }, null, 1));
        console.log(ipNova ? '🔐 Adreça de xarxa nova: s\'ha generat un certificat nou (cal tornar-lo a instal·lar als aparells).' : '🔐 Certificat HTTPS generat.');
    }
    return { cert: fs.readFileSync(fc), key: fs.readFileSync(fk), fitxer: fc };
}

// ═══ Emmagatzematge ═══
const netId = id => String(id || '').replace(/[^\w.-]/g, '_').slice(0, 80);
const fitxerProj = id => path.join(DADES, 'projectes', netId(id) + '.json');
const fitxerOrdres = id => path.join(DADES, 'ordres', netId(id) + '.json');
const fitxerProg = (id, ordre) => path.join(DADES, 'progres', netId(id) + '__' + netId(ordre) + '.json');
const FITXER_PERSONES = path.join(DADES, 'persones.json');
function escriuAtomic(f, text) {
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, text);
    if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
    fs.renameSync(tmp, f);
}
const llegeixJSON = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; } };

// Resum curt (SHA-256) del projecte publicat: identifica la versió exacta
const empremtaProjecte = id => { try { return crypto.createHash('sha256').update(fs.readFileSync(fitxerProj(id))).digest('hex').slice(0, 12); } catch (e) { return ''; } };

// ─── Ordres de fabricació ───
// Cada projecte té una llista d'ordres; la primera es crea sola (i hi passa el
// progrés d'una versió anterior del servidor, si n'hi havia).
function ordres(id) {
    let l = llegeixJSON(fitxerOrdres(id), null);
    if (!l) {
        l = [{ id: 'OF-1', codi: FO.codiOrdreSeguent([]), serie: '', notes: '', creada: new Date().toISOString(), creador: '', empremta: empremtaProjecte(id) }];
        const antic = path.join(DADES, 'progres', netId(id) + '.json');
        if (fs.existsSync(antic)) fs.renameSync(antic, fitxerProg(id, 'OF-1'));
        escriuAtomic(fitxerOrdres(id), JSON.stringify(l, null, 1));
    }
    return l;
}
function creaOrdre(id, dades, qui) {
    const l = ordres(id);
    const o = {
        id: 'OF-' + (l.length + 1) + '-' + Date.now().toString(36),
        codi: String(dades.codi || '').trim() || FO.codiOrdreSeguent(l),
        serie: String(dades.serie || '').trim(), notes: String(dades.notes || '').trim(),
        creada: new Date().toISOString(), creador: qui || '',
        // empremta del projecte en crear l'ordre: permet saber amb quina versió es va fabricar
        empremta: empremtaProjecte(id)
    };
    l.push(o);
    escriuAtomic(fitxerOrdres(id), JSON.stringify(l, null, 1));
    return o;
}

// ─── Progrés (un per projecte i ordre), en memòria i desat amb retard ───
const progressos = new Map();   // "projecte|ordre" → estat
const clauP = (id, ordre) => id + '|' + ordre;
function progres(id, ordre) {
    const k = clauP(id, ordre);
    if (!progressos.has(k)) progressos.set(k, FO.normalitzaProgres(llegeixJSON(fitxerProg(id, ordre), null)));
    return progressos.get(k);
}
const pendentsDesar = new Map();
function desaProgres(id, ordre) {
    const k = clauP(id, ordre);
    clearTimeout(pendentsDesar.get(k));
    pendentsDesar.set(k, setTimeout(() => { escriuAtomic(fitxerProg(id, ordre), JSON.stringify(progres(id, ordre))); pendentsDesar.delete(k); }, 250));
}
function llistaProjectes() {
    return fs.readdirSync(path.join(DADES, 'projectes')).filter(f => f.endsWith('.json')).map(f => {
        try {
            const p = JSON.parse(fs.readFileSync(path.join(DADES, 'projectes', f), 'utf8'));
            const ords = ordres(p.id).map(o => {
                const pr = progres(p.id, o.id);
                return Object.assign({}, o, { passosFets: Object.keys(pr.fets).length, tancada: !!pr.tancada, rev: pr.rev });
            });
            return { id: p.id, nom: p.nom, actualitzat: fs.statSync(path.join(DADES, 'projectes', f)).mtime, empremta: empremtaProjecte(p.id), ordres: ords };
        } catch (e) { return null; }
    }).filter(Boolean);
}

// ═══ Persones, rols i sessions ═══
// persones.json: [{ nom, rols: [...], sal, hash, actiu }]. El PIN no es guarda mai:
// només el seu resum (scrypt amb sal). Les sessions són fitxes aleatòries en memòria
// que també es desen per sobreviure a un reinici.
let persones = llegeixJSON(FITXER_PERSONES, { persones: [], sessions: {} });
const desaPersones = () => escriuAtomic(FITXER_PERSONES, JSON.stringify(persones, null, 1));
const resumPIN = (pin, sal) => crypto.scryptSync(String(pin), sal, 32).toString('hex');
const configurat = () => persones.persones.some(x => x.actiu && x.rols.includes('responsable'));
const publica = x => ({ nom: x.nom, rols: x.rols, actiu: x.actiu });
function sessioDe(req, url) {
    const t = req.headers['x-fordre-token'] || url.searchParams.get('token');
    const s = t && persones.sessions[t];
    if (!s) return null;
    const pers = persones.persones.find(x => x.nom === s.nom && x.actiu);
    return pers ? { token: t, nom: pers.nom, rols: pers.rols } : null;
}
// Protecció contra provar PINs a l'atzar: 5 intents fallits → 60 s d'espera
const intents = new Map();
function massaIntents(ip) { const i = intents.get(ip); return i && i.n >= 5 && Date.now() - i.t < 60000; }
function intentFallit(ip) { const i = intents.get(ip) || { n: 0, t: 0 }; i.n = Date.now() - i.t > 60000 ? 1 : i.n + 1; i.t = Date.now(); intents.set(ip, i); }

// ═══ Temps real (Server-Sent Events) ═══
const subscriptors = new Map();   // "projecte|ordre" → Set(res)   ·   "projecte" → avisos de projecte
function emet(clau, tipus, dades) {
    const s = subscriptors.get(clau); if (!s) return;
    const msg = `event: ${tipus}\ndata: ${JSON.stringify(dades)}\n\n`;
    s.forEach(res => { try { res.write(msg); } catch (e) { /* desconnectat */ } });
}
function subscriu(clau, res) {
    if (!subscriptors.has(clau)) subscriptors.set(clau, new Set());
    subscriptors.get(clau).add(res);
}
setInterval(() => subscriptors.forEach(s => s.forEach(res => { try { res.write(': viu\n\n'); } catch (e) { /* */ } })), 25000);

// ═══ HTTP ═══
const TIPUS = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
    '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.crt': 'application/x-x509-ca-cert'
};
function capcaleres(req, extra) {
    return Object.assign({
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-FOrdre-Clau, X-FOrdre-Token, X-FOrdre-Rol',
        'Access-Control-Allow-Private-Network': 'true',
        'Cache-Control': 'no-cache'
    }, extra || {});
}
function json(req, res, codi, obj) { res.writeHead(codi, capcaleres(req, { 'Content-Type': 'application/json; charset=utf-8' })); res.end(JSON.stringify(obj)); }
function llegeixCos(req, max) {
    return new Promise((ok, ko) => {
        const parts = []; let n = 0;
        req.on('data', c => { n += c.length; if (n > max) { ko(new Error('massa gran')); req.destroy(); } else parts.push(c); });
        req.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch (e) { ko(e); } });
        req.on('error', ko);
    });
}
// Clau de xarxa opcional (--clau): una barrera abans de tot, a part de les persones
function autoritzat(req, url) {
    if (!CLAU) return true;
    return req.headers['x-fordre-clau'] === CLAU || url.searchParams.get('clau') === CLAU;
}

async function api(req, res, url) {
    const p = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);   // ['api', recurs, …]
    const ip = req.socket.remoteAddress || '';
    if (p[1] === 'estat') return json(req, res, 200, { app: 'FOrdre', versio: VERSIO, hora: new Date(), clau: !!CLAU, configurat: configurat() });
    if (!autoritzat(req, url)) return json(req, res, 401, { error: 'Cal la clau del taller' });
    const ses = sessioDe(req, url);
    // Sense cap Responsable configurat, el taller funciona obert (primer ús o aparells sols)
    const obert = !configurat();
    const cal = rol => {
        if (obert) return true;
        if (!ses) { json(req, res, 401, { error: 'Cal iniciar sessió' }); return false; }
        if (rol && !ses.rols.includes(rol) && !ses.rols.includes('responsable')) { json(req, res, 403, { error: FO.t('Cal el rol de {rol}', { rol: FO.ROLS[rol].nom }) }); return false; }
        return true;
    };

    // ─── Persones i sessions ───
    if (p[1] === 'persones' && req.method === 'GET') return json(req, res, 200, persones.persones.filter(x => x.actiu).map(publica));
    if (p[1] === 'persones' && req.method === 'POST') {
        // el primer Responsable es pot crear sense sessió; després, només un Responsable
        if (!obert && !cal('responsable')) return;
        const d = await llegeixCos(req, 1e5);
        const nom = String(d.nom || '').trim().slice(0, 60);
        const rols = (Array.isArray(d.rols) ? d.rols : []).filter(r => FO.ROLS[r]);
        if (!nom || !rols.length) return json(req, res, 400, { error: 'Cal un nom i almenys un rol' });
        if (obert && !rols.includes('responsable')) return json(req, res, 400, { error: 'La primera persona ha de ser Responsable' });
        let pers = persones.persones.find(x => x.nom.toLowerCase() === nom.toLowerCase());
        if (!pers && !/^\d{4,8}$/.test(String(d.pin || ''))) return json(req, res, 400, { error: 'El PIN ha de tenir de 4 a 8 xifres' });
        // mai no es pot deixar el taller sense cap Responsable actiu: tornaria a quedar obert a qualsevol
        const quedaResp = persones.persones.some(x => x !== pers && x.actiu && x.rols.includes('responsable')) || (d.actiu !== false && rols.includes('responsable'));
        if (!obert && !quedaResp) return json(req, res, 400, { error: 'Ha de quedar almenys un Responsable actiu' });
        if (!pers) { pers = { nom, rols, actiu: true }; persones.persones.push(pers); }
        pers.rols = rols; pers.actiu = d.actiu !== false;
        if (d.pin) { if (!/^\d{4,8}$/.test(String(d.pin))) return json(req, res, 400, { error: 'El PIN ha de tenir de 4 a 8 xifres' }); pers.sal = crypto.randomBytes(8).toString('hex'); pers.hash = resumPIN(d.pin, pers.sal); }
        if (!pers.actiu) Object.keys(persones.sessions).forEach(t => { if (persones.sessions[t].nom === pers.nom) delete persones.sessions[t]; });
        desaPersones();
        console.log(`👤 Persona ${pers.actiu ? 'desada' : 'desactivada'}: ${pers.nom} (${pers.rols.join(', ')})`);
        return json(req, res, 200, publica(pers));
    }
    if (p[1] === 'sessio' && req.method === 'POST') {
        if (massaIntents(ip)) return json(req, res, 429, { error: 'Massa intents. Espera un minut.' });
        const d = await llegeixCos(req, 1e4);
        const pers = persones.persones.find(x => x.actiu && x.nom === d.nom);
        if (!pers || !pers.hash || resumPIN(d.pin || '', pers.sal) !== pers.hash) { intentFallit(ip); return json(req, res, 401, { error: 'Nom o PIN incorrectes' }); }
        intents.delete(ip);
        const token = crypto.randomBytes(24).toString('hex');
        persones.sessions[token] = { nom: pers.nom, creat: new Date().toISOString() };
        desaPersones();
        return json(req, res, 200, { token, nom: pers.nom, rols: pers.rols });
    }
    if (p[1] === 'sessio' && req.method === 'DELETE') {
        if (ses) { delete persones.sessions[ses.token]; desaPersones(); }
        return json(req, res, 200, { ok: true });
    }
    if (p[1] === 'jo') return ses ? json(req, res, 200, { nom: ses.nom, rols: ses.rols }) : json(req, res, 401, { error: 'Sense sessió' });

    // A partir d'aquí cal sessió (si el taller està configurat)
    if (!cal()) return;
    const id = netId(p[2]);

    // ─── Projectes ───
    if (p[1] === 'projectes' && !p[2]) return json(req, res, 200, llistaProjectes());
    if (p[1] === 'projectes' && id) {
        if (req.method === 'GET') {
            if (!fs.existsSync(fitxerProj(id))) return json(req, res, 404, { error: 'Projecte desconegut' });
            res.writeHead(200, capcaleres(req, { 'Content-Type': 'application/json; charset=utf-8' }));
            return fs.createReadStream(fitxerProj(id)).pipe(res);
        }
        if (req.method === 'PUT') {
            if (!cal('responsable')) return;
            const proj = await llegeixCos(req, 40e6);
            if (!proj || !Array.isArray(proj.conjunts)) return json(req, res, 400, { error: 'No és un projecte de FOrdre' });
            proj.id = id;
            escriuAtomic(fitxerProj(id), JSON.stringify(proj));
            ordres(id);
            emet(id, 'projecte', { id, nom: proj.nom, hora: new Date() });
            console.log(`📦 Projecte publicat: ${proj.nom} (${id})`);
            return json(req, res, 200, { ok: true, id });
        }
    }

    // ─── Ordres de fabricació ───
    if (p[1] === 'ordres' && id) {
        if (!fs.existsSync(fitxerProj(id))) return json(req, res, 404, { error: 'Projecte desconegut' });
        if (req.method === 'GET') return json(req, res, 200, ordres(id));
        if (req.method === 'POST') {
            if (!cal('responsable')) return;
            const o = creaOrdre(id, await llegeixCos(req, 1e5), ses ? ses.nom : '');
            emet(id, 'ordres', ordres(id));
            console.log(`🏭 Ordre nova: ${o.codi} (${id})`);
            return json(req, res, 200, o);
        }
    }

    // ─── Progrés d'una ordre ───
    if (p[1] === 'progres' && id && p[3]) {
        if (!fs.existsSync(fitxerProj(id))) return json(req, res, 404, { error: 'Projecte desconegut' });
        const ordre = netId(p[3]);
        if (!ordres(id).some(o => o.id === ordre)) return json(req, res, 404, { error: 'Ordre desconeguda' });
        const k = clauP(id, ordre);
        if (p[4] === 'flux') {
            res.writeHead(200, capcaleres(req, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }));
            res.write(`event: estat\ndata: ${JSON.stringify(progres(id, ordre))}\n\n`);
            subscriu(k, res); subscriu(id, res);
            req.on('close', () => { subscriptors.get(k).delete(res); subscriptors.get(id).delete(res); });
            return;
        }
        if (p[4] === 'ops' && req.method === 'POST') {
            const cos = await llegeixCos(req, 5e6);
            const est = progres(id, ordre);
            // qui fa l'operació el decideix la sessió, no l'aparell
            const usuari = ses ? { nom: ses.nom, rols: ses.rols } : null;
            // rol amb què treballa: el de l'operació, o el de la capçalera, si la persona el té
            const rolDe = o => [o.rol, req.headers['x-fordre-rol']].find(r => r && ses.rols.includes(r)) || ses.rols[0];
            let n = 0; const rebutjades = [];
            (Array.isArray(cos.ops) ? cos.ops : []).slice(0, 5000).forEach(o => {
                if (!o || !o.id || (est._vist && est._vist.has(o.id)) || est.vist.includes(o.id)) return;
                if (usuari) { o.op = usuari.nom; o.rol = rolDe(o); }
                const motiu = FO.validaOp(est, o, usuari);
                if (motiu) { rebutjades.push({ id: o.id, motiu }); return; }
                if (FO.aplicaOp(est, o)) n++;
            });
            if (n) { desaProgres(id, ordre); emet(k, 'estat', est); }
            return json(req, res, 200, { aplicades: n, rebutjades, estat: est });
        }
        if (req.method === 'GET') return json(req, res, 200, progres(id, ordre));
    }

    // ─── Fotos (per ordre) ───
    if (p[1] === 'fotos' && id && p[3]) {
        if (!fs.existsSync(fitxerProj(id)) || !ordres(id).some(o => o.id === netId(p[3]))) return json(req, res, 404, { error: 'Ordre desconeguda' });
        const dir = path.join(DADES, 'fotos', id, netId(p[3]));
        if (req.method === 'POST' && !p[4]) {
            const cos = await llegeixCos(req, 15e6);
            const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(cos.dades || '');
            if (!m) return json(req, res, 400, { error: 'Imatge no vàlida' });
            fs.mkdirSync(dir, { recursive: true });
            const nom = `${netId(cos.conj)}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
            fs.writeFileSync(path.join(dir, nom), Buffer.from(m[2], 'base64'));
            return json(req, res, 200, { fitxer: nom });
        }
        if (req.method === 'GET' && p[4]) {
            const f = path.join(dir, path.basename(p[4]));
            if (!fs.existsSync(f)) return json(req, res, 404, { error: 'No existeix' });
            res.writeHead(200, capcaleres(req, { 'Content-Type': TIPUS[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'max-age=31536000' }));
            return fs.createReadStream(f).pipe(res);
        }
    }
    json(req, res, 404, { error: 'Ruta desconeguda' });
}

function estatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const f = path.resolve(ARREL, '.' + rel);
    // només fitxers de l'app: res de fora del repositori ni de les dades del servidor
    if (!f.startsWith(ARREL + path.sep) || f.startsWith(DADES) || f.startsWith(path.join(ARREL, '.git')) || f.startsWith(path.join(ARREL, 'servidor'))) {
        res.writeHead(403); return res.end('No permès');
    }
    fs.stat(f, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No trobat'); }
        res.writeHead(200, { 'Content-Type': TIPUS[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': st.size });
        fs.createReadStream(f).pipe(res);
    });
}

function gestor(cert, segur) {
    return (req, res) => {
        const url = new URL(req.url, 'http://x');
        if (req.method === 'OPTIONS') { res.writeHead(204, capcaleres(req)); return res.end(); }
        if (url.pathname === '/certificat' || url.pathname === '/fordre.crt') {
            res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="fordre-taller.crt"' });
            return res.end(cert.cert);
        }
        if (!segur && url.pathname !== '/api/estat') {
            // per HTTP només es dona el certificat i una pàgina d'ajuda; la resta va per HTTPS
            const host = (req.headers.host || 'localhost').replace(/:\d+$/, '');
            const desti = `https://${host}:${PORT}${url.pathname === '/' ? '/muntatge.html' : url.pathname}${url.search}`;
            if (url.pathname === '/' || url.pathname === '/ajuda') {
                // la pàgina d'ajuda surt en l'idioma del navegador (?lang=ca|es|en per forçar-lo)
                const L = idiomaPeticio(req, url), t = (s, v) => FO.t(s, v, L), q = '&lang=' + L;
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                return res.end(`<!doctype html><html lang="${L}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FOrdre ${t('Taller')}</title>
<body style="font-family:system-ui;max-width:560px;margin:24px auto;padding:0 16px;line-height:1.5">
<p style="text-align:right">${Object.entries(FO.IDIOMES).map(([k, x]) => k === L ? `<b>${x.curt}</b>` : `<a href="?lang=${k}">${x.curt}</a>`).join(' · ')}</p>
<h1>FOrdre · ${t('servidor del taller')}</h1>
<p><a href="${desti}${desti.includes('?') ? q : '?' + q.slice(1)}" style="font-size:20px">➜ ${t('Obrir l\'app del taller')}</a></p>
<p>${t('Accés directe per rol:')} ${Object.entries(FO.ROLS).map(([r, x]) => `<a href="https://${host}:${PORT}/muntatge.html?rol=${r}${q}">${x.ico} ${t(x.nom)}</a>`).join(' · ')}</p>
<p><a href="https://${host}:${PORT}/index.html?${q.slice(1)}">➜ ${t('Obrir el configurador (ordinador)')}</a></p>
<h2>${t('Primer cop en aquest aparell')}</h2>
<ol><li>${t('<a href="/certificat">Descarrega el certificat del taller</a> i instal·la\'l com a <b>certificat de CA</b> (Android: Configuració › Seguretat › Xifratge i credencials › Instal·la un certificat › Certificat de CA · iPhone: obre\'l, instal·la el perfil i activa\'l a Configuració › General › Informació › Confiança de certificats).')}</li>
<li>${t('O bé obre l\'app i accepta l\'avís de seguretat del navegador («Configuració avançada › Continua»).')}</li></ol></body></html>`);
            }
            res.writeHead(302, { Location: desti }); return res.end();
        }
        if (url.pathname.startsWith('/api/')) return api(req, res, url).catch(e => json(req, res, 400, { error: e.message }));
        if (url.pathname === '/') { res.writeHead(302, { Location: '/muntatge.html' }); return res.end(); }
        estatic(req, res, url);
    };
}

// Idioma d'una petició: ?lang=… o la capçalera Accept-Language del navegador (per defecte, català)
function idiomaPeticio(req, url) {
    const q = url.searchParams.get('lang');
    if (FO.IDIOMES[q]) return q;
    const l = String(req.headers['accept-language'] || '').split(',').map(x => x.trim().slice(0, 2).toLowerCase()).find(x => FO.IDIOMES[x]);
    return l || 'ca';
}

// ─── QR a la consola ───
function qrConsola(text) {
    try {
        const qrcode = require(path.join(ARREL, 'vendor', 'qrcode.js'));
        const q = qrcode(0, 'M'); q.addData(text); q.make();
        const n = q.getModuleCount(), m = 2, fosc = (r, c) => r >= 0 && c >= 0 && r < n && c < n && q.isDark(r, c);
        let out = '';
        for (let r = -m; r < n + m; r += 2) {
            let l = '';
            for (let c = -m; c < n + m; c++) { const a = fosc(r, c), b = fosc(r + 1, c); l += a && b ? ' ' : a ? '▄' : b ? '▀' : '█'; }
            out += '  ' + l + '\n';
        }
        return out;
    } catch (e) { return ''; }
}

// ═══ Arrencada ═══
const cert = certificat();
const srv = https.createServer({ cert: cert.cert, key: cert.key }, gestor(cert, true));
const srvHttp = http.createServer(gestor(cert, false));
srv.on('error', e => { console.error(`❌ No es pot obrir el port ${PORT}: ${e.message}`); process.exit(1); });
srvHttp.on('error', e => console.warn(`⚠ Port HTTP ${PORT_HTTP} no disponible (${e.message}); continua només amb HTTPS.`));
srv.listen(PORT, '0.0.0.0', () => {
    srvHttp.listen(PORT_HTTP, '0.0.0.0');
    const ips = ipsLocals().filter(ip => ip !== '127.0.0.1');
    const principal = `http://${ips[0] || 'localhost'}:${PORT_HTTP}/`;
    console.log(`\n  FOrdre · servidor del taller ${VERSIO}\n  ────────────────────────────────────`);
    console.log(`  Dades:        ${DADES}`);
    ips.forEach(ip => console.log(`  App taller:   https://${ip}:${PORT}/muntatge.html   (per rol: …/muntatge.html?rol=magatzem · muntador · qualitat · responsable)`));
    console.log(`  Configurador: https://${ips[0] || 'localhost'}:${PORT}/index.html`);
    console.log(`  Nom de xarxa: https://${os.hostname()}.local:${PORT}/muntatge.html`);
    console.log(`  Primer cop:   ${principal}  (certificat i ajuda)`);
    if (CLAU) console.log('  Clau del taller activada.');
    console.log(configurat() ? `  Persones: ${persones.persones.filter(x => x.actiu).length} actives.` : '  Primer ús: obre l\'app del taller i crea el primer Responsable.');
    console.log('\n  Escaneja aquest QR amb el mòbil (mateixa Wi-Fi):\n');
    console.log(qrConsola(principal));
});
// En aturar-lo, desa el que estigui pendent
process.on('SIGINT', () => {
    pendentsDesar.forEach((t, k) => { clearTimeout(t); const [id, ordre] = k.split('|'); escriuAtomic(fitxerProg(id, ordre), JSON.stringify(progres(id, ordre))); });
    process.exit(0);
});
process.on('SIGTERM', () => process.emit('SIGINT'));
