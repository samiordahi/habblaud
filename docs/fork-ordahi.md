# O fork Ordahi do Habblaud

Este repositório (`samiordahi/habblaud`) é a distribuição da Ordahi. O original é só fonte de atualizações:

- `origin`: `samiordahi/habblaud`, onde vivem as identidades fixas e a ponte com o AIOS;
- `upstream`: `marmottajr/habblaud`, somente leitura (push desligado);
- `main`: versão Ordahi aprovada.

Tudo o que é do fork carrega o comentário `Fork Ordahi` no código, para o merge com o upstream achar as costuras.

## Identidades fixas: um personagem por agente

O Habblaud original dá um personagem sorteado a cada sessão. Aqui, cada ferramenta pode ter **um personagem fixo**
(o Claude é sempre o Cody, o Codex é sempre o Codex), declarado em `~/.habblaud/identidades.json`:

```json
{ "identidades": [
  { "nome": "Cody", "ferramenta": "claude", "casa": "Ordahi AIOS", "look": "m", "seed": 3,
    "parts": { "accessory": "cap", "accessoryColor": "#e78130", "topStyle": "jacket", "top": "#2f2a3a" } }
] }
```

| campo        | o que é |
| ------------ | ------- |
| `nome`       | o nome do personagem |
| `ferramenta` | `claude` ou `codex` |
| `pasta`      | opcional: trecho do caminho do projeto; a regra só vale lá (a primeira regra que casa vence) |
| `casa`       | opcional: trecho do caminho onde a identidade prefere estar |
| `look`, `seed`, `parts` | a aparência, no mesmo formato do editor de personagem (`shared/appearance.ts`) |

- A **titular** veste a identidade: a primeira sessão viva da ferramenta, ou, com `casa`, uma sessão em casa.
- As outras sessões abertas ao mesmo tempo são **ajudantes** (selo "Ajudante do Cody"), com nome sorteado. Cada uma
  mantém o próprio terminal, aprovação e mensagens, porque no Habblaud isso é por sessão.
- Quando a titular sai, o ajudante em casa (ou o mais antigo) **assume** a identidade.
- Sessão nova em casa toma a identidade de uma titular que esteja fora de casa; a de fora vira ajudante.
- Subagentes continuam como no Habblaud: colegas temporários que entregam o resultado e vão embora.

O arquivo é relido quando muda; sem ele, tudo volta ao sorteio do Habblaud. Código em `server/model/identities.ts`,
testes em `server/model/identities.test.ts`.

## A tela de Personagens

O botão de pessoas na barra do topo abre a tela, na sala direta e dentro do painel, sem depender do Habblaud World. Ela
cria, muda e apaga as identidades fixas, e grava em `~/.habblaud/identidades.json`, que continua sendo a fonte: dá para
seguir editando o arquivo à mão. O lápis da gaveta, num personagem fixo ou num ajudante dele, abre a tela no personagem.
Num agente sorteado, segue editando o personagem do projeto.

- **Aparência:** o mesmo editor do World (`AppearanceFields`), com `office: true`, que libera as peças só do escritório
  e a cor livre. As 13 peças vão todas para o arquivo: a aparência fica fixa e a semente sobra para a personalidade.
- **Personalidade:** 2 ou 3 traços, bordão e amizades e rivalidades, no campo `personalidade`. Traços e bordão iguais
  aos da semente não são declarados. Vínculo vale nos dois sentidos, e o arquivo guarda dos dois lados.
- **Ligação:** Claude ou Codex (com pasta opcional), um perfil que a ponte do Hermes mostrou, ou Guardado
  (`ferramenta: "nenhuma"`), que fica na tela e não entra em sala. Perfil novo se cria no Hermes, não aqui.

```json
{ "nome": "Sofia", "ferramenta": "claude", "pasta": "Evolua", "look": "f", "seed": 9, "parts": { },
  "personalidade": { "tracos": ["calma", "leitura"], "bordao": "Bora organizar!", "amigos": ["Tars"], "rivais": [] } }
```

Rotas: `GET/PUT /api/personagens` e `DELETE /api/personagens/:nome`, só pelo próprio computador (mesma trava do
personagem do projeto), nunca pelo celular. Regras em `saveCharacter`/`removeCharacter` (`server/model/identities.ts`):
nome e ligação não repetem, regra com pasta vai à frente da geral, entrada fora do formato fica como está. Grava por
arquivo temporário e troca, com a versão anterior em `identidades.json.bak`; arquivo ilegível nunca é sobrescrito.

Ao salvar, quem está na sala veste a mudança na hora (`Office.reconcileIdentities`, `ExternalSource.refreshIdentities`):
a titular troca de roupa, quem perdeu a regra volta ao sorteio e identidade nova vai para a sessão dela.

### O que nunca sobe ao World

Peças novas ficam em `OFFICE_*` (`shared/appearance.ts`), fora das listas do World. O servidor do mundo recusa o pacote
inteiro com peça ou cor fora das listas dele, então `flattenAppearance` passa por `toWorldAppearance`: peça do escritório
vira a equivalente e cor livre vira a da paleta mais próxima. Só reduz: o mundo vê menos, nunca algo diferente do agente.
O tipo de retorno é o do protocolo, para o compilador acusar quem tentar pular essa porta. `personalidade` não entra na
projeção. O editor do personagem do mundo segue fechado nas listas dele (`parseWorldParts`).

