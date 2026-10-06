const ALARME_FILA = 'os8-proxima';
function ordenarOsPorAbertura(solicitacoes) {
  const data = texto => {
    const m = String(texto).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if(!m) throw new Error(`Data de abertura não reconhecida: ${texto || '(vazia)'}. A fila não foi iniciada.`);
    const [,dia,mes,ano,h='00',min='00',s='00']=m;
    const stamp=Date.UTC(+ano,+mes-1,+dia,+h,+min,+s);
    const d=new Date(stamp);
    if(d.getUTCFullYear()!==+ano || d.getUTCMonth()!==+mes-1 || d.getUTCDate()!==+dia || +h>23 || +min>59 || +s>59) throw new Error('Data de abertura inválida. A fila não foi iniciada.');
    return stamp;
  };
  const unicas=new Map(solicitacoes.map(s=>[s.url,{...s,instante:data(s.abertura)}]));
  return [...unicas.values()].sort((a,b)=>a.instante-b.instante || Number(new URL(a.url).searchParams.get('SolicitacaoId'))-Number(new URL(b.url).searchParams.get('SolicitacaoId')));
}
async function lerPaginaDaFila() {
  try { return await localizarOs8(true); } catch(e) { return {erro:e.message}; }
}
async function avancarPaginaDaFila(direcao = 'proxima') {
  const assinatura = () => [...document.querySelectorAll('a[href*="SolicitacaoDetalhe.aspx?SolicitacaoId="]')].map(a=>a.getAttribute('href')).join('|');
  const rotulo=direcao==='anterior'?/go to previous page/i:/go to next page/i;
  const links = [...document.querySelectorAll('a')].filter(a=>a.getClientRects().length && rotulo.test(a.title || a.getAttribute('aria-label') || ''));
  const proximo=links.find(a=>a.getAttribute('aria-disabled')!=='true' && !a.classList.contains('disabled'));
  if(!proximo) return {fim:true};
  const antes=assinatura();
  proximo.click();
  const inicio=Date.now();
  while(Date.now()-inicio<15000) {
    if(assinatura() && assinatura()!==antes) return {fim:false};
    await new Promise(r=>setTimeout(r,250));
  }
  return {erro:'A próxima página não carregou. A fila não foi iniciada.'};
}
async function salvarFila(fila) {
  await chrome.storage.local.set({filaOs8:{...fila,atualizadoEm:new Date().toISOString()}});
}
async function atualizarDiagnosticoOs8(solicitacaoId, etapa, status, detalhe = '') {
  const ordemEtapas = ['abertura_os', 'captura_descricao', 'consulta_espelhos', 'inclusao_grupos', 'fechamento_os'];
  const { diagnosticoOs8 } = await chrome.storage.local.get('diagnosticoOs8');
  const base = diagnosticoOs8?.solicitacaoId === solicitacaoId
    ? diagnosticoOs8
    : { solicitacaoId, etapas: [], status: 'executando', atualizadoEm: new Date().toISOString() };
  const etapas = [...(base.etapas || [])];
  const idx = etapas.findIndex(e => e.etapa === etapa);
  const registro = { etapa, status, detalhe, atualizadoEm: new Date().toISOString() };
  if (idx >= 0) etapas[idx] = registro;
  else etapas.push(registro);
  etapas.sort((a, b) => ordemEtapas.indexOf(a.etapa) - ordemEtapas.indexOf(b.etapa));
  base.etapas = etapas;
  base.atualizadoEm = new Date().toISOString();
  await chrome.storage.local.set({ diagnosticoOs8: base });
}
async function atenderOsInformada(solicitacaoId) {
  if (executando) throw new Error('Já existe um atendimento em execução.');
  executando = true;
  let captura;
  try {
    const id = String(solicitacaoId || '').trim();
    if (!/^\d+$/.test(id)) throw new Error('Informe um número de OS válido.');
    await chrome.storage.local.set({ diagnosticoOs8: { solicitacaoId: id, status: 'executando', atualizadoEm: new Date().toISOString(), etapas: [] } });
    await chrome.alarms.clear(ALARME_FILA);
    await chrome.storage.session.remove('consultaPendente');
    const url = `https://servicos.goiania.go.gov.br/atende/SolicitacaoDetalhe.aspx?SolicitacaoId=${id}`;
    await atualizarDiagnosticoOs8(id, 'abertura_os', 'executando', 'Abrindo aba da OS informada.');
    await registrar({ status: 'executando', mensagem: `Abrindo OS ${id}…` });
    const abas = await chrome.tabs.query({url:'https://servicos.goiania.go.gov.br/atende/SolicitacaoDetalhe.aspx*'});
    let tab = abas.find(t => {
      try { return new URL(t.url).searchParams.get('SolicitacaoId') === id; }
      catch (_) { return false; }
    });
    if (tab) await chrome.tabs.update(tab.id, { active: true });
    else tab = await chrome.tabs.create({ url, active: true });
    await aguardarPagina(tab.id, url);
    await atualizarDiagnosticoOs8(id, 'abertura_os', 'concluido', 'Tela da OS aberta com sucesso.');
    await atualizarDiagnosticoOs8(id, 'captura_descricao', 'executando', 'Lendo descrição da solicitação no Atende.');
    await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},files:['automation.js']});
    captura = await executarNaPagina(tab.id, lerNaPagina);
    captura.tabOs = tab.id;
    if (captura.solicitacaoId !== id) throw new Error('A página aberta não corresponde ao número informado.');
    await atualizarDiagnosticoOs8(id, 'captura_descricao', 'concluido', 'Descrição capturada com sucesso.');
    const [situacao] = await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:etapaFechamentoNaPagina,args:[id,'estado','']});
    if (situacao?.result?.fechada) {
      await atualizarDiagnosticoOs8(id, 'fechamento_os', 'concluido', 'OS já estava fechada antes do atendimento.');
      await chrome.storage.local.set({ diagnosticoOs8: { solicitacaoId: id, status: 'concluido', atualizadoEm: new Date().toISOString(), etapas: (await chrome.storage.local.get('diagnosticoOs8')).diagnosticoOs8?.etapas || [] } });
      await registrar({ ...captura, status: 'concluido', mensagem: `OS ${id} já está fechada. Nenhuma ação necessária.` });
      return { status: 'ja_fechada', solicitacaoId: id };
    }
    const equivalencias = extrairEquivalencias(captura.texto);
    if (!equivalencias.length) {
      await atualizarDiagnosticoOs8(id, 'consulta_espelhos', 'interrompido', 'Descrição sem matrícula de equivalência para consulta.');
      await chrome.storage.local.set({ diagnosticoOs8: { solicitacaoId: id, status: 'interrompido', atualizadoEm: new Date().toISOString(), etapas: (await chrome.storage.local.get('diagnosticoOs8')).diagnosticoOs8?.etapas || [] } });
      await registrar({ ...captura, status: 'concluido', mensagem: `OS ${id} sem matrícula de equivalência. Nada para incluir.` });
      return { status: 'sem_equivalencia', solicitacaoId: id };
    }
    await atualizarDiagnosticoOs8(id, 'consulta_espelhos', 'executando', 'Consultando espelhos e grupos no sistema Acessos.');
    await atualizarDiagnosticoOs8(id, 'inclusao_grupos', 'executando', 'Validando matrícula destino e incluindo nos grupos.');
    await registrar({ ...captura, status: 'executando', mensagem: `Processando OS ${id}…` });
    await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:mostrarDescricaoNaPagina,args:[captura]});
    const dados = await consultarEIncluir({ ...captura, equivalencias });
    if (dados?.pularOs) {
      await atualizarDiagnosticoOs8(id, 'consulta_espelhos', 'interrompido', 'Matrícula espelho não localizada nas tentativas automáticas.');
      await atualizarDiagnosticoOs8(id, 'inclusao_grupos', 'interrompido', 'Inclusão não iniciada por falta de matrícula válida para consulta.');
      await chrome.storage.local.set({ diagnosticoOs8: { solicitacaoId: id, status: 'interrompido', atualizadoEm: new Date().toISOString(), etapas: (await chrome.storage.local.get('diagnosticoOs8')).diagnosticoOs8?.etapas || [] } });
      await registrar({ ...captura, status: 'concluido', mensagem: `OS ${id} pulada: matrícula não localizada nas tentativas automáticas.` });
      return { status: 'matricula_nao_localizada', solicitacaoId: id };
    }
    await atualizarDiagnosticoOs8(id, 'consulta_espelhos', 'concluido', 'Consulta de espelhos concluída.');
    const { inclusaoOs8, fechamentoOs8 } = await chrome.storage.local.get(['inclusaoOs8', 'fechamentoOs8']);
    if (inclusaoOs8?.solicitacaoId === id && inclusaoOs8.status === 'concluido') {
      await atualizarDiagnosticoOs8(id, 'inclusao_grupos', 'concluido', 'Todos os grupos retornaram confirmação de inclusão.');
    } else {
      const emAndamento = inclusaoOs8?.grupoEmAndamento ? ` Último grupo: ${inclusaoOs8.grupoEmAndamento}.` : '';
      const erroInclusao = inclusaoOs8?.erro ? ` ${inclusaoOs8.erro}` : '';
      await atualizarDiagnosticoOs8(id, 'inclusao_grupos', 'interrompido', `Inclusão não concluída (${inclusaoOs8?.status || 'sem registro'}).${emAndamento}${erroInclusao}`.trim());
      throw new Error(`Inclusão de grupos não concluída (${inclusaoOs8?.status || 'sem registro'}). Verifique o resumo de inclusão por grupo.`);
    }
    if (fechamentoOs8?.solicitacaoId === id && ['fechada', 'ja_fechada'].includes(fechamentoOs8.status)) {
      await atualizarDiagnosticoOs8(id, 'fechamento_os', 'concluido', fechamentoOs8.status === 'ja_fechada' ? 'OS já fechada antes da confirmação final.' : 'OS recebida e fechada com sucesso.');
      await chrome.storage.local.set({ diagnosticoOs8: { solicitacaoId: id, status: 'concluido', atualizadoEm: new Date().toISOString(), etapas: (await chrome.storage.local.get('diagnosticoOs8')).diagnosticoOs8?.etapas || [] } });
      await registrar({ ...captura, status: 'concluido', mensagem: `OS ${id} atendida com sucesso.` });
      return { status: 'concluido', solicitacaoId: id };
    }
    const { consultaPendente } = await chrome.storage.session.get('consultaPendente');
    if (consultaPendente) {
      await atualizarDiagnosticoOs8(id, 'fechamento_os', 'aguardando', 'Aguardando login no Acessos para retomar o fechamento.');
      await chrome.storage.local.set({ diagnosticoOs8: { solicitacaoId: id, status: 'aguardando', atualizadoEm: new Date().toISOString(), etapas: (await chrome.storage.local.get('diagnosticoOs8')).diagnosticoOs8?.etapas || [] } });
      await registrar({ ...captura, status: 'aguardando', mensagem: 'Aguardando login no Acessos para retomar o atendimento automaticamente.' });
      return { status: 'aguardando_login', solicitacaoId: id };
    }
    const detalheFechamento = fechamentoOs8?.solicitacaoId === id
      ? `Fechamento com status ${fechamentoOs8.status}${fechamentoOs8.erro ? `: ${fechamentoOs8.erro}` : ''}.`
      : 'Nenhum registro de fechamento foi gerado para esta OS.';
    await atualizarDiagnosticoOs8(id, 'fechamento_os', 'interrompido', detalheFechamento);
    throw new Error(`Fechamento da OS não confirmado. ${detalheFechamento}`);
  } catch (e) {
    const id = String(solicitacaoId || '').trim();
    if (/^\d+$/.test(id)) {
      const { diagnosticoOs8 } = await chrome.storage.local.get('diagnosticoOs8');
      if (diagnosticoOs8?.solicitacaoId === id) {
        diagnosticoOs8.status = 'erro';
        diagnosticoOs8.erro = e.message;
        diagnosticoOs8.atualizadoEm = new Date().toISOString();
        await chrome.storage.local.set({ diagnosticoOs8 });
      }
    }
    await registrar({ ...captura, status: 'erro', mensagem: `Atendimento da OS ${solicitacaoId}: ${e.message}` });
    throw e;
  } finally {
    executando = false;
  }
}
async function iniciarFila() {
  if(executando) return;
  executando=true;
  try {
    await chrome.alarms.clear(ALARME_FILA);
    await chrome.storage.session.remove('consultaPendente');
    const [ativa]=await chrome.tabs.query({active:true,currentWindow:true});
    const lista=/^https:\/\/servicos\.goiania\.go\.gov\.br\/atende\/Solicitacoes\.aspx(?:[?#]|$)/i.test(ativa?.url||'') ? ativa : await chrome.tabs.create({url:LISTA,active:true});
    await aguardarPagina(lista.id, LISTA);
    await registrar({status:'executando',mensagem:'Voltando ao início da lista para ordenar todas as OSs por abertura…'});
    while(!(await executarNaPagina(lista.id,avancarPaginaDaFila,['anterior'])).fim) {}
    const solicitacoes=[];
    const paginas=new Set();
    let pagina=1;
    while(true) {
      await registrar({status:'executando',mensagem:`Preparando fila: lendo página ${pagina} da lista…`});
      await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:lista.id},files:['automation.js']});
      const encontrados=await executarNaPagina(lista.id,lerPaginaDaFila);
      solicitacoes.push(...encontrados.solicitacoes);
      const [assinatura]=await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:lista.id},func:()=>[...document.querySelectorAll('a[href*="SolicitacaoDetalhe.aspx?SolicitacaoId="]')].map(a=>a.getAttribute('href')).join('|')});
      if(paginas.has(assinatura.result)) throw new Error('A paginação repetiu uma página. Confira os filtros da lista.');
      paginas.add(assinatura.result);
      const proxima=await executarNaPagina(lista.id,avancarPaginaDaFila);
      if(proxima.fim) break;
      pagina++;
    }
    const ordenadas=ordenarOsPorAbertura(solicitacoes);
    const fila={urls:ordenadas.map(s=>s.url),aberturas:ordenadas.map(s=>s.abertura),ordem:'abertura_crescente',indice:0,concluidas:[],puladas:[],status:'executando',parar:false};
    await salvarFila(fila);
  } catch(e) { await registrar({status:'erro',mensagem:e.message}); return; }
  finally {executando=false;}
  await processarProximaOs();
}
async function processarProximaOs() {
  if(executando) return;
  executando=true;
  let fila;
  try {
    ({filaOs8:fila}=await chrome.storage.local.get('filaOs8'));
    if(!fila || fila.status!=='executando') return;
    if(fila.parar) {fila.status='parada';await salvarFila(fila);return;}
    if(fila.indice>=fila.urls.length) {
      fila.status='concluida';await salvarFila(fila);
      await registrar({status:'concluido',mensagem:`Fila finalizada: ${fila.concluidas.length} OS(s) atendida(s), ${fila.puladas.length} pulada(s).`});
      return;
    }
    const url=fila.urls[fila.indice];
    const id=new URL(url).searchParams.get('SolicitacaoId');
    fila.atual=id;await salvarFila(fila);
    await registrar({status:'executando',mensagem:`OS ${id} — ${fila.indice+1} de ${fila.urls.length}.`});
    let tab;
    if(fila.tabOs) {try {tab=await chrome.tabs.get(fila.tabOs);}catch(_) {}}
    if(tab) await chrome.tabs.update(tab.id,{url,active:true});
    else tab=await chrome.tabs.create({url,active:true});
    fila.tabOs=tab.id;await salvarFila(fila);
    await aguardarPagina(tab.id, url);
    await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},files:['automation.js']});
    const resultado=await executarNaPagina(tab.id,lerNaPagina);
    resultado.tabOs=tab.id;
    if(resultado.url!==url) throw new Error('A página aberta não corresponde à OS da fila.');
    const [situacao]=await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:etapaFechamentoNaPagina,args:[id,'estado','']});
    const equivalencias=extrairEquivalencias(resultado.texto);
    if(situacao?.result?.fechada) fila.puladas.push({id,motivo:'OS já fechada'});
    else if(!equivalencias.length) fila.puladas.push({id,motivo:'Sem matrícula de equivalência'});
    else {
      await registrar({...resultado,status:'executando',mensagem:`Processando OS ${id}…`});
      await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:mostrarDescricaoNaPagina,args:[resultado]});
      const dados=await consultarEIncluir({...resultado,equivalencias});
      if(dados?.pularOs) fila.puladas.push({id,motivo:'Matrícula não localizada'});
      else {
        const {fechamentoOs8}=await chrome.storage.local.get('fechamentoOs8');
        if(fechamentoOs8?.solicitacaoId===id && ['fechada','ja_fechada'].includes(fechamentoOs8.status)) fila.concluidas.push(id);
        else {
          const {consultaPendente}=await chrome.storage.session.get('consultaPendente');
          fila.status=consultaPendente?'aguardando_login':'interrompida';
          await salvarFila(fila);return;
        }
      }
    }
    fila.indice++;
    const {filaOs8:atual}=await chrome.storage.local.get('filaOs8');
    fila.parar=atual?.parar || false;
    if(fila.parar) fila.status='parada';
    await salvarFila(fila);
    if(!fila.parar) {
      // Uma OS por evento evita exceder a duração máxima do service worker.
      await chrome.alarms.create(ALARME_FILA,{delayInMinutes:0.5});
      await registrar({status:'executando',mensagem:`${fila.concluidas.length} concluída(s), ${fila.puladas.length} pulada(s). Próxima OS em até 30 segundos.`});
    }
  } catch(e) {
    if(fila) {fila.status='interrompida';fila.erro=e.message;await salvarFila(fila);}
    await registrar({status:'erro',mensagem:`Fila interrompida: ${e.message}`});
  } finally {executando=false;}
}
chrome.alarms.onAlarm.addListener(alarme=>{if(alarme.name===ALARME_FILA) processarProximaOs();});
