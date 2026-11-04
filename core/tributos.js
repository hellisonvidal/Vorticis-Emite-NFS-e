// Motor de cálculo fiscal: ISSQN, retenções federais, Simples Nacional e IBS/CBS (Reforma Tributária - LC 214/2025).
// As regras de preenchimento seguem o Anexo I (RN DPS/NFS-e) v1.01 do Sistema Nacional NFS-e.

export const REGIMES = {
  MEI:            { label: 'MEI - Microempreendedor Individual', opSimpNac: '2', regApTribSN: null, simples: true },
  SN:             { label: 'Simples Nacional - ME/EPP', opSimpNac: '3', regApTribSN: '1', simples: true },
  SN_EXCESSO_ISS: { label: 'Simples Nacional - ISS fora do SN (sublimite excedido)', opSimpNac: '3', regApTribSN: '2', simples: true },
  SN_EXCESSO:     { label: 'Simples Nacional - federais e ISS fora do SN', opSimpNac: '3', regApTribSN: '3', simples: true },
  LP:             { label: 'Lucro Presumido', opSimpNac: '1', regApTribSN: null, pis: 0.65, cofins: 3.0, cst: '01' },
  LR:             { label: 'Lucro Real', opSimpNac: '1', regApTribSN: null, pis: 1.65, cofins: 7.6, cst: '01' },
  LA:             { label: 'Lucro Arbitrado', opSimpNac: '1', regApTribSN: null, pis: 0.65, cofins: 3.0, cst: '01' },
  IMUNE:          { label: 'Entidade Imune', opSimpNac: '1', regApTribSN: null, pis: 0, cofins: 0, cst: '08' },
  ISENTA:         { label: 'Entidade Isenta', opSimpNac: '1', regApTribSN: null, pis: 0, cofins: 0, cst: '07' },
};

export const REG_ESP_TRIB = {
  0: 'Nenhum', 1: 'Ato Cooperado (Cooperativa)', 2: 'Estimativa', 3: 'Microempresa Municipal',
  4: 'Notário ou Registrador', 5: 'Profissional Autônomo', 6: 'Sociedade de Profissionais', 9: 'Outros',
};

// Alíquotas de IBS/CBS por ano (LC 214/2025, arts. 343 a 348). Ano-teste 2026: CBS 0,9% + IBS 0,1%.
// De 2027 em diante as alíquotas de referência ainda dependem de resolução do Senado: valores editáveis.
export const ALIQ_IBSCBS = {
  2026: { cbs: 0.9, ibsUF: 0.1, ibsMun: 0, obs: 'Ano-teste (art. 343/346 LC 214/2025)' },
  2027: { cbs: 8.8, ibsUF: 0.05, ibsMun: 0.05, obs: 'CBS plena (referência estimada) + IBS 0,1%' },
  2028: { cbs: 8.8, ibsUF: 0.05, ibsMun: 0.05, obs: 'Referência estimada' },
  2029: { cbs: 8.8, ibsUF: 1.77, ibsMun: 0.0, obs: 'IBS 10% da referência (estimado) - ajuste' },
  2033: { cbs: 8.8, ibsUF: 10.0, ibsMun: 7.7, obs: 'Alíquotas plenas estimadas (26,5%)' },
};
export function aliquotasAno(ano, override) {
  if (override && override.cbs !== undefined && override.cbs !== null && override.cbs !== '') return { cbs: +override.cbs, ibsUF: +override.ibsUF, ibsMun: +override.ibsMun };
  const anos = Object.keys(ALIQ_IBSCBS).map(Number).sort();
  let sel = anos[0];
  for (const a of anos) if (ano >= a) sel = a;
  return ALIQ_IBSCBS[sel];
}

const r2 = v => Math.round((+v || 0) * 100 + Number.EPSILON) / 100;
export const arred = r2;

/**
 * Calcula todos os valores da nota a partir do formulário.
 * @param {object} f formulário (ver docs no frontend)
 * @param {object} contrib contribuinte (regime, alíquotas padrão)
 */
