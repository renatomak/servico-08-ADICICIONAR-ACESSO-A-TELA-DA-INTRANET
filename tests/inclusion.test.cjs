const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../inclusion.js'),'utf8');
function ambiente(responder) {
  const chamadas=[],salvos=[];
  const c=vm.createContext({Date,URL,registrar:async()=>{},chrome:{
    tabs:{query:async()=>[{id:1,url:'https://intra004.goiania.go.gov.br/sistemas/senha/asp/senha00004f0.asp?nm_sigla=senha'}],update:async()=>{}},
    storage:{local:{set:async x=>salvos.push(JSON.parse(JSON.stringify(x.inclusaoOs8))) }},
    scripting:{executeScript:async p=>{chamadas.push(p.args);return [{result:responder(p.args)}];}}
  }});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../groups.js'),'utf8'),c);
  vm.runInContext(source,c);
  return {c,chamadas,salvos};
}
const captura={solicitacaoId:'123',texto:'MATRÍCULA: 113410802'};
const dados={solicitacaoId:'123',matriculaDestino:'113410802',status:'concluido',porMatricula:[{status:'concluido'}],grupos:['16','122','16']};
test('remove contrato antes de validar e usa destino numérico sem M em todos os grupos',async()=>{
  const {c,chamadas,salvos}=ambiente(([grupo,destino,validar])=>validar?(destino==='1134108'?{status:'validada',nome:'Teste'}:{status:'erro',erro:'MATRÍCULA INVÁLIDA'}):{grupo,destino,status:grupo==='16'?'ja_incluido':'incluido'});
  const r=await c.incluirGruposGuardados(dados,captura);
  assert.equal(r.status,'concluido');
  assert.deepEqual(chamadas.map(a=>a[1]),['1134108','1134108','1134108']);
  assert.equal(chamadas[0][2],true);
  assert(chamadas.every(a=>/^\d{4,7}$/.test(a[1])));
  assert.equal(salvos.at(-1).tentativasDestino[0].usuario,'1134108');
  assert.equal(salvos.at(-1).matriculaInformada,'113410802');
  assert.equal(salvos.at(-1).matriculaDestino,'1134108');
  assert.equal(salvos.at(-1).gruposTotal,2);
  assert.equal(salvos.at(-1).resultados.length,2);
  assert(salvos.at(-1).resultados.every(item=>typeof item.mensagem==='string' && item.mensagem.length>0));
});
test('destino sem contrato inválido não produz inclusão e sinaliza próxima OS',async()=>{
  const {c,chamadas}=ambiente(()=>({status:'erro',erro:'MATRÍCULA INVÁLIDA'}));
  const r=await c.incluirGruposGuardados(dados,captura);
  assert.equal(r.pularOs,true);
  assert.equal(chamadas.length,1);
  assert(chamadas.every(a=>a[2]===true));
});
test('resultado incerto interrompe lote sem reenviar nem tentar outro destino',async()=>{
  const {c,chamadas}=ambiente(([grupo,destino,validar])=>validar?{status:'validada'}:{grupo,status:'verificar',erro:'Sem confirmação'});
  const r=await c.incluirGruposGuardados(dados,captura);
  assert.equal(r.status,'interrompido');
  assert.equal(chamadas.length,2);
});
test('recusa dados parciais ou de outra OS antes de acessar o sistema',async()=>{
  const {c,chamadas}=ambiente(()=>({}));
  await assert.rejects(c.incluirGruposGuardados({...dados,status:'parcial'},captura),/completa/);
  await assert.rejects(c.incluirGruposGuardados({...dados,solicitacaoId:'outra'},captura),/não correspondem/);
  assert.equal(chamadas.length,0);
});

test('modo de validação consulta nome e não aciona Adicionar',async()=>{
  let adicionadas=0;
  const resposta={contentDocument:{readyState:'complete'}};
  const respondeu=()=>{resposta.contentDocument={readyState:'complete'};};
  const campos={txt_cd_grupo:{value:'',dispatchEvent:()=>{campos.txt_nm_grupo.value='Grupo';respondeu();}},txt_nm_grupo:{value:''},txt_nr_matr:{value:'',dispatchEvent:()=>{campos.txt_nm_pes_func.value='Destino';respondeu();}},txt_nm_pes_func:{value:''},sel_inclui:{options:[]},btn_consultar:{click:respondeu},btn_adicionar:{click:()=>{adicionadas++;respondeu();}}};
  const doc={URL:'https://intra004.goiania.go.gov.br/sistemas/senha/asp/senha00008f0.asp',querySelector:s=>campos[s.match(/name="([^"]+)"/)?.[1]],querySelectorAll:()=>[]};
  const frame={contentDocument:{},set src(v){this.contentDocument=doc;},contentWindow:{document:doc}};
  const main={querySelector:s=>s.includes('cpo')?frame:s.includes('acd')?resposta:null,querySelectorAll:s=>s==='frame,iframe'?[frame]:[]};
  const c=vm.createContext({Date,URL,Event:class{},setTimeout,window:{document:main},location:{origin:'https://intra004.goiania.go.gov.br'}});
  vm.runInContext(source,c);
  const r=await c.incluirDestinoNoGrupo('16','1134108',true);
  assert.equal(r.status,'validada');
  assert.equal(adicionadas,0);
});

test('aceita resposta sem troca de contentDocument no frame de retorno', async()=>{
  let adicionadas=0;
  const respostaDoc={readyState:'complete',URL:'https://intra004.goiania.go.gov.br/sistemas/senha/asp/senha00008f0.asp',body:{innerText:''}};
  const resposta={contentDocument:respostaDoc};
  const atualizarResposta=texto=>{respostaDoc.body.innerText=texto;};
  const campos={
    txt_cd_grupo:{value:'',dispatchEvent:()=>{campos.txt_nm_grupo.value='Grupo';atualizarResposta('grupo-ok');}},
    txt_nm_grupo:{value:''},
    txt_nr_matr:{value:'',dispatchEvent:()=>{campos.txt_nm_pes_func.value='Destino';atualizarResposta('matricula-ok');}},
    txt_nm_pes_func:{value:''},
    sel_inclui:{options:[{text:'1134108 | DESTINO'}]},
    btn_consultar:{click:()=>atualizarResposta('consulta-ok')},
    btn_adicionar:{click:()=>{adicionadas++;atualizarResposta('adicao-ok');}}
  };
  const doc={URL:'https://intra004.goiania.go.gov.br/sistemas/senha/asp/senha00008f0.asp',querySelector:s=>campos[s.match(/name="([^"]+)"/)?.[1]],querySelectorAll:()=>[]};
  const frame={contentDocument:{},set src(v){this.contentDocument=doc;},contentWindow:{document:doc}};
  const main={querySelector:s=>s.includes('cpo')?frame:s.includes('acd')?resposta:null,querySelectorAll:s=>s==='frame,iframe'?[frame]:[]};
  const c=vm.createContext({Date,URL,Event:class{},setTimeout,window:{document:main},location:{origin:'https://intra004.goiania.go.gov.br'}});
  vm.runInContext(source,c);
  const r=await c.incluirDestinoNoGrupo('16','1134108');
  assert.equal(r.status,'ja_incluido');
  assert.equal(adicionadas,0);
});
