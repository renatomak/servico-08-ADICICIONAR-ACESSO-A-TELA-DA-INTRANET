// Uma inclusão por chamada. Nunca usa a matrícula espelho como destino.
async function incluirDestinoNoGrupo(grupo, destino, somenteValidar = false) {
  let enviado = false;
  try {
    if (!/^\d{1,5}$/.test(grupo) || !/^\d{4,7}$/.test(destino)) throw new Error('Código de grupo ou matrícula destino inválidos: destino numérico com até 7 dígitos, sem M.');
    const documentos = () => {
      const docs = [], fila = [window];
      while (fila.length) {
        const w = fila.shift();
        try { docs.push(w.document); for (const f of w.document.querySelectorAll('frame,iframe')) fila.push(f.contentWindow); } catch (_) {}
      }
      return docs;
    };
    const esperar = async (fn, mensagem) => {
      const inicio = Date.now();
      while (Date.now() - inicio < 12000) {
        const valor = fn();
        if (valor) return valor;
        await new Promise(r => setTimeout(r, 200));
      }
      throw new Error(mensagem);
    };
    const frame = documentos().map(d => d.querySelector('frame[name="cpo"],iframe[name="cpo"]')).find(Boolean);
    if (!frame) throw new Error('Frame de trabalho do Acessos não encontrado.');
    const anterior = frame.contentDocument;
    frame.src = new URL('/sistemas/senha/asp/senha00008f0.asp', location.origin).href;
    const doc = await esperar(() => {
      const d = frame.contentDocument;
      return d && d !== anterior && /senha00008f0\.asp/i.test(d.URL) && d.querySelector('[name="btn_adicionar"]') && d;
    }, 'A tela Atualiza Usuários não carregou.');
    const campo = name => doc.querySelector(`[name="${name}"]`);
    for (const name of ['txt_cd_grupo','txt_nm_grupo','txt_nr_matr','txt_nm_pes_func','sel_inclui','btn_consultar','btn_adicionar']) {
      if (!campo(name)) throw new Error(`Campo ${name} não encontrado.`);
    }
    const resposta = documentos().map(d => d.querySelector('frame[name="acd"],iframe[name="acd"]')).find(Boolean);
    if (!resposta) throw new Error('Frame de resposta do sistema não encontrado.');
    const mensagens = () => documentos().flatMap(d => [...d.querySelectorAll('input[name="msg_n"],input[name="avs_n"]')]);
    const textoMensagens = () => mensagens().map(e => String(e.value || '').trim()).filter(Boolean).join(' ');
    const assinaturaResposta = () => {
      const d = resposta.contentDocument;
      if (!d) return '';
      let tamanhoTexto = 0;
      try { tamanhoTexto = String(d.body?.innerText || d.body?.textContent || '').trim().length; }
      catch (_) {}
      return `${d.URL || ''}|${d.readyState || ''}|${tamanhoTexto}`;
    };
    const requisitar = async (acao, validacao) => {
      if (frame.contentDocument !== doc) throw new Error('A tela foi alterada durante a execução.');
      for (const e of mensagens()) e.value = '';
      const antesDoc = resposta.contentDocument;
      const antesAssinatura = assinaturaResposta();
      acao();
      await esperar(() => {
        if (frame.contentDocument !== doc) throw new Error('A tela foi alterada durante a execução.');
        if (validacao && validacao()) return true;
        if (textoMensagens()) return true;
        if (resposta.contentDocument !== antesDoc) return true;
        return assinaturaResposta() !== antesAssinatura;
      }, 'O sistema não confirmou a resposta.');
      const mensagem = textoMensagens();
      if (/inv[aá]lid|n[aã]o encontrad|erro|negad|n[aã]o cadastrad/i.test(mensagem)) throw new Error(mensagem);
      if (validacao && !validacao()) throw new Error(mensagem || 'Resposta não confirmou os dados consultados.');
    };
    const normal = n => String(n).replace(/^0+(?=\d)/, '');
    const presente = () => [...campo('sel_inclui').options].some(o => {
      const numero = o.text.trim().match(/^(\d+)(?:\s|\||$)/)?.[1];
      return numero && normal(numero) === normal(destino);
    });
    campo('txt_cd_grupo').value = grupo;
    campo('txt_nm_grupo').value = '';
    await requisitar(() => campo('txt_cd_grupo').dispatchEvent(new Event('blur')), () => !!campo('txt_nm_grupo').value.trim());
    if (normal(campo('txt_cd_grupo').value) !== normal(grupo)) throw new Error('O código de grupo retornado não corresponde ao solicitado.');
    await requisitar(() => campo('btn_consultar').click());
    if (presente()) return { grupo, destino, status: somenteValidar ? 'validada' : 'ja_incluido' };
    campo('txt_nr_matr').value = destino; // Este formulário recebe números, sem M.
    campo('txt_nm_pes_func').value = '';
    await requisitar(() => campo('txt_nr_matr').dispatchEvent(new Event('blur')), () => !!campo('txt_nm_pes_func').value.trim());
    if (campo('txt_nr_matr').value.trim() !== destino || normal(campo('txt_cd_grupo').value) !== normal(grupo)) throw new Error('Grupo ou matrícula mudaram antes da inclusão.');
    if (somenteValidar) return { grupo, destino, status: 'validada', nome: campo('txt_nm_pes_func').value.trim() };
    await requisitar(() => { enviado = true; campo('btn_adicionar').click(); });
    // Confirma no servidor, não apenas pela lista que já estava na tela.
    await requisitar(() => campo('btn_consultar').click());
    if (!presente()) throw new Error('Matrícula não apareceu nos componentes do grupo após a inclusão.');
    return { grupo, destino, status: 'incluido' };
  } catch (e) {
    return { grupo, destino, status: enviado ? 'verificar' : 'erro', erro: e.message };
  }
}

