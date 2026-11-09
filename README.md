# Vorticis Emite NFS

Emissor de **NFS-e Padrão Nacional** para **Windows** e **Android**. Envia as notas direto pela API oficial da Sefin Nacional (leiaute DPS **v1.01**) e já inclui o grupo **IBS/CBS** da Reforma Tributária (LC 214/2025).

| Plataforma | Arquivo | Como funciona |
|---|---|---|
| **Windows** 10/11 (64 bits) | `Vorticis-Emite-NFS-x.y.z-instalador.exe` ou `-portatil.exe` | App de desktop (Electron). Os dados ficam em `%APPDATA%\Vorticis Emite NFS\dados`. |
| **Android** 7.0+ | `Vorticis-Emite-NFS-x.y.z-android.apk` | App nativo (Capacitor). Tudo roda no aparelho, inclusive o banco e a comunicação com a Sefin via certificado A1. |
| Navegador (opcional) | `npm start` | Servidor local em `http://localhost:3000`. |

Nas três versões, a interface e as regras fiscais são as mesmas: o núcleo do sistema é compartilhado.

## Funcionalidades

- **Acesso:**
  - login com usuário e senha (a conta é criada na própria aba "Usuário e senha"), ou com certificado digital;
  - **certificados já instalados no computador ou no celular**: repositório pessoal do Windows (inclusive chaves não exportáveis e token/cartão A3, com o PIN pedido pelo Windows) e certificados instalados no Android (KeyChain). A chave privada não sai do sistema: a assinatura da DPS e a conexão segura com a Sefin são feitas pelo próprio Windows/Android;
  - ou o arquivo A1 (`.pfx`), guardado com criptografia AES-256-GCM;
  - várias **procurações eletrônicas** por empresa, cada uma com vigência e escopo.
- **Emitir em nome da empresa (representação, vigente desde 01/11/2026 — Guia do Emissor Nacional v1.3, item 11):** em "Emitir como" você escolhe:
  - o **certificado da empresa**;
  - o **responsável legal** (e-CPF do representante no cadastro CNPJ). Em *Empresas → Representação*, "Identificar" encontra o CPF pelo e-CNPJ da empresa (o certificado ICP-Brasil traz o CPF do responsável) e pelo quadro societário da Receita;
  - um **estabelecimento da mesma raiz de CNPJ** (o e-CNPJ da matriz emite pelas filiais);
  - um **procurador** com procuração eletrônica do serviço NFS-e.

  A Sefin confere o vínculo pelo certificado da conexão e pela assinatura. Cancelamento e consulta usam o mesmo certificado que emitiu a nota.
- **Conta gov.br (sem certificado):** a conta gov.br (prata/ouro) é aceita apenas no **Emissor Nacional web**; as APIs da Sefin exigem certificado. Por isso, em "Emitir como → Conta gov.br" o app faz por dentro tudo o que é possível:
  - **valida quem vai emitir**: titular (CPF igual ao do prestador pessoa física), **responsável legal** (CPF conferido com o responsável cadastrado ou com o quadro societário da Receita) ou **procurador** (procuração cadastrada no app, vigente e com emissão; sem cadastro, exige confirmar a procuração do e-CAC com o serviço NFS-e). Também exige confirmar o nível prata/ouro da conta;
  - **valida a nota** com as mesmas regras da emissão por API e guarda um **rascunho vinculado**;
  - abre o Emissor Nacional do ambiente da empresa (produção ou produção restrita). **No Windows**, numa janela do app com o login salvo e um **painel Vorticis dentro da página**: clique no campo do Emissor e em "Inserir";
  - o **XML baixado volta para o app** (Windows: automaticamente; navegador/Android: "Importar XML") e **substitui o rascunho** pela nota autorizada.
