# RouteX Cloud 3.0 — Bela Metais

Central logística multiusuário para **roteirização de entregas + histórico + agenda compartilhada do veículo + administração**.

Esta versão foi preparada para sair do uso exclusivamente local e ser publicada na **Vercel**.

## O que mudou na versão 3.0

- PostgreSQL persistente substitui o SQLite como banco principal.
- Sessões de login ficam no PostgreSQL, funcionando entre múltiplas instâncias do servidor.
- Toda rota otimizada é salva automaticamente no histórico do usuário.
- Tela **Rotas geradas** com links do Google Maps e download da planilha XLSX.
- Tela inicial após login com duas ações: **Gerar uma rota** ou **Fazer um agendamento**.
- Agenda mensal compartilhada entre todos os usuários.
- Bloqueio transacional de conflito de horários para o veículo único.
- Repetição diária de agendamentos, com data final e validação de todas as ocorrências.
- **Meus agendamentos** para editar ou cancelar reservas.
- Associação de uma rota gerada a um agendamento, incluindo acesso ao Maps e à planilha.
- Campo para link de rota externo e upload opcional de XLSX.
- Painel de administrador com todos os usuários, todas as rotas e todos os agendamentos.
- Admin pode definir senha provisória; o usuário é obrigado a criar uma nova senha no próximo login.
- Processamento dos XMLs em memória, sem depender de diretório temporário persistente.
- Compatibilidade com Vercel/Node.js 24.

---

# 1. Arquitetura

```text
Navegador
   |
   v
RouteX / Express / Node.js 24
   |----------------------|
   v                      v
PostgreSQL             Vercel Private Blob
(Neon recomendado)     (somente XLSX manual)
   |
   +-- usuários
   +-- sessões
   +-- locais cadastrados
   +-- cache de geocodificação
   +-- histórico de rotas
   +-- agendamentos
   +-- referência de anexos
```

## Por que PostgreSQL?

Em uma publicação multiusuário, o banco não pode depender de um arquivo SQLite dentro da máquina onde o processo Node está executando. O PostgreSQL mantém os dados fora da aplicação e pode ser acessado por todas as instâncias do RouteX.

Para Vercel, a opção recomendada neste projeto é **Neon Postgres**, disponível no Marketplace da própria Vercel.

Vercel Marketplace: https://vercel.com/marketplace/category/storage
Neon: https://vercel.com/marketplace/neon

## Por que Vercel Private Blob?

O Blob é utilizado somente quando um usuário envia manualmente um `.xlsx` para um agendamento. As planilhas geradas pelo RouteX são reconstruídas a partir do histórico salvo no PostgreSQL e não ocupam armazenamento de arquivos.

Documentação: https://vercel.com/docs/storage/vercel-blob

---

# 2. Requisitos

## Node.js

**Versão: 24.x**

O `package.json` fixa Node.js 24 para manter compatibilidade com novos deployments da Vercel.

Download local: https://nodejs.org/

## npm

Instalado junto com Node.js.

## PostgreSQL

Você não precisa instalar PostgreSQL no computador se utilizar Neon/Vercel. Basta obter a `DATABASE_URL`.

## Vercel CLI — opcional, recomendado

```bash
npm install -g vercel@latest
```

É útil para testar a publicação e importar as variáveis de ambiente localmente.

---

# 3. Instalação local

## 1. Extrair o ZIP

Entre na pasta que contém `package.json` e `server.js`.

## 2. Instalar dependências

```bash
npm install
```

## 3. Criar `.env`

Copie:

```bash
cp .env.example .env
```

No Windows/PowerShell:

```powershell
Copy-Item .env.example .env
```

## 4. Configurar PostgreSQL

Preencha no `.env`:

```env
DATABASE_URL=postgresql://usuario:senha@host:5432/routex?sslmode=require
```

Se usar PostgreSQL local sem SSL:

```env
DATABASE_SSL=false
```

## 5. Configurar sessão

Defina uma frase aleatória longa:

```env
SESSION_SECRET=uma-frase-longa-e-aleatoria-com-mais-de-24-caracteres
```

## 6. Administrador inicial

```env
ADMIN_EMAIL=seu-email@empresa.com.br
ADMIN_NAME=Administrador RouteX
ADMIN_INITIAL_PASSWORD=uma-senha-inicial-com-pelo-menos-8-caracteres
```

Na primeira inicialização, se o e-mail ainda não existir, o usuário administrador será criado.

**Depois que o administrador existir, remova `ADMIN_INITIAL_PASSWORD` do ambiente de produção.**

Se o e-mail já existir como usuário normal, ele será promovido a administrador sem alterar a senha atual.

## 7. Iniciar

```bash
npm start
```

Acesse:

```text
http://localhost:3000
```

O schema é criado/atualizado automaticamente na inicialização.

---

# 4. Arquivo `.env`

Exemplo completo:

