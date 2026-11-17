# GastoZen

App web de controle de gastos para estudantes. Projeto final de Banco de Dados e Programação Mobile/Web.

**Stack:** HTML/CSS/JavaScript (front) · Node.js + Express (API REST com JWT) · PostgreSQL.

## Funcionalidades
- Cadastro e login (senha com hash bcrypt, autenticação JWT)
- CRUD de transações (receitas e despesas)
- Categorias com limite mensal
- Resumo do mês: saldo, gasto por categoria e alerta de limite ultrapassado

## Como rodar
Requisitos: Node.js 18+ e PostgreSQL.

1. Crie o banco e as tabelas:
   ```
   psql -U postgres -c "CREATE DATABASE gastozen;"
   psql -U postgres -d gastozen -f database/schema.sql
   ```
2. Configure o backend:
   ```
   cd backend
   cp .env.example .env     # edite a senha do PostgreSQL no .env
   npm install
   npm start
   ```
3. Abra http://localhost:3000, crie uma conta e use o app.

## Modelo de dados
`usuarios (1) —— (N) categorias (1) —— (N) transacoes`, e `usuarios (1) —— (N) transacoes`.

## Autor
Antonio Carlos Biasotto da Silva · https://github.com/antoniobiasottosilva
