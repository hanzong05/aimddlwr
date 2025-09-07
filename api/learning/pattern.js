// api/learning/patterns.js
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Verify auth
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    switch (req.method) {
      case 'GET':
        return await getPatterns(req, res, userId);
      case 'POST':
        return await createPattern(req, res, userId);
      case 'PUT':
        return await updatePattern(req, res, userId);
      case 'DELETE':
        return await deletePattern(req, res, userId);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Patterns error:', error);
    res.status(500).json({ error: 'Request failed' });
  }
}

async function getPatterns(req, res, userId) {
  const { 
    limit = 20, 
    offset = 0, 
    category, 
    min_confidence = 0,
    sort = 'confidence'
  } = req.query;

  let query = supabase
    .from('learning_patterns')
    .select('*')
    .eq('user_id', userId)
    .gte('confidence', min_confidence)
    .order(sort, { ascending: false })
    .range(offset, offset + limit - 1);

  if (category) {
    query = query.eq('category', category);
  }

  const { data: patterns, error } = await query;

  if (error) throw error;

  res.json(patterns || []);
}

async function createPattern(req, res, userId) {
  const { input_pattern, response_pattern, category, confidence = 0.5 } = req.body;

  if (!input_pattern || !response_pattern) {
    return res.status(400).json({ error: 'Input and response patterns required' });
  }

  const { data, error } = await supabase
    .from('learning_patterns')
    .insert({
      user_id: userId,
      input_pattern,
      response_pattern,
      category,
      confidence,
      use_count: 1
    })
    .select()
    .single();

  if (error) throw error;

  res.json({ success: true, pattern: data });
}

async function updatePattern(req, res, userId) {
  const { id, confidence, response_pattern, category } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Pattern ID required' });
  }

  const updates = { updated_at: new Date().toISOString() };
  if (confidence !== undefined) updates.confidence = confidence;
  if (response_pattern) updates.response_pattern = response_pattern;
  if (category) updates.category = category;

  const { data, error } = await supabase
    .from('learning_patterns')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;

  res.json({ success: true, pattern: data });
}

async function deletePattern(req, res, userId) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Pattern ID required' });
  }

  const { error } = await supabase
    .from('learning_patterns')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;

  res.json({ success: true });
}
