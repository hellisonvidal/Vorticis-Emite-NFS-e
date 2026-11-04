"""Converte as planilhas oficiais do Sistema Nacional NFS-e (gov.br/nfse) em JSON.
Uso: python3 scripts/importar_tabelas.py <pasta_com_xlsx> <pasta_saida>
"""
import json, re, sys, os
import openpyxl

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

def wb(name):
    for f in os.listdir(src):
        if f.startswith(name) and f.endswith('.xlsx'):
            return openpyxl.load_workbook(os.path.join(src, f), read_only=True, data_only=True)
    raise SystemExit('Planilha nao encontrada: ' + name)

def s(v):
    return re.sub(r'\s+', ' ', str(v)).strip() if v is not None else ''

def dump(name, data):
    with open(os.path.join(out, name), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(name, len(data))

# ---------- Lista de serviços nacional (cTribNac) + NBS ----------
b = wb('anexo_b-nbs2')
lista = []
for i, r in enumerate(b['LISTA.SERV.NAC.'].iter_rows(values_only=True)):
    if i == 0 or r[1] is None: continue
    item, sub, des = int(r[1]), int(r[2]), int(r[3])
    nivel = 'item' if sub == 0 else ('subitem' if des == 0 else 'desdobro')
    codigo = f'{item:02d}{sub:02d}{des:02d}'
    lista.append({'codigo': codigo, 'item': f'{item:02d}', 'subitem': f'{item:02d}.{sub:02d}' if sub else '',
                  'nivel': nivel, 'descricao': s(r[4])})

nbs = []
for i, r in enumerate(b['LISTA.NBS_v2.0'].iter_rows(values_only=True)):
    if i == 0 or r[0] is None: continue
    cod = s(r[0])
    if re.fullmatch(r'\d{5}', cod):  # linha de cabeçalho/seção ex: 10101 -> 1.0101
        cod = cod[0] + '.' + cod[1:]
    digits = re.sub(r'\D', '', cod)
    nbs.append({'codigo': cod, 'cNBS': digits if len(digits) == 9 else '', 'descricao': s(r[1])})

# ---------- Incidência / grupos obrigatórios ----------
a1 = wb('anexo_i-sefin')
inc = {}
for i, r in enumerate(a1['MUN.INCID_INFO.SERV.'].iter_rows(values_only=True)):
    if i < 4 or r[0] is None: continue
    cod = re.sub(r'\D', '', s(r[0])).zfill(6)
    if len(cod) != 6: continue
    locais = [n for n, v in zip(['Estabelecimento do prestador', 'Local da prestação', 'Estabelecimento do tomador'], r[2:5]) if s(v).upper() == 'X']
    inc[cod] = {'local': locais, 'grupo': s(r[6]) if s(r[6]) not in ('-', '') else '', 'infoCompl': s(r[7]) if s(r[7]) not in ('-', 'X', '') else ''}
for l in lista:
    if l['codigo'] in inc:
        l.update({'incidencia': inc[l['codigo']]['local'], 'grupoObrigatorio': inc[l['codigo']]['grupo']})

# ---------- Correlação Item LC116 x NBS x indOp x cClassTrib ----------
c = wb('anexo_viii-tabela-correlacao')
corr = {}
classtrib = {}
item = desc_item = nbs_cod = nbs_desc = ativ = loc = None
indops = []
for i, r in enumerate(c['tabela geral'].iter_rows(values_only=True)):
    if i == 0: continue
    r = list(r) + [None] * 12
    if r[0]:
        item, desc_item, ativ, loc = s(r[0]), s(r[1]), s(r[5]), s(r[7])
    if r[2]:
        nbs_cod, nbs_desc = s(r[2]), s(r[3])
    if r[7]: loc = s(r[7])
    if not item or not nbs_cod: continue
    key = (item, nbs_cod)
    e = corr.setdefault(key, {'item': item, 'descItem': desc_item, 'nbs': nbs_cod, 'descNbs': nbs_desc,
                              'ativSN': ativ, 'localIncidIBS': loc, 'indOp': [], 'cClassTrib': []})
    if r[6]:
        for op in re.findall(r'\d{6}', s(r[6])):
            if op not in e['indOp']: e['indOp'].append(op)
    if r[8]:
        ct = re.sub(r'\D', '', s(r[8])).zfill(6)
        if ct not in e['cClassTrib']: e['cClassTrib'].append(ct)
        classtrib.setdefault(ct, s(r[9]))
corr_list = list(corr.values())

# ---------- indOp ----------
d = wb('anexovii-indop')
indop = []
for i, r in enumerate(d.worksheets[0].iter_rows(values_only=True)):
    if i == 0 or not r[0]: continue
    cod = re.sub(r'\D', '', s(r[0]))
    if len(cod) != 6: continue
    indop.append({'codigo': cod, 'tipo': s(r[1]), 'caracteristica': s(r[2]), 'local': s(r[3]), 'legal': s(r[4]),
                  'nfse': s(r[7]).upper() == 'S', 'localIncidNFSe': s(r[9])})

# ---------- cClassTrib ----------
CST = {'000': 'Tributação integral', '010': 'Tributação com alíquotas uniformes', '011': 'Tributação com alíquotas uniformes reduzidas',
       '200': 'Alíquota reduzida', '210': 'Redução de alíquota com redutor de base de cálculo', '220': 'Alíquota fixa',
       '221': 'Alíquota fixa proporcional', '222': 'Redução de base de cálculo', '400': 'Isenção', '410': 'Imunidade e não incidência',
       '510': 'Diferimento', '515': 'Diferimento com redução de alíquota', '550': 'Suspensão', '620': 'Tributação monofásica',
       '800': 'Transferência de crédito', '810': 'Ajuste de IBS na ZFM', '811': 'Ajustes', '820': 'Tributação em declaração de regime específico',
       '830': 'Exclusão da base de cálculo'}
# Percentuais de redução de alíquota de referência (LC 214/2025) - conferir antes de usar
RED = {'011001': 60, '011003': 60, '011005': 30, '200016': 60, '200021': 60, '200025': 100, '200026': 80,
       '200027': 70, '200028': 60, '200029': 60, '200037': 60, '200038': 60, '200039': 60, '200040': 60,
       '200041': 60, '200042': 60, '200043': 60, '200044': 60, '200045': 60, '200046': 50, '200048': 40,
       '200051': 40, '200052': 30}
ct_list = []
for k in sorted(classtrib):
    nome = classtrib[k]
    m = re.search(r'(\d{2,3})\s?%', nome)
    red = RED.get(k, 0)
    if k.startswith('200') and m: red = int(m.group(1))
    if k[:3] in ('400', '410'): red = 100
    ct_list.append({'codigo': k, 'cst': k[:3], 'descCst': CST.get(k[:3], ''), 'nome': nome, 'pRedAliq': red})

# ---------- Municípios / países ----------
a = wb('anexo_a-municipio')
UF_IBGE = {'11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN',
           '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC',
           '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF'}
mun = []
for i, r in enumerate(a['TAB.MUN_IBGE'].iter_rows(values_only=True)):
    if i == 0 or not r[3]: continue
    cod = s(r[3])
    mun.append({'codigo': cod, 'nome': s(r[2]), 'uf': s(r[1]) or UF_IBGE.get(cod[:2], '')})
paises = []
for i, r in enumerate(a['TAB.PAÍS_ISO2'].iter_rows(values_only=True)):
    if i == 0 or not r[0]: continue
    paises.append({'codigo': s(r[0]), 'nome': s(r[1])})

dump('ctribnac.json', lista)
dump('nbs.json', nbs)
dump('correlacao.json', corr_list)
dump('indop.json', indop)
dump('cclasstrib.json', ct_list)
dump('municipios.json', mun)
dump('paises.json', paises)
