# Gera o ícone do Vorticis Emite NFS a partir do vórtice da família Vorticis (github.com/hellisonvidal/Vorticis),
# recolorido no azul do app (#4F46E5 → #06B6D4) e com o selo "NF", no mesmo padrão dos demais produtos.
# Uso: python3 scripts/gerar-icone-vorticis.py <VorticisEscritorio-512.png> [saida.png]
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ORIGEM = sys.argv[1]
SAIDA = sys.argv[2] if len(sys.argv) > 2 else 'public/img/icone.png'
FONTE = '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'
N = 512
CX = CY = 382; R = 130                       # selo original (centro e raio, com borda branca)
AZUL1 = np.array([0x4F, 0x46, 0xE5]); AZUL2 = np.array([0x06, 0xB6, 0xD4]); ESCURO = np.array([0x31, 0x2E, 0x81])

a = np.array(Image.open(ORIGEM).convert('RGBA')).astype(float)
yy, xx = np.mgrid[0:N, 0:N]
# remove o selo original
a[(xx - CX) ** 2 + (yy - CY) ** 2 <= (R + 16) ** 2, 3] = 0
# recolore o vórtice: gradiente diagonal; traços escuros (marinho) ficam em índigo profundo
lum = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) / 255
t = np.clip((xx + yy) / (1.5 * N), 0, 1)[..., None]
grad = AZUL1 * (1 - t) + AZUL2 * t
k = np.clip((lum - 0.04) / 0.22, 0, 1)[..., None]
rgb = ESCURO * (1 - k) + grad * k
img = Image.fromarray(np.dstack([rgb, a[..., 3]]).clip(0, 255).astype(np.uint8), 'RGBA')

# selo "NF" (supersampling para bordas suaves)
S = 4
selo = Image.new('RGBA', (N * S, N * S), (0, 0, 0, 0))
d = ImageDraw.Draw(selo)
d.ellipse([(CX - R) * S, (CY - R) * S, (CX + R) * S, (CY + R) * S], fill=(255, 255, 255, 255))
ri = R - 12
# preenchimento com gradiente índigo → azul
g = Image.new('RGBA', (2 * ri * S, 2 * ri * S))
gy, gx = np.mgrid[0:2 * ri * S, 0:2 * ri * S]
tt = ((gx + gy) / (4 * ri * S))[..., None]
c1, c2 = np.array([0x43, 0x38, 0xCA]), np.array([0x25, 0x63, 0xEB])
g = Image.fromarray(np.dstack([c1 * (1 - tt) + c2 * tt, np.full(gx.shape, 255)]).astype(np.uint8), 'RGBA')
m = Image.new('L', g.size, 0); ImageDraw.Draw(m).ellipse([0, 0, g.size[0] - 1, g.size[1] - 1], fill=255)
selo.paste(g, ((CX - ri) * S, (CY - ri) * S), m)
f = ImageFont.truetype(FONTE, 118 * S)
bb = d.textbbox((0, 0), 'NF', font=f)
d.text((CX * S - (bb[0] + bb[2]) / 2, CY * S - (bb[1] + bb[3]) / 2), 'NF', font=f, fill=(255, 255, 255, 255))
img.alpha_composite(selo.resize((N, N), Image.LANCZOS))
img.save(SAIDA)
print('ícone gerado:', SAIDA)
