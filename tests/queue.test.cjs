const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../queue.js'),'utf8');
const url=id=>`https://servicos.goiania.go.gov.br/atende/SolicitacaoDetalhe.aspx?SolicitacaoId=${id}`;
function ambiente(tipo='sucesso') {
  let currentUrl=url('1');
  const db={filaOs8:{urls:[url('1'),url('2')],indice:0,concluidas:[],puladas:[],status:'executando',parar:false}};
  let alarmes=0,processadas=0;
  const c=vm.createContext({URL,Date,setTimeout,executando:false,
    registrar:async()=>{},aguardarPagina:async()=>{},lerNaPagina:()=>{},mostrarDescricaoNaPagina:()=>{},etapaFechamentoNaPagina:()=>{},
    executarNaPagina:async()=>({url:currentUrl,solicitacaoId:new URL(currentUrl).searchParams.get('SolicitacaoId'),texto:'Exemplo'}),
    extrairEquivalencias:()=>tipo==='sem espelho'?[]:['123456'],
    consultarEIncluir:async captura=>{
      processadas++;
      if(tipo==='erro')throw new Error('Inclusão não confirmada');
      if(tipo==='invalida')return {pularOs:true};
      db.fechamentoOs8={solicitacaoId:captura.solicitacaoId,status:'fechada'};
      return {status:'concluido'};
    },
    chrome:{storage:{local:{get:async()=>JSON.parse(JSON.stringify(db)),set:async d=>Object.assign(db,JSON.parse(JSON.stringify(d)))},session:{get:async()=>({})}},
      tabs:{create:async d=>{currentUrl=d.url;return {id:10};},get:async()=>({id:10}),update:async(id,d)=>{currentUrl=d.url;}},
      scripting:{executeScript:async()=>[]},
      alarms:{create:async()=>{alarmes++;},onAlarm:{addListener:()=>{}}}}
  });
  vm.runInContext(source,c);
  return {c,db,alarmes:()=>alarmes,processadas:()=>processadas};
}
test('continua após fechar a primeira OS e termina depois da última sem repetir',async()=>{
  const a=ambiente();
  await a.c.processarProximaOs();
  assert.equal(a.db.filaOs8.indice,1);
  assert.equal(a.alarmes(),1);
  await a.c.processarProximaOs();
  assert.deepEqual(a.db.filaOs8.concluidas,['1','2']);
  await a.c.processarProximaOs();
  assert.equal(a.db.filaOs8.status,'concluida');
  assert.equal(a.processadas(),2);
});
for(const tipo of ['sem espelho','invalida']) test(`pula ${tipo} e agenda a próxima`,async()=>{
  const a=ambiente(tipo);await a.c.processarProximaOs();
  assert.equal(a.db.filaOs8.puladas.length,1);
  assert.equal(a.db.filaOs8.indice,1);
  assert.equal(a.alarmes(),1);
});
test('erro interrompe sem avançar e parada impede outra OS',async()=>{
  const a=ambiente('erro');await a.c.processarProximaOs();
  assert.equal(a.db.filaOs8.status,'interrompida');assert.equal(a.db.filaOs8.indice,0);assert.equal(a.alarmes(),0);
  const b=ambiente();b.db.filaOs8.parar=true;await b.c.processarProximaOs();
  assert.equal(b.db.filaOs8.status,'parada');assert.equal(b.processadas(),0);
});
test('página sem OS 08 continua na paginação e URLs repetidas são deduplicadas',async()=>{
  const a=ambiente();let pagina=0;
  a.c.LISTA='https://servicos.goiania.go.gov.br/atende/Solicitacoes.aspx';
  a.c.chrome.tabs.query=async()=>[{id:1,url:a.c.LISTA}];
  a.c.chrome.alarms.clear=async()=>{};
  a.c.chrome.storage.session.remove=async()=>{};
  a.c.chrome.scripting.executeScript=async p=>p.files?[]:[{result:String(pagina)}];
  a.c.executarNaPagina=async(id,fn,args)=>args?.[0]==='anterior'?{fim:true}:fn.name==='lerPaginaDaFila'?{solicitacoes:pagina===0?[]:[{url:url('1'),abertura:'28/09/2026 08:00:00'},{url:url('1'),abertura:'28/09/2026 08:00:00'}]}:{fim:pagina++===1};
  a.c.processarProximaOs=async()=>{};
  await a.c.iniciarFila();
  assert.deepEqual(a.db.filaOs8.urls,[url('1')]);
  assert.equal(pagina,2);
});
test('ordena por abertura real entre páginas, horário e desempate por número da OS',()=>{
  const {c}=ambiente();
  const resultado=c.ordenarOsPorAbertura([
    {url:url('1'),abertura:'01/10/2026 08:00:00'},
    {url:url('8'),abertura:'30/09/2026 09:00:00'},
    {url:url('9'),abertura:'30/09/2026 08:00:00'},
    {url:url('7'),abertura:'30/09/2026 09:00:00'}
  ]);
  assert.equal(resultado.map(s=>new URL(s.url).searchParams.get('SolicitacaoId')).join(','),'9,7,8,1');
  assert.throws(()=>c.ordenarOsPorAbertura([{url:url('1'),abertura:''}]),/não reconhecida/);
  assert.throws(()=>c.ordenarOsPorAbertura([{url:url('1'),abertura:'31/02/2026'}]),/inválida/);
});
