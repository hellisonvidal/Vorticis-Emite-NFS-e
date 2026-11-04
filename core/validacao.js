export const so = s => String(s ?? '').replace(/\D/g, '');

export function cnpjValido(v) {
  const c = so(v);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = len => {
    let soma = 0, pos = len - 7;
    for (let i = len; i >= 1; i--) { soma += +c[len - i] * pos--; if (pos < 2) pos = 9; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === +c[12] && calc(13) === +c[13];
}

export function cpfValido(v) {
  const c = so(v);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i);
    const d = ((s * 10) % 11) % 10;
    if (d !== +c[t]) return false;
  }
  return true;
}

export function docValido(tipo, v) {
  if (tipo === 'CNPJ') return cnpjValido(v);
  if (tipo === 'CPF') return cpfValido(v);
  return true;
}

// Validação de negócio antes do envio (espelha as principais RN do Anexo I)
export function validarEmissao({ contrib, tomador, form, calc }) {
  const e = [];
  if (!docValido(contrib.tipo_doc, contrib.documento)) e.push('CPF/CNPJ do prestador inválido.');
  if (!/^\d{7}$/.test(so(contrib.cod_municipio))) e.push('Município (código IBGE) do prestador não informado.');
  if (!/^\d{6}$/.test(so(form.ctribnac))) e.push('Código de Tributação Nacional deve ter 6 dígitos.');
  if (form.cnbs && !/^\d{9}$/.test(so(form.cnbs))) e.push('Código NBS deve ter 9 dígitos.');
  if (form.ctribmun && (!/^\d{3}$/.test(so(form.ctribmun)) || so(form.ctribmun) === '000')) e.push('Código de Tributação Municipal deve ter 3 dígitos (diferente de 000).');
  if (!String(form.descricao || '').trim()) e.push('Descrição do serviço é obrigatória.');
  if (!(calc.vServ > 0)) e.push('Valor do serviço deve ser maior que zero.');
  if (!form.competencia) e.push('Data de competência é obrigatória.');
  else if (form.competencia > new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)) e.push('A competência não pode ser posterior à data de emissão (E0015).');
  if (tomador?.documento && !docValido(tomador.tipo_doc, tomador.documento)) e.push('CPF/CNPJ do tomador inválido.');
  if (tomador && !tomador.nome && tomador.documento) e.push('Nome do tomador é obrigatório.');
  if (calc.retido && !tomador?.documento) e.push('ISS retido exige identificação do tomador.');
  if (calc.vTotalRet >= calc.vServ && calc.vServ > 0) e.push('Total de retenções não pode ser igual ou superior ao valor do serviço.');
  if (calc.aliq > 5) e.push('Alíquota do ISS superior a 5% (E0595).');
  if (calc.ibscbs) {
    if (!/^\d{6}$/.test(calc.ibscbs.cIndOp)) e.push('Indicador da operação (cIndOp) deve ter 6 dígitos.');
    if (!/^\d{6}$/.test(calc.ibscbs.cClassTrib)) e.push('cClassTrib deve ter 6 dígitos.');
    const exigeToma = ['030102', '050102', '100101', '100301', '100501', '030103', '050103', '100102', '100201', '100302', '100401', '100502', '100601'];
    if (exigeToma.includes(calc.ibscbs.cIndOp) && !tomador?.documento) e.push(`Para o cIndOp ${calc.ibscbs.cIndOp} o tomador deve ser informado.`);
    if (exigeToma.includes(calc.ibscbs.cIndOp) && tomador?.documento && !tomador.logradouro) e.push(`Para o cIndOp ${calc.ibscbs.cIndOp} o endereço do tomador é obrigatório.`);
  }
  return e;
}
