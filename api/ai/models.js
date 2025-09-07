// api/ai/models.js
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
        return await getModels(req, res, userId);
      case 'POST':
        return await activateModel(req, res, userId);
      case 'PUT':
        return await updateModel(req, res, userId);
      case 'DELETE':
        return await deleteModel(req, res, userId);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Model management error:', error);
    res.status(500).json({ error: 'Model request failed' });
  }
}

async function getModels(req, res, userId) {
  const { data: models, error } = await supabase
    .from('models')
    .select(`
      *,
      training_jobs(
        status,
        progress_percentage,
        completed_at
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Add training data count for each model
  const modelsWithStats = await Promise.all(
    models.map(async (model) => {
      const { count } = await supabase
        .from('training_data')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('used_in_training', true);

      return {
        ...model,
        training_data_used: count || 0
      };
    })
  );

  res.json(modelsWithStats);
}

async function activateModel(req, res, userId) {
  const { modelId } = req.body;

  if (!modelId) {
    return res.status(400).json({ error: 'Model ID required' });
  }

  // Verify model belongs to user
  const { data: model, error: modelError } = await supabase
    .from('models')
    .select('*')
    .eq('id', modelId)
    .eq('user_id', userId)
    .single();

  if (modelError || !model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  if (model.status !== 'trained') {
    return res.status(400).json({ error: 'Model must be trained before activation' });
  }

  // Deactivate all other models for this user
  await supabase
    .from('models')
    .update({ is_active: false })
    .eq('user_id', userId);

  // Activate the selected model
  const { data: updatedModel, error: updateError } = await supabase
    .from('models')
    .update({ 
      is_active: true,
      status: 'deployed',
      updated_at: new Date().toISOString()
    })
    .eq('id', modelId)
    .select()
    .single();

  if (updateError) throw updateError;

  res.json({
    success: true,
    message: 'Model activated successfully',
    model: updatedModel
  });
}

async function updateModel(req, res, userId) {
  const { modelId, name, description } = req.body;

  if (!modelId) {
    return res.status(400).json({ error: 'Model ID required' });
  }

  const updates = {};
  if (name) updates.name = name;
  if (description) updates.description = description;
  updates.updated_at = new Date().toISOString();

  const { data: model, error } = await supabase
    .from('models')
    .update(updates)
    .eq('id', modelId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;

  res.json({
    success: true,
    model
  });
}

async function deleteModel(req, res, userId) {
  const { modelId } = req.query;

  if (!modelId) {
    return res.status(400).json({ error: 'Model ID required' });
  }

  // Check if model is currently active
  const { data: model, error: checkError } = await supabase
    .from('models')
    .select('is_active')
    .eq('id', modelId)
    .eq('user_id', userId)
    .single();

  if (checkError) throw checkError;

  if (model.is_active) {
    return res.status(400).json({ 
      error: 'Cannot delete active model. Please activate another model first.' 
    });
  }

  // Archive the model instead of deleting
  const { error: deleteError } = await supabase
    .from('models')
    .update({ 
      status: 'archived',
      updated_at: new Date().toISOString()
    })
    .eq('id', modelId)
    .eq('user_id', userId);

  if (deleteError) throw deleteError;

  res.json({
    success: true,
    message: 'Model archived successfully'
  });
}