- **Clientes por empresa:** cada empresa emitente tem o seu cadastro de clientes; a emissão só sugere os clientes da empresa selecionada. Um cliente pode ser copiado para outra empresa. Na atualização, os cadastros antigos são distribuídos pelas notas em que aparecem.
- **Regimes:** MEI, Simples Nacional ME/EPP (incluindo sublimite excedido), Lucro Presumido, Real e Arbitrado, Imune e Isenta, além de regimes especiais de ISS.
- **Tributos:**
  - ISS próprio ou retido;
  - PIS e COFINS (regime cumulativo e não cumulativo);
  - retenções de IRRF, CSLL, INSS e CSRF;
  - a alíquota do ISS vai ou não no XML conforme as regras de negócio oficiais (Anexo I).
- **IBS/CBS:**
  - campos de indicador da operação (`cIndOp`) e classificação tributária (`cClassTrib`/CST), com redução de alíquota;
  - destinatário, tipo de operação e ente governamental;
  - em 2026 calcula CBS 0,9% + IBS 0,1%; as alíquotas de outros anos podem ser editadas.
- **Emissão:**
  - cálculo ao vivo dos tributos e prévia do XML;
  - sugestão de NBS, cIndOp e cClassTrib pela tabela de correlação oficial;
  - rascunhos, serviços favoritos e consulta de CNPJ e CEP;
  - grupos de obra, evento, comércio exterior e substituição.
- **Copiar a última nota:** por empresa ou por tomador. Depois é só trocar o tomador e os valores e emitir.
- **Campos formatados:** CPF/CNPJ, CEP e telefone já formatados (inclusive ao colar ou ao preencher por consulta), valores em R$ (ou % quando a retenção/dedução é percentual) e datas no padrão dd/mm/aaaa.
- **Códigos de tributação:** cTribNac e cTribMun aceitam digitação com busca e têm uma seta para ver todas as opções. As opções de cTribMun vêm da tabela do município (inclusive consultada na Sefin), dos serviços favoritos e das notas anteriores.
- **Cadastro pela Receita:** a consulta de CNPJ preenche o endereço completo, o município/UF, o telefone e o e-mail, usando BrasilAPI, Minha Receita e CNPJ.ws como alternativas. "Completar pela Receita" faz o mesmo em lote para empresas e clientes, só nos campos vazios.
- **Inscrição municipal:** não consta do cadastro da Receita, e o cadastro nacional (CNC) só é aberto às prefeituras. O app busca a IM nas NFS-e já emitidas ou importadas do ADN, em que a Sefin grava a IM do CNC, e preenche o cadastro automaticamente a cada nota autorizada ou importada.
- **Parâmetros municipais (Sefin):** alíquota do serviço na competência, histórico de alíquotas, regimes especiais e convênio do município, pelas rotas oficiais (`/{município}/{serviço}/{competência}/aliquota` etc.). Quando o município não parametrizou o serviço, o app explica o motivo em vez de mostrar o erro bruto.
- **Saída do app (Windows):** confirmação no visual do app, com "Salvar rascunho e sair" quando há nota em digitação.
- **Consultas:** tabelas oficiais da Lista Nacional (cTribNac), NBS 2.0, correlação Item × NBS × IBS/CBS, cClassTrib, cIndOp, municípios IBGE e códigos municipais.
- **Notas:**
  - XML da DPS e da NFS-e;
  - cancelamento, substituição e consulta da situação na Sefin;
  - nota **pendente** quando a resposta da Sefin se perde (queda de rede ou timeout), recuperada depois pelo número da DPS.
- **DANFSe v2.0** (NT SE/CGNFS-e nº 008/2026 v1.02), gerado no próprio app porque a API oficial foi suspensa em 03/08/2026:
  - todos os blocos e campos da NT, em A4 de página única, com QR Code da consulta pública e logomarca oficial da NFS-e;
  - regras da NT: tarja "NFS-e SEM VALIDADE JURÍDICA" (produção restrita), marca d'água CANCELADA/SUBSTITUÍDA, blocos não identificados, destinatário igual ao tomador, operação não sujeita ao ISSQN, linha de PIS/COFINS até 2026, tratamento de `tpRetPisCofins` da v1.02, NFS-e substituída, obra, imóvel e evento em Informações Complementares, e totais aproximados da Lei 12.741/2012;
  - opções em *Configurações*: canhoto (item 2.1.13), supressão de endereço e e-mail (Nota 1) e de linhas sem dados (Nota 5);
  - impressão, **PDF direto** (Windows e Android; no navegador, use "Salvar como PDF"), **impressão em lote** das notas selecionadas e **DANFSe de qualquer XML** de NFS-e, como notas recebidas como tomador.
