# Servidor del taller

El servidor fa que tots els mòbils, tauletes i ordinadors del taller comparteixin el projecte, el progrés del muntatge, l'estoc, el registre i les fotos **en temps real**, sense necessitat d'internet.

- Funciona en una **Raspberry Pi** (3, 4 o 5) o en qualsevol ordinador amb **Windows, Linux o macOS**.
- Només necessita **Node.js 18 o superior**. No cal instal·lar res més: tot el servidor és el fitxer `fordre-servidor.js`.
- Serveix les dues apps per la Wi-Fi del taller, amb un certificat HTTPS propi: la càmera (l'escàner) només funciona en connexions segures.
- Si un mòbil perd la Wi-Fi, continua funcionant i envia els canvis quan torna. Si dues persones treballen alhora, no es trepitgen: l'estoc se suma i cada acció s'aplica una sola vegada.

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
4. A l'app de muntatge, al menú ⋮, escriu el teu nom a **Operari**. Surt al registre.

Si la Raspberry Pi canvia d'adreça IP, el servidor genera un certificat nou i caldrà tornar-lo a instal·lar. Per evitar-ho, dona-li una **IP fixa** al router, o fes servir sempre el nom de xarxa (`https://raspberrypi.local:8443`).

## Com es fa servir

- A l'ordinador, obre `https://<servidor>:8443/index.html`, prepara el projecte i prem **🏭 Taller › Publicar aquest projecte**. Des del mateix diàleg es veu el progrés de tots els passos en directe.
- Als mòbils i tauletes, obre `https://<servidor>:8443/muntatge.html`: el projecte es carrega sol. El punt de color de la capçalera indica l'estat:
  - 🟢 connectat;
  - 🟠 hi ha canvis per enviar;
  - 🔴 sense connexió (els canvis es guarden i s'envien després);
  - ⟳ el projecte s'ha actualitzat a l'ordinador (toca'l per carregar-lo).

## Dades

Tot es guarda a `servidor/dades/`: `projectes/`, `progres/` (amb una còpia `.bak` de l'estat anterior), `fotos/` i `certificat/`. Per fer-ne una còpia de seguretat, copia aquesta carpeta. Git no la puja al repositori.

## Opcions

```
node servidor/fordre-servidor.js [--port 8443] [--port-http 8080] [--dades carpeta] [--clau PIN] [--nou-certificat]
```

Amb `--clau`, cal escriure la clau al menú de l'app de muntatge. La xarxa del taller ha de ser de confiança: el servidor no està pensat per exposar-lo a internet.
