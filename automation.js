// Funções independentes: executadas na página pelo chrome.scripting.
async function localizarOs8(permitirVazia = false) {
  const normalizar = texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const ehTipo8 = texto => /^(?:(?:os|tipo|servico|codigo)\s*[:.\-–]?\s*)?0?8(?:\s*[-–:.)]\s*.*|\s+[^\d].*)?$/.test(normalizar(texto));
  const visivel = el => el.getClientRects().length > 0;
  const inicio = Date.now();
  let motivo = '';
  while (Date.now() - inicio < 15000) {
    const candidatas = [];
    const solicitacoes = [];
    let tabelaReconhecida = false;
    if (/\/Intranet\/Login\.aspx/i.test(location.pathname)) {
      throw new Error('Entre no Atende e clique em Executar novamente.');
    }
    for (const tabela of document.querySelectorAll('table, [role="grid"], [role="table"]')) {
      if (!visivel(tabela)) continue;
      const linhas = [...tabela.querySelectorAll('tr, [role="row"]')].filter(l => l.closest('table, [role="grid"], [role="table"]') === tabela && visivel(l));
      const cabecalho = linhas.find(l => l.querySelector('th, [role="columnheader"]'));
      if (!cabecalho) continue;
      const titulos = [...cabecalho.querySelectorAll('th, td, [role="columnheader"]')].map(c => normalizar(c.innerText.replace(/Sort column by[^\n]*/gi, '')));
      const indices = titulos.map((t, i) => /^(?:(?:codigo|cod\.?)\s+(?:do\s+)?)?(?:tipo(?:\s+(?:de|da)\s+(?:os|solicitacao|servico))?|servico|assunto|categoria)$/.test(t) ? i : -1).filter(i => i >= 0);
      if (!indices.length) continue;
      const dataIdx = titulos.findIndex(t => /^(?:data (?:de )?)?abertura$/.test(t));
      tabelaReconhecida = true;
      for (const linha of linhas) {
        if (linha === cabecalho) continue;
        const celulas = [...linha.querySelectorAll(':scope > td, :scope > th, :scope > [role="cell"], :scope > [role="gridcell"]')];
        if (!indices.some(i => celulas[i] && ehTipo8(celulas[i].innerText))) continue;
        const links = [...linha.querySelectorAll('a[href]')].filter(visivel).map(a => {
          try { return new URL(a.getAttribute('href'), location.href); } catch { return null; }
        }).filter(u => u && u.origin === location.origin && /^\/atende\/SolicitacaoDetalhe\.aspx$/i.test(u.pathname) && /^\d+$/.test(u.searchParams.get('SolicitacaoId') || ''));
        const urls = [...new Set(links.map(u => u.href))];
        if (urls.length === 1) {
          candidatas.push(urls[0]);
          solicitacoes.push({url:urls[0],abertura:celulas[dataIdx]?.innerText?.trim() || ''});
        }
        else motivo = 'Encontrei o tipo 8, mas não identifiquei um link único para abrir seus detalhes.';
      }
    }
    if (candidatas.length) return { url: candidatas[0], urls: [...new Set(candidatas)], solicitacoes };
    if (permitirVazia && tabelaReconhecida && !motivo) return {urls:[],solicitacoes:[]};
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(motivo || 'Nenhuma OS do tipo 8 foi encontrada na página exibida. Confira os filtros da lista e tente novamente.');
}

