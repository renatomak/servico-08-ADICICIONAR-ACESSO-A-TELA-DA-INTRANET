const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'automation.js'), 'utf8');
const lista = 'https://servicos.goiania.go.gov.br/atende/Solicitacoes.aspx';
const detalhe = 'https://servicos.goiania.go.gov.br/atende/SolicitacaoDetalhe.aspx?SolicitacaoId=1234567';

function fixture(servicos = ['33 - OUTRO', '07 - SENHA', '08 - ADICICIONAR ACESSO']) {
  const table = { getClientRects: () => [1] };
  const headers = ['', '', 'Operações', 'OS\nSort column by Id', 'Solicitante', 'Órgão Solicitante\nSort column by Sigla', 'Documento\nSort column by NumeroDocumento', 'Serviço\nSort column by Nome2'];
  const row = (cells, header, href) => ({
    closest: () => table,
    getClientRects: () => [1],
    querySelector: () => header ? {} : null,
    querySelectorAll: selector => selector === 'a[href]' ? [
      { getClientRects: () => [1], getAttribute: () => href },
      { getClientRects: () => [1], getAttribute: () => href }
    ] : cells.map(innerText => ({ innerText }))
  });
  const rows = [row(headers, true), ...servicos.map(s => row(['', '', '', '8', '', '', '8', s], false, detalhe))];
  table.querySelectorAll = () => rows;
  let now = 0;
  const context = vm.createContext({ URL, location: new URL(lista), Date: { now: () => now },
    setTimeout: resolve => { now += 16000; resolve(); },
    document: { querySelectorAll: () => [table], querySelector: () => null }
  });
  vm.runInContext(code, context);
  return context;
}

test('identifica Serviço com texto de ordenação e abre apenas o tipo 08', async () => {
  const c = fixture();
  assert.equal((await c.localizarOs8()).url, detalhe);
});
test('não confunde número da OS ou documento 8 com serviço 8', async () => {
  const c = fixture(['18 - OUTRO', '80 - OUTRO', '07 - SENHA']);
  await assert.rejects(c.localizarOs8(), /Nenhuma OS do tipo 8/);
});
test('captura preserva quebras de linha e texto integral', async () => {
  const c = fixture();
  c.location = new URL(detalhe);
  const texto = 'Descrição de teste\nMATRÍCULA: 123456\nEspelho: 654321\n';
  c.document.querySelector = () => ({ value: texto });
  const resultado = await c.capturarDescricao();
  assert.equal(resultado.texto, texto);
  assert.equal(resultado.solicitacaoId, '1234567');
});
test('login e descrição vazia produzem mensagens claras', async () => {
  const c = fixture();
  c.location = new URL('https://servicos.goiania.go.gov.br/Intranet/Login.aspx');
  await assert.rejects(c.localizarOs8(), /Entre no Atende/);
  c.location = new URL(detalhe);
  await assert.rejects(c.capturarDescricao(), /descrição da OS está vazia/);
});
test('extrai apenas matrículas explicitamente associadas à equivalência', () => {
  const c = fixture();
  assert.equal(c.extrairEquivalencias('Matrícula espelho: 9.135.553-01 / 697.656-01').join(','), '9135553,697656');
  assert.equal(c.extrairEquivalencias('Matrícula espelho: 9135553-01').join(','), '9135553');
  assert.equal(c.extrairEquivalencias('Matrícula espelho: 913555301').join(','), '9135553');
  assert.equal(c.extrairEquivalencias('MATRÍCULA: 164451\nCPF 123.456.789-00\nOU descrição: ADICICIONAR ACESSO E-RESOLVE SICCA').length, 0);
  assert.equal(c.extrairEquivalencias('MATRÍCULA: 164451\nInforme matrícula espelho para liberação por equivalência:\nOU descrição: acesso 123456').length, 0);
  assert.equal(c.extrairEquivalencias('MATRÍCULA: 563943\nInforme matrícula espelho para liberação por equivalência: 1536222 / 1203436\nOU descrição: acesso').join(','), '1536222,1203436');
  assert.equal(c.extrairEquivalencias('conforme as matrículas espelho nº 1536222 e 1203436.').join(','), '1536222,1203436');
  assert.equal(c.extrairEquivalencias('MATRÍCULA: 164451\nMatrícula espelho: 164451').length, 0);
});
