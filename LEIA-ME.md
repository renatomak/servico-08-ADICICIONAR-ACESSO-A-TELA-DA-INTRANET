# Atende — Captura automática OS 8

Extensão independente para Chrome ou Edge. Não depende da extensão antiga.

## Versão 1.10.1 — espera de carregamento

A espera verifica os campos de cada tela e a identificação da OS/usuário esperados, sem depender de a aba inteira marcar carregamento completo. Frames, fontes e o painel podem manter a aba em carregamento mesmo com o formulário disponível. As injeções também usam execução imediata. A tolerância para a tela ficar utilizável é de 60 segundos; login recebe diagnóstico específico. Não há recarga automática nem reenvio de inclusões ou fechamentos.

## Versão 1.10 — painel fixo

O painel completo da extensão aparece no canto superior direito do Atende e da Intranet, inclusive nas telas com frames e relatórios. Ele acompanha as mudanças de página e atualiza progresso, resultados e erros pelos mesmos registros do popup. Não fecha ao clicar fora. Permanece aberto também ao concluir a fila, para conferir o resultado.

**Minimizar** recolhe o painel para uma barra; **Expandir** reabre. A preferência fica salva e é respeitada nas próximas páginas e abas. Minimizar não interrompe o atendimento; para isso use **Parar após a OS atual**. Após atualizar a extensão, recarregue as abas já abertas uma vez para carregar o painel.

## Versão 1.9 — mais antigas primeiro

Antes de atender, retorna à primeira página usando a paginação, mantém os filtros, coleta as solicitações de todas as páginas e ordena pela coluna **Abertura**, em ordem crescente de data e hora. Em caso de empate, usa o menor número de OS. Datas ausentes ou inválidas interrompem a preparação em vez de iniciar numa ordem incerta. A ordem não depende de como a tabela estava ordenada. Recarregue a extensão e inicie uma nova fila para aplicar a ordenação; filas já preparadas não são alteradas durante o atendimento.

## Versão 1.8 — fila de OSs

Executar percorre a página atual da lista e as seguintes, mantendo os filtros, e prepara uma fila única das OSs 08 encontradas. Para pegar toda a listagem, comece na primeira página. Depois atende uma OS por vez: captura, consulta, inclusão, recebimento e fechamento. Só avança como concluída quando o fechamento foi confirmado. Solicitações sem espelho e matrículas não localizadas são puladas; erros de sessão, inclusão ou fechamento interrompem ou aguardam login.

Há um intervalo de aproximadamente 30 segundos entre OSs para continuar a execução em eventos separados do navegador. A fila e os contadores ficam salvos em `filaOs8`. **Parar após a OS atual** evita iniciar outra solicitação. A fila cobre as OSs presentes durante a leitura inicial; novas solicitações recebidas depois entram na próxima execução. Esta versão não dispara uma execução real ao ser instalada.

## Versão 1.7 — recebimento e fechamento da OS

Depois de confirmar todos os grupos para a matrícula destino, o fluxo volta à OS, aciona Receber quando necessário, abre Fechar Solicitação, preenche Justificativa, seleciona Atendida, aguarda a atualização do formulário e confirma. Verifica situação Fechada, data de encerramento e mensagem no histórico. Não fecha OS com inclusão incompleta, de outra matrícula ou sem confirmação de todos os grupos.

O botão **Receber e fechar OS concluída** permite continuar das inclusões já guardadas. OS já fechada não recebe mensagem duplicada. Em caso de resposta incerta, o plugin interrompe e pede conferência; não repete automaticamente o envio. O registro fica em `fechamentoOs8`.

Mensagem: “Boa tarde! Sua solicitação foi atendida com sucesso. Os acessos solicitados foram liberados. Agradecemos o contato e permanecemos à disposição.” A saudação muda conforme o horário de Brasília. O fluxo foi conferido na OS 1959319, recebida e fechada como atendida em 28/09/2026.

## Versão 1.6 — matrícula com no máximo 7 dígitos

Regra atual (substitui as tentativas descritas nas versões anteriores): quando o número informado tem 8 ou 9 dígitos, remove os dois dígitos finais de contrato antes da primeira consulta. Assim, 69765601 vira 697656 e 113410802 vira 1134108. Nunca envia mais de 7 dígitos ao sistema nem testa um número intermediário que ainda contenha parte do contrato. Números de até 7 dígitos mantêm as tentativas por rejeição explícita, limitadas à remoção de até dois dígitos do original. Usuário não cadastrado também é tratado como rejeição da matrícula; erros de sessão não geram tentativas com outros números.

Consulta de espelho: **M697656**. Inclusão em grupo: **1134108**, somente números, sem prefixo M. O registro de tentativas de destino também mostra os números sem M. A matrícula originalmente informada continua preservada para conferência.

## Versão 1.5 — inclusão em Grupos > Atualiza Usuários

O fluxo Executar agora prossegue da consulta dos espelhos para a inclusão da matrícula destino nos grupos. Também é possível usar **Incluir destino nos grupos guardados** para continuar de uma consulta completa da mesma OS.

