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
//  · Guarda projectes, progrés i fotos a la carpeta servidor/dades.
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
const VERSIO = '1.3.0';

global.FO = {};
require(path.join(ARREL, 'js', 'fo-progres.js'));
const FO = global.FO;

for (const d of ['projectes', 'progres', 'fotos', 'certificat']) fs.mkdirSync(path.join(DADES, d), { recursive: true });

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
const fitxerProg = id => path.join(DADES, 'progres', netId(id) + '.json');
function escriuAtomic(f, text) {
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, text);
    if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
    fs.renameSync(tmp, f);
}
const progressos = new Map();   // id → estat en memòria
function progres(id) {
    if (!progressos.has(id)) {
        let p = null;
        try { p = JSON.parse(fs.readFileSync(fitxerProg(id), 'utf8')); } catch (e) { /* nou */ }
        progressos.set(id, FO.normalitzaProgres(p));
    }
    return progressos.get(id);
}
const pendentsDesar = new Map();
function desaProgres(id) {
    clearTimeout(pendentsDesar.get(id));
    pendentsDesar.set(id, setTimeout(() => { escriuAtomic(fitxerProg(id), JSON.stringify(progres(id))); pendentsDesar.delete(id); }, 250));
}
function llistaProjectes() {
    return fs.readdirSync(path.join(DADES, 'projectes')).filter(f => f.endsWith('.json')).map(f => {
        try {
            const p = JSON.parse(fs.readFileSync(path.join(DADES, 'projectes', f), 'utf8'));
            const pr = progres(p.id);
            return { id: p.id, nom: p.nom, actualitzat: fs.statSync(path.join(DADES, 'projectes', f)).mtime, passosFets: Object.keys(pr.fets).length, rev: pr.rev };
        } catch (e) { return null; }
    }).filter(Boolean);
}

