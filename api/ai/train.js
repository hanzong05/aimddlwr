// api/ai/train.js
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
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

    if (req.method === 'POST') {
      return await startTraining(req, res, userId);
    } else if (req.method === 'GET') {
      return await getTrainingStatus(req, res, userId);
    }

  } catch (error) {
    console.error('Training error:', error);
    res.status(500).json({ error: 'Training request failed' });
  }
}

async function startTraining(req, res, userId) {
  const { 
    epochs = 5, 
    learningRate = 0.001, 
    batchSize = 16,
    modelName = `Custom Model ${Date.now()}`
  } = req.body;

  // Get training data
  const { data: trainingData, error: dataError } = await supabase
    .from('training_data')
    .select('*')
    .eq('user_id', userId)
    .eq('used_in_training', false)
    .gte('quality_score', 3.0)
    .order('created_at', { ascending: false })
    .limit(1000); // Limit for safety

  if (dataError) throw dataError;

  if (!trainingData || trainingData.length < 5) {
    return res.status(400).json({ 
      error: 'Need at least 5 quality training examples',
      currentCount: trainingData?.length || 0
    });
  }

  // Check for existing active training job
  const { data: existingJob } = await supabase
    .from('training_jobs')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['pending', 'running'])
    .single();

  if (existingJob) {
    return res.status(400).json({ 
      error: 'Training job already in progress',
      jobId: existingJob.id 
    });
  }

  // Create training job
  const { data: job, error: jobError } = await supabase
    .from('training_jobs')
    .insert({
      user_id: userId,
      status: 'pending',
      training_data_count: trainingData.length,
      epochs,
      batch_size: batchSize,
      learning_rate: learningRate,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (jobError) throw jobError;

  // Start training process (async)
  setImmediate(() => processTraining(job.id, userId, trainingData, modelName));

  res.json({
    success: true,
    jobId: job.id,
    trainingDataCount: trainingData.length,
    status: 'started'
  });
}

async function getTrainingStatus(req, res, userId) {
  const { jobId } = req.query;

  if (jobId) {
    // Get specific job
    const { data: job, error } = await supabase
      .from('training_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    return res.json(job);
  } else {
    // Get all jobs for user
    const { data: jobs, error } = await supabase
      .from('training_jobs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    return res.json(jobs);
  }
}

// Training process simulation (replace with actual ML training)
async function processTraining(jobId, userId, trainingData, modelName) {
  try {
    console.log(`Starting training job ${jobId} with ${trainingData.length} examples`);

    // Update job status to running
    await supabase
      .from('training_jobs')
      .update({ 
        status: 'running',
        started_at: new Date().toISOString()
      })
      .eq('id', jobId);

    // Simulate training epochs
    const totalEpochs = 5;
    for (let epoch = 1; epoch <= totalEpochs; epoch++) {
      // Simulate training time
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Calculate simulated metrics
      const progress = (epoch / totalEpochs) * 100;
      const loss = Math.max(0.1, 2.5 - (epoch * 0.4) + (Math.random() * 0.2));
      const accuracy = Math.min(0.95, 0.3 + (epoch * 0.15) + (Math.random() * 0.1));

      // Update progress
      await supabase
        .from('training_jobs')
        .update({
          current_epoch: epoch,
          progress_percentage: progress,
          loss_value: loss,
          accuracy_value: accuracy
        })
        .eq('id', jobId);

      console.log(`Job ${jobId} - Epoch ${epoch}/${totalEpochs}, Loss: ${loss.toFixed(4)}, Accuracy: ${accuracy.toFixed(4)}`);
    }

    // Create the trained model
    const { data: model, error: modelError } = await supabase
      .from('models')
      .insert({
        user_id: userId,
        name: modelName,
        status: 'trained',
        model_type: 'text_generation',
        accuracy: 0.85 + Math.random() * 0.1,
        training_examples: trainingData.length,
        training_duration_seconds: totalEpochs * 3,
        performance_metrics: {
          final_loss: 0.15,
          final_accuracy: 0.87,
          training_epochs: totalEpochs,
          samples_processed: trainingData.length
        },
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (modelError) throw modelError;

    // Complete training job
    await supabase
      .from('training_jobs')
      .update({
        status: 'completed',
        model_id: model.id,
        completed_at: new Date().toISOString(),
        progress_percentage: 100
      })
      .eq('id', jobId);

    // Mark training data as used
    const trainingIds = trainingData.map(td => td.id);
    await supabase
      .from('training_data')
      .update({ 
        used_in_training: true,
        training_batch_id: jobId
      })
      .in('id', trainingIds);

    console.log(`Training job ${jobId} completed successfully. Model ${model.id} created.`);

  } catch (error) {
    console.error(`Training job ${jobId} failed:`, error);
    
    await supabase
      .from('training_jobs')
      .update({
        status: 'failed',
        error_message: error.message,
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);
  }
}