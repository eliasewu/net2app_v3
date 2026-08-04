import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'sms_platform',
  user: process.env.DB_USER || 'net2app_user',
  password: process.env.DB_PASS || 'Ariya@2024Net2App',
});

class DynamicRouter {
  
  // Get MCC/MNC from destination number — resolves actual MNC via mccmnc table
  async getMccMnc(destination) {
    const cleaned = String(destination).replace(/^\+/, '');
    
    // Build all possible prefix lengths, query in one round trip, longest wins
    const prefixes = [];
    for (let len = Math.min(cleaned.length, 5); len >= 1; len--) {
      prefixes.push(cleaned.substring(0, len));
    }
    
    const result = await pool.query(
      `SELECT mcc, mnc, operator, country FROM mccmnc
       WHERE calling_code = ANY($1) AND (is_deleted IS NULL OR is_deleted = false)
       ORDER BY LENGTH(calling_code) DESC LIMIT 1`,
      [prefixes]
    );
    
    if (result.rows.length) {
      const row = result.rows[0];
      return { mcc: row.mcc, mnc: row.mnc, operator: row.operator || '', country: row.country || '' };
    }
    
    // Simple country code fallback for common prefixes
    if (cleaned.startsWith('880') || cleaned.startsWith('016')) return { mcc: '470', mnc: '*', operator: '', country: 'Bangladesh' };
    if (cleaned.startsWith('91')) return { mcc: '404', mnc: '*', operator: '', country: 'India' };
    if (cleaned.startsWith('92')) return { mcc: '410', mnc: '*', operator: '', country: 'Pakistan' };
    if (cleaned.startsWith('1')) return { mcc: '310', mnc: '*', operator: '', country: 'USA' };
    if (cleaned.startsWith('44')) return { mcc: '234', mnc: '*', operator: '', country: 'UK' };
    return { mcc: '000', mnc: '*', operator: '', country: 'Unknown' };
  }

  // Get client routing configuration
  async getClientRouting(clientId) {
    const result = await pool.query(`
      SELECT 
        c.id,
        c.client_code,
        c.routing_plan_id,
        c.rate_plan_id,
        rp.plan_name,
        rp.route_ids
      FROM clients c
      LEFT JOIN route_plans rp ON c.routing_plan_id = rp.id
      WHERE c.id = $1 AND c.status = 'active'
    `, [clientId]);
    
    return result.rows[0];
  }

  // Get best route for destination
  async getRoute(routeIds, mcc, mnc) {
    if (!routeIds || routeIds.length === 0) {
      return null;
    }
    
    // Get all routes in the plan (including voice_otp_config_id)
    const routesResult = await pool.query(`
      SELECT 
        r.id,
        r.route_name,
        r.route_method,
        r.trunk_ids,
        r.is_active,
        r.voice_otp_config_id
      FROM routes r
      WHERE r.id = ANY($1) AND r.is_active = true
    `, [routeIds]);
    
    if (routesResult.rows.length === 0) {
      return null;
    }
    
    // For each route, find matching trunk
    for (const route of routesResult.rows) {
      const trunk = await this.getTrunk(route.trunk_ids, mcc, mnc);
      if (trunk) {
        return { route, trunk };
      }
    }
    
    return null;
  }

  // Get best trunk for destination
  async getTrunk(trunkIds, mcc, mnc) {
    if (!trunkIds || trunkIds.length === 0) {
      return null;
    }
    
    // Get all trunks (including voice_otp_config_id from trunk and supplier)
    const trunksResult = await pool.query(`
      SELECT 
        t.id,
        t.trunk_name,
        t.trunk_type,
        t.supplier_id,
        t.priority,
        t.percentage,
        t.mccmnc_allowed,
        t.voice_otp_config_id AS trunk_voice_otp_config_id,
        s.supplier_code,
        s.company_name,
        s.voice_otp_config_id AS supplier_voice_otp_config_id
      FROM trunks t
      JOIN suppliers s ON t.supplier_id = s.id
      WHERE t.id = ANY($1) AND t.is_active = true
      ORDER BY t.priority ASC
    `, [trunkIds]);
    
    // Find trunk that matches MCC pattern
    for (const trunk of trunksResult.rows) {
      const allowed = trunk.mccmnc_allowed || ['*'];
      const matches = allowed.some(pattern => {
        if (pattern === '*') return true;
        if (pattern.endsWith('*')) {
          const prefix = pattern.slice(0, -1);
          return mcc.startsWith(prefix);
        }
        return pattern === mcc;
      });
      
      if (matches) {
        return trunk;
      }
    }
    
    // Return first trunk if no match found
    return trunksResult.rows[0] || null;
  }

