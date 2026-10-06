function verificarPaginaUtilizavel(urlEsperada) {
  const atual = new URL(location.href);
  if (/\/login\.aspx$|\/principal\.shtml$/i.test(atual.pathname) || document.querySelector('input[type="password"]')) return {login:true};
  if (urlEsperada) {
    const esperada = new URL(urlEsperada);
    if (atual.origin !== esperada.origin || atual.pathname.toLowerCase() !== esperada.pathname.toLowerCase()) return {pronta:false};
    for (const chave of ['SolicitacaoId','txt_id_usuario']) {
      if (esperada.searchParams.has(chave) && atual.searchParams.get(chave) !== esperada.searchParams.get(chave)) return {pronta:false};
    }
  }
  const path=atual.pathname.toLowerCase();
  if(path.startsWith('/portalservicos')) return {pronta:[...document.querySelectorAll('a')].some(a=>a.textContent.trim()==='Acessos')};
  if(path.endsWith('/solicitacaodetalhe.aspx')) return {pronta:!!document.querySelector('textarea[id$="_wtSolicitacao_Descricao"]')};
  if(path.endsWith('/solicitacoes.aspx')) return {pronta:!!document.querySelector('table[id$="wtSolicitacaoTable"]')};
  if(path.endsWith('/senha00060w0.asp')) return {pronta:/ACESSOS DA MATR[IÍ]CULA/i.test(document.body?.innerText || '') && document.readyState !== 'loading'};
  if(/\/(?:senha00004f0|geral00000f0)\.asp$/.test(path)) {
    const fila=[window];
    let campo=false, menu=false, bloqueio='';
    while(fila.length) {
      const w=fila.shift();
      try {
        const d=w.document;
        if(d.querySelector('input[type="password"]') || /\/(?:login\.aspx|principal\.shtml)(?:[?#]|$)/i.test(d.URL || '')) return {login:true};
        const frame=d.querySelector('frame[name="cpo"],iframe[name="cpo"]');
        if(frame) campo=true;
        if(/Menu Principal/i.test(d.body?.innerText || '')) menu=true;
        for(const f of d.querySelectorAll('frame,iframe')) {
          // O painel da extensão não faz parte da sessão do Acessos.
          if(/^chrome-extension:/i.test(f.src || '')) continue;
          if(f.contentWindow) fila.push(f.contentWindow);
        }
      } catch(_) { bloqueio='Um frame do Acessos não pôde ser lido.'; }
    }
    return {pronta:campo && menu, detalhe:campo ? 'Aguardando o Menu Principal do Acessos.' : bloqueio || 'O frame cpo do Acessos ainda não está disponível.'};
  }
  return {pronta:false};
}

async function esperarPaginaUtilizavel(tabId,urlEsperada,timeout=60000) {
  const inicio=Date.now();
  let detalhe='';
  while(Date.now()-inicio<timeout) {
    // Não depende de tab.status: frames e o painel podem manter "loading".
    const tab=await chrome.tabs.get(tabId);
    let estado;
    try {
      const [r]=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},injectImmediately:true,func:verificarPaginaUtilizavel,args:[urlEsperada || '']});
      estado=r?.result;
      detalhe=estado?.detalhe || detalhe;
    } catch(e) { detalhe=`Não foi possível verificar a página: ${e.message}`; }
    if(estado?.login) throw new Error('A sessão expirou ou o sistema pediu login. Entre na aba aberta e retome o atendimento.');
    if(estado?.pronta && !tab.pendingUrl) return tab;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  const destino=urlEsperada ? new URL(urlEsperada).pathname.split('/').pop() : 'página solicitada';
  throw new Error(`A tela ${destino} não ficou disponível em ${Math.ceil(timeout/1000)} segundos. ${detalhe} Confira a conexão e a sessão na aba aberta; nenhum reenvio foi feito.`);
}
