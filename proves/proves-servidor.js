// ═══════════════════════════════════════════════════════════════
// FOrdre — proves del servidor del taller (API, persones, rols, ordres)
// Arrenca un servidor temporal amb una carpeta de dades buida, hi fa
// peticions com ho farien els aparells i comprova les regles del procés.
// Execució:  node proves/proves-servidor.js
// ═══════════════════════════════════════════════════════════════
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

const PORT = 19443 + Math.floor(Math.random() * 500);
const DADES = fs.mkdtempSync(path.join(os.tmpdir(), 'fordre-proves-'));
const agent = new https.Agent({ rejectUnauthorized: false });   // certificat autosignat

// Petició a l'API. Retorna { codi, cos }
function crida(metode, ruta, cos, token, extra) {
    return new Promise((ok, ko) => {
        const dades = cos === undefined ? null : Buffer.from(JSON.stringify(cos));
        const req = https.request({
            host: '127.0.0.1', port: PORT, path: ruta, method: metode, agent,
            headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-FOrdre-Token': token } : {}, extra || {})
        }, res => {
            const parts = [];
            res.on('data', c => parts.push(c));
            res.on('end', () => { let c = Buffer.concat(parts).toString('utf8'); try { c = JSON.parse(c); } catch (e) { /* text */ } ok({ codi: res.statusCode, cos: c }); });
        });
        req.on('error', ko);
        if (dades) req.write(dades);
        req.end();
    });
}
// Obre el flux de temps real i recull els esdeveniments
function flux(ruta, token) {
    const rebuts = [];
    const req = https.get({ host: '127.0.0.1', port: PORT, path: ruta + '?token=' + token, agent }, res => {
        let buf = '';
        res.on('data', c => {
            buf += c;
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const bloc = buf.slice(0, i); buf = buf.slice(i + 2);
                const ev = /event: (\w+)/.exec(bloc), d = /data: (.*)/.exec(bloc);
                if (ev) rebuts.push({ tipus: ev[1], dades: JSON.parse(d[1]) });
            }
        });
    });
    return { rebuts, tanca: () => req.destroy() };
}
const espera = ms => new Promise(r => setTimeout(r, ms));

