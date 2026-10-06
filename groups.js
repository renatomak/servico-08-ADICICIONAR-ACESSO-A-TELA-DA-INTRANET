function extrairDestino(texto) {
  return String(texto || '').match(/\bMATR[ÍI]CULA\s*:\s*(\d{4,10})(?!\d)/i)?.[1] || '';
}

async function consultarComTentativas(matricula, consultar, prefixo = 'M') {
  matricula = String(matricula || '').replace(/[-–—]\d{2}$/, '').replace(/\D/g, '');
  const tentativas = [];
  // Números com 8/9 posições incluem os dois dígitos de contrato.
  // Não consultar um número intermediário de 7 posições que ainda contenha contrato.
  if (!/^\d{4,9}$/.test(matricula)) return { erro: 'Matrícula fora do formato: até 7 dígitos mais 2 de contrato.', tentativas, esgotada: true };
  for (let removidos = matricula.length > 7 ? 2 : 0; removidos <= 2; removidos++) {
    const candidata = matricula.slice(0, matricula.length - removidos);
    if (candidata.length < 4) break;
    const resultado = await consultar(candidata);
    tentativas.push({ usuario: `${prefixo}${candidata}`, erro: resultado?.erro || null });
    if (resultado && !resultado.erro) return { ...resultado, matriculaConsultada: candidata, tentativas };
    const erro = resultado?.erro || 'Falha na consulta.';
    // Só modifica o número quando o sistema rejeita explicitamente a matrícula.
    if (!/matricula invalida|(?:usuario|matricula)\s+nao\s+(?:cadastrad[oa]|encontrad[oa])/i.test(erro.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
      return { erro, tentativas, esgotada: false };
    }
  }
  return { erro: `${prefixo}${matricula}: matrícula não localizada nas consultas ${tentativas.map(t => t.usuario).join(', ')}.`, tentativas, esgotada: true };
}

// Executada no frame principal do Acessos. Usa somente o formulário de consulta.
async function consultarEspelhoNoAcessos(matricula) {
  try {
    if (!/^\d{4,7}$/.test(matricula)) throw new Error('Matrícula espelho inválida: máximo de 7 dígitos.');
    const usuario = `M${matricula}`;
    const docs = () => {
      const out = [], fila = [window];
      while (fila.length) {
        const w = fila.shift();
        try {
          out.push(w.document);
          for (const frame of w.document.querySelectorAll('frame,iframe')) fila.push(frame.contentWindow);
        } catch (_) { /* frame de outro domínio */ }
      }
      return out;
    };
    const esperar = async predicate => {
      const inicio = Date.now();
      while (Date.now() - inicio < 12000) {
        const valor = predicate();
        if (valor) return valor;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw new Error('A consulta não respondeu. Confira a sessão do Acessos.');
    };
    // Endereço confirmado no item Menu Principal > Relatórios > Acessos do Usuário.
    const frame = docs().map(d => d.querySelector('frame[name="cpo"],iframe[name="cpo"]')).find(Boolean);
    if (!frame) throw new Error('Abra a tela principal do sistema Acessos antes de consultar os grupos.');
    const anterior = frame.contentDocument;
    frame.src = new URL('/sistemas/senha/asp/senha00060f0.asp', location.origin).href;
    const formDoc = await esperar(() => {
      const d = frame.contentDocument;
      return d && d !== anterior && /senha00060f0\.asp/i.test(d.URL) && d.querySelector('input[name="txt_id_usuario"]') && d;
    });
    const campo = formDoc.querySelector('input[name="txt_id_usuario"]');
    const nome = formDoc.querySelector('input[name="txt_nm_usuario"]');
    const consultar = formDoc.querySelector('input[value="Consultar"]');
    if (!nome || !consultar) throw new Error('Campos do relatório não encontrados.');
    nome.value = '';
    for (const d of docs()) {
      const aviso = d.querySelector('input[name="msg_n"]');
      if (aviso) aviso.value = '';
    }
    campo.value = usuario;
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    campo.dispatchEvent(new Event('change', { bubbles: true }));
    consultar.click();
    await esperar(() => {
      const aviso = docs().map(d => d.querySelector('input[name="msg_n"]')?.value || '').join(' ');
      if (/inv[aá]lida|n[aã]o encontrad|n[aã]o cadastrad/i.test(aviso)) throw new Error(`${usuario}: ${aviso.trim()}`);
      return nome.value.trim();
    });
    if (campo.value.toUpperCase() !== usuario) throw new Error('A matrícula consultada mudou durante a leitura.');
    const url = new URL('/sistemas/senha/asp/senha00060w0.asp', location.origin);
    url.searchParams.set('txt_id_usuario', usuario);
    url.searchParams.set('txt_nm_usuario', nome.value.trim());
    return { usuario, nome: nome.value.trim(), url: url.href };
  } catch (e) { return { erro: e.message }; }
}

function lerGruposDoRelatorio(usuario) {
  try {
    const url = new URL(location.href);
    if (!/\/senha00060w0\.asp$/i.test(url.pathname) || url.searchParams.get('txt_id_usuario') !== usuario) {
      throw new Error('Relatório não corresponde à matrícula consultada.');
    }
    if (!/ACESSOS DA MATR[IÍ]CULA/i.test(document.body.innerText)) throw new Error('Relatório não carregou. Confira a sessão do Acessos.');
    const grupos = new Map();
    for (const tr of document.querySelectorAll('table tr')) {
      const cells = [...tr.cells];
      if (cells.length !== 1 || cells[0].colSpan !== 2 || cells[0].querySelector('a')) continue;
      const m = cells[0].innerText.trim().match(/^(\d+)\s*[-–]\s*(\S[\s\S]*)$/);
      if (m) grupos.set(m[1], { codigo: m[1], nome: m[2].trim() });
    }
    return { usuario, grupos: [...grupos.values()] };
  } catch (e) { return { erro: e.message }; }
}

async function guardarGruposDaCaptura(captura) {
  const matriculaDestino = extrairDestino(captura?.texto);
  if (!matriculaDestino) throw new Error('Não identifiquei a matrícula destino na descrição.');
  const equivalencias = extrairEquivalencias(captura.texto);
  if (!equivalencias.length) throw new Error('A descrição não informa matrícula espelho.');
  const abas = await chrome.tabs.query({ url: 'https://intra004.goiania.go.gov.br/*' });
  const candidatas = abas.filter(t => /\/senha00004f0\.asp(?:[?#]|$)/i.test(t.url || '') && /(?:nm_sigla=senha|nm_sistema=Acessos)/i.test(t.url || ''))
    .sort((a,b) => Number(b.active)-Number(a.active) || (b.lastAccessed || 0)-(a.lastAccessed || 0));
  let sistema;
  for (const candidata of candidatas) {
    try {
      const [r] = await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:candidata.id},func:verificarPaginaUtilizavel,args:[candidata.url]});
      if (r?.result?.pronta) { sistema=candidata; break; }
    } catch (_) { /* Aba fechada ou substituída: verificar a próxima. */ }
  }
  sistema ||= candidatas[0];
  if (!sistema) {
    await registrar({ ...captura, status: 'executando', mensagem: 'Abrindo a Intranet no sistema Acessos…' });
    // O frameset geral00000f0 depende do contêiner principal; não é uma entrada.
    await chrome.storage.session.set({consultaPendente:captura});
    const portalUrl = 'https://eresolve.goiania.go.gov.br/portalservicos/';
    const portais = await chrome.tabs.query({url:'https://eresolve.goiania.go.gov.br/portalservicos/*'});
    const portal = portais[0] || await chrome.tabs.create({url:portalUrl,active:true});
    try {
      await aguardarPagina(portal.id, portalUrl);
      const [abertura] = await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:portal.id},func:abrirAcessosNoPortal});
      if (!abertura?.result) throw new Error('O link Acessos não está disponível no portal.');
      // O evento onUpdated pode ocorrer enquanto executando ainda está ativo.
      // Aguardar aqui evita perder essa abertura e deixar a consulta pendente.
      const inicio = Date.now();
      while (Date.now() - inicio < 60000) {
        const abertas = await chrome.tabs.query({url:'https://intra004.goiania.go.gov.br/*'});
        sistema = abertas.find(t => /\/senha00004f0\.asp(?:[?#]|$)/i.test(t.url || ''));
        if (sistema) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (_) { /* Login: mantém a captura para retomar após a entrada oficial. */ }
    if (!sistema) {
    await registrar({...captura,status:'aguardando',mensagem:'Abrindo Acessos pela entrada oficial do E-Resolve. Se o portal pedir login ou bloquear a nova aba, entre e clique em Acessos; o atendimento retoma automaticamente.'});
    return;
    }
  }
  try { await aguardarPagina(sistema.id, sistema.url); }
  catch(e) {
    if(!/login/i.test(e.message)) throw e;
    await chrome.storage.session.set({consultaPendente:captura});
    await registrar({...captura,status:'aguardando',mensagem:e.message});
    return;
  }
  const [pronta] = await chrome.scripting.executeScript({injectImmediately:true, target: { tabId: sistema.id }, func: verificarAcessosPronto });
  if (!pronta?.result) {
    await chrome.storage.session.set({ consultaPendente: captura });
    await registrar({ ...captura, status: 'aguardando', mensagem: 'Aguardando login na Intranet e abertura do Acessos. A consulta continuará automaticamente quando o sistema estiver pronto.' });
    return;
  }
  await chrome.storage.session.remove('consultaPendente');
  const dados = { solicitacaoId: captura.solicitacaoId, matriculaDestino, equivalencias, porMatricula: [], grupos: [], status: 'consultando', atualizadoEm: new Date().toISOString() };
  const salvar = async () => {
    dados.atualizadoEm = new Date().toISOString();
    await chrome.storage.local.set({ gruposOs8: dados });
  };
  await salvar();
  let relatorio;
  for (const matricula of equivalencias) {
    await registrar({ ...captura, status: 'executando', mensagem: `Consultando grupos de M${matricula}…`, matriculaDestino });
    try {
      const consulta = await consultarComTentativas(matricula, async candidata => {
        await registrar({ ...captura, status: 'executando', mensagem: `Consultando M${candidata} (espelho informado: M${matricula})…`, matriculaDestino });
        const [retorno] = await chrome.scripting.executeScript({injectImmediately:true, target: { tabId: sistema.id }, func: consultarEspelhoNoAcessos, args: [candidata] });
        return retorno?.result;
      });
      if (consulta.erro) {
        dados.porMatricula.push({ matricula, usuario: `M${matricula}`, grupos: [], status: 'erro', erro: consulta.erro, tentativas: consulta.tentativas });
        if (consulta.esgotada) dados.pularOs = true;
        await salvar();
        if (consulta.esgotada) break;
        continue;
      }
      const usuario = consulta.usuario;
      if (relatorio) await chrome.tabs.update(relatorio.id, { url: consulta.url });
      else relatorio = await chrome.tabs.create({ url: consulta.url, active: true });
      await aguardarPagina(relatorio.id, consulta.url);
      const [leitura] = await chrome.scripting.executeScript({injectImmediately:true, target: { tabId: relatorio.id }, func: lerGruposDoRelatorio, args: [usuario] });
      if (!leitura?.result || leitura.result.erro) throw new Error(leitura?.result?.erro || 'Falha ao ler os grupos.');
      dados.porMatricula.push({ matricula, matriculaConsultada: consulta.matriculaConsultada, usuario, tentativas: consulta.tentativas, grupos: leitura.result.grupos, status: 'concluido' });
      dados.grupos = [...new Set(dados.porMatricula.flatMap(item => (item.grupos || []).map(g => g.codigo)))];
    } catch (e) {
      dados.porMatricula.push({ matricula, usuario: `M${matricula}`, grupos: [], status: 'erro', erro: e.message });
    }
    await salvar();
  }
  dados.status = dados.porMatricula.some(item => item.status === 'erro') ? 'parcial' : 'concluido';
  await salvar();
  if (dados.pularOs) {
    // Histórico separado: a consulta da OS seguinte não apaga o motivo da OS pulada.
    const { errosOs8 = [] } = await chrome.storage.local.get('errosOs8');
    await chrome.storage.local.set({ errosOs8: [...errosOs8, { solicitacaoId: dados.solicitacaoId, atualizadoEm: dados.atualizadoEm, falhas: dados.porMatricula.filter(item => item.status === 'erro') }] });
  }
  const falhas = dados.porMatricula.filter(item => item.status === 'erro');
  await registrar({ ...captura, matriculaDestino, status: falhas.length ? 'erro' : 'concluido', mensagem: `${dados.grupos.length} grupo(s) guardado(s) para a OS ${dados.solicitacaoId}. ${falhas.length ? falhas.map(f => f.erro).join(' | ') : 'Consulta concluída. Nenhum acesso foi incluído.'}` });
  return dados;
}

function abrirAcessosNoPortal() {
  const link=[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Acessos' && a.getClientRects().length);
  if(!link) return false;
  link.click();
  return true;
}

function verificarAcessosPronto() {
  const fila = [window];
  while (fila.length) {
    const w = fila.shift();
    try {
      if (w.document.querySelector('frame[name="cpo"],iframe[name="cpo"]')) return true;
      for (const f of w.document.querySelectorAll('frame,iframe')) fila.push(f.contentWindow);
    } catch (_) {}
  }
  return false;
}
