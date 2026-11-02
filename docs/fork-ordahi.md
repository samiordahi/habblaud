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
- Prompt, argumento e saída não fazem parte do contrato. Terminal, aprovação e mensagens não existem para externos.

Código em `server/sources/external.ts`, testes em `server/sources/external.test.ts`.

No Windows, a letra do drive não diferencia caixa na sala (`server/model/rooms.ts`): o VS Code manda `d:`, o Node `D:`.

## Atualizar a partir do original

```bash
git fetch upstream
git merge upstream/main   # resolver as costuras "Fork Ordahi"
npm install && npm run typecheck && npx vitest run server/model
npm run build
```

No Windows, ~20 testes do original falham por motivo de plataforma (permissão 600, openssl, Docker): conferir que a
lista é a mesma de antes do merge, não que é zero.