export function calcular(f, contrib) {
  const reg = REGIMES[contrib.regime] || REGIMES.SN;
  const avisos = [];
  const vServ = r2(f.valor_servico);
  const vDescIncond = r2(f.desconto_incond);
  const vDescCond = r2(f.desconto_cond);
  let vDR = 0;
  if (f.deducao_tipo === 'percentual') vDR = r2((vServ - vDescIncond) * (+f.deducao_valor || 0) / 100);
  else if (f.deducao_tipo === 'valor') vDR = r2(f.deducao_valor);

  // ---------- ISSQN ----------
  const tribISSQN = String(f.trib_issqn || '1');
  const tpRetISSQN = String(f.tp_ret_issqn || '1');
  const retido = tpRetISSQN !== '1';
  const regEsp = String(contrib.reg_esp_trib || '0');
  let aliq = +f.aliq_iss || 0;
  if (aliq > 5) avisos.push('Alíquota de ISS acima de 5% não é permitida (E0595).');
  if (aliq && aliq < 2 && !reg.simples) avisos.push('Alíquota de ISS abaixo do mínimo constitucional de 2%: confirme benefício municipal.');
  const bcISS = tribISSQN === '1' ? r2(Math.max(vServ - vDescIncond - vDR, 0)) : 0;
  const vISS = tribISSQN === '1' && reg.opSimpNac !== '2' ? r2(bcISS * aliq / 100) : 0;

  // Regras de envio do pAliq (Anexo I - RN pAliq)
  const convenioAtivo = f.convenio_ativo !== false && f.convenio_ativo !== 'false';
  let enviarAliq = false;
  if (reg.opSimpNac === '2' || tribISSQN !== '1' || regEsp !== '0' || f.beneficio_isencao) enviarAliq = false;
  else if (reg.opSimpNac === '1') enviarAliq = !convenioAtivo;
  else if (reg.regApTribSN === '1') {
    enviarAliq = retido;
    if (retido && aliq < 1.8) avisos.push('Simples Nacional com ISS retido: a alíquota mínima informada é 1,8%.');
  } else enviarAliq = !convenioAtivo;
  if (enviarAliq && !aliq) avisos.push('Informe a alíquota do ISS: obrigatória neste cenário.');

  // ---------- Tributos federais ----------
  const pj = (contrib.tipo_doc || 'CNPJ') === 'CNPJ';
  const fed = { cst: '00', pAliqPis: 0, pAliqCofins: 0, vPis: 0, vCofins: 0, vBC: 0, tpRet: '', vIRRF: 0, vCSLL: 0, vCP: 0 };
  if (pj) {
    if (!reg.simples || reg.opSimpNac === '3' && contrib.regime === 'SN_EXCESSO') {
      fed.cst = f.pis_cst || reg.cst || '01';
      fed.pAliqPis = f.aliq_pis !== undefined && f.aliq_pis !== '' ? +f.aliq_pis : (reg.pis ?? 0.65);
      fed.pAliqCofins = f.aliq_cofins !== undefined && f.aliq_cofins !== '' ? +f.aliq_cofins : (reg.cofins ?? 3);
      fed.vBC = r2(vServ - vDescIncond);
      fed.vPis = r2(fed.vBC * fed.pAliqPis / 100);
      fed.vCofins = r2(fed.vBC * fed.pAliqCofins / 100);
    }
    fed.vIRRF = r2(f.ret_irrf_tipo === 'p' ? (vServ * (+f.ret_irrf || 0) / 100) : f.ret_irrf);
    fed.vCSLL = r2(f.ret_csll_tipo === 'p' ? (vServ * (+f.ret_csll || 0) / 100) : f.ret_csll);
    fed.vCP = r2(f.ret_inss_tipo === 'p' ? (vServ * (+f.ret_inss || 0) / 100) : f.ret_inss);
  } else if (f.ret_irrf || f.ret_csll || f.ret_inss) {
    avisos.push('Emitente pessoa física (CPF): tributos federais não podem ser informados (E0675).');
  }
  const retPis = !!f.ret_pis, retCofins = !!f.ret_cofins, retCsll = fed.vCSLL > 0;
  // tpRetPisCofins conforme TSTipoRetPISCofins
  const mapa = { '000': '0', '110': '4', '111': '3', '001': '8', '100': '5', '010': '6', '011': '7', '101': '9' };
  fed.tpRet = (fed.vPis || fed.vCofins || retCsll) ? (mapa[`${+retPis}${+retCofins}${+retCsll}`] ?? '2') : '';
  if (fed.tpRet === '0' && !(fed.vPis || fed.vCofins)) fed.tpRet = '';
  const vRetPis = retPis ? fed.vPis : 0, vRetCofins = retCofins ? fed.vCofins : 0;
  // Dispensa de retenção de valores até R$ 10,00 (IN RFB 1.234/2012 e Lei 9.430/96)
  if (fed.vIRRF > 0 && fed.vIRRF <= 10) avisos.push('IRRF de até R$ 10,00 é dispensado de retenção.');

  const vTotalRet = r2((retido ? vISS : 0) + fed.vIRRF + fed.vCSLL + fed.vCP + vRetPis + vRetCofins);
  const vLiq = r2(vServ - vDescIncond - vDescCond - vTotalRet);

  // ---------- Total aproximado de tributos ----------
  let totTrib;
  if (reg.opSimpNac === '3') totTrib = { pTotTribSN: +(+contrib.aliq_sn || f.aliq_sn || 0).toFixed(2) };
  else totTrib = { indTotTrib: '0' };

  // ---------- IBS / CBS ----------
  let ibscbs = null;
  if (f.ibscbs_ativo) {
    const comp = f.competencia || new Date().toISOString().slice(0, 10);
    const ano = +comp.slice(0, 4);
    const al = aliquotasAno(ano, f.ibscbs_aliq);
    const red = +f.ibscbs_pred || 0;              // % de redução da alíquota pelo cClassTrib
    const cst = (f.cclasstrib || '000001').slice(0, 3);
    const isento = ['400', '410', '510', '550'].includes(cst);
    // Base: valor do serviço - desconto incondicionado - ISS - PIS - COFINS (LC 214 art. 12, §2º - transição até 2032)
    const vBC = r2(Math.max(vServ - vDescIncond - (ano <= 2032 ? vISS + fed.vPis + fed.vCofins : 0), 0));
    const ef = p => +(isento ? 0 : p * (1 - red / 100)).toFixed(4);
    const pCBS = ef(al.cbs), pUF = ef(al.ibsUF), pMun = ef(al.ibsMun);
    const vCBS = r2(vBC * pCBS / 100), vIBSUF = r2(vBC * pUF / 100), vIBSMun = r2(vBC * pMun / 100);
    ibscbs = {
      ano, cst, cClassTrib: f.cclasstrib || '000001', cIndOp: f.ind_op || '100301', pRedAliq: red, vBC,
      aliq: al, pCBS, pIBSUF: pUF, pIBSMun: pMun, vCBS, vIBSUF, vIBSMun, vIBS: r2(vIBSUF + vIBSMun),
      vTotNF: r2(vLiq + (ano >= 2027 ? vCBS + vIBSUF + vIBSMun : 0)),
      obs: ano === 2026 ? 'Ano-teste: valores destacados sem recolhimento efetivo (compensáveis com PIS/COFINS).' : '',
    };
    if (comp < '2026-01-01') { ibscbs = null; avisos.push('IBS/CBS só pode ser declarado a partir da competência 01/01/2026 (E0850).'); }
  }

  return {
    regime: contrib.regime, opSimpNac: reg.opSimpNac, regApTribSN: reg.regApTribSN, regEspTrib: regEsp,
    vServ, vDescIncond, vDescCond, vDR, deducaoTipo: f.deducao_tipo, deducaoValor: +f.deducao_valor || 0,
    tribISSQN, tpRetISSQN, retido, aliq, enviarAliq, bcISS, vISS,
    fed, vRetPis, vRetCofins, vTotalRet, vLiq, totTrib, ibscbs, avisos,
  };
}

// Sugestões de retenção conforme tipo do tomador (o usuário pode alterar)
export function sugerirRetencoes(contrib, tomador, vServ) {
  const reg = REGIMES[contrib.regime] || REGIMES.SN;
  const s = { ret_irrf: 0, ret_csll: 0, ret_pis: false, ret_cofins: false, ret_inss: 0, obs: [] };
  if (!tomador || tomador.tipo_doc !== 'CNPJ' || !tomador.retem_federais) return s;
  if (!reg.simples) {
    s.ret_irrf = 1.5; s.ret_irrf_tipo = 'p';
    s.ret_csll = 1; s.ret_csll_tipo = 'p'; s.ret_pis = true; s.ret_cofins = true;
    s.obs.push('Retenções sugeridas: IRRF 1,5% e CSRF 4,65% (PIS 0,65% / COFINS 3% / CSLL 1%) - Lei 10.833/2003.');
    if (vServ * 0.0465 <= 10) s.obs.push('CSRF ≤ R$ 10,00: dispensada a retenção.');
  } else s.obs.push('Optante do Simples Nacional: não há retenção de IRRF/CSRF (IN RFB 1.234/2012, art. 4º, XI).');
  return s;
}
