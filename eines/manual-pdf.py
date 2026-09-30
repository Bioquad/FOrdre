#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════
# FOrdre — genera els manuals en HTML (i, amb Node + Playwright, en PDF)
# a partir de docs/MANUAL.md (català), MANUAL.es.md i MANUAL.en.md. Conversor de Markdown mínim, sense
# dependències: títols, paràgrafs, llistes (també niades), taules,
# blocs de codi, cites, imatges, enllaços, negreta, cursiva i codi.
# Ús:  python3 eines/manual-pdf.py [ca] [es] [en]   (sense res, els tres)
# ═══════════════════════════════════════════════════════════════
import html, os, re, subprocess, sys, unicodedata

ARREL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ARREL, 'docs')

def slug(t):
    """Àncora com les de GitHub: minúscules, sense signes, espais → guions."""
    t = re.sub(r'[`*_]', '', t).strip().lower()
    t = ''.join(c for c in t if unicodedata.category(c)[0] in 'LN' or c in ' -')
    return t.replace(' ', '-')

def enlinia(t):
    """Format dins d'una línia."""
    codis = []
    def guarda(m): codis.append(m.group(1)); return f'\x00{len(codis) - 1}\x00'
    t = re.sub(r'`([^`]+)`', guarda, t)
    t = t.replace('\\|', '\x01')
    t = html.escape(t, quote=False)
    t = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', lambda m: f'<img src="{m.group(2)}" alt="{m.group(1)}"' + (' class="mobil"' if os.path.basename(m.group(2)).startswith('t') else '') + '>', t)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', t)
    t = re.sub(r'(?<![\w/])(https?://[^\s<)]+[\w/])', r'<a href="\1">\1</a>', t) if '<a ' not in t else t
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)', r'<i>\1</i>', t)
    t = re.sub(r'\x00(\d+)\x00', lambda m: '<code>' + html.escape(codis[int(m.group(1))].replace('\\|', '|'), quote=False) + '</code>', t)
    return t.replace('\x01', '|')

def converteix(md):
    out, linies, i = [], md.split('\n'), 0
    while i < len(linies):
        l = linies[i]
        if l.startswith('```'):                                    # bloc de codi
            j = i + 1
            while j < len(linies) and not linies[j].startswith('```'): j += 1
            out.append('<pre><code>' + html.escape('\n'.join(linies[i + 1:j])) + '</code></pre>'); i = j + 1; continue
        m = re.match(r'^(#{1,6})\s+(.*)', l)
        if m:                                                      # títol
            n, t = len(m.group(1)), m.group(2)
            out.append(f'<h{n} id="{slug(t)}">{enlinia(t)}</h{n}>'); i += 1; continue
        if l.strip() == '---': out.append('<hr>'); i += 1; continue
        if l.startswith('|'):                                      # taula
            files = []
            while i < len(linies) and linies[i].startswith('|'): files.append(linies[i]); i += 1
            cel = lambda f: [c.strip() for c in re.split(r'(?<!\\)\|', f.strip())[1:-1]]
            cap, cos = cel(files[0]), [cel(f) for f in files[2:]]
            alin = ['center' if re.match(r'^:-+:$', a) else '' for a in cel(files[1])]
            td = lambda c, k, tag: f'<{tag}' + (f' style="text-align:center"' if k < len(alin) and alin[k] else '') + f'>{enlinia(c)}</{tag}>'
            out.append('<table><thead><tr>' + ''.join(td(c, k, 'th') for k, c in enumerate(cap)) + '</tr></thead><tbody>' +
                       ''.join('<tr>' + ''.join(td(c, k, 'td') for k, c in enumerate(f)) + '</tr>' for f in cos) + '</tbody></table>')
            continue
        if l.startswith('>'):                                      # cita
            bloc = []
            while i < len(linies) and linies[i].startswith('>'): bloc.append(linies[i].lstrip('> ')); i += 1
            out.append('<blockquote>' + enlinia(' '.join(bloc)) + '</blockquote>'); continue
        if re.match(r'^\s*([-*]|\d+\.)\s', l):                     # llista (amb nivells per sagnat)
            bloc = []
            while i < len(linies) and (re.match(r'^\s*([-*]|\d+\.)\s', linies[i]) or (linies[i].startswith('   ') and linies[i].strip())):
                bloc.append(linies[i]); i += 1
            out.append(llista(bloc)); continue
        if not l.strip(): i += 1; continue
        par = []                                                   # paràgraf
        while i < len(linies) and linies[i].strip() and not re.match(r'^(#|```|\||>|\s*([-*]|\d+\.)\s|---)', linies[i]):
            par.append(linies[i].strip()); i += 1
        out.append('<p>' + enlinia(' '.join(par)) + '</p>')
    return '\n'.join(out)