  // Get rates for client and supplier — matches by MNC first, falls back to MCC, picks lowest
  async getRates(clientId, supplierId, mcc, mnc) {
    // Priority: exact MNC match → MCC wildcard MNC → MCC only → global fallback
    // Picks the LOWEST matching rate (most favorable to client)
    const rateQuery = (entityType, entityId) => pool.query(`
      SELECT rate, currency, mnc
      FROM rates 
      WHERE entity_type = $1 
        AND entity_id = $2 
        AND (mcc = $3 OR mcc = '*')
        AND is_active = true 
      ORDER BY 
        CASE WHEN mnc = $4 THEN 0 WHEN mnc = '*' THEN 1 ELSE 2 END,
        rate ASC
      LIMIT 1
    `, [entityType, entityId, mcc, mnc]);
    
    const [clientRate, supplierRate] = await Promise.all([
      rateQuery('client', clientId),
      rateQuery('supplier', supplierId)
    ]);
    
    return {
      clientRate: clientRate.rows[0]?.rate || 0.05,
      supplierRate: supplierRate.rows[0]?.rate || 0.002,
      currency: clientRate.rows[0]?.currency || 'USD'
    };
  }

  // Get supplier API connector
  async getSupplierConnector(supplierId) {
    const result = await pool.query(`
      SELECT 
        s.id,
        s.supplier_code,
        s.connection_type,
        ac.id as connector_id,
        ac.name as connector_name,
        ac.api_key,
        ac.send_url,
        ac.params,
        ac.http_method
      FROM suppliers s
      LEFT JOIN api_connectors ac ON ac.name = s.company_name
      WHERE s.id = $1 AND s.status = 'active'
    `, [supplierId]);
    
    return result.rows[0];
  }

  // Main routing function
  async routeSms(clientId, destination, message, senderId) {
    // 1. Get MCC/MNC from destination (resolves real MNC from mccmnc table)
    const { mcc, mnc } = await this.getMccMnc(destination);
    console.log(`[Router] MCC: ${mcc}, MNC: ${mnc}`);
    
    // 2. Get client routing configuration
    const clientRouting = await this.getClientRouting(clientId);
    if (!clientRouting) {
      throw new Error('Client not found or inactive');
    }
    console.log(`[Router] Client: ${clientRouting.client_code}, Plan: ${clientRouting.plan_name}`);
    
    // 3. Get route based on route plan
    const routing = await this.getRoute(clientRouting.route_ids, mcc, mnc);
    if (!routing) {
      throw new Error('No route found for destination');
    }
    console.log(`[Router] Route: ${routing.route.route_name}, Trunk: ${routing.trunk.trunk_name}`);
    
    // 4. Get rates
    const rates = await this.getRates(clientId, routing.trunk.supplier_id, mcc, mnc);
    console.log(`[Router] Client Rate: ${rates.clientRate}, Supplier Rate: ${rates.supplierRate}`);
    
    // 5. Get supplier connector
    const connector = await this.getSupplierConnector(routing.trunk.supplier_id);
    
    return {
      routing,
      rates,
      connector,
      mcc,
      mnc,
      // Voice OTP config resolution priority: route > trunk > supplier > null (auto-resolve)
      voiceOtpConfigId: routing.route.voice_otp_config_id
        || routing.trunk.trunk_voice_otp_config_id
        || routing.trunk.supplier_voice_otp_config_id
        || null,
    };
  }
}

export default new DynamicRouter();