// Só considera números associados explicitamente a espelho/equivalência.
// Nunca procura matrículas indiscriminadamente na descrição (CPF e destino não são espelhos).
function extrairEquivalencias(texto) {
  const normalizado = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const destino = normalizado.match(/\bmatricula\s*:\s*(\d+)/)?.[1];
  const encontrados = new Set();
  const rotulo = /\b(?:matriculas?\s+(?:de\s+)?(?:espelho|equivalencia)|matriculas?\s+para\s+(?:liberacao\s+por\s+)?equivalencia)\b/g;
  for (const m of normalizado.matchAll(rotulo)) {
    const resto = normalizado.slice(m.index + m[0].length);
    // Admite o rótulo padrão do formulário e listas como nº 123456 e 654321.
    const lista = resto.match(/^(?:\s+para\s+liberacao\s+por\s+equivalencia)?\s*(?::|n[º°o.]*)?\s*((?:M?\d[\d.()\-–—]*\d(?:[ \t]*(?:\/|,|;|\be\b)[ \t]*|\s*\n\s*)?)+)/i);
    if (!lista) continue;
    for (const token of lista[1].match(/\d[\d.()\-–—]*\d/g) || []) {
      let numero = token.replace(/[-–—]\d{2}$/, '').replace(/\D/g, '');
      if (numero.length > 7 && numero.length <= 9) numero = numero.slice(0, -2);
      if (!/^\d{4,7}$/.test(numero)) continue;
      if (numero !== destino && !/^0+$/.test(numero)) encontrados.add(numero);
    }
  }
  return [...encontrados];
}

async function capturarDescricao() {
  const url = new URL(location.href);
  if (!/^\/atende\/SolicitacaoDetalhe\.aspx$/i.test(url.pathname)) {
    throw new Error('A tela de detalhes não abriu. Confira se a sessão do Atende está ativa.');
  }
  const seletor = 'textarea[id$="_wtSolicitacao_Descricao"], textarea[name$="$wtSolicitacao_Descricao"]';
  const inicio = Date.now();
  while (Date.now() - inicio < 15000) {
    const campo = document.querySelector(seletor);
    if (campo?.value?.trim()) return {
      texto: campo.value,
      solicitacaoId: url.searchParams.get('SolicitacaoId'),
      url: url.href
    };
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('A descrição da OS está vazia ou o campo não foi encontrado.');
}

function mostrarDescricaoNaPagina(resultado) {
  if (document.getElementById('os8-painel-fixo')) return;
  document.getElementById('atende-os8-captura')?.remove();
  const painel = document.createElement('div');
  painel.id = 'atende-os8-captura';
  painel.style.cssText = 'position:fixed;top:16px;right:16px;width:min(440px,95vw);z-index:2147483647';
  const root = painel.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    *{box-sizing:border-box}section{padding:18px;background:#fff;color:#1e293b;border:2px solid #79553b;border-radius:12px;box-shadow:0 10px 40px #0004;font:14px/1.5 system-ui}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:18px;margin:0}p{margin:8px 0}textarea{width:100%;height:260px;max-height:50vh;resize:vertical;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font:13px/1.5 monospace;color:#1e293b;background:#f8fafc}button{padding:9px 14px;background:#79553b;color:white;border:0;border-radius:6px;cursor:pointer;font:600 14px system-ui}button:focus-visible,textarea:focus-visible{outline:3px solid #2563eb}#copiar{width:100%;margin-top:8px}
    </style><section aria-label="Descrição capturada da OS"><header><h2>Descrição capturada</h2><button id="fechar" type="button" aria-label="Fechar painel">×</button></header><p id="origem"></p><textarea readonly aria-label="Texto completo da descrição"></textarea><button id="copiar" type="button">Copiar texto</button></section>`;
  root.querySelector('#origem').textContent = `Solicitação ${resultado.solicitacaoId} · Serviço 08`;
  root.querySelector('textarea').value = resultado.texto;
  const andamento = document.createElement('p');
  andamento.id = 'andamento';
  andamento.setAttribute('role', 'status');
  andamento.textContent = 'Descrição capturada. Abrindo o Acessos para consultar os grupos…';
  root.querySelector('section').appendChild(andamento);
  root.querySelector('#fechar').onclick = () => painel.remove();
  root.querySelector('#copiar').onclick = async () => {
    try {
      await navigator.clipboard.writeText(resultado.texto);
      root.querySelector('#copiar').textContent = 'Copiado!';
    } catch {
      root.querySelector('textarea').select();
      root.querySelector('#copiar').textContent = 'Texto selecionado — pressione Ctrl+C';
    }
  };
  document.documentElement.appendChild(painel);
}