// ═══ Temps real (Server-Sent Events) ═══
const subscriptors = new Map();   // id → Set(res)
function emet(id, tipus, dades) {
    const s = subscriptors.get(id); if (!s) return;
    const msg = `event: ${tipus}\ndata: ${JSON.stringify(dades)}\n\n`;
    s.forEach(res => { try { res.write(msg); } catch (e) { /* desconnectat */ } });
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
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-FOrdre-Clau',
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
function autoritzat(req, url) {
    if (!CLAU) return true;
    return req.headers['x-fordre-clau'] === CLAU || url.searchParams.get('clau') === CLAU;
}

async function api(req, res, url, cert) {
    const p = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);   // ['api', recurs, id, ...]
    if (p[1] === 'estat') return json(req, res, 200, { app: 'FOrdre', versio: VERSIO, hora: new Date(), clau: !!CLAU, projectes: autoritzat(req, url) ? llistaProjectes() : [] });
    if (!autoritzat(req, url)) return json(req, res, 401, { error: 'Cal la clau del taller' });
    const id = netId(p[2]);
    if (p[1] === 'projectes' && !p[2]) return json(req, res, 200, llistaProjectes());
    if (p[1] === 'projectes' && id) {
        if (req.method === 'GET') {
            if (!fs.existsSync(fitxerProj(id))) return json(req, res, 404, { error: 'Projecte desconegut' });
            res.writeHead(200, capcaleres(req, { 'Content-Type': 'application/json; charset=utf-8' }));
            return fs.createReadStream(fitxerProj(id)).pipe(res);
        }
        if (req.method === 'PUT') {
            const proj = await llegeixCos(req, 40e6);
            if (!proj || !Array.isArray(proj.conjunts)) return json(req, res, 400, { error: 'No és un projecte de FOrdre' });
            proj.id = id;
            escriuAtomic(fitxerProj(id), JSON.stringify(proj));
            emet(id, 'projecte', { id, nom: proj.nom, hora: new Date() });
            console.log(`📦 Projecte publicat: ${proj.nom} (${id})`);
            return json(req, res, 200, { ok: true, id });
        }
    }
    if (p[1] === 'progres' && id) {
        if (p[3] === 'flux') {
            res.writeHead(200, capcaleres(req, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }));
            res.write(`event: estat\ndata: ${JSON.stringify(progres(id))}\n\n`);
            if (!subscriptors.has(id)) subscriptors.set(id, new Set());
            subscriptors.get(id).add(res);
            req.on('close', () => subscriptors.get(id).delete(res));
            return;
        }
        if (p[3] === 'ops' && req.method === 'POST') {
            const cos = await llegeixCos(req, 5e6);
            const est = progres(id);
            let n = 0;
            (Array.isArray(cos.ops) ? cos.ops : []).slice(0, 5000).forEach(o => { if (FO.aplicaOp(est, o)) n++; });
            if (n) { desaProgres(id); emet(id, 'estat', est); }
            return json(req, res, 200, { aplicades: n, estat: est });
        }
        if (req.method === 'GET') return json(req, res, 200, progres(id));
    }
    if (p[1] === 'fotos' && id) {
        const dir = path.join(DADES, 'fotos', id);
        if (req.method === 'POST' && !p[3]) {
            const cos = await llegeixCos(req, 15e6);
            const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(cos.dades || '');
            if (!m) return json(req, res, 400, { error: 'Imatge no vàlida' });
            fs.mkdirSync(dir, { recursive: true });
            const nom = `${netId(cos.conj)}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
            fs.writeFileSync(path.join(dir, nom), Buffer.from(m[2], 'base64'));
            return json(req, res, 200, { fitxer: nom });
        }
        if (req.method === 'GET' && p[3]) {
            const f = path.join(dir, path.basename(p[3]));
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
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FOrdre taller</title>
<body style="font-family:system-ui;max-width:560px;margin:24px auto;padding:0 16px;line-height:1.5">
<h1>FOrdre · servidor del taller</h1>
<p><a href="${desti}" style="font-size:20px">➜ Obrir l'app de muntatge</a></p>
<p><a href="https://${host}:${PORT}/index.html">➜ Obrir l'app de disseny</a></p>
<h2>Primer cop en aquest aparell</h2>
<ol><li><a href="/certificat">Descarrega el certificat del taller</a> i instal·la'l com a <b>certificat de CA</b> (Android: Configuració › Seguretat › Xifratge i credencials › Instal·la un certificat › Certificat de CA · iPhone: obre'l, instal·la el perfil i activa'l a Configuració › General › Informació › Confiança de certificats).</li>
<li>O bé obre l'app i accepta l'avís de seguretat del navegador («Configuració avançada › Continua»).</li></ol></body>`);
            }
            res.writeHead(302, { Location: desti }); return res.end();
        }
        if (url.pathname.startsWith('/api/')) return api(req, res, url, cert).catch(e => json(req, res, 400, { error: e.message }));
        if (url.pathname === '/') { res.writeHead(302, { Location: '/muntatge.html' }); return res.end(); }
        estatic(req, res, url);
    };
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
    ips.forEach(ip => console.log(`  App muntatge: https://${ip}:${PORT}/muntatge.html`));
    console.log(`  App disseny:  https://${ips[0] || 'localhost'}:${PORT}/index.html`);
    console.log(`  Nom de xarxa: https://${os.hostname()}.local:${PORT}/muntatge.html`);
    console.log(`  Primer cop:   ${principal}  (certificat i ajuda)`);
    if (CLAU) console.log('  Clau del taller activada.');
    console.log('\n  Escaneja aquest QR amb el mòbil (mateixa Wi-Fi):\n');
    console.log(qrConsola(principal));
});
process.on('SIGINT', () => { pendentsDesar.forEach((t, id) => { clearTimeout(t); escriuAtomic(fitxerProg(id), JSON.stringify(progres(id))); }); process.exit(0); });
process.on('SIGTERM', () => process.emit('SIGINT'));
