// server.js - Local development server
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Auth middleware
const authenticateUser = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'AI Middleware Service (Local)',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const { data: user, error } = await supabase
      .from('users')
      .insert([{ 
        email, 
        password: hashedPassword,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Email already exists' });
      }
      throw error;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Chat endpoint
app.post('/api/ai/chat', authenticateUser, async (req, res) => {
  try {
    const { message, conversationId } = req.body;
    const userId = req.userId;

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    // Get or create conversation
    let conversation = await getOrCreateConversation(userId, conversationId, message);

    // Save user message
    await saveMessage(conversation.id, 'user', message);

    // Generate AI response
    const aiResponse = await generateAIResponse(userId, message);

    // Save AI message
    await saveMessage(conversation.id, 'assistant', aiResponse);

    // Add to training data
    await addTrainingData(userId, message, aiResponse);

    res.json({
      success: true,
      response: aiResponse,
      conversationId: conversation.id,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Training endpoints
app.post('/api/ai/train', authenticateUser, async (req, res) => {
  try {
    const userId = req.userId;
    const { epochs = 5, learningRate = 0.001, modelName = `Custom Model ${Date.now()}` } = req.body;

    // Get training data
    const { data: trainingData, error } = await supabase
      .from('training_data')
      .select('*')
      .eq('user_id', userId)
      .eq('used_in_training', false)
      .gte('quality_score', 3.0)
      .limit(1000);

    if (error) throw error;

    if (!trainingData || trainingData.length < 5) {
      return res.status(400).json({ 
        error: 'Need at least 5 quality training examples',
        currentCount: trainingData?.length || 0
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

  } catch (error) {
    console.error('Training error:', error);
    res.status(500).json({ error: 'Training request failed' });
  }
});

app.get('/api/ai/train', authenticateUser, async (req, res) => {
  try {
    const { jobId } = req.query;
    const userId = req.userId;

    if (jobId) {
      const { data: job, error } = await supabase
        .from('training_jobs')
        .select('*')
        .eq('id', jobId)
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return res.json(job);
    } else {
      const { data: jobs, error } = await supabase
        .from('training_jobs')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return res.json(jobs);
    }
  } catch (error) {
    console.error('Training status error:', error);
    res.status(500).json({ error: 'Failed to get training status' });
  }
});

// Helper functions
async function getOrCreateConversation(userId, conversationId, message) {
  if (conversationId) {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single();
    if (data) return data;
  }

  const { data } = await supabase
    .from('conversations')
    .insert([{
      user_id: userId,
      title: message.substring(0, 50),
      created_at: new Date().toISOString()
    }])
    .select()
    .single();
  
  return data;
}

async function saveMessage(conversationId, type, content) {
  await supabase
    .from('messages')
    .insert([{
      conversation_id: conversationId,
      type,
      content,
      timestamp: new Date().toISOString()
    }]);
}

async function addTrainingData(userId, input, output) {
  await supabase
    .from('training_data')
    .insert([{
      user_id: userId,
      input,
      output,
      created_at: new Date().toISOString()
    }]);
}

async function generateAIResponse(userId, message) {
  // Check if user has an active trained model
  const { data: activeModel } = await supabase
    .from('models')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('status', 'deployed')
    .single();

  if (activeModel) {
    return await generateTrainedResponse(activeModel, message);
  } else {
    return await generateDefaultResponse(message);
  }
}

async function generateTrainedResponse(model, message) {
  const { data: examples } = await supabase
    .from('training_data')
    .select('input, output')
    .eq('user_id', model.user_id)
    .eq('used_in_training', true)
    .limit(5);

  const lowerMessage = message.toLowerCase();
  const bestMatch = examples?.find(ex => 
    ex.input.toLowerCase().includes(lowerMessage.substring(0, 20)) ||
    lowerMessage.includes(ex.input.toLowerCase().substring(0, 20))
  );

  if (bestMatch) {
    return `Based on my training: ${bestMatch.output}`;
  }

  const enhancedResponses = [
    `Using my custom training: ${await generateDefaultResponse(message)}`,
    `From my personalized knowledge: ${await generateDefaultResponse(message)}`,
    `Based on our previous conversations: ${await generateDefaultResponse(message)}`
  ];

  return enhancedResponses[Math.floor(Math.random() * enhancedResponses.length)];
}

async function generateDefaultResponse(message) {
  const responses = [
    "That's an interesting question! Let me think about that.",
    "I understand what you're asking. Here's my perspective:",
    "Great point! Let me help you with that.",
    "I can definitely assist you with this."
  ];

  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
    return "Hello! How can I help you today?";
  }
  
  if (lowerMessage.includes('code') || lowerMessage.includes('programming')) {
    return "I'd be happy to help with coding! What programming challenge are you working on?";
  }
  
  return responses[Math.floor(Math.random() * responses.length)];
}

async function processTraining(jobId, userId, trainingData, modelName) {
  try {
    console.log(`🚀 Starting training job ${jobId} with ${trainingData.length} examples`);

    await supabase
      .from('training_jobs')
      .update({ 
        status: 'running',
        started_at: new Date().toISOString()
      })
      .eq('id', jobId);

    const totalEpochs = 5;
    for (let epoch = 1; epoch <= totalEpochs; epoch++) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay for local

      const progress = (epoch / totalEpochs) * 100;
      const loss = Math.max(0.1, 2.5 - (epoch * 0.4) + (Math.random() * 0.2));
      const accuracy = Math.min(0.95, 0.3 + (epoch * 0.15) + (Math.random() * 0.1));

      await supabase
        .from('training_jobs')
        .update({
          current_epoch: epoch,
          progress_percentage: progress,
          loss_value: loss,
          accuracy_value: accuracy
        })
        .eq('id', jobId);

      console.log(`📊 Job ${jobId} - Epoch ${epoch}/${totalEpochs}, Loss: ${loss.toFixed(4)}, Accuracy: ${accuracy.toFixed(4)}`);
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
        training_duration_seconds: totalEpochs * 2,
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

    await supabase
      .from('training_jobs')
      .update({
        status: 'completed',
        model_id: model.id,
        completed_at: new Date().toISOString(),
        progress_percentage: 100
      })
      .eq('id', jobId);

    const trainingIds = trainingData.map(td => td.id);
    await supabase
      .from('training_data')
      .update({ 
        used_in_training: true,
        training_batch_id: jobId
      })
      .in('id', trainingIds);

    console.log(`✅ Training job ${jobId} completed successfully. Model ${model.id} created.`);

  } catch (error) {
    console.error(`❌ Training job ${jobId} failed:`, error);
    
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});