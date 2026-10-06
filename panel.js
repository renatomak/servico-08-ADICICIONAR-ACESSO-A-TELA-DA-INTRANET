(() => {
  if (window !== window.top || document.getElementById('os8-painel-fixo')) return;
  const CHAVE = 'os8PainelMinimizado';
  const host = document.createElement('div');
  host.id = 'os8-painel-fixo';
  host.style.cssText = 'position:fixed;right:12px;top:12px;z-index:2147483647;display:block;';
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = `<style>
    *{box-sizing:border-box}section{width:min(452px,calc(100vw - 24px));border:2px solid #79553b;border-radius:10px;background:white;box-shadow:0 8px 30px #0004;overflow:hidden;font:14px system-ui;color:white}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;background:#79553b}
    strong{font-size:14px}button{background:white;color:#65452f;border:0;border-radius:5px;padding:6px 10px;cursor:pointer;font:600 12px system-ui}button:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}
    iframe{display:block;width:100%;height:min(760px,calc(100vh - 84px));border:0;background:#f8fafc}
    section.minimizado{width:260px;max-width:calc(100vw - 24px)}section.minimizado iframe{display:none}
  </style><section aria-label="Painel de atendimento OS 08"><header><strong>Atendimento OS 08</strong><button type="button" aria-expanded="true">Minimizar</button></header><iframe title="Controles e andamento do atendimento OS 08"></iframe></section>`;
  const section=root.querySelector('section');
  const botao=root.querySelector('button');
  let minimizado=false;
  const aplicar = valor => {
    minimizado=Boolean(valor);
    section.classList.toggle('minimizado',minimizado);
    botao.textContent=minimizado?'Expandir':'Minimizar';
    botao.setAttribute('aria-expanded',String(!minimizado));
  };
  botao.onclick=()=>{
    aplicar(!minimizado);
    chrome.storage.local.set({[CHAVE]:minimizado});
  };
  root.querySelector('iframe').src=chrome.runtime.getURL('popup.html')+'?painel=1';
  // A raiz HTML também funciona nas telas antigas que usam frameset em vez de body.
  document.documentElement.appendChild(host);
  chrome.storage.local.get(CHAVE).then(d=>aplicar(d[CHAVE]===true));
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local' && changes[CHAVE]) aplicar(changes[CHAVE].newValue);
  });
  // O painel fixo substitui a antiga caixa avulsa de descrição.
  document.getElementById('atende-os8-captura')?.remove();
})();
