// Popula uma base de demonstração (modo simulação) via API.
// Uso: node scripts/demo.js [http://localhost:3000]
import { gerarPfx } from '../tests/gerar-cert-teste.js';

const base = process.argv[2] || 'http://localhost:3000';
let token;
const api = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${url}: ${JSON.stringify(j)}`);
  return j;
};

const r = await api('POST', '/api/auth/registrar', { nome: 'Usuário Demo', email: 'demo@nfse.local', senha: 'demo12345' }).catch(() => api('POST', '/api/auth/login', { email: 'demo@nfse.local', senha: 'demo12345' }));
token = r.token;
const cert = await api('POST', '/api/certificados', { pfx: gerarPfx({ nome: 'ALFA TECNOLOGIA LTDA', cnpj: '11222333000181' }).toString('base64'), senha: '1234', apelido: 'e-CNPJ Alfa (teste)' });
const certCont = await api('POST', '/api/certificados', { pfx: gerarPfx({ nome: 'MARIA CONTADORA', cpf: '52998224725' }).toString('base64'), senha: '1234', apelido: 'e-CPF Contadora (teste)' });
const end = { cep: '01310100', logradouro: 'Avenida Paulista', numero: '1000', bairro: 'Bela Vista', cod_municipio: '3550308', uf: 'SP', ambiente: 'simulacao', ibscbs_ativo: true };
const alfa = await api('POST', '/api/contribuintes', { tipo_doc: 'CNPJ', documento: '11222333000181', razao_social: 'ALFA TECNOLOGIA LTDA', nome_fantasia: 'Alfa Tech', regime: 'SN', aliq_sn: 6, aliq_iss: 2, email: 'fiscal@alfa.com.br', certificado_id: cert.id, ...end });
const beta = await api('POST', '/api/contribuintes', { tipo_doc: 'CNPJ', documento: '60746948000112', razao_social: 'BETA CONSULTORIA EMPRESARIAL S/S', nome_fantasia: 'Beta Consultoria', regime: 'LP', aliq_iss: 5, ...end, cod_municipio: '3304557', cep: '20040020', logradouro: 'Rua da Assembleia', uf: 'RJ' });
await api('POST', '/api/contribuintes', { tipo_doc: 'CNPJ', documento: '45723174000110', razao_social: 'JOAO DESIGNER MEI', regime: 'MEI', ...end, cod_municipio: '4106902', uf: 'PR' });
await api('POST', '/api/procuracoes', { contribuinte_id: beta.id, certificado_id: certCont.id, valida_ate: '2027-12-31', observacao: 'Procuração e-CAC (teste)' });

const tomadores = [
  { tipo_doc: 'CNPJ', documento: '19131243000197', nome: 'MERCADO CENTRAL LTDA', cep: '20040020', logradouro: 'Rua da Assembleia', numero: '10', bairro: 'Centro', cod_municipio: '3304557', email: 'financeiro@mercadocentral.com.br', retem_federais: 1 },
  { tipo_doc: 'CNPJ', documento: '11444777000161', nome: 'INDUSTRIA DELTA S.A.', cep: '30130010', logradouro: 'Avenida Afonso Pena', numero: '500', bairro: 'Centro', cod_municipio: '3106200', retem_federais: 1 },
  { tipo_doc: 'CNPJ', documento: '04252011000110', nome: 'CLINICA SAUDE MAIS LTDA', cep: '80010000', logradouro: 'Rua XV de Novembro', numero: '200', bairro: 'Centro', cod_municipio: '4106902' },
  { tipo_doc: 'CPF', documento: '52998224725', nome: 'CARLOS ALBERTO SOUZA', cep: '01001000', logradouro: 'Praça da Sé', numero: '1', bairro: 'Sé', cod_municipio: '3550308' },
  { tipo_doc: 'CNPJ', documento: '00000000000191', nome: 'BANCO DO BRASIL SA', cep: '70073901', logradouro: 'SAUN Quadra 5', numero: 'B', bairro: 'Asa Norte', cod_municipio: '5300108', retem_federais: 1 },
];
const servs = [
  { ctribnac: '010101', cnbs: '115021000', descricao: 'Desenvolvimento de sistema web sob medida - sprint mensal', ind_op: '100301' },
  { ctribnac: '010701', cnbs: '115013000', descricao: 'Suporte técnico em informática e manutenção de sistemas', ind_op: '100301' },
  { ctribnac: '171901', cnbs: '', descricao: 'Consultoria contábil e fiscal mensal', ind_op: '100301' },
];
const hoje = new Date();
let n = 0;
for (let m = 11; m >= 0; m--) {
  const qtd = 3 + Math.floor(Math.random() * 4) + (11 - m) / 3;
  for (let i = 0; i < qtd; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - m, 1 + Math.floor(Math.random() * 25));
    if (d > hoje) d.setTime(hoje.getTime() - 86400e3);
    const comp = d.toISOString().slice(0, 10);
    const emp = Math.random() < 0.7 ? alfa : beta;
    const s = emp === beta ? servs[2] : servs[Math.floor(Math.random() * 2)];
    const t = tomadores[Math.floor(Math.random() * tomadores.length)];
    const valor = Math.round((800 + Math.random() * 14000) * 100) / 100;
    const lp = emp === beta && t.tipo_doc === 'CNPJ' && t.retem_federais;
    await api('POST', '/api/notas/emitir', {
      contribuinte_id: emp.id, tomador: t,
      form: { competencia: comp, ...s, valor_servico: valor, trib_issqn: '1', tp_ret_issqn: '1', aliq_iss: emp === beta ? 5 : 2, ibscbs_ativo: comp >= '2026-01-01', cclasstrib: '000001',
        ...(lp ? { ret_irrf: 1.5, ret_irrf_tipo: 'p', ret_csll: 1, ret_csll_tipo: 'p', ret_pis: true, ret_cofins: true } : {}) },
    });
    n++;
  }
}
const ultimas = await api('GET', `/api/notas?contribuinte_id=${alfa.id}&limite=3`);
await api('POST', `/api/notas/${ultimas.itens[2].id}/cancelar`, { motivo: '2', justificativa: 'Serviço não foi prestado conforme contrato' });
console.log(`Demo criada: ${n} notas. Login: demo@nfse.local / demo12345`);