- **Numeração (DPS e NFS-e):**
  - consulta à Sefin (`HEAD /dps`) antes de cada envio, para não reutilizar números;
  - verificação e ajuste do próximo nº de DPS, com recuperação automática da nota em caso de duplicidade (E0014);
  - importação das notas da empresa pelo ADN (distribuição por NSU), incluindo cancelamentos e substituições;
  - validação da faixa da série: 00001–49999 para aplicativo próprio.
- **Produção:**
  - diagnóstico por empresa: cadastro, numeração, certificado, cadeia ICP-Brasil, procuração, convênio do município e teste de comunicação mTLS;
  - ativação do ambiente de produção com checklist.
- **Certificados:** a cadeia ICP-Brasil é completada automaticamente pelo endereço AIA do certificado, porque o ADN recusa conexões com a cadeia incompleta.
- **Procurações na Receita:** consulta da data de vencimento e dos sistemas autorizados pelo **Integra Contador (SERPRO)**, serviço OBTERPROCURACAO41. Exige contratação na Loja SERPRO; o modo trial devolve dados fictícios.
- **Relatórios e painel:**
  - apuração de ISS, retenções e IBS/CBS, com exportação em CSV;
  - painel com indicadores e gráficos;
  - acompanhamento do limite do MEI e do Simples;
  - backup do banco de dados.

### Ambientes de emissão

Cada empresa escolhe o seu:
- **Simulação**: nada é enviado. Serve para treinar.
- **Produção restrita**: homologação oficial da Sefin.
- **Produção**: a nota tem validade fiscal.

## Instalação

- **Windows:** baixe o instalador na página *Releases* (ou nos artefatos do GitHub Actions) e execute. Como o instalador ainda não tem assinatura de código, o SmartScreen pode avisar. Clique em *Mais informações → Executar assim mesmo*.
- **Android:** baixe o `.apk` no celular e permita a instalação de fontes desconhecidas.
  - O certificado A1 é selecionado pelo seletor de arquivos.
  - XML, CSV, PDF e backup são salvos em `Downloads/Vorticis` (Android 10+; nas versões anteriores abre direto o compartilhamento) e podem ser compartilhados.
  - A impressão usa o serviço do Android, que também permite "Salvar como PDF".

## Desenvolvimento

Requisitos: Node.js 22.5+. Para os testes, `xmllint`. Para o Android, JDK 21 e Android SDK 36.

```bash
npm install
npm test                 # testes de integração (XSD oficial, assinatura, regimes, sql.js)
npm start                # versão navegador em http://localhost:3000
npm run demo             # popula dados de exemplo (com o servidor rodando)
npm run desktop          # abre o app Windows/Electron em modo desenvolvimento
npm run build:win        # gera o instalador e a versão portátil em dist/ (no Linux exige wine)
npm run build:android    # gera mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

### Estrutura

```
core/        núcleo compartilhado (roda no Node e no WebView do Android)
  api.js       rotas da aplicação, independentes de plataforma
  tributos.js  motor fiscal: regimes, ISS, federais, IBS/CBS
  dps.js       XML da DPS e dos eventos + assinatura XMLDSig (C14N), sem dependências nativas
  sefin.js     cliente das APIs Sefin Nacional/ADN (o transporte mTLS vem da plataforma)
  danfse.js    DANFSe v2.0 (NT 008/2026) em HTML A4; o PDF é gerado pela plataforma (Electron/Android)
  xml.js       leitura de XML da NFS-e (@xmldom/xmldom)
  integra-contador.js  procurações eletrônicas via Integra Contador (SERPRO)
  banco.js     esquema SQLite + adaptadores node:sqlite (Windows) e sql.js/WASM (Android)
  seguranca.js PBKDF2 / AES-GCM via WebCrypto
  data/        tabelas oficiais convertidas (gov.br/nfse)
