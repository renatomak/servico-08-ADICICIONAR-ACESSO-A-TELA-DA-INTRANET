const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../groups.js'), 'utf8');
test('abre o Acessos automaticamente e preserva pendência quando precisa de login', async () => {
  const abertas = [], estados = [], sessao = {};
  const captura = {solicitacaoId:'123',texto:'MATRÍCULA: 563943'};
  const c = vm.createContext({URL,Date,extrairEquivalencias:()=>['1536222'],aguardarPagina:async()=>{},registrar:async e=>estados.push(e),chrome:{
    tabs:{query:async()=>[],create:async options=>{abertas.push(options);return {id:5};}},
    scripting:{executeScript:async()=>[{result:false}]},
    storage:{session:{set:async data=>Object.assign(sessao,data)}}
  }});
  vm.runInContext(source,c);
  await c.guardarGruposDaCaptura(captura);
  assert.equal(abertas.length,1);
  assert.equal(abertas[0].url,'https://eresolve.goiania.go.gov.br/portalservicos/');
  assert.equal(new URL(abertas[0].url).searchParams.has('aid'),false);
  assert.equal(sessao.consultaPendente,captura);
  assert.equal(estados.at(-1).status,'aguardando');
});
test('captura somente títulos de grupo, ignorando sistemas e acesso individual', () => {
  const row = (text, colspan, link = false) => ({ cells: [{ innerText: text, colSpan: colspan, querySelector: () => link ? {} : null }] });
  const c = vm.createContext({ URL, location: { href: 'https://intra004.goiania.go.gov.br/sistemas/senha/asp/senha00060w0.asp?txt_id_usuario=M1536222' }, document: {
    body: { innerText: 'ACESSOS DA MATRICULA' }, querySelectorAll: () => [
      row('ACESSO INDIVIDUAL', 2), row('122 - SAUDE - FREQUENCIA CHEFIA', 2), row('16 - GESTOR PSF', 2),
      row('16 - GESTOR PSF', 2), row('64 - Sistema', 1, true), row('sicaa', 1)
    ]
  } });
  vm.runInContext(source, c);
  assert.equal(c.lerGruposDoRelatorio('M1536222').grupos.map(g => g.codigo).join(','), '122,16');
  assert.match(c.lerGruposDoRelatorio('M1203436').erro, /não corresponde/);
  assert.equal(c.extrairDestino('MATRÍCULA: 113410802\nCPF: 12345678901'), '113410802');
});

test('guarda origem, destino, grupos únicos e erro de matrícula sem perder as demais', async () => {
  const salvos = [], args = [];
  const c = vm.createContext({ URL, Date,
    extrairEquivalencias: () => ['1536222', '1203436', '69765601'],
    aguardarPagina: async () => {}, registrar: async () => {},
    chrome: {
      storage: { session: {remove:async()=>{}}, local: { get:async()=>({}), set: async d => {if(d.gruposOs8) salvos.push(JSON.parse(JSON.stringify(d.gruposOs8)));} } },
      tabs: { query: async () => [{id:1,url:'https://intra004.goiania.go.gov.br/sistemas/senha/asp/senha00004f0.asp?nm_sigla=senha'}], create: async () => ({id:2}), update: async () => {} },
      scripting: { executeScript: async p => {
        if (p.func.name === 'verificarAcessosPronto') return [{result:true}];
        args.push(p.args[0]);
        if (p.func.name === 'consultarEspelhoNoAcessos') return [{ result: p.args[0].startsWith('697656') ? {erro:'M69765601: MATRÍCULA INVÁLIDA'} : {usuario:`M${p.args[0]}`,url:'https://intra004.goiania.go.gov.br/sistemas/senha/asp/senha00060w0.asp'} }];
        return [{result:{grupos:[{codigo:'16',nome:'GESTOR PSF'},{codigo:p.args[0]==='M1536222'?'122':'17',nome:'SAUDE'}]}}];
      } }
    }
  });
  vm.runInContext(source, c);
  await c.guardarGruposDaCaptura({solicitacaoId:'123',texto:'MATRÍCULA: 563943'});
  const final = salvos.at(-1);
  assert.equal(final.status,'parcial');
  assert.equal(final.matriculaDestino,'563943');
  assert.deepEqual(final.grupos,['16','122','17']);
  assert.equal(final.porMatricula[2].status,'erro');
  assert.equal(final.pularOs,true);
  assert(args.includes('M1536222'));
});

test('remove contrato e só consulta matrículas com até sete dígitos', async () => {
  const c = vm.createContext({});
  vm.runInContext(source,c);
  const usadas=[];
  const retorno=await c.consultarComTentativas('69765601',async m=>{
    usadas.push(m);
    return m==='697656'?{usuario:'M697656'}:{erro:'MATRÍCULA INVÁLIDA'};
  });
  assert.deepEqual(usadas,['697656']);
  assert.equal(retorno.matriculaConsultada,'697656');
  let vezes=0;
  const falha=await c.consultarComTentativas('69765601',async()=>{vezes++;return {erro:'Sessão expirada'};});
  assert.equal(vezes,1);
  assert.equal(falha.esgotada,false);
  const esgotada=await c.consultarComTentativas('69765601',async()=>({erro:'MATRÍCULA INVÁLIDA'}));
  assert.equal(esgotada.esgotada,true);
  assert.equal(esgotada.tentativas.length,1);
  const curtas=[];
  const usuarioAusente=await c.consultarComTentativas('1234567',async m=>{
    curtas.push(m);
    return m==='123456'?{usuario:'M123456'}:{erro:'USUÁRIO NÃO CADASTRADO'};
  });
  assert.deepEqual(curtas,['1234567','123456']);
  assert.equal(usuarioAusente.matriculaConsultada,'123456');
  const impossivel=await c.consultarComTentativas('1234567890',async()=>{throw new Error('Não deve consultar');});
  assert.equal(impossivel.esgotada,true);
});

test('a consulta prefixa M e não envia matrícula sem o prefixo', async () => {
  let valorEnviado;
  const campo = {value:'',dispatchEvent:()=>{}};
  const nome = {value:''};
  const doc = { URL:'https://intra004.goiania.go.gov.br/sistemas/senha/asp/senha00060f0.asp', querySelector:s=>s.includes('txt_id_usuario')?campo:s.includes('txt_nm_usuario')?nome:s.includes('Consultar')?{click:()=>{valorEnviado=campo.value;nome.value='Usuário de teste';}}:null,querySelectorAll:()=>[] };
  const frame = {contentDocument:{},set src(v){this.contentDocument=doc;},contentWindow:{document:doc}};
  const main = {querySelector:()=>frame,querySelectorAll:()=>[frame]};
  const c = vm.createContext({URL,Date,setTimeout,Event:class{},window:{document:main},location:{origin:'https://intra004.goiania.go.gov.br'}});
  vm.runInContext(source,c);
  const result = await c.consultarEspelhoNoAcessos('1536222');
  assert.equal(valorEnviado,'M1536222');
  assert.equal(new URL(result.url).searchParams.get('txt_id_usuario'),'M1536222');
});
