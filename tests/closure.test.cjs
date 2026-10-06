const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const c=vm.createContext({Date,Intl,extrairDestino:()=> '113410802'});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../closure.js'),'utf8'),c);
test('mensagem de encerramento usa horário de Brasília',()=>{
  assert.match(c.mensagemDeFechamento(new Date('2026-09-28T12:00:00Z')),/^Bom dia!/);
  assert.match(c.mensagemDeFechamento(new Date('2026-09-28T17:00:00Z')),/^Boa tarde!/);
  assert.match(c.mensagemDeFechamento(new Date('2026-09-29T00:00:00Z')),/^Boa noite!/);
});
test('fluxo recebe, abre modal, prepara Atendida e confirma uma única vez',async()=>{
  const acoes=[];
  let estado={receber:true}, ultimo;
  const captura={solicitacaoId:'123',texto:'exemplo'};
  const gruposOs8={solicitacaoId:'123',matriculaDestino:'113410802',status:'concluido',grupos:['16']};
  const inclusaoOs8={solicitacaoId:'123',matriculaInformada:'113410802',matriculaDestino:'1134108',status:'concluido',resultados:[{grupo:'16',destino:'1134108',status:'ja_incluido'}]};
  const contexto=vm.createContext({Date,Intl,URL,setTimeout:fn=>fn(),extrairDestino:()=> '113410802',aguardarPagina:async()=>{},registrar:async()=>{},chrome:{
    storage:{local:{get:async()=>({gruposOs8,inclusaoOs8}),set:async d=>{ultimo={...d.fechamentoOs8};}}},
    tabs:{query:async()=>[{id:1,url:'https://servicos.goiania.go.gov.br/atende/SolicitacaoDetalhe.aspx?SolicitacaoId=123'}],update:async()=>{}},
    scripting:{executeScript:async p=>{
      const acao=p.args[1];
      if(acao==='estado') return [{result:estado}];
      acoes.push(acao);
      if(acao==='receber') estado={fechar:true};
      if(acao==='abrir') estado={modal:true};
      if(acao==='preparar') estado={modal:true,preparada:true};
      if(acao==='confirmar') estado={fechada:true,mensagemConfirmada:true};
      return [{result:{enviado:true}}];
    }}
  }});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../closure.js'),'utf8'),contexto);
  await contexto.fecharOsConcluida(captura);
  assert.deepEqual(acoes,['receber','abrir','preparar','confirmar']);
  assert.equal(ultimo.status,'fechada');
  await contexto.fecharOsConcluida(captura);
  assert.equal(acoes.length,4);
  assert.equal(ultimo.status,'ja_fechada');
});
test('fechamento exige mesma OS e confirmação de todos os grupos',()=>{
  const captura={solicitacaoId:'123',texto:'exemplo'};
  const grupos={solicitacaoId:'123',matriculaDestino:'113410802',status:'concluido',grupos:['16','17']};
  const inclusao={solicitacaoId:'123',matriculaInformada:'113410802',matriculaDestino:'1134108',status:'concluido',resultados:[{grupo:'16',destino:'1134108',status:'incluido'},{grupo:'17',destino:'1134108',status:'ja_incluido'}]};
  assert.equal(c.validarConclusaoParaFechamento(captura,grupos,inclusao),true);
  assert.throws(()=>c.validarConclusaoParaFechamento(captura,grupos,{...inclusao,status:'interrompido'}));
  assert.throws(()=>c.validarConclusaoParaFechamento(captura,grupos,{...inclusao,solicitacaoId:'456'}));
  assert.throws(()=>c.validarConclusaoParaFechamento(captura,grupos,{...inclusao,resultados:inclusao.resultados.slice(0,1)}));
});
