# 📦 FOrdre

[![Three.js](https://img.shields.io/badge/Three.js-r128-black?style=flat&logo=three.js)](https://threejs.org/)
[![HTML5](https://img.shields.io/badge/Sense_instal·lació-HTML_+_JS-orange?style=flat&logo=html5)](#)
[![License](https://img.shields.io/badge/License-CERN--OHL--S--2.0-blue.svg)](LICENSE)

> **Kits de muntatge ordenats: safates a mida per imprimir en 3D i etiquetes per a cada peça.**
> *Kits de montaje ordenados: bandejas a medida para imprimir en 3D y etiquetas para cada pieza.*
> *Ordered assembly kits: custom 3D-printable trays and labels for every part.*

🌐 [Català](#català) | [Español](#-español) | [English](#-english)

## 🚀 Prova-ho

👉 **[Obrir FOrdre](./index.html)**

[![Live Demo](https://img.shields.io/badge/🌐_Demo-4A90D9?style=for-the-badge&logo=githubpages)](https://Bioquad.github.io/FOrdre/)

---

## Català

Quan una màquina té centenars de peces (plaques metàl·liques, peces de fibra de vidre, plàstics, impressions 3D, electrònica, cargoleria, mànegues, fluids…) i es munta per fases (peces → subconjunts → conjunts → màquina), es perd molt de temps buscant i ordenant material. **FOrdre** prepara, per a cada pas de muntatge, un **kit**: una safata amb un caixetí a mida per a cada material, identificat amb una etiqueta.

### Com funciona

1. **Arbre de muntatge.** Defineix la màquina, els conjunts i els subconjunts, i els materials que es munten a cada un (amb la quantitat). Es pot fer a mà o **importar-lo**:
   - d'un **Excel / CSV** propi (una fila per material, amb la columna del conjunt),
   - d'una **BOM indentada de CAD** (FreeCAD, Fusion 360, SolidWorks, Inventor, Onshape…) amb columna de nivell `1 · 1.1 · 1.1.2`.
   Les columnes es reconeixen en català, castellà i anglès, i es poden corregir abans d'importar. Unitats en mm/cm/m/polzades i g/kg/lb.
2. **Propietats de cada material:** mides, pes, forma, tipus (peça, cargoleria, consumible), **sensible a l'ESD**, **conté líquids**, **inclinació màxima** (si es pot tombar), **apilable** (i quantes), fragilitat, i com s'ha de posar: individual, apilada, en capa o a granel.
3. **Càlcul dels caixetins.** Cada material té el seu caixetí (mai no se'n barregen dos). La mida surt de les mides de la peça, la quantitat i la disposició:
   - *individual*: una cel·la per unitat, amb divisors (peces fràgils, líquids);
   - *apilada*: piles fins a la fondària màxima;
   - *en capa*: una sola capa, amb espai per als dits;
   - *a granel*: volum segons la quantitat (cargols, volanderes…), amb el fons elevat perquè quedin a l'abast.
   Les peces que porten líquids o no es poden tombar van dretes, amb prou fondària perquè no bolquin.
4. **Safates.** Els caixetins d'un conjunt es col·loquen dins el llit de la teva impressora. Si no hi caben, el kit es reparteix en diverses safates (A, B…). Les peces **ESD** van a una safata pròpia (per imprimir amb filament antiestàtic) i els **consumibles** (coles, frenafils, brides, etiquetes…) al darrere. Opcionalment, les safates poden anar **inclinades** sobre una falca amb tope; la inclinació es limita automàticament si hi ha peces que no es poden tombar. Un llavi a les parets evita vessaments en moure-les.
5. **Format del kit** (per a tot el projecte o per a cada conjunt):
   - **Safata fusionada**: una sola peça amb tots els caixetins.
   - **Caixes individuals**: una caixa per material, cadascuna del seu color i material.
   - **Caixes + contenidor**: les caixes individuals dins un **contenidor general** obert per dalt (amb osques per agafar-les) per transportar tot el kit alhora.
   - **Mixt**: els materials petits en un bloc de caixetins fusionats, els grans en caixes individuals, tot dins el contenidor.
6. **Materials i colors d'impressió.** PLA, PETG, ABS, ASA, PC, PA, PP, TPU, PETG-ESD o PLA-CF, per defecte, per conjunt (caixes i contenidor) o per a la caixa de cada material. Les caixes de peces ESD es fan automàticament en material antiestàtic. El color de les caixes individuals pot ser el del material, el del conjunt, per tipus o fix, o triat a mà; els colors automàtics s'ajusten als filaments que tinguis. FOrdre calcula els **grams de filament** per material i color.
7. **Grups de grups.** Un conjunt pot tenir les dades de la **peça ja muntada** (mides, pes, ESD, líquids…) i les unitats que en necessita el pare. Llavors té una **caixa de guarda** pròpia i entra com una peça més al muntatge del conjunt pare. Si un subconjunt es munta diverses vegades, els materials del seu kit es multipliquen.
8. **Vista 3D** de totes les safates amb les peces a dins, ordenades per pas de muntatge. Tria un conjunt a l'arbre i se'n ressalten les safates; tria un material i es marca el seu caixetí, amb un cartell que mostra l'etiqueta.
9. **Sortides:**
   - **STL** de cada safata, caixa, contenidor i falca (o tot en un ZIP amb un `LLEGEIX-ME.txt` i el filament necessari). El nom de cada fitxer porta el material i el color. Els sòlids són tancats, llestos per laminar.
   - **Etiquetes** per a qualsevol format: cintes de 9/12/18/24 mm (Brother, Dymo…), rotlles tèrmics, fulls A4 adhesius o a mida. Porten el codi, el nom, la quantitat, el pas, el conjunt, els colors del material i del conjunt, **QR** i **codi de barres** Code 128. L'etiqueta s'adapta a l'amplada del caixetí.
   - **RFID / NFC:** CSV amb les dades i un EPC de 96 bits per a gravadores RFID. Amb Chrome per a Android es poden escriure etiquetes NFC directament.
   - **Full de ruta** imprimible: passos, subconjunts que cal tenir muntats, mapa de cada safata i llista de comprovació.
   - **Llista de materials** (CSV) amb el total de cada material per a tota la màquina.

### Fitxers

| Fitxer | Contingut |
|---|---|
| `index.html` | Aplicació (obre-la amb el navegador; no cal servidor) |
| `js/fo-dades.js` | Model de dades, arbre i ordre de muntatge |
| `js/fo-calcul.js` | Mida dels caixetins i distribució en safates |
| `js/fo-stl.js` | Geometria de les safates, STL i ZIP |
| `js/fo-etiquetes.js` | Etiquetes, QR, Code 128, RFID/NFC |
| `js/fo-importa.js` | Importació CSV / Excel / BOM de CAD |
| `js/fo-vista3d.js` | Vista 3D |
| `js/fo-app.js` | Interfície |
| `exemples/` | Projecte d'exemple, plantilla CSV i BOM de mostra |
| `proves/proves.js` | Proves del nucli: `node proves/proves.js` |

El projecte es desa en un fitxer `.fordre.json`. El navegador també en guarda una còpia local per comoditat.

Dependències (CDN): Three.js r128, qrcode-generator i SheetJS (només per llegir Excel; sense aquesta llibreria es poden importar CSV).

---

## 🇪🇸 Español

FOrdre prepara, para cada paso de montaje de una máquina, un **kit**: bandeja fusionada, cajas individuales, cajas dentro de un contenedor general o mixto, con un compartimento a medida para cada material (nunca se mezclan), en el material y color de impresión que elijas y una etiqueta para cada uno (código, nombre, cantidad, colores, QR, código de barras, RFID/NFC). Importa listas desde Excel/CSV o BOM indentadas de CAD, separa las piezas ESD en su propia bandeja, mantiene verticales las piezas con líquidos, admite bandejas inclinadas con cuña y genera cajas de almacenaje para subconjuntos ya montados, que entran como una pieza más en el conjunto padre. Visualización 3D, exportación STL/ZIP, hoja de ruta imprimible y lista de materiales.

## 🇬🇧 English

FOrdre builds an **assembly kit** for every step of a machine build: a fused tray, individual boxes, boxes inside an open-top carrier, or a mix, with a custom-sized pocket for each part (never mixed), in the print material and colour you choose and a label for each pocket (code, name, quantity, colours, QR, Code 128 barcode, RFID/NFC data). It imports Excel/CSV lists and indented CAD BOMs, puts ESD-sensitive parts in their own tray, keeps liquid-filled parts upright, supports tilted trays on a printed wedge, and creates storage boxes for finished sub-assemblies, which then become parts of their parent assembly. 3D preview, STL/ZIP export, printable route sheet and bill of materials.

---

Basat en [FDins](https://github.com/Bioquad/FDins). © Bioquad — [CERN Open Hardware Licence v2 – Strongly Reciprocal](LICENSE).
