# Servidor del taller

El servidor fa que tots els mòbils, tauletes i ordinadors del taller comparteixin el projecte, les ordres de fabricació, el progrés, l'estoc, el registre i les fotos **en temps real**, sense necessitat d'internet. També guarda les **persones** del taller amb el seu PIN i els seus rols, i comprova que cada acció la fa qui la pot fer.

- Funciona en una **Raspberry Pi** (3, 4 o 5) o en qualsevol ordinador amb **Windows, Linux o macOS**.
- Només necessita **Node.js 18 o superior**. No cal instal·lar res més: tot el servidor és el fitxer `fordre-servidor.js`.
- Serveix les dues apps per la Wi-Fi del taller, amb un certificat HTTPS propi: la càmera (l'escàner) només funciona en connexions segures.
- Si un mòbil perd la Wi-Fi, continua funcionant i envia els canvis (i les fotos) quan torna. Si dues persones treballen alhora, no es trepitgen: l'estoc se suma i cada acció s'aplica una sola vegada.

## Raspberry Pi (o Linux amb systemd)

1. Instal·la la Raspberry Pi OS i connecta-la a la xarxa del taller.
2. Obre un terminal a la Raspberry Pi i executa:

   ```bash
   git clone https://github.com/Bioquad/FOrdre.git
   cd FOrdre
   sudo bash servidor/configura-raspberry.sh
   ```

   L'script instal·la Node.js si no hi és i crea el servei `fordre`, que arrenca sol cada cop que s'encén la Raspberry Pi.
3. Al final, l'script mostra les adreces. Per veure el QR per al mòbil:

   ```bash
   journalctl -u fordre -f
   ```

Ordres útils:

| Acció | Ordre |
|---|---|
| Veure el registre i el QR | `journalctl -u fordre -f` |
| Aturar / reiniciar | `sudo systemctl stop fordre` · `sudo systemctl restart fordre` |
| Actualitzar FOrdre | `cd FOrdre && git pull && sudo systemctl restart fordre` |
| Posar una clau al taller | `FORDRE_CLAU=1234 sudo -E bash servidor/configura-raspberry.sh` |
| Canviar els ports | `FORDRE_PORT=9443 FORDRE_PORT_HTTP=9080 sudo -E bash servidor/configura-raspberry.sh` |

## Windows

1. Instal·la **Node.js** (versió LTS) des de <https://nodejs.org>.
2. Descarrega FOrdre (botó verd **Code › Download ZIP** a GitHub) i descomprimeix-lo.
3. Obre la carpeta `servidor` i fes doble clic a **`inicia-windows.bat`**.
4. Si Windows pregunta pel tallafoc, permet l'accés a les **xarxes privades**.

Per aturar-lo, tanca la finestra. Perquè arrenqui sol, posa una drecera d'`inicia-windows.bat` a la carpeta d'inici (`Win + R` › `shell:startup`).

## Linux o macOS (a mà)

```bash
bash servidor/inicia.sh
```

## Primer cop a cada mòbil o tauleta

1. Connecta l'aparell a la mateixa Wi-Fi.
2. Escaneja el QR que mostra el servidor en arrencar, o obre `http://<adreça-del-servidor>:8080`.
3. A la pàgina que s'obre:
   - **Recomanat:** descarrega el certificat del taller i instal·la'l com a certificat de CA. Després ja no sortirà cap avís.
     - **Android:** Configuració › Seguretat › Xifratge i credencials › Instal·la un certificat › Certificat de CA.
     - **iPhone / iPad:** obre el fitxer, instal·la el perfil, i activa'l a Configuració › General › Informació › Confiança de certificats.
     - **Windows:** doble clic al fitxer › Instal·la el certificat › Màquina local › «Entitats de certificació arrel de confiança».
   - **O bé:** obre l'app i accepta l'avís de seguretat del navegador («Configuració avançada › Continua»).
4. Entra amb el teu nom i PIN (vegeu *Persones i rols*).

Si la Raspberry Pi canvia d'adreça IP, el servidor genera un certificat nou i caldrà tornar-lo a instal·lar. Per evitar-ho, dona-li una **IP fixa** al router, o fes servir sempre el nom de xarxa (`https://raspberrypi.local:8443`).

## Persones i rols

La primera vegada que s'obre l'app amb el servidor, demana crear el **Responsable** (nom i PIN de 4 a 8 xifres). Després, el Responsable dona d'alta la resta de persones a **📋 Tauler › 👥 Persones**, cadascuna amb un o més rols:

| Rol | Pot fer |
|---|---|
| 📦 Magatzem | Omplir i buidar caixes, estoc, tornar caixes |
| 🔧 Muntador | Agafar caixes, començar i marcar passos com a muntats, tornar caixes |
| ✅ Qualitat | Verificar (aprovar o rebutjar amb motiu) i resoldre incidències |
| 📋 Responsable | Tot l'anterior, i a més publicar projectes, obrir i tancar ordres, assignar passos i gestionar persones |

Tothom pot obrir incidències, fer fotos i consultar el registre i els resultats. Qui ha muntat un pas **no** el pot verificar (regla dels quatre ulls; el Responsable sí que pot). El PIN no es guarda mai: només un resum xifrat. Cinc PIN erronis seguits bloquegen l'entrada un minut.

## Com es fa servir

1. **Ordinador:** obre `https://<servidor>:8443/index.html`, prepara el projecte i prem **🏭 Taller**. Entra com a Responsable i **publica el projecte**. Des del mateix diàleg pots crear **ordres de fabricació** (una per unitat, amb número de sèrie), veure l'estat de cada pas en directe i obrir l'**informe** de l'ordre.
2. **Mòbils i tauletes:** obre `https://<servidor>:8443/muntatge.html`, entra amb nom i PIN i tria el rol a la capçalera. L'ordre de treball es tria tocant el seu codi (p. ex. `OF-2026-001`).
   - **Accés directe per rol:** `https://<servidor>:8443/muntatge.html?rol=magatzem` (o `muntador`, `qualitat`, `responsable`) obre l'app amb aquell rol. Són útils per desar-los com a icona a l'aparell de cada lloc de treball (la tauleta del magatzem, la de la línia de muntatge…). La pàgina d'ajuda `http://<servidor>:8080` en té els enllaços. Si la persona no té aquell rol, l'app l'avisa i fa servir el seu.
3. El punt de color de la capçalera indica l'estat:
   - 🟢 connectat;
   - 🟠 hi ha canvis per enviar (o el projecte no és al servidor);
   - 🔴 sense connexió (els canvis i les fotos es guarden i s'envien sols quan torna);
   - ⟳ el projecte s'ha actualitzat a l'ordinador (toca'l per carregar-lo).

Cada ordre té el seu progrés, registre i informe. En crear-la, es guarda l'empremta del projecte publicat: si després es modifica, l'informe ho avisa.

## Dades

Tot es guarda a `servidor/dades/`: `projectes/`, `ordres/`, `progres/` (un fitxer per projecte i ordre, amb una còpia `.bak` de l'estat anterior), `fotos/`, `persones.json` (persones, rols i resum dels PIN) i `certificat/`. El progrés d'una versió anterior del servidor passa sol a la primera ordre. Per fer-ne una còpia de seguretat, copia aquesta carpeta. Git no la puja al repositori.

## Opcions

```
node servidor/fordre-servidor.js [--port 8443] [--port-http 8080] [--dades carpeta] [--clau PIN] [--nou-certificat]
```

Amb `--clau`, cal escriure la clau al menú de l'app del taller: és una barrera addicional de xarxa, a part del PIN de cada persona. La xarxa del taller ha de ser de confiança: el servidor no està pensat per exposar-lo a internet.