let fallades = 0, total = 0;
async function prova(nom, fn) {
    total++;
    try { await fn(); console.log('  ✓ ' + nom); } catch (e) { fallades++; console.log('  ✗ ' + nom + '\n      ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };
let n = 0;
const op = (t, dades) => Object.assign({ id: 'prova-' + (++n), t, ts: new Date().toISOString() }, dades);

(async () => {
    const srv = spawn(process.execPath, [path.join(__dirname, '..', 'servidor', 'fordre-servidor.js'), '--dades', DADES, '--port', PORT, '--port-http', PORT + 1], { stdio: 'pipe' });
    let sortida = ''; srv.stdout.on('data', c => { sortida += c; }); srv.stderr.on('data', c => { sortida += c; });
    for (let i = 0; i < 100 && !/servidor del taller/.test(sortida); i++) await espera(100);

    const T = {};   // fitxes de sessió per persona
    console.log('Servidor del taller');

    await prova('primer ús: el taller està obert i demana un Responsable', async () => {
        const r = await crida('GET', '/api/estat');
        assert(r.codi === 200 && r.cos.configurat === false, JSON.stringify(r.cos));
        const r2 = await crida('POST', '/api/persones', { nom: 'Anna', rols: ['muntador'], pin: '1234' });
        assert(r2.codi === 400, 'la primera persona hauria de ser Responsable');
    });
    await prova('es crea el primer Responsable i el taller queda configurat', async () => {
        const r = await crida('POST', '/api/persones', { nom: 'Rosa', rols: ['responsable'], pin: '1111' });
        assert(r.codi === 200, JSON.stringify(r.cos));
        assert((await crida('GET', '/api/estat')).cos.configurat === true);
        assert(!JSON.stringify(fs.readFileSync(path.join(DADES, 'persones.json'), 'utf8')).includes('1111'), 'el PIN no es pot guardar en clar');
    });
    await prova('sense sessió no es pot llegir res del taller', async () => {
        assert((await crida('GET', '/api/projectes')).codi === 401);
    });
    await prova('iniciar sessió amb nom i PIN', async () => {
        const mal = await crida('POST', '/api/sessio', { nom: 'Rosa', pin: '9999' });
        assert(mal.codi === 401);
        const r = await crida('POST', '/api/sessio', { nom: 'Rosa', pin: '1111' });
        assert(r.codi === 200 && r.cos.token, JSON.stringify(r.cos));
        T.rosa = r.cos.token;
        assert((await crida('GET', '/api/jo', undefined, T.rosa)).cos.nom === 'Rosa');
    });
    await prova('el Responsable dona d\'alta persones amb rols', async () => {
        for (const [nom, rols, pin] of [['Marc', ['magatzem'], '2222'], ['Anna', ['muntador'], '3333'], ['Pau', ['qualitat'], '4444'], ['Joan', ['muntador', 'qualitat'], '5555']]) {
            const r = await crida('POST', '/api/persones', { nom, rols, pin }, T.rosa);
            assert(r.codi === 200, nom + ': ' + JSON.stringify(r.cos));
            T[nom.toLowerCase()] = (await crida('POST', '/api/sessio', { nom, pin })).cos.token;
        }
        const r = await crida('POST', '/api/persones', { nom: 'Intrús', rols: ['responsable'], pin: '0000' }, T.anna);
        assert(r.codi === 403, 'un muntador no pot crear persones');
    });
    await prova('publicar un projecte només ho pot fer el Responsable', async () => {
        const proj = { id: 'prova', nom: 'Màquina de prova', conjunts: [{ id: 'A', nom: 'Base' }, { id: 'B', nom: 'Tapa' }], materials: [] };
        assert((await crida('PUT', '/api/projectes/prova', proj, T.anna)).codi === 403);
        assert((await crida('PUT', '/api/projectes/prova', proj, T.rosa)).codi === 200);
        const l = (await crida('GET', '/api/projectes', undefined, T.anna)).cos;
        assert(l.length === 1 && l[0].ordres.length === 1, 'el projecte ha de tenir la primera ordre: ' + JSON.stringify(l));
    });
    let ordre;
    await prova('ordres de fabricació: una de nova amb codi correlatiu', async () => {
        assert((await crida('POST', '/api/ordres/prova', {}, T.anna)).codi === 403);
        const r = await crida('POST', '/api/ordres/prova', { serie: 'SN-0002' }, T.rosa);
        assert(r.codi === 200 && /^OF-\d{4}-002$/.test(r.cos.codi), JSON.stringify(r.cos));
        ordre = r.cos.id;
        assert((await crida('GET', '/api/ordres/prova', undefined, T.anna)).cos.length === 2);
    });
    const ops = (tok, llista, rol) => crida('POST', `/api/progres/prova/${ordre}/ops`, { ops: llista }, tok, rol ? { 'X-FOrdre-Rol': rol } : {});
    let fl;
    await prova('omplir, muntar i verificar amb el rol de cadascú', async () => {
        fl = flux(`/api/progres/prova/${ordre}/flux`, T.rosa);
        await espera(200);
        let r = await ops(T.marc, [op('omple', { clau: 'A|M1', mat: 'M1', qty: 4 }), op('estoc', { mat: 'M1', delta: 10 })]);
        assert(r.cos.aplicades === 2 && r.cos.estat.estoc.M1 === 6, JSON.stringify(r.cos));
        r = await ops(T.anna, [op('inicia', { conj: 'A' }), op('fet', { conj: 'A' })]);
        assert(r.cos.aplicades === 2 && r.cos.estat.fets.A.op === 'Anna', 'el servidor ha de posar el nom de la sessió');
        r = await ops(T.pau, [op('verifica', { conj: 'A', resultat: 'ok' })]);
        assert(r.cos.aplicades === 1 && r.cos.estat.verificacions.A.op === 'Pau');
        assert(FO_estat(r.cos.estat, 'A') === 'verificat');
    });
    await prova('permisos: el magatzem no pot verificar ni el muntador omplir', async () => {
        let r = await ops(T.marc, [op('verifica', { conj: 'A', resultat: 'ok' })]);
        assert(r.cos.aplicades === 0 && r.cos.rebutjades.length === 1, JSON.stringify(r.cos));
        r = await ops(T.anna, [op('omple', { clau: 'B|M2', mat: 'M2', qty: 1 })]);
        assert(r.cos.rebutjades.length === 1);
    });
    await prova('quatre ulls: qui munta no pot verificar el seu pas', async () => {
        let r = await ops(T.joan, [op('fet', { conj: 'B' })], 'muntador');
        assert(r.cos.aplicades === 1 && r.cos.estat.fets.B.op === 'Joan', JSON.stringify(r.cos.rebutjades));
        r = await ops(T.joan, [op('verifica', { conj: 'B', resultat: 'ok' })], 'qualitat');
        assert(r.cos.rebutjades.length === 1 && /altra persona/.test(r.cos.rebutjades[0].motiu), JSON.stringify(r.cos));
    });
    await prova('un rebuig demana motiu i torna el pas al muntador', async () => {
        let r = await ops(T.pau, [op('verifica', { conj: 'B', resultat: 'ko' })]);
        assert(r.cos.rebutjades.length === 1, 'sense motiu s\'ha de rebutjar');
        r = await ops(T.pau, [op('verifica', { conj: 'B', resultat: 'ko', motiu: 'Falta un cargol' })]);
        assert(r.cos.aplicades === 1 && !r.cos.estat.fets.B && r.cos.estat.historial.length === 1);
        assert(FO_estat(r.cos.estat, 'B') === 'rebutjat');
    });
    await prova('una operació repetida s\'aplica un sol cop', async () => {
        const o = op('estoc', { mat: 'M1', delta: 1 });
        await ops(T.marc, [o]);
        const r = await ops(T.marc, [o]);
        assert(r.cos.aplicades === 0 && r.cos.estat.estoc.M1 === 7);
    });
    await prova('les ordres tenen progrés independent', async () => {
        const l = (await crida('GET', '/api/ordres/prova', undefined, T.rosa)).cos;
        const r = await crida('GET', `/api/progres/prova/${l[0].id}`, undefined, T.rosa);
        assert(r.codi === 200 && !Object.keys(r.cos.fets).length, JSON.stringify(r.cos.fets));
    });
    await prova('tancar l\'ordre la bloqueja fins que es reobre', async () => {
        assert((await ops(T.anna, [op('tanca', {})])).cos.rebutjades.length === 1, 'només el Responsable tanca');
        assert((await ops(T.rosa, [op('tanca', {})])).cos.aplicades === 1);
        assert((await ops(T.anna, [op('fet', { conj: 'B' })])).cos.rebutjades.length === 1);
        assert((await ops(T.rosa, [op('reobre', {})])).cos.aplicades === 1);
    });
    await prova('el flux en temps real avisa dels canvis', async () => {
        await espera(300);
        fl.tanca();
        assert(fl.rebuts[0].tipus === 'estat' && fl.rebuts.length >= 5, 'esdeveniments rebuts: ' + fl.rebuts.length);
    });
    await prova('fotos per ordre', async () => {
        const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
        const r = await crida('POST', `/api/fotos/prova/${ordre}`, { conj: 'A', dades: png }, T.anna);
        assert(r.codi === 200 && r.cos.fitxer, JSON.stringify(r.cos));
        const g = await crida('GET', `/api/fotos/prova/${ordre}/${r.cos.fitxer}`, undefined, T.anna);
        assert(g.codi === 200);
    });
    await prova('massa PINs incorrectes bloquegen un minut', async () => {
        for (let i = 0; i < 5; i++) await crida('POST', '/api/sessio', { nom: 'Pau', pin: '0000' });
        assert((await crida('POST', '/api/sessio', { nom: 'Pau', pin: '4444' })).codi === 429);
    });
    await prova('tancar la sessió invalida la fitxa', async () => {
        await crida('DELETE', '/api/sessio', undefined, T.marc);
        assert((await crida('GET', '/api/projectes', undefined, T.marc)).codi === 401);
    });
    await prova('no es pot deixar el taller sense cap Responsable (quedaria obert a qualsevol)', async () => {
        let r = await crida('POST', '/api/persones', { nom: 'Rosa', rols: ['responsable'], actiu: false }, T.rosa);
        assert(r.codi === 400, 'donar de baixa el darrer Responsable: ' + r.codi);
        r = await crida('POST', '/api/persones', { nom: 'Rosa', rols: ['muntador'] }, T.rosa);
        assert(r.codi === 400, 'treure-li el rol: ' + r.codi);
        assert((await crida('GET', '/api/estat')).cos.configurat === true);
        assert((await crida('POST', '/api/persones', { nom: 'Intrús', rols: ['responsable'], pin: '9999' })).codi === 401, 'sense sessió no es crea ningú');
    });
    await prova('un projecte que no existeix no deixa fitxers brossa', async () => {
        assert((await crida('GET', '/api/progres/no-existeix/OF-1', undefined, T.rosa)).codi === 404);
        assert(!fs.existsSync(path.join(DADES, 'ordres', 'no-existeix.json')));
    });
    await prova('el progrés d\'una versió anterior passa a la primera ordre', async () => {
        const dadesAntic = fs.mkdtempSync(path.join(os.tmpdir(), 'fordre-antic-'));
        fs.mkdirSync(path.join(dadesAntic, 'projectes'), { recursive: true });
        fs.mkdirSync(path.join(dadesAntic, 'progres'), { recursive: true });
        fs.writeFileSync(path.join(dadesAntic, 'projectes', 'vell.json'), JSON.stringify({ id: 'vell', nom: 'Vell', conjunts: [] }));
        fs.writeFileSync(path.join(dadesAntic, 'progres', 'vell.json'), JSON.stringify({ fets: { X: { ts: 't', op: 'Anna' } }, vist: ['a-1'], rev: 1 }));
        const port2 = PORT + 2;
        const s2 = spawn(process.execPath, [path.join(__dirname, '..', 'servidor', 'fordre-servidor.js'), '--dades', dadesAntic, '--port', port2, '--port-http', port2 + 1], { stdio: 'ignore' });
        await espera(1500);
        const r = await new Promise(ok => https.get({ host: '127.0.0.1', port: port2, path: '/api/progres/vell/OF-1', agent }, res => {
            let t = ''; res.on('data', c => { t += c; }); res.on('end', () => ok(JSON.parse(t)));
        }));
        s2.kill();
        fs.rmSync(dadesAntic, { recursive: true, force: true });
        assert(r.fets && r.fets.X, JSON.stringify(r));
    });

    srv.kill('SIGINT');
    await espera(300);
    fs.rmSync(DADES, { recursive: true, force: true });
    console.log(`\n${total - fallades}/${total} proves correctes`);
    process.exit(fallades ? 1 : 0);
})();

// Estat d'un pas calculat amb el mateix nucli que fan servir les apps
function FO_estat(p, conj) {
    globalThis.FO = globalThis.FO || {};
    require(path.join(__dirname, '..', 'js', 'fo-progres.js'));
    return globalThis.FO.estatPas(globalThis.FO.normalitzaProgres(p), conj, false);
}