server/      servidor HTTP local (Express) usado no Windows e no navegador
desktop/     processo principal do Electron (janela, menu, downloads, PDF, confirmação ao fechar)
  emissor-govbr.js         Emissor Nacional (gov.br) em janela própria e importação do XML baixado
  repositorio-windows.js   certificados do Windows via PowerShell/.NET (listar e assinar)
  certificados-windows.js  TLS com certificado do Windows pela pilha de rede do Chromium
mobile/      app Android (Capacitor)
  src/main.js  inicialização: sql.js + IndexedDB + ponte nativa
  build.js     empacota o frontend e o núcleo em mobile/www
  android/     projeto Android; plugin nativo VorticisNativoPlugin.java (mTLS, salvar, compartilhar, imprimir, PDF)
public/      interface (JS puro, sem build) + Chart.js
scripts/     importar_tabelas.py, gerar-icone-vorticis.py (ícone da família Vorticis), gerar-icones.cjs, demo.js
docs-oficiais/ XSDs v1.01 e planilhas oficiais
```

### Builds automáticos (GitHub Actions)

O workflow `.github/workflows/build.yml` faz o seguinte:
- **A cada push na `main`:** roda os testes, gera o instalador Windows (em `windows-latest`) e o APK Android, e publica os artefatos na aba *Actions*.
- **Nova versão:** aumente `version` no `package.json` (por exemplo, `npm version patch`) e envie para a `main`. O Actions cria a tag `vX.Y.Z` e a **Release** com o instalador Windows e o APK. Enviar uma tag `vX.Y.Z` manualmente também funciona.

Segredos opcionais (*Settings → Secrets and variables → Actions*):

| Segredo | Para quê |
|---|---|
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Gerar o APK e o AAB de **release** assinados (necessário para a Google Play). Sem eles, sai só o APK de depuração. |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Assinatura de código Authenticode do instalador Windows (`.pfx` em base64). |

Para criar a keystore Android (guarde em lugar seguro: sem ela não é possível publicar atualizações):

```bash
keytool -genkeypair -keystore vorticis.jks -alias vorticis -keyalg RSA -keysize 2048 -validity 10000
```

Depois, gere o valor do segredo `ANDROID_KEYSTORE_BASE64`:

```bash
base64 -w0 vorticis.jks
```

## Pontos de atenção

- **A transmissão à Sefin sempre exige certificado digital ICP-Brasil**, que pode ser da empresa ou de um procurador. Login com usuário e senha dá acesso ao app, mas não substitui o certificado. Sem certificado, só o modo simulação funciona.
- **Procuração:** precisa estar registrada oficialmente (Procuração Eletrônica com o serviço NFS-e). O app só associa o certificado do procurador à empresa.
- **Antes de usar em produção**, valide em **Produção restrita** com o seu certificado real (use *Empresas → Diagnóstico*). Se a Sefin rejeitar a assinatura (erro E0714), troque o algoritmo para SHA-256 no cadastro da empresa.
- **Numeração:** se usar o app em mais de um aparelho, use uma **série diferente em cada um**. O Emissor Web da Receita usa as séries 70000–79999, então não há conflito com ele.
- **Certificado A3** (token ou cartão): funciona no Windows quando o certificado aparece no repositório pessoal (driver do token instalado). O Windows pede o PIN ao assinar. No Android, use certificado A1 instalado ou o arquivo `.pfx`.
- **Envio à Sefin em UTF-8:** a DPS e os eventos são enviados com a declaração `<?xml version="1.0" encoding="UTF-8"?>`, o que corrige a rejeição E1229.
- **Alíquotas de IBS/CBS a partir de 2027** e as reduções por cClassTrib são **valores de referência**. Confira antes de emitir.
- **No Android, os dados ficam só no aparelho.** Faça backups regulares em *Configurações → Backup do banco de dados*.
- **Atualização das tabelas oficiais:** baixe os novos anexos de https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica para `docs-oficiais/` e rode `npm run tabelas`.
