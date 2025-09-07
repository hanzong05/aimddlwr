// api/data/training.js
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
        return await getTrainingData(req, res, userId);
      case 'POST':
        return await addTrainingData(req, res, userId);
      case 'PUT':
        return await updateTrainingData(req, res, userId);
      case 'DELETE':
        return await deleteTrainingData(req, res, userId);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Training data error:', error);
    res.status(500).json({ error: 'Training data request failed' });
  }
}

async function getTrainingData(req, res, userId) {
  const { 
    page = 1, 
    limit = 50, 
    category, 
    used_in_training,
    min_quality = 0 
  } = req.query;

  let query = supabase
    .from('training_data')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .gte('quality_score', min_quality)
    .order('created_at', { ascending: false });

  if (category) {
    query = query.eq('category', category);
  }

  if (used_in_training !== undefined) {
    query = query.eq('used_in_training', used_in_training === 'true');
  }

  const offset = (page - 1) * limit;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) throw error;

  // Get stats
  const { data: stats } = await supabase
    .from('training_data')
    .select('quality_score, used_in_training, category')
    .eq('user_id', userId);

  const statistics = {
    total: count,
    used_in_training: stats?.filter(s => s.used_in_training).length || 0,
    unused: stats?.filter(s => !s.used_in_training).length || 0,
    high_quality: stats?.filter(s => s.quality_score >= 4).length || 0,
    categories: [...new Set(stats?.map(s => s.category).filter(Boolean))]
  };

  res.json({
    data,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: count,
      pages: Math.ceil(count / limit)
    },
    statistics
  });
}

async function addTrainingData(req, res, userId) {
  const { input, output, category, quality_score = 3.0, tags = [] } = req.body;

  if (!input || !output) {
    return res.status(400).json({ error: 'Input and output are required' });
  }

  if (input.length < 3 || output.length < 3) {
    return res.status(400).json({ error: 'Input and output must be at least 3 characters' });
  }

  const { data, error } = await supabase
    .from('training_data')
    .insert({
      user_id: userId,
      input: input.trim(),
      output: output.trim(),
      category: category || null,
      quality_score: Math.max(1, Math.min(5, quality_score)),
      tags: Array.isArray(tags) ? tags : [],
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;

  res.json({
    success: true,
    data,
    message: 'Training example added successfully'
  });
}

async function updateTrainingData(req, res, userId) {
  const { id, input, output, category, quality_score, tags, feedback } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Training data ID required' });
  }

  const updates = { updated_at: new Date().toISOString() };
  
  if (input !== undefined) updates.input = input.trim();
  if (output !== undefined) updates.output = output.trim();
  if (category !== undefined) updates.category = category;
  if (quality_score !== undefined) updates.quality_score = Math.max(1, Math.min(5, quality_score));
  if (tags !== undefined) updates.tags = Array.isArray(tags) ? tags : [];
  if (feedback !== undefined) updates.feedback = Math.max(1, Math.min(5, feedback));

  const { data, error } = await supabase
    .from('training_data')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;

  res.json({
    success: true,
    data,
    message: 'Training example updated successfully'
  });
}

async function deleteTrainingData(req, res, userId) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Training data ID required' });
  }

  // Check if this data was used in training
  const { data: trainingData, error: checkError } = await supabase
    .from('training_data')
    .select('used_in_training')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (checkError) throw checkError;

  if (trainingData.used_in_training) {
    return res.status(400).json({ 
      error: 'Cannot delete training data that has been used in model training' 
    });
  }

  const { error } = await supabase
    .from('training_data')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;

  res.json({
    success: true,
    message: 'Training example deleted successfully'
  });
}