importScripts('automation.js');
importScripts('groups.js');
importScripts('inclusion.js');
importScripts('closure.js');
importScripts('queue.js');
importScripts('loading.js');
const LISTA = 'https://servicos.goiania.go.gov.br/atende/Solicitacoes.aspx';
let executando = false;
const registrar = async estado => {
  await chrome.storage.session.set({ captura: { ...estado, atualizadoEm: Date.now() } });
  if (estado.tabOs) {
    try {
      await chrome.scripting.executeScript({injectImmediately:true, target: { tabId: estado.tabOs }, func: atualizarPainelOs, args: [estado.mensagem || ''] });
    } catch (_) { /* A OS pode ter sido fechada; o retorno continua no popup. */ }
  }
};
function atualizarPainelOs(mensagem) {
  const root = document.getElementById('atende-os8-captura')?.shadowRoot;
  if (root?.querySelector('#andamento')) root.querySelector('#andamento').textContent = mensagem;
}
async function consultarEIncluir(captura) {
  const dados = await guardarGruposDaCaptura(captura);
  if (dados?.status === 'concluido' && !dados.pularOs && dados.grupos.length) {
    const inclusao = await incluirGruposGuardados(dados, captura);
    if (inclusao?.pularOs) dados.pularOs = true;
    if (inclusao?.status === 'concluido') await fecharOsConcluida(captura);
  }
  return dados;
}

async function aguardarPagina(tabId, urlEsperada) {
  return esperarPaginaUtilizavel(tabId, urlEsperada);
}

async function executarNaPagina(tabId, func, args = []) {
  const [resposta] = await chrome.scripting.executeScript({injectImmediately:true, target: { tabId, frameIds: [0] }, func, args });
  if (!resposta?.result) throw new Error('Não foi possível ler a página. Confira o login e tente novamente.');
  if (resposta.result.erro) throw new Error(resposta.result.erro);
  return resposta.result;
}

// Invólucros devolvem os erros da página sem perder a mensagem na API de injeção.
async function buscarNaPagina() {
  try { return await localizarOs8(); } catch (e) { return { erro: e.message }; }
}
async function lerNaPagina() {
  try { return await capturarDescricao(); } catch (e) { return { erro: e.message }; }
}

async function executarSemFila(solicitacaoIdManual = '') {
  const idManual = String(solicitacaoIdManual || '').trim();
  if (idManual) return atenderOsInformada(idManual);
  if (executando) throw new Error('Já existe um atendimento em execução.');
  executando = true;
  let captura;
  try {
    await chrome.alarms.clear(ALARME_FILA);
    await chrome.storage.session.remove('consultaPendente');
    const [ativa] = await chrome.tabs.query({ active: true, currentWindow: true });
    const lista = /^https:\/\/servicos\.goiania\.go\.gov\.br\/atende\/Solicitacoes\.aspx(?:[?#]|$)/i.test(ativa?.url || '')
      ? ativa
      : await chrome.tabs.create({ url: LISTA, active: true });
    await aguardarPagina(lista.id, LISTA);
    await registrar({ status: 'executando', mensagem: 'Localizando a próxima OS 08 na lista exibida…' });
    await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:lista.id},files:['automation.js']});
    const encontrada = await executarNaPagina(lista.id, buscarNaPagina);
    if (!encontrada?.url) throw new Error('Nenhuma OS do tipo 8 foi encontrada na página exibida.');
    const id = new URL(encontrada.url).searchParams.get('SolicitacaoId') || '';
    await registrar({ status: 'executando', mensagem: `Abrindo OS ${id}…` });
    const tab = await chrome.tabs.create({ url: encontrada.url, active: true });
    await aguardarPagina(tab.id, encontrada.url);
    await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},files:['automation.js']});
    captura = await executarNaPagina(tab.id, lerNaPagina);
    captura.tabOs = tab.id;
    if (captura.url !== encontrada.url) throw new Error('A página aberta não corresponde à OS localizada na lista.');
    const [situacao] = await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:etapaFechamentoNaPagina,args:[captura.solicitacaoId,'estado','']});
    if (situacao?.result?.fechada) {
      await registrar({ ...captura, status: 'concluido', mensagem: `OS ${captura.solicitacaoId} já está fechada. Nenhuma ação necessária.` });
      return;
    }
    const equivalencias = extrairEquivalencias(captura.texto);
    if (!equivalencias.length) {
      await registrar({ ...captura, status: 'concluido', mensagem: `OS ${captura.solicitacaoId} sem matrícula de equivalência. Nada para incluir.` });
      return;
    }
    await registrar({ ...captura, status: 'executando', mensagem: `Processando OS ${captura.solicitacaoId}…` });
    await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:mostrarDescricaoNaPagina,args:[captura]});
    const dados = await consultarEIncluir({ ...captura, equivalencias });
    if (dados?.pularOs) {
      await registrar({ ...captura, status: 'erro', mensagem: `OS ${captura.solicitacaoId} interrompida: matrícula não localizada nas tentativas automáticas.` });
      return;
    }
    const { fechamentoOs8 } = await chrome.storage.local.get('fechamentoOs8');
    if (fechamentoOs8?.solicitacaoId === captura.solicitacaoId && ['fechada', 'ja_fechada'].includes(fechamentoOs8.status)) {
      await registrar({ ...captura, status: 'concluido', mensagem: `OS ${captura.solicitacaoId} atendida com sucesso.` });
      return;
    }
    const { consultaPendente } = await chrome.storage.session.get('consultaPendente');
    if (consultaPendente) {
      await registrar({ ...captura, status: 'aguardando', mensagem: 'Aguardando login no Acessos para retomar o atendimento automaticamente.' });
      return;
    }
    throw new Error('O fechamento da OS não foi confirmado. Confira a seção de diagnóstico para identificar a fase com erro.');
  } catch (e) {
    await registrar({ ...captura, status: 'erro', mensagem: e.message });
    throw e;
  } finally {
    executando = false;
  }
}

