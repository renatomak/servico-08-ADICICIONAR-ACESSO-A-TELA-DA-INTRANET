function mensagemDeFechamento(agora = new Date()) {
  const hora = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }).format(agora));
  const saudacao = hora < 12 ? 'Bom dia!' : hora < 18 ? 'Boa tarde!' : 'Boa noite!';
  return `${saudacao} Sua solicitação foi atendida com sucesso. Os acessos solicitados foram liberados. Agradecemos o contato e permanecemos à disposição.`;
}

function validarConclusaoParaFechamento(captura, grupos, inclusao) {
  const id = captura?.solicitacaoId;
  if (!id || grupos?.solicitacaoId !== id || inclusao?.solicitacaoId !== id) throw new Error('A OS não corresponde aos registros de consulta e inclusão.');
  if (grupos.status !== 'concluido' || grupos.pularOs || inclusao.status !== 'concluido') throw new Error('A OS só pode ser fechada após concluir todas as inclusões.');
  if (grupos.matriculaDestino !== extrairDestino(captura.texto) || inclusao.matriculaInformada !== grupos.matriculaDestino) throw new Error('A matrícula destino não corresponde à descrição da OS.');
  const esperados = [...new Set(grupos.grupos || [])];
  if (!esperados.length || esperados.some(grupo => !(inclusao.resultados || []).some(r => r.grupo === grupo && r.destino === inclusao.matriculaDestino && ['incluido', 'ja_incluido'].includes(r.status)))) throw new Error('Há grupos sem confirmação da matrícula destino.');
  return true;
}

function etapaFechamentoNaPagina(id, acao = 'estado', mensagem = '') {
  try {
    const url = new URL(location.href);
    if (url.pathname.toLowerCase() !== '/atende/solicitacaodetalhe.aspx' || url.searchParams.get('SolicitacaoId') !== id) throw new Error('A aba não corresponde à OS que será fechada.');
    const situacao = document.querySelector('input[id$="_wt238"]')?.value?.trim();
    const encerramento = document.querySelector('input[id$="_wtSolicitacao_DataEncerramento2"]')?.value?.trim();
    const fechada = situacao === 'Fechada' && !!encerramento;
    const receber = document.querySelector('[id$="_wtBtnReceber"]');
    const fechar = document.querySelector('[id$="_wtBtnFecharSolicitacao"]');
    const modal = [...document.querySelectorAll('iframe')].find(f => {
      try { const u = new URL(f.src); return u.origin === url.origin && /\/ReabreouEncerraSolicitacao\.aspx$/i.test(u.pathname) && u.searchParams.get('SolicitacaoId') === id && u.searchParams.get('Operacao') === '2'; } catch { return false; }
    });
    const d = modal?.contentDocument;
    const texto = d?.querySelector('textarea[id$="_wtDescricaoReabertura"]');
    const atendida = d?.getElementById('WebPatterns_wt23_block_wtMainContent_WebPatterns_wt53_block_wtContent_wt40');
    const confirmar = d?.getElementById('WebPatterns_wt23_block_wtMainContent_wt9');
    if (acao === 'estado') return {fechada,situacao,receber:!!receber,fechar:!!fechar,modal:!!(texto && atendida && confirmar),preparada:!!atendida?.checked && texto?.value === mensagem, mensagemConfirmada: document.querySelector('[id$="_wtAndamentoTable"]')?.innerText.includes(mensagem) || false};
    if (fechada) return {fechada:true};
    if (acao === 'receber') {
      if (!receber || receber.disabled) throw new Error('Receber não está disponível.');
      receber.click();
    } else if (acao === 'abrir') {
      if (receber || !fechar || fechar.disabled) throw new Error('A OS ainda não está pronta para fechamento.');
      fechar.click();
    } else if (acao === 'preparar') {
      if (!texto || !atendida || !confirmar || confirmar.disabled || !mensagem.trim()) throw new Error('Formulário de fechamento não está pronto.');
      if (texto.value.trim() && texto.value !== mensagem) throw new Error('Já existe outra justificativa no formulário. Confira antes de fechar.');
      texto.value = mensagem;
      texto.dispatchEvent(new Event('input',{bubbles:true}));
      texto.dispatchEvent(new Event('change',{bubbles:true}));
      if (!atendida.checked) atendida.click();
    } else if (acao === 'confirmar') {
      if (!atendida?.checked || texto?.value !== mensagem || !confirmar || confirmar.disabled) throw new Error('Justificativa ou opção Atendida não confirmadas.');
      confirmar.click();
    } else throw new Error('Etapa de fechamento desconhecida.');
    return {enviado:true};
  } catch (e) { return {erro:e.message}; }
}