```env
NODE_ENV=development
PORT=3000
SESSION_SECRET=troque-por-uma-frase-longa-e-aleatoria

DATABASE_URL=postgresql://usuario:senha@host:5432/routex?sslmode=require
DATABASE_SSL=true
DB_POOL_MAX=5

ADMIN_EMAIL=admin@belametais.com.br
ADMIN_NAME=Administrador RouteX
ADMIN_INITIAL_PASSWORD=troque-esta-senha-inicial

GEOCODING_PROVIDER=nominatim
GEOCODING_STRATEGY=balanced
GEOCODING_PRECISE_LIMIT=12
NOMINATIM_USER_AGENT=RouteX-BelaMetais/3.0
NOMINATIM_INTERVAL_MS=1100
NOMINATIM_TIMEOUT_MS=4500
CEP_COORDINATES_TIMEOUT_MS=4500

ROUTING_PROVIDER=osrm
OSRM_BASE_URL=https://router.project-osrm.org
OSRM_MAX_POINTS=100
MAPS_MAX_POINTS_PER_LINK=10
HAVERSINE_ROAD_FACTOR=1.25
HAVERSINE_AVERAGE_SPEED_KMH=45
```

Não é necessária chave da API do Google para abrir os links do Maps.

---

# 5. Publicação na Vercel

## Etapa A — Subir o projeto para GitHub

Crie um repositório privado e envie a pasta do RouteX.

Nunca envie `.env` para o GitHub. Ele já está incluído no `.gitignore`.

## Etapa B — Criar o projeto na Vercel

1. Entre em https://vercel.com/
2. **Add New → Project**.
3. Importe o repositório do RouteX.
4. O projeto detecta o `server.js` e executa como aplicação Node/Express.
5. O `package.json` solicita Node.js `24.x`.

## Etapa C — Criar o PostgreSQL

Na Vercel:

1. Abra o projeto.
2. Acesse **Storage / Marketplace**.
3. Escolha **Neon** ou outro PostgreSQL compatível.
4. Crie/conecte o banco ao projeto.
5. Confirme que a variável `DATABASE_URL` está disponível no projeto. O RouteX também aceita `POSTGRES_URL` como alternativa, caso o provedor use esse nome.

O RouteX criará suas tabelas automaticamente no primeiro acesso do servidor.

## Etapa D — Configurar variáveis de ambiente

Em **Project Settings → Environment Variables**, adicione pelo menos:

```text
SESSION_SECRET
DATABASE_URL
ADMIN_EMAIL
ADMIN_NAME
ADMIN_INITIAL_PASSWORD
GEOCODING_PROVIDER
ROUTING_PROVIDER
OSRM_BASE_URL
NOMINATIM_USER_AGENT
```

As demais podem usar os padrões do `.env.example`.

## Etapa E — Anexos manuais XLSX

Para permitir upload manual de planilhas nos agendamentos:

1. Crie um **Vercel Blob** com acesso **Private**.
2. Conecte o Blob ao mesmo projeto.
3. Faça novo deploy.

Se o Blob não estiver configurado, as rotas, agenda e planilhas geradas pelo próprio RouteX continuam funcionando; somente o upload de XLSX manual apresentará aviso.

## Etapa F — Deploy

Faça o deploy normalmente pela Vercel.

Após confirmar que o admin foi criado, retire do ambiente:

```text
ADMIN_INITIAL_PASSWORD
```

---

# 6. Migração da versão SQLite anterior

Se quiser transferir os usuários, pontos operacionais e cache de geocodificação da versão 2.x:

1. Coloque o antigo arquivo em:

```text
data/routex_bela_v3.db
```

2. Configure no `.env` a `DATABASE_URL` do novo PostgreSQL.

3. Execute:

```bash
npm run migrate:sqlite
```

Ou informe outro arquivo:

```bash
npm run migrate:sqlite -- "C:/caminho/routex_bela_v3.db"
```

A migração transfere:

- usuários e hashes de senha existentes;
- locais cadastrados;
- cache de geocodificação.

O histórico de rotas e agenda não existiam nas versões antigas, portanto começam vazios.

---

# 7. Criar/promover administrador pelo terminal

Com `DATABASE_URL` configurada:

```bash
npm run create-admin -- admin@empresa.com.br "Nome do Administrador" "SenhaCom8OuMais"
```

Se o e-mail já existir, ele é promovido a `admin` e recebe a senha informada.

---

# 8. Banco de dados

O arquivo do schema é:

```text
src/database/schema.postgres.sql
```

## `users`

Usuários da plataforma.

Principais campos:

- `id`
- `name`
- `email`
- `password_hash`
- `role`: `user` ou `admin`
- `must_change_password`
- `active`

## `saved_locations`

Pontos operacionais compartilhados: lojas, depósitos etc.

## `geocode_cache`

Cache compartilhado de coordenadas para acelerar novas rotas.

## `route_history`

Histórico persistente de cada otimização:

