require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const SECRET = process.env.JWT_SECRET || 'dev-secret';

app.use(express.json());
app.use(express.static(__dirname + '/public'));

// ---------- Autenticação ----------
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.userId = jwt.verify(token, SECRET).id;
    next();
  } catch {
    res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  }
}

const handle = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error(e);
    res.status(500).json({ erro: 'Erro no servidor.' });
  });

app.post('/api/cadastro', handle(async (req, res) => {
  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha || senha.length < 6)
    return res.status(400).json({ erro: 'Preencha nome, e-mail e senha (mínimo 6 caracteres).' });
  const hash = await bcrypt.hash(senha, 10);
  try {
    const r = await db.query(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES ($1,$2,$3) RETURNING id, nome',
      [nome, email.toLowerCase(), hash]
    );
    const u = r.rows[0];
    // categorias iniciais para o usuário já poder usar o app
    await db.query(
      `INSERT INTO categorias (usuario_id, nome, tipo, limite_mensal) VALUES
       ($1,'Alimentação','despesa',600), ($1,'Transporte','despesa',200),
       ($1,'Lazer','despesa',150), ($1,'Mesada/Bolsa','receita',NULL)`,
      [u.id]
    );
    res.json({ token: jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' }), nome: u.nome });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
    throw e;
  }
}));

app.post('/api/login', handle(async (req, res) => {
  const { email, senha } = req.body;
  const r = await db.query('SELECT * FROM usuarios WHERE email = $1', [(email || '').toLowerCase()]);
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(senha || '', u.senha_hash)))
    return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  res.json({ token: jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' }), nome: u.nome });
}));

// ---------- Categorias ----------
app.get('/api/categorias', auth, handle(async (req, res) => {
  const r = await db.query('SELECT * FROM categorias WHERE usuario_id=$1 ORDER BY nome', [req.userId]);
  res.json(r.rows);
}));

app.post('/api/categorias', auth, handle(async (req, res) => {
  const { nome, tipo, limite_mensal } = req.body;
  if (!nome || !['receita', 'despesa'].includes(tipo))
    return res.status(400).json({ erro: 'Informe nome e tipo da categoria.' });
  try {
    const r = await db.query(
      'INSERT INTO categorias (usuario_id, nome, tipo, limite_mensal) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.userId, nome, tipo, limite_mensal || null]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ erro: 'Você já tem uma categoria com esse nome.' });
    throw e;
  }
}));

app.put('/api/categorias/:id', auth, handle(async (req, res) => {
  const { nome, tipo, limite_mensal } = req.body;
  const r = await db.query(
    'UPDATE categorias SET nome=$1, tipo=$2, limite_mensal=$3 WHERE id=$4 AND usuario_id=$5 RETURNING *',
    [nome, tipo, limite_mensal || null, req.params.id, req.userId]
  );
  r.rows[0] ? res.json(r.rows[0]) : res.status(404).json({ erro: 'Categoria não encontrada.' });
}));

app.delete('/api/categorias/:id', auth, handle(async (req, res) => {
  try {
    await db.query('DELETE FROM categorias WHERE id=$1 AND usuario_id=$2', [req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23503')
      return res.status(409).json({ erro: 'Esta categoria tem transações. Exclua-as antes.' });
    throw e;
  }
}));

// ---------- Transações ----------
app.get('/api/transacoes', auth, handle(async (req, res) => {
  const mes = req.query.mes || new Date().toISOString().slice(0, 7); // AAAA-MM
  const r = await db.query(
    `SELECT t.id, t.descricao, t.valor, t.tipo, to_char(t.data,'YYYY-MM-DD') AS data,
            t.categoria_id, c.nome AS categoria
     FROM transacoes t JOIN categorias c ON c.id = t.categoria_id
     WHERE t.usuario_id=$1 AND to_char(t.data,'YYYY-MM')=$2
     ORDER BY t.data DESC, t.id DESC`,
    [req.userId, mes]
  );
  res.json(r.rows);
}));

app.post('/api/transacoes', auth, handle(async (req, res) => {
  const { descricao, valor, data, categoria_id } = req.body;
  if (!descricao || !(Number(valor) > 0) || !categoria_id)
    return res.status(400).json({ erro: 'Informe descrição, valor maior que zero e categoria.' });
  const cat = await db.query('SELECT tipo FROM categorias WHERE id=$1 AND usuario_id=$2', [categoria_id, req.userId]);
  if (!cat.rows[0]) return res.status(400).json({ erro: 'Categoria inválida.' });
  const r = await db.query(
    `INSERT INTO transacoes (usuario_id, categoria_id, descricao, valor, data, tipo)
     VALUES ($1,$2,$3,$4,COALESCE($5, CURRENT_DATE),$6) RETURNING id`,
    [req.userId, categoria_id, descricao, valor, data || null, cat.rows[0].tipo]
  );
  res.json(r.rows[0]);
}));

app.put('/api/transacoes/:id', auth, handle(async (req, res) => {
  const { descricao, valor, data, categoria_id } = req.body;
  const cat = await db.query('SELECT tipo FROM categorias WHERE id=$1 AND usuario_id=$2', [categoria_id, req.userId]);
  if (!cat.rows[0]) return res.status(400).json({ erro: 'Categoria inválida.' });
  const r = await db.query(
    `UPDATE transacoes SET descricao=$1, valor=$2, data=$3, categoria_id=$4, tipo=$5
     WHERE id=$6 AND usuario_id=$7 RETURNING id`,
    [descricao, valor, data, categoria_id, cat.rows[0].tipo, req.params.id, req.userId]
  );
  r.rows[0] ? res.json(r.rows[0]) : res.status(404).json({ erro: 'Transação não encontrada.' });
}));

app.delete('/api/transacoes/:id', auth, handle(async (req, res) => {
  await db.query('DELETE FROM transacoes WHERE id=$1 AND usuario_id=$2', [req.params.id, req.userId]);
  res.json({ ok: true });
}));

// ---------- Dashboard ----------
app.get('/api/dashboard', auth, handle(async (req, res) => {
  const mes = req.query.mes || new Date().toISOString().slice(0, 7);
  const tot = await db.query(
    `SELECT COALESCE(SUM(valor) FILTER (WHERE tipo='receita'),0) AS receitas,
            COALESCE(SUM(valor) FILTER (WHERE tipo='despesa'),0) AS despesas
     FROM transacoes WHERE usuario_id=$1 AND to_char(data,'YYYY-MM')=$2`,
    [req.userId, mes]
  );
  const cats = await db.query(
    `SELECT c.id, c.nome, c.limite_mensal, COALESCE(SUM(t.valor),0) AS gasto
     FROM categorias c
     LEFT JOIN transacoes t ON t.categoria_id=c.id AND to_char(t.data,'YYYY-MM')=$2
     WHERE c.usuario_id=$1 AND c.tipo='despesa'
     GROUP BY c.id ORDER BY gasto DESC`,
    [req.userId, mes]
  );
  const { receitas, despesas } = tot.rows[0];
  res.json({
    receitas: Number(receitas),
    despesas: Number(despesas),
    saldo: Number(receitas) - Number(despesas),
    categorias: cats.rows.map((c) => ({
      ...c,
      limite_mensal: c.limite_mensal === null ? null : Number(c.limite_mensal),
      gasto: Number(c.gasto),
      estourou: c.limite_mensal !== null && Number(c.gasto) > Number(c.limite_mensal),
    })),
  });
}));

app.listen(process.env.PORT || 3000, () =>
  console.log(`GastoZen rodando em http://localhost:${process.env.PORT || 3000}`)
);