chrome.runtime.onMessage.addListener((mensagem, sender, responder) => {
  if (sender.id !== chrome.runtime.id) return;
  if (mensagem?.acao === 'pararFila') {
    (async()=>{
      const {filaOs8}=await chrome.storage.local.get('filaOs8');
      if(filaOs8) {filaOs8.parar=true;await salvarFila(filaOs8);}
      responder({ok:true});
    })();
    return true;
  }
  if (['consultarGrupos','incluirGrupos','fecharOs'].includes(mensagem?.acao)) {
    if (executando) { responder({ ok: false }); return; }
    executando = true;
    (async () => {
      const { captura } = await chrome.storage.session.get('captura');
      try {
        if (mensagem.acao === 'fecharOs') await fecharOsConcluida(captura);
        else if (mensagem.acao === 'incluirGrupos') {
          const {gruposOs8} = await chrome.storage.local.get('gruposOs8');
          const inclusao = await incluirGruposGuardados(gruposOs8, captura);
          if (inclusao?.status === 'concluido') await fecharOsConcluida(captura);
        } else await consultarEIncluir(captura);
      }
      catch (e) { await registrar({ ...captura, status: 'erro', mensagem: e.message }); }
    })().finally(() => { executando = false; responder({ ok: true }); });
    return true;
  }
  if (mensagem?.acao === 'executarOsInformada') {
    executarSemFila(mensagem.solicitacaoId).then(
      () => responder({ ok: true }),
      e => responder({ ok: false, erro: e.message })
    );
    return true;
  }
  if (mensagem?.acao !== 'executar') return;
  executarSemFila().then(() => responder({ ok: true }), e => responder({ ok: false, erro: e.message }));
  return true;
});

// Retoma após login/navegação, inclusive se o popup da extensão foi fechado.
chrome.tabs.onUpdated.addListener(async (_tabId, change, tab) => {
  if (executando || change.status !== 'complete' || !/^https:\/\/intra004\.goiania\.go\.gov\.br\/sistemas\/senha\/asp\/(?:senha00004f0|geral00000f0)\.asp/i.test(tab.url || '')) return;
  executando = true;
  try {
    const { consultaPendente } = await chrome.storage.session.get('consultaPendente');
    if (consultaPendente) {
      await consultarEIncluir(consultaPendente);
      const {filaOs8,fechamentoOs8}=await chrome.storage.local.get(['filaOs8','fechamentoOs8']);
      if(filaOs8?.status==='aguardando_login' && filaOs8.atual===consultaPendente.solicitacaoId && fechamentoOs8?.solicitacaoId===filaOs8.atual && ['fechada','ja_fechada'].includes(fechamentoOs8.status)) {
        filaOs8.concluidas.push(filaOs8.atual);filaOs8.indice++;filaOs8.status=filaOs8.parar?'parada':'executando';
        await salvarFila(filaOs8);
        if(!filaOs8.parar) await chrome.alarms.create(ALARME_FILA,{delayInMinutes:0.5});
      }
    }
  } catch (e) {
    const { captura } = await chrome.storage.session.get('captura');
    await registrar({ ...captura, status: 'erro', mensagem: e.message });
  } finally { executando = false; }
});