- usuário;
- origem;
- paradas;
- regras;
- destino final;
- sequência final;
- links do Maps;
- distância e tempo;
- algoritmo/provedor.

O XLSX é gerado novamente a partir deste registro.

## `appointments`

Agenda compartilhada do veículo.

Campos principais:

- usuário responsável;
- título e observação;
- início e fim;
- rota associada;
- link de rota manual;
- série/recorrência;
- status ativo/cancelado.

## `appointment_attachments`

Metadados de arquivos guardados no Vercel Private Blob.

## `user_sessions`

Criada automaticamente pelo `connect-pg-simple` para manter as sessões de login no PostgreSQL.

---

# 9. Como funciona o bloqueio de agenda

O RouteX considera conflito quando:

```text
novo_inicio < fim_existente
E
novo_fim > inicio_existente
```

Antes da verificação o PostgreSQL recebe um **advisory lock transacional** para a agenda do veículo. Isso evita que duas solicitações simultâneas passem pela verificação ao mesmo tempo.

É permitido, por exemplo:

```text
Agendamento A: 08:00–10:00
Agendamento B: 10:00–12:00
```

Não é permitido:

```text
Agendamento A: 08:00–10:00
Agendamento B: 09:30–11:00
```

Na repetição diária, todas as ocorrências são verificadas dentro da mesma transação. Se um único dia conflitar, a série inteira é recusada e o sistema informa a ocorrência conflitante.

A série diária exige uma data final e é limitada a 366 ocorrências por criação.

---

# 10. Fluxo do usuário

Após o login a tela inicial oferece:

## Gerar uma rota

1. Importar XMLs.
2. Definir partida.
3. Preparar paradas.
4. Adicionar regras.
5. Definir destino final, se necessário.
6. Otimizar.
7. A rota é salva automaticamente no histórico.
8. Abrir Google Maps.
9. Exportar XLSX.

## Fazer um agendamento

1. Escolher data.
2. Informar horário inicial e final.
3. Informar título.
4. Adicionar observação, se necessário.
5. Associar uma rota já gerada e/ou colar link externo.
6. Opcionalmente anexar um XLSX.
7. Escolher agendamento único ou repetição diária.
8. Confirmar.

Depois o usuário pode acessar **Meus agendamentos** para editar ou cancelar.

---

# 11. Rotas geradas

Cada usuário enxerga somente o próprio histórico em **Rotas geradas**.

O administrador enxerga todas as rotas pelo painel **Administração**.

Cada registro oferece:

- data/hora de geração;
- quantidade de paradas;
- distância;
- links do Google Maps;
- download do XLSX;
- detalhes da sequência.

---

# 12. Administração

Usuários com `role = admin` possuem a opção **Administração**.

O painel permite:

- visualizar todos os usuários;
- visualizar todas as rotas;
- visualizar todos os agendamentos;
- abrir rotas de qualquer usuário;
- editar agendamentos;
- definir senha provisória de um usuário.

Ao definir senha provisória, `must_change_password` é ativado. No próximo login, o usuário é direcionado obrigatoriamente para a tela de nova senha.

---

# 13. Limite de upload na Vercel

A Vercel documenta limite de **4,5 MB no corpo de uma requisição de Function**.

Por segurança o RouteX avisa no navegador quando a seleção de XMLs ultrapassa aproximadamente 4 MB.

Se tiver muitos XMLs:

1. importe o primeiro lote;
2. aguarde a inclusão das paradas;
3. importe o segundo lote;
4. continue no mesmo planejamento.

O sistema não apaga as NF-e que já foram importadas ao adicionar outro lote.

Documentação: https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE

---

# 14. Estrutura principal

```text
RouteX/
├── server.js
├── package.json
├── .env.example
├── scripts/
│   ├── createAdmin.js
│   └── migrateSqliteToPostgres.js
└── src/
    ├── app.js
    ├── controllers/
    ├── database/
    │   ├── db.js
    │   └── schema.postgres.sql
    ├── middleware/
    ├── models/
    ├── repositories/
    ├── routes/
    ├── services/
    ├── utils/
    ├── views/
    └── public/
```

---

# 15. Inicialização normal depois de instalado

## Local

```bash
npm start
```

Depois:

```text
http://localhost:3000
```

## Produção/Vercel

Não é necessário iniciar o servidor manualmente. O deploy executa a aplicação e conecta ao PostgreSQL configurado no projeto.

---

# 16. Observações de produção

- Não publique `.env` no GitHub.
- Use uma `SESSION_SECRET` exclusiva.
- Retire `ADMIN_INITIAL_PASSWORD` depois do primeiro deploy.
- Mantenha o Blob como privado.
- Use HTTPS, já fornecido pela Vercel.
- Para uso intensivo de roteirização, considere futuramente um OSRM próprio em vez do servidor público compartilhado.
- O Nominatim público deve continuar respeitando o intervalo configurado e o cache persistente.