async function fecharOsConcluida(captura) {
  const {gruposOs8, inclusaoOs8} = await chrome.storage.local.get(['gruposOs8','inclusaoOs8']);
  validarConclusaoParaFechamento(captura, gruposOs8, inclusaoOs8);
  const id = captura.solicitacaoId;
  if (!/^\d+$/.test(id)) throw new Error('Número de OS inválido.');
  const url = `https://servicos.goiania.go.gov.br/atende/SolicitacaoDetalhe.aspx?SolicitacaoId=${id}`;
  const abas = await chrome.tabs.query({url:'https://servicos.goiania.go.gov.br/atende/SolicitacaoDetalhe.aspx*'});
  let tab = abas.find(t => new URL(t.url).searchParams.get('SolicitacaoId') === id);
  if (!tab) tab = await chrome.tabs.create({url,active:true});
  else await chrome.tabs.update(tab.id,{active:true});
  await aguardarPagina(tab.id, url);
  const mensagem = mensagemDeFechamento();
  const registro = {solicitacaoId:id,mensagem,status:'iniciando'};
  const salvar = async status => { registro.status=status; registro.atualizadoEm=new Date().toISOString(); await chrome.storage.local.set({fechamentoOs8:registro}); };
  const agir = async acao => {
    const [r] = await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:etapaFechamentoNaPagina,args:[id,acao,mensagem]});
    if (!r?.result || r.result.erro) throw new Error(r?.result?.erro || 'Não foi possível verificar o fechamento.');
    return r.result;
  };
  const esperar = async fn => {
    const inicio=Date.now();
    while(Date.now()-inicio<20000) {
      const estado=await agir('estado');
      if(fn(estado)) return estado;
      await new Promise(r=>setTimeout(r,300));
    }
    throw new Error('O Atende não confirmou a etapa. Confira a OS antes de repetir.');
  };
  await salvar('iniciando');
  try {
    let estado=await agir('estado');
    if (estado.fechada) { await salvar('ja_fechada'); await registrar({...captura,status:'concluido',mensagem:`OS ${id} já está fechada. Nenhuma mensagem duplicada foi enviada.`}); return; }
    await registrar({...captura,status:'executando',mensagem:`Recebendo e fechando a OS ${id}…`});
    if(estado.receber) {
      await salvar('recebendo');
      await agir('receber');
      estado=await esperar(e=>e.fechar && !e.receber);
    }
    if(!estado.modal) {
      await agir('abrir');
      await esperar(e=>e.modal);
    }
    await salvar('confirmando');
    await agir('preparar');
    await esperar(e=>e.preparada);
    // Atendida dispara Ajax do OutSystems; aguarda estabilizar antes do postback final.
    await new Promise(r=>setTimeout(r,1000));
    await esperar(e=>e.preparada);
    await agir('confirmar');
    await esperar(e=>e.fechada && e.mensagemConfirmada);
    await salvar('fechada');
    await registrar({...captura,status:'concluido',mensagem:`OS ${id} recebida e fechada como atendida. Mensagem de conclusão registrada.`});
  } catch(e) {
    registro.erro=e.message;
    await salvar('verificar');
    await registrar({...captura,status:'erro',mensagem:`Fechamento da OS ${id}: ${e.message}`});
    throw e;
  }
}
