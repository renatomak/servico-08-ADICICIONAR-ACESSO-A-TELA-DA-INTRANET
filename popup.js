const $ = id => document.getElementById(id);
const limparNumeroOs = valor => String(valor || '').replace(/\D+/g, '');
const lerNumeroOs = () => limparNumeroOs($('osNumero')?.value);
const salvarNumeroOs = async solicitacaoId => {
  await chrome.storage.local.set({ os8NumeroManual: solicitacaoId });
};
function mostrarFila(f) {
  if (!$('filaResumo')) return;
  $('filaResumo').textContent=f?`Fila: ${f.status} · ${f.indice}/${f.urls.length} · ${f.concluidas.length} concluídas · ${f.puladas.length} puladas${f.parar?' · Parada solicitada':''}`:'';
}
chrome.storage.local.get('filaOs8').then(({filaOs8})=>mostrarFila(filaOs8));
if ($('pararFila')) {
  $('pararFila').hidden = true;
  $('pararFila').onclick=()=>chrome.runtime.sendMessage({acao:'pararFila'});
}
if ($('filaResumo')) $('filaResumo').hidden = true;
function mostrar(estado) {
  const rodando = estado?.status === 'executando';
  $('executar').disabled = rodando;
  if ($('osNumero')) $('osNumero').disabled = rodando;
  $('executar').textContent = rodando ? 'Executando…' : 'Executar atendimento';
  $('status').textContent = estado?.mensagem || 'Pronto para iniciar.';
  $('status').dataset.status = estado?.status || '';
  $('descricao').value = estado?.texto || '';
  $('copiar').disabled = !estado?.texto;
  $('consultarGrupos').disabled = rodando || !estado?.texto;
  $('incluirGrupos').disabled = rodando || !estado?.texto;
  $('fecharOs').disabled = rodando || !estado?.texto;
  $('origem').hidden = !estado?.url;
  if (estado?.url) $('origem').href = estado.url;
  else $('origem').removeAttribute('href');
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.captura) mostrar(changes.captura.newValue);
  if (area === 'local' && changes.gruposOs8) mostrarGrupos(changes.gruposOs8.newValue);
  if (area === 'local' && changes.errosOs8) mostrarErros(changes.errosOs8.newValue);
  if (area === 'local' && changes.inclusaoOs8) mostrarInclusao(changes.inclusaoOs8.newValue);
  if (area === 'local' && changes.diagnosticoOs8) mostrarDiagnostico(changes.diagnosticoOs8.newValue);
  if (area === 'local' && changes.fechamentoOs8) mostrarFechamento(changes.fechamentoOs8.newValue);
  if (area === 'local' && changes.filaOs8) mostrarFila(changes.filaOs8.newValue);
});
function mostrarFechamento(d) {
  $('fechamentoResumo').textContent = d ? `OS ${d.solicitacaoId} · ${d.status}\n${d.erro || d.mensagem}` : '';
}
chrome.storage.local.get('fechamentoOs8').then(({fechamentoOs8})=>mostrarFechamento(fechamentoOs8));
$('fecharOs').onclick = async () => {
  $('fecharOs').disabled = true;
  try { await chrome.runtime.sendMessage({acao:'fecharOs'}); }
  catch { $('status').textContent = 'Confira a situação da OS antes de repetir o fechamento.'; }
  finally { $('fecharOs').disabled = false; }
};
function mostrarInclusao(dados) {
  const rotuloStatus = status => ({
    validando:'validando destino',
    executando:'executando inclusões',
    concluido:'concluído',
    interrompido:'interrompido',
    em_andamento:'tentando inclusão',
    incluido:'incluída',
    ja_incluido:'já incluída',
    verificar:'verificar',
    erro:'erro'
  }[status] || status || '');
  const detalheGrupo = r => {
    const detalhe = r.mensagem || r.erro || '';
    return `Grupo ${r.grupo}: ${rotuloStatus(r.status)}${detalhe ? ' — ' + detalhe : ''}`;
  };
  $('inclusaoResumo').textContent = dados
    ? `Inclusão OS ${dados.solicitacaoId} · Destino ${dados.matriculaDestino} · Informada ${dados.matriculaInformada || dados.matriculaDestino} · ${rotuloStatus(dados.status)}${dados.gruposTotal ? ` · ${dados.resultados.length}/${dados.gruposTotal}` : ''}\n${dados.erro || ''}\n` + (dados.resultados || []).map(detalheGrupo).join('\n')
    : '';
}
chrome.storage.local.get('inclusaoOs8').then(({inclusaoOs8})=>mostrarInclusao(inclusaoOs8));
function mostrarDiagnostico(dados) {
  const nomeEtapa = etapa => ({
    abertura_os: 'Abertura da OS',
    captura_descricao: 'Captura da descrição',
    consulta_espelhos: 'Consulta de espelhos',
    inclusao_grupos: 'Inclusão nos grupos',
    fechamento_os: 'Fechamento da OS'
  }[etapa] || etapa);
  const statusEtapa = status => ({
    executando: 'executando',
    concluido: 'concluída',
    interrompido: 'interrompida',
    aguardando: 'aguardando',
    erro: 'erro'
  }[status] || status || '');
  if (!dados) {
    $('diagnosticoResumo').textContent = 'Nenhum diagnóstico registrado.';
    return;
  }
  const cabecalho = `OS ${dados.solicitacaoId} · ${statusEtapa(dados.status || 'executando')}`;
  const erro = dados.erro ? `Erro final: ${dados.erro}` : '';
  const etapas = (dados.etapas || []).map(e => `${nomeEtapa(e.etapa)}: ${statusEtapa(e.status)}${e.detalhe ? ` — ${e.detalhe}` : ''}`);
  $('diagnosticoResumo').textContent = [cabecalho, erro, ...etapas].filter(Boolean).join('\n');
}
chrome.storage.local.get('diagnosticoOs8').then(({diagnosticoOs8})=>mostrarDiagnostico(diagnosticoOs8));
$('incluirGrupos').onclick = async () => {
  $('incluirGrupos').disabled = true;
  try { await chrome.runtime.sendMessage({acao:'incluirGrupos'}); }
  catch { $('status').textContent = 'Execução interrompida. Confira o resultado das inclusões.'; }
  finally { $('incluirGrupos').disabled = false; }
};
function mostrarErros(erros = []) {
  $('errosOs').textContent = erros.length ? erros.map(e => `OS ${e.solicitacaoId}: ${e.falhas.map(f => f.erro).join(' | ')}`).join('\n') : 'Nenhum erro registrado.';
  $('errosOs').style.whiteSpace = 'pre-wrap';
}
chrome.storage.local.get('errosOs8').then(({errosOs8}) => mostrarErros(errosOs8));
function mostrarGrupos(dados) {
  $('grupos').value = dados?.grupos?.join('\n') || '';
  $('gruposResumo').textContent = dados ? `OS ${dados.solicitacaoId} · Destino ${dados.matriculaDestino} · ${dados.status}\n` + dados.porMatricula.map(item => `${item.usuario}: ${item.status === 'erro' ? item.erro : item.grupos.length + ' grupo(s)'}`).join(' | ') : 'Nenhuma consulta guardada.';
}
chrome.storage.local.get('gruposOs8').then(({ gruposOs8 }) => mostrarGrupos(gruposOs8));
 $('consultarGrupos').onclick = async () => {
  $('consultarGrupos').disabled = true;
  try { await chrome.runtime.sendMessage({ acao: 'consultarGrupos' }); }
  catch { $('status').textContent = 'A consulta foi interrompida. Tente novamente.'; }
  finally { $('consultarGrupos').disabled = false; }
};
chrome.storage.session.get('captura').then(({ captura }) => mostrar(captura));
$('osNumero').addEventListener('input', e => {
  const limpo = limparNumeroOs(e.target.value);
  if (e.target.value !== limpo) e.target.value = limpo;
});
chrome.storage.local.get('os8NumeroManual').then(({ os8NumeroManual }) => {
  if (os8NumeroManual) $('osNumero').value = limparNumeroOs(os8NumeroManual);
});
$('executar').onclick = async () => {
  const solicitacaoId = lerNumeroOs();
  if (solicitacaoId) await salvarNumeroOs(solicitacaoId);
  mostrar({ status: 'executando', mensagem: solicitacaoId ? `Iniciando atendimento da OS ${solicitacaoId}…` : 'Iniciando atendimento da próxima OS 08 da lista…' });
  try {
    const resposta = solicitacaoId
      ? await chrome.runtime.sendMessage({ acao: 'executarOsInformada', solicitacaoId })
      : await chrome.runtime.sendMessage({ acao: 'executar' });
    if (resposta?.ok === false) throw new Error(resposta.erro || 'Falha ao iniciar atendimento.');
  }
  catch {
    const alvo = solicitacaoId ? `da OS ${solicitacaoId}` : 'da próxima OS 08';
    mostrar({ status: 'erro', mensagem: `A execução ${alvo} foi interrompida. Tente novamente.` });
  }
};
$('copiar').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('descricao').value);
    $('copiar').textContent = 'Copiado!';
    setTimeout(() => $('copiar').textContent = 'Copiar texto', 1500);
  } catch { $('status').textContent = 'Selecione o texto da descrição e use Ctrl+C para copiar.'; }
};