async function incluirGruposGuardados(dados, captura) {
  if (!captura?.solicitacaoId || dados?.solicitacaoId !== captura.solicitacaoId || dados.matriculaDestino !== extrairDestino(captura.texto)) throw new Error('Os grupos guardados não correspondem à OS capturada.');
  if (dados.status !== 'concluido' || dados.pularOs || !dados.grupos?.length || dados.porMatricula.some(p => p.status !== 'concluido')) throw new Error('A consulta dos grupos precisa estar completa antes da inclusão.');
  const grupos = [...new Set(dados.grupos)];
  if (!/^\d{4,9}$/.test(dados.matriculaDestino) || grupos.some(g => !/^\d{1,5}$/.test(g))) throw new Error('Matrícula destino ou códigos fora do formato aceito pelo formulário.');
  const abas = await chrome.tabs.query({url:'https://intra004.goiania.go.gov.br/*'});
  const sistema = abas.find(t => /\/senha00004f0\.asp(?:[?#]|$)/i.test(t.url || '') && /(?:nm_sigla=senha|nm_sistema=Acessos)/i.test(t.url || ''));
  if (!sistema) throw new Error('Abra o sistema Acessos para incluir os grupos guardados.');
  await chrome.tabs.update(sistema.id,{active:true});
  const inclusao = {solicitacaoId:dados.solicitacaoId,matriculaInformada:dados.matriculaDestino,matriculaDestino:dados.matriculaDestino,status:'validando',gruposTotal:grupos.length,resultados:[]};
  const salvar = () => chrome.storage.local.set({inclusaoOs8:{...inclusao,atualizadoEm:new Date().toISOString()}});
  const mensagemDoResultado = resultado => {
    if (resultado?.mensagem) return resultado.mensagem;
    if (resultado?.erro) return resultado.erro;
    if (resultado?.status === 'incluido') return 'Inclusão confirmada no grupo.';
    if (resultado?.status === 'ja_incluido') return 'Matrícula já constava no grupo.';
    if (resultado?.status === 'validada') return 'Matrícula validada para inclusão.';
    if (resultado?.status === 'em_andamento') return 'Tentando incluir matrícula neste grupo…';
    if (resultado?.status === 'verificar') return 'Sem confirmação da inclusão. Conferir no sistema.';
    return 'Resultado sem detalhe retornado pelo sistema.';
  };
  await salvar();
  const validacao = await consultarComTentativas(dados.matriculaDestino, async candidata => {
    await registrar({...captura,status:'executando',mensagem:`Validando matrícula destino ${candidata} (informada: ${dados.matriculaDestino})…`});
    const [r] = await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:sistema.id},func:incluirDestinoNoGrupo,args:[grupos[0],candidata,true]});
    if (r?.result?.status === 'validada') return {matriculaConsultada:candidata,nome:r.result.nome};
    return {erro:r?.result?.erro || 'Não foi possível validar a matrícula destino.'};
  }, '');
  inclusao.tentativasDestino = validacao.tentativas;
  if (validacao.erro) {
    inclusao.status = 'interrompido';
    inclusao.erro = validacao.erro;
    await salvar();
    await registrar({...captura,status:'erro',mensagem:`Destino não validado: ${validacao.erro}. Nenhum grupo foi incluído.`});
    return {...inclusao,pularOs:validacao.esgotada};
  }
  const destinoValidado = validacao.matriculaConsultada;
  inclusao.matriculaDestino = destinoValidado;
  inclusao.nomeDestino = validacao.nome || '';
  inclusao.status = 'executando';
  await salvar();
  for (const grupo of grupos) {
    inclusao.grupoEmAndamento = grupo;
    const indiceResultado = inclusao.resultados.length;
    inclusao.resultados.push({grupo,destino:destinoValidado,status:'em_andamento',mensagem:`Tentando incluir matrícula ${destinoValidado} no grupo ${grupo}…`});
    await salvar();
    await registrar({...captura,status:'executando',mensagem:`Incluindo matrícula ${destinoValidado} no grupo ${grupo}…`});
    let resultado;
    try {
      const [r] = await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:sistema.id},func:incluirDestinoNoGrupo,args:[grupo,destinoValidado]});
      resultado = r?.result || {grupo,status:'verificar',erro:'Resposta da inclusão não recebida.'};
    } catch (e) { resultado = {grupo,status:'verificar',erro:e.message}; }
    inclusao.resultados[indiceResultado] = {...resultado,mensagem:mensagemDoResultado(resultado)};
    await salvar();
    if (!['incluido','ja_incluido'].includes(resultado.status)) {
      inclusao.status = 'interrompido';
      await salvar();
      await registrar({...captura,status:'erro',mensagem:`Grupo ${grupo}: ${resultado.erro}. Inclusão interrompida; confira o resultado antes de continuar.`});
      return inclusao;
    }
  }
  inclusao.status = 'concluido';
  delete inclusao.grupoEmAndamento;
  await salvar();
  await registrar({...captura,status:'concluido',mensagem:`OS ${dados.solicitacaoId}: matrícula ${destinoValidado} (informada: ${dados.matriculaDestino}) confirmada nos ${grupos.length} grupo(s).`});
  return inclusao;
}
