// Add this to server.cjs before the catch-all route

// ===================== ROUTE PLANS CRUD =====================
app.get('/api/route-plans', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM route_plans ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/route-plans', auth, async (req, res) => {
  try {
    const { plan_name, route_ids, is_default } = req.body;
    const result = await pool.query(
      `INSERT INTO route_plans (plan_name, route_ids, is_default, created_at)
       VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [plan_name, route_ids || [], is_default || false]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/route-plans/:id', auth, async (req, res) => {
  try {
    const { plan_name, route_ids, is_default } = req.body;
    const result = await pool.query(
      `UPDATE route_plans 
       SET plan_name = COALESCE($1, plan_name),
           route_ids = COALESCE($2, route_ids),
           is_default = COALESCE($3, is_default),
           updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [plan_name, route_ids, is_default, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/route-plans/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM route_plans WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== ROUTES CRUD =====================
app.get('/api/routes', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM routes ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/routes', auth, async (req, res) => {
  try {
    const { route_name, trunk_ids, route_method, is_active } = req.body;
    const result = await pool.query(
      `INSERT INTO routes (route_name, trunk_ids, route_method, is_active, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [route_name, trunk_ids || [], route_method || 'priority', is_active !== false]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/routes/:id', auth, async (req, res) => {
  try {
    const { route_name, trunk_ids, route_method, is_active } = req.body;
    const result = await pool.query(
      `UPDATE routes 
       SET route_name = COALESCE($1, route_name),
           trunk_ids = COALESCE($2, trunk_ids),
           route_method = COALESCE($3, route_method),
           is_active = COALESCE($4, is_active),
           updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [route_name, trunk_ids, route_method, is_active, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/routes/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM routes WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== TRUNKS CRUD =====================
app.get('/api/trunks', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM trunks ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/trunks', auth, async (req, res) => {
  try {
    const { trunk_name, trunk_type, supplier_id, priority, percentage, is_active, mccmnc_allowed } = req.body;
    const result = await pool.query(
      `INSERT INTO trunks (trunk_name, trunk_type, supplier_id, priority, percentage, is_active, mccmnc_allowed, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
      [trunk_name, trunk_type, supplier_id, priority || 1, percentage || 100, is_active !== false, mccmnc_allowed || ['*']]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/trunks/:id', auth, async (req, res) => {
  try {
    const { trunk_name, trunk_type, supplier_id, priority, percentage, is_active, mccmnc_allowed } = req.body;
    const result = await pool.query(
      `UPDATE trunks 
       SET trunk_name = COALESCE($1, trunk_name),
           trunk_type = COALESCE($2, trunk_type),
           supplier_id = COALESCE($3, supplier_id),
           priority = COALESCE($4, priority),
           percentage = COALESCE($5, percentage),
           is_active = COALESCE($6, is_active),
           mccmnc_allowed = COALESCE($7, mccmnc_allowed),
           updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [trunk_name, trunk_type, supplier_id, priority, percentage, is_active, mccmnc_allowed, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/trunks/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM trunks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== ROUTE MAPS CRUD =====================
app.get('/api/route-maps', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT rm.*, c.client_code, r.route_name, s.supplier_code 
      FROM route_maps rm
      LEFT JOIN clients c ON rm.client_id = c.id
      LEFT JOIN routes r ON rm.route_id = r.id
      LEFT JOIN suppliers s ON rm.supplier_id = s.id
      ORDER BY rm.id
    `);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/route-maps', auth, async (req, res) => {
  try {
    const { client_id, route_id, supplier_id, mccmnc_pattern, priority, percentage, is_active } = req.body;
    const result = await pool.query(
      `INSERT INTO route_maps (client_id, route_id, supplier_id, mccmnc_pattern, priority, percentage, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
      [client_id, route_id, supplier_id, mccmnc_pattern || '*', priority || 1, percentage || 100, is_active !== false]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/route-maps/:id', auth, async (req, res) => {
  try {
    const { client_id, route_id, supplier_id, mccmnc_pattern, priority, percentage, is_active } = req.body;
    const result = await pool.query(
      `UPDATE route_maps 
       SET client_id = COALESCE($1, client_id),
           route_id = COALESCE($2, route_id),
           supplier_id = COALESCE($3, supplier_id),
           mccmnc_pattern = COALESCE($4, mccmnc_pattern),
           priority = COALESCE($5, priority),
           percentage = COALESCE($6, percentage),
           is_active = COALESCE($7, is_active),
           updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [client_id, route_id, supplier_id, mccmnc_pattern, priority, percentage, is_active, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/route-maps/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM route_maps WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== CLIENTS CRUD (Enhanced) =====================
app.put('/api/clients/:id', auth, async (req, res) => {
  try {
    const { client_code, company_name, contact_person, email, phone, address, country, 
            smpp_username, smpp_password, smpp_port, billing_mode, currency, 
            balance, credit_limit, status, routing_plan_id } = req.body;
    
    const result = await pool.query(
      `UPDATE clients 
       SET client_code = COALESCE($1, client_code),
           company_name = COALESCE($2, company_name),
           contact_person = COALESCE($3, contact_person),
           email = COALESCE($4, email),
           phone = COALESCE($5, phone),
           address = COALESCE($6, address),
           country = COALESCE($7, country),
           smpp_username = COALESCE($8, smpp_username),
           smpp_password = COALESCE($9, smpp_password),
           smpp_port = COALESCE($10, smpp_port),
           billing_mode = COALESCE($11, billing_mode),
           currency = COALESCE($12, currency),
           balance = COALESCE($13, balance),
           credit_limit = COALESCE($14, credit_limit),
           status = COALESCE($15, status),
           routing_plan_id = COALESCE($16, routing_plan_id),
           updated_at = NOW()
       WHERE id = $17 RETURNING *`,
      [client_code, company_name, contact_person, email, phone, address, country,
       smpp_username, smpp_password, smpp_port, billing_mode, currency,
       balance, credit_limit, status, routing_plan_id, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== SUPPLIERS CRUD (Enhanced) =====================
app.put('/api/suppliers/:id', auth, async (req, res) => {
  try {
    const { supplier_code, company_name, contact_person, email, phone, connection_type,
            smpp_host, smpp_port, smpp_username, smpp_password, status } = req.body;
    
    const result = await pool.query(
      `UPDATE suppliers 
       SET supplier_code = COALESCE($1, supplier_code),
           company_name = COALESCE($2, company_name),
           contact_person = COALESCE($3, contact_person),
           email = COALESCE($4, email),
           phone = COALESCE($5, phone),
           connection_type = COALESCE($6, connection_type),
           smpp_host = COALESCE($7, smpp_host),
           smpp_port = COALESCE($8, smpp_port),
           smpp_username = COALESCE($9, smpp_username),
           smpp_password = COALESCE($10, smpp_password),
           status = COALESCE($11, status),
           updated_at = NOW()
       WHERE id = $12 RETURNING *`,
      [supplier_code, company_name, contact_person, email, phone, connection_type,
       smpp_host, smpp_port, smpp_username, smpp_password, status, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== RATES CRUD (Enhanced) =====================
app.put('/api/rates/:id', auth, async (req, res) => {
  try {
    const { rate, is_active } = req.body;
    const result = await pool.query(
      `UPDATE rates 
       SET rate = COALESCE($1, rate),
           is_active = COALESCE($2, is_active),
           updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [rate, is_active, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
