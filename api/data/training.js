import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    if (req.method === 'POST') {
      const { input, output, category, quality_score = 3.0 } = req.body;
      
      const { data } = await supabase
        .from('training_data')
        .insert({
          user_id: userId,
          input,
          output,
          category,
          quality_score
        })
        .select()
        .single();

      return res.json({ success: true, data });
    }

    if (req.method === 'GET') {
      const { data } = await supabase
        .from('training_data')
        .select('*')
        .eq('user_id', userId);

      return res.json({
        data: data || [],
        statistics: { total: data?.length || 0, high_quality: 0 }
      });
    }

  } catch (error) {
    res.status(500).json({ error: 'Request failed' });
  }
}