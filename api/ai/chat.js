import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify auth
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        error: 'Missing authorization header' 
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const { message, conversationId } = req.body;

    if (!message) {
      return res.status(400).json({ 
        success: false, 
        error: 'Message required' 
      });
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

    res.status(200).json({
      success: true,
      response: aiResponse,
      conversationId: conversation.id,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process message' 
    });
  }
}

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
    // Use trained model - simulate enhanced responses based on training
    return await generateTrainedResponse(activeModel, message);
  } else {
    // Use default AI responses
    return await generateDefaultResponse(message);
  }
}

async function generateTrainedResponse(model, message) {
  // Get some training examples for context
  const { data: examples } = await supabase
    .from('training_data')
    .select('input, output')
    .eq('user_id', model.user_id)
    .eq('used_in_training', true)
    .limit(5);

  // Simple similarity matching (in production, use vector embeddings)
  const lowerMessage = message.toLowerCase();
  const bestMatch = examples?.find(ex => 
    ex.input.toLowerCase().includes(lowerMessage.substring(0, 20)) ||
    lowerMessage.includes(ex.input.toLowerCase().substring(0, 20))
  );

  if (bestMatch) {
    // Return a variation of the trained response
    return `Based on my training: ${bestMatch.output}`;
  }

  // Enhanced default response indicating it's from trained model
  const enhancedResponses = [
    `Using my custom training, I'd say: ${await generateDefaultResponse(message)}`,
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