def llista(bloc):
    """Llistes niades: el sagnat decideix el nivell."""
    res, pila = [], []
    for l in bloc:
        m = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)', l)
        if not m:                                                  # continuació del mateix element
            res[-1] = res[-1][:-5] + ' ' + enlinia(l.strip()) + '</li>'; continue
        sag, tipus = len(m.group(1)), 'ol' if m.group(2)[0].isdigit() else 'ul'
        while pila and pila[-1][0] > sag: res.append(f'</{pila.pop()[1]}>')
        if not pila or pila[-1][0] < sag:
            pila.append((sag, tipus)); res.append(f'<{tipus}>')
        res.append('<li>' + enlinia(m.group(3)) + '</li>')
    while pila: res.append(f'</{pila.pop()[1]}>')
    # els subnivells han d'anar dins de l'element anterior
    return re.sub(r'</li>(<(?:ul|ol)>)', r'\1', ''.join(res)).replace('</ul></li>', '</ul></li>')

CSS = """
@page { size: A4; margin: 16mm 14mm 18mm }
body { font-family: 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif; color: #1c1f2e; font-size: 10.5pt; line-height: 1.5; max-width: 900px; margin: 0 auto; padding: 0 12px }
h1 { font-size: 26pt; color: #1C1C30; margin: 0 0 4px } h1 + p { font-size: 12pt; color: #4A90D9 }
h2 { font-size: 17pt; color: #1C1C30; border-bottom: 3px solid #4A90D9; padding-bottom: 3px; margin-top: 28px; break-before: page }
h2#índex { break-before: auto }
h3 { font-size: 13pt; color: #2d5f99; margin-top: 20px; break-after: avoid }
h4 { font-size: 11pt; break-after: avoid }
table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; font-size: 9.5pt; break-inside: auto }
th, td { border: 1px solid #cfd4e0; padding: 4px 6px; text-align: left; vertical-align: top }
th { background: #eef2f9 } tr { break-inside: avoid }
code { font-family: Consolas, 'SF Mono', monospace; background: #f1f3f8; padding: 0 3px; border-radius: 3px; font-size: 9pt }
pre { background: #1C1C30; color: #e8ebf5; padding: 10px 12px; border-radius: 6px; font-size: 8.8pt; white-space: pre-wrap; break-inside: avoid }
pre code { background: none; color: inherit; padding: 0 }
blockquote { border-left: 4px solid #E8A838; background: #fff8ec; margin: 10px 0; padding: 6px 12px }
img { max-width: 100%; border: 1px solid #cfd4e0; border-radius: 6px; display: block; margin: 8px auto; break-inside: avoid }
img.mobil { max-width: 270px }
td img.mobil { max-width: 230px }
a { color: #2d6fb9; text-decoration: none }
hr { border: none; border-top: 1px solid #cfd4e0; margin: 18px 0 }
li { margin: 2px 0 }
"""

# Un manual per idioma: (fitxer Markdown, idioma, títol)
MANUALS = [('MANUAL.md', 'ca', 'Manual de FOrdre'), ('MANUAL.es.md', 'es', 'Manual de FOrdre'), ('MANUAL.en.md', 'en', 'FOrdre Manual')]

def genera(nom, lang, titol):
    fm = os.path.join(DOCS, nom)
    if not os.path.exists(fm):
        return
    md = open(fm, encoding='utf-8').read()
    # els enllaços entre manuals apunten a la versió HTML
    md = re.sub(r'\]\((MANUAL(?:\.\w\w)?)\.md\)', r'](\1.html)', md)
    cos = converteix(md)
    base = nom[:-3]
    pag = f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{titol}</title><style>{CSS}</style></head><body>{cos}</body></html>'
    fh = os.path.join(DOCS, base + '.html')
    open(fh, 'w', encoding='utf-8').write(pag)
    print('✓', os.path.relpath(fh, ARREL))
    # PDF amb Chromium (Playwright), si hi és
    fp = os.path.join(DOCS, base + '.pdf')
    js = f"""
    const {{ chromium }} = require(process.env.PLAYWRIGHT || 'playwright');
    (async () => {{
      const b = await chromium.launch(); const p = await b.newPage();
      await p.goto('file://{fh}'); await p.waitForTimeout(1500);
      await p.pdf({{ path: '{fp}', format: 'A4', printBackground: true, displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#888">{titol} · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        margin: {{ top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' }} }});
      await b.close();
    }})();"""
    r = subprocess.run(['node', '-e', js], capture_output=True, text=True)
    print('✓ ' + os.path.relpath(fp, ARREL) if r.returncode == 0 else '⚠ Sense PDF (cal Node i Playwright): ' + r.stderr.strip()[:300])

def main():
    # sense arguments, els tres idiomes; amb arguments, només els indicats (ca, es, en)
    tria = sys.argv[1:]
    for nom, lang, titol in MANUALS:
        if not tria or lang in tria:
            genera(nom, lang, titol)

if __name__ == '__main__':
    main()