Peça nova: acrescente em `OFFICE_*`, desenhe em `client/src/art/character/` (o tipo obriga), dê o rótulo em
`character-model.ts` e a equivalente em `WORLD_*` (`shared/world/appearance-flat.ts`).

## Agentes de fora: a ponte com o AIOS

O Hermes roda na VPS, e com ele os perfis Tars, Bella Banker e Stella Sales. Quem lê a VPS é o painel do AIOS
(`hermes logs -f` por SSH, reduzido a estado, ferramenta e hora). O Habblaud só consulta o recorte pronto:

```
HABBLAUD_EXTERNAL_URL=http://127.0.0.1:4360/api/agentes-remotos
```

```json
{ "projeto": "D:\\Documentos\\Ordahi AIOS",
  "agentes": [ { "id": "tars", "nome": "Tars", "estado": "active", "atividade": "Auditoria da inbox",
                 "ferramenta": "Hermes", "quando": "2026-11-01T10:02:03Z", "origem": "VPS" } ] }
```

- Cada agente vira um principal na sala do `projeto`, junto com o Cody, com o selo "Hermes · VPS" (ou "· GitHub",
  quando o último sinal veio do repositório).
- A aparência vem de `identidades.json`, com `"ferramenta": "externo"` e `"chave"` igual ao `id`. Sem regra, o nome
  vem da ponte.
- `estado`: `active` trabalha, `waiting` pede você, `idle` descansa, `error` descansa com a atividade marcada como erro.
- Quem some do retrato sai pelo elevador; se a ponte cai por 20 consultas seguidas (~1 min), todos os externos saem e
  voltam quando ela volta.
- Prompt, argumento e saída não fazem parte do contrato. Terminal e mensagens não existem para externos.

Código em `server/sources/external.ts`, testes em `server/sources/external.test.ts`.

### Aprovar pedidos do AIOS pela sala

A ponte traz também os arquivos de `requests/` em `estado: esperando`, e onde mandar a decisão:

```json
{ "pedidos": [ { "id": "requests/x.md", "agente": "bella", "titulo": "Enviar cobrança", "texto": "O texto na íntegra",
                 "tipo": "enviar", "origem": "hermes", "skill": null, "efeitoExterno": true, "quando": "..." } ],
  "decisao": "/api/pedido" }
```

- O arquivo é a verdade. A sala é um espelho: o pedido vira cartão **Pede sua aprovação** no agente de `agente`, o
  mesmo cartão das permissões (`PermissionRequestInfo.external`), e o texto só sai pelo detalhe, como os argumentos.
- A decisão vai por POST `{arquivo, decisao}` em `decisao`, sempre na origem da ponte. O cartão só some quando a origem
  confirma; se ela falhar, o pedido continua aberto e o motivo aparece na página. Sem `decisao`, ninguém decide.
- Pedido não expira, não precisa de página aberta para esperar e não tem "Responder no terminal". Decidido no painel,
  some da sala na consulta seguinte. Só existe aprovar ou recusar; a recusa não leva motivo, porque o arquivo só guarda
  a decisão.
- Com a página aberta, pedido novo dá aviso. Pedido que já esperava aparece no contador "precisam de você" e na tecla `P`.

Código em `server/sources/external.ts` e `syncExternal`/`decideExternal` em `server/permissions/registry.ts`.

No Windows, a letra do drive não diferencia caixa na sala (`server/model/rooms.ts`): o VS Code manda `d:`, o Node `D:`.

## Dentro do painel do AIOS

O escritório abre na aba Agentes do painel (`apps/painel/app/src/agentes.tsx` no AIOS), num iframe. O original
recusa iframe (`X-Frame-Options: DENY`, contra clickjacking); aqui `HABBLAUD_FRAME_ANCESTORS` lista as origens que
podem embutir, só do próprio computador (`localhost`, `127.0.0.1`, `[::1]`):

```
HABBLAUD_FRAME_ANCESTORS="http://127.0.0.1:4360 http://localhost:4360"
```

Com a lista, sai `Content-Security-Policy: frame-ancestors 'self' <origens>` no lugar do DENY; sem ela, tudo como no
original. O painel liga o Habblaud já com isso (`scripts/painel-habblaud.mjs` no AIOS). Código em
`server/http/static.ts`, testes em `server/http/frame.test.ts`.

## O que está ligado: `~/.habblaud/ambiente.env`

Terminal interativo, ditado, World e o desenho do celular moram num arquivo só, `CHAVE=valor`, lido pelas duas partidas
(`iniciar.ps1` e `scripts/painel-habblaud.mjs` no AIOS), para a sala subir igual por qualquer uma. Sem o arquivo, tudo
fica no padrão fechado: é o caso do cliente do Northbase. O login do celular fica no `.env` deste repositório, que o
`npm run remote:setup` escreve e o Git ignora.

No Windows, o celular entra pela porta 4748 presa ao `127.0.0.1` e publicada por `tailscale serve`: não há anúncio mDNS
aqui, e assim a porta nunca aparece na rede local. Ditado: `whisper-cli.exe` do release oficial do whisper.cpp em
`~/.habblaud/ferramentas/whisper`, ffmpeg pelo winget e `ggml-small.bin` em `~/.local/share/whisper`.

## Atualizar a partir do original

```bash
git fetch upstream
git merge upstream/main   # resolver as costuras "Fork Ordahi"
npm install && npm run typecheck && npx vitest run server/model
npm run build
```

No Windows, ~20 testes do original falham por motivo de plataforma (permissão 600, openssl, Docker): conferir que a
lista é a mesma de antes do merge, não que é zero.