Antes de incluir, valida a matrícula destino no formulário: original, sem o último dígito e sem os dois últimos (ex.: 113410802 → 11341080 → 1134108). Só tenta a próxima se o sistema informar matrícula inválida. Neste formulário o destino é numérico, sem M. O prefixo M continua sendo usado na consulta dos espelhos.

Guarda matrícula informada, matrícula validada e tentativas. Para cada grupo, consulta os componentes, pula o destino já presente, valida o nome e aciona Adicionar. Depois consulta novamente para confirmar a presença. Se houver erro ou resultado incerto, interrompe as inclusões e registra o grupo para conferência. Nunca altera uma matrícula destino depois de iniciadas as inclusões. Resultados ficam em `inclusaoOs8` e no popup. Dados parciais ou pertencentes a outra OS não podem ser usados para incluir.

A etapa de inclusão foi validada com testes simulados; nenhuma inclusão real foi efetuada durante o desenvolvimento.

## Versão 1.4 — tentativas de matrícula espelho

Quando a consulta retorna explicitamente **MATRÍCULA INVÁLIDA**, tenta o número original, depois remove o último dígito, depois os dois últimos, sempre com M. Exemplo: M69765601 → M6976560 → M697656. Para na primeira consulta válida e registra tanto a matrícula original quanto a efetivamente consultada e as tentativas. Não tenta outros números em caso de erro de sessão ou tempo de resposta.

Se as três tentativas falharem, registra o erro em `errosOs8`, visível no popup, e o fluxo Executar continua para a próxima OS da página atual. Os grupos de uma OS com falha são marcados como parciais. Não há inclusão de acessos.

## Versão 1.3 — continuação automática

Após capturar a descrição, abre automaticamente o frameset do sistema Acessos quando não houver uma aba desse sistema. Com a sessão ativa, consulta os espelhos sem outro clique. Se o sistema pedir login, a captura fica pendente e a consulta é retomada ao carregar a tela do Acessos. O painel da OS mostra o andamento e os erros da consulta. Recarregue a extensão e atualize a página do Atende para usar esta versão. Não é necessário conservar o link com `aid` temporário.

## Versão 1.2 — consulta e armazenamento de grupos

Deixe aberta e autenticada uma aba da tela principal do sistema Acessos no **intra004**. Após capturar uma OS com equivalência, a extensão abre no frame de trabalho a página usada por **Menu Principal > Relatórios > Acessos do Usuário**, consulta cada espelho com **M** antes do número e abre sua listagem. São extraídos somente os títulos numéricos dos grupos, não as siglas dos sistemas nem os acessos individuais.

Os dados ficam no armazenamento local da extensão (`gruposOs8`): OS, matrícula destino, matrículas espelho, grupos com nome por espelho, códigos consolidados sem duplicatas e eventuais erros. A próxima consulta substitui esse conjunto. Resultados parciais são identificados e não tratados como consulta completa. Nenhuma inclusão de acesso é executada.

Use **Consultar grupos das matrículas espelho** para retomar a captura já disponível, inclusive após abrir o Acessos ou corrigir a sessão. Matrícula inválida é registrada como erro; não há tentativa sem o prefixo M. Confira o quadro **Grupos guardados** no popup para ver a OS associada ao resultado.

Ao atualizar, recarregue a extensão e permita o acesso ao domínio intra004 solicitado pelo navegador.

## Instalar

1. Abra o gerenciador de extensões do Chrome ou Edge.
2. Ative o modo de desenvolvedor.
3. Clique em **Carregar sem compactação** e selecione a pasta **ATENDE_OS8_AUTOMATICO** (a que contém este arquivo e o manifest.json).
4. Fixe a extensão na barra do navegador.

## Usar

Entre no Atende. Clique no ícone desta extensão e em **Executar**.

Na versão 1.1, a extensão coleta as OSs do serviço 08 da página exibida e verifica cada descrição em ordem. Se não encontrar matrícula explicitamente indicada como espelho/equivalência, deixa a OS sem alteração e passa à próxima. Para na primeira OS com equivalência e mostra a descrição. O retorno informa quantas OSs foram puladas. A matrícula da própria servidora e números soltos na descrição não são tratados como equivalência. Se todas forem puladas, informa que não encontrou equivalência nesta página. Não avança a paginação automaticamente.

Se a aba ativa já for a lista de solicitações, os filtros e a página atual serão mantidos. Caso contrário, a extensão abrirá a lista em outra aba. Ela procura a primeira linha visível com tipo/serviço 8, abre o link de detalhes dessa linha e lê o textarea da descrição. O resultado aparece automaticamente em um painel na página e também fica disponível no popup. O botão **Copiar texto** copia a descrição integral.

Esta versão busca na página exibida; não percorre a paginação. A seleção exige uma coluna identificável de tipo/serviço/assunto/categoria com código 8 ou 08 e um link único para SolicitacaoDetalhe.aspx. Se a estrutura não puder ser reconhecida, exibe um erro em vez de abrir uma OS arbitrária. A coluna Serviço, o link de detalhes e o campo da descrição foram conferidos na sessão autenticada em 28/09/2026. A instalação e a execução completa pelo botão da extensão precisam ser testadas no Chrome/Edge.

A captura fica apenas no armazenamento de sessão da extensão, é substituída a cada execução e desaparece ao encerrar o navegador. Não altera a solicitação nem libera acessos.
