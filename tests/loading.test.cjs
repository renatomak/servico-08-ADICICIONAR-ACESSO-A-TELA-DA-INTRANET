const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../loading.js'),'utf8');
test('prossegue com aba loading quando formulário da OS correta está pronto',async()=>{
  let chamadas=0;
  const c=vm.createContext({URL,Date,setTimeout,chrome:{tabs:{get:async()=>({id:1,status:'loading'})},scripting:{executeScript:async args=>{chamadas++;assert.equal(args.injectImmediately,true);return [{result:{pronta:true}}];}}}});
  vm.runInContext(code,c);
  assert.equal((await c.esperarPaginaUtilizavel(1,'https://exemplo/')).id,1);
  assert.equal(chamadas,1);
});
test('não confunde documento da OS anterior com a OS aguardada',()=>{
  const c=vm.createContext({URL,location:{href:'https://servicos.goiania.go.gov.br/atende/SolicitacaoDetalhe.aspx?SolicitacaoId=1'},document:{querySelector:s=>s.includes('password')?null:{}}});
  vm.runInContext(code,c);
  assert.equal(c.verificarPaginaUtilizavel('https://servicos.goiania.go.gov.br/atende/SolicitacaoDetalhe.aspx?SolicitacaoId=2').pronta,false);
  assert.equal(c.verificarPaginaUtilizavel('https://servicos.goiania.go.gov.br/atende/SolicitacaoDetalhe.aspx?SolicitacaoId=1').pronta,true);
});
test('login produz diagnóstico específico sem aguardar timeout',async()=>{
  const c=vm.createContext({URL,Date,setTimeout,chrome:{tabs:{get:async()=>({id:1})},scripting:{executeScript:async()=>[{result:{login:true}}]}}});
  vm.runInContext(code,c);
  await assert.rejects(c.esperarPaginaUtilizavel(1),/login/);
});

test('Acessos pronto com menu e cpo mesmo enquanto o documento interno carrega',()=>{
  const menu={URL:'https://intra004.goiania.go.gov.br/sistemas/senha/asp/geral00004f0.asp',body:{innerText:'Menu Principal'},querySelector:()=>null,querySelectorAll:()=>[]};
  const cpo={contentDocument:{readyState:'loading'}};
  const root={querySelector:s=>s.includes('cpo')?cpo:null,querySelectorAll:()=>[{src:'menu',contentWindow:{document:menu}}]};
  const c=vm.createContext({URL,location:{href:'https://intra004.goiania.go.gov.br/sistemas/senha/asp/senha00004f0.asp'},document:root,window:{document:root}});
  vm.runInContext(code,c);
  assert.equal(c.verificarPaginaUtilizavel().pronta,true);
  menu.body.innerText='';
  assert.equal(c.verificarPaginaUtilizavel().pronta,false);
  menu.querySelector=()=>({});
  assert.equal(c.verificarPaginaUtilizavel().login,true);
});
