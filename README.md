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
  - login com usuário e senha, ou com certificado digital A1 (`.pfx`);
  - certificados guardados com criptografia AES-256-GCM;
  - várias **procurações eletrônicas** por empresa, cada uma com vigência e escopo; na emissão você escolhe qual certificado ou procuração usar.
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
- **Consultas:** tabelas oficiais da Lista Nacional (cTribNac), NBS 2.0, correlação Item × NBS × IBS/CBS, cClassTrib, cIndOp, municípios IBGE e códigos municipais.
- **Notas:**
  - XML da DPS e da NFS-e, DANFSe oficial e espelho para impressão;
  - cancelamento, substituição e consulta da situação na Sefin.
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
  banco.js     esquema SQLite + adaptadores node:sqlite (Windows) e sql.js/WASM (Android)
  seguranca.js PBKDF2 / AES-GCM via WebCrypto
  data/        tabelas oficiais convertidas (gov.br/nfse)
server/      servidor HTTP local (Express) usado no Windows e no navegador
desktop/     processo principal do Electron (janela, menu, downloads)
mobile/      app Android (Capacitor)
  src/main.js  inicialização: sql.js + IndexedDB + ponte nativa
  build.js     empacota o frontend e o núcleo em mobile/www
  android/     projeto Android; plugin nativo VorticisNativoPlugin.java (mTLS, salvar, compartilhar, imprimir)
public/      interface (JS puro, sem build) + Chart.js
scripts/     importar_tabelas.py, gerar-icones.cjs, demo.js
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
- **Antes de usar em produção**, valide em **Produção restrita** com o seu certificado real. Se a Sefin rejeitar a assinatura (erro E0714), troque o algoritmo para SHA-256 no cadastro da empresa.
- **Alíquotas de IBS/CBS a partir de 2027** e as reduções por cClassTrib são **valores de referência**. Confira antes de emitir.
- **No Android, os dados ficam só no aparelho.** Faça backups regulares em *Configurações → Backup do banco de dados*.
- **Atualização das tabelas oficiais:** baixe os novos anexos de https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica para `docs-oficiais/` e rode `npm run tabelas`.
