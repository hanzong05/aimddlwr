// api/ai/brain-chat.js - Brain-Enhanced Chat System
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    if (req.method === 'POST') {
      return await processBrainChat(req, res, userId);
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Brain chat error:', error);
    res.status(500).json({ error: 'Brain chat request failed' });
  }
}

async function processBrainChat(req, res, userId) {
  const { 
    message,
    useMemory = true,
    useTrainingData = true,
    modelId = null,
    maxTokens = 500,
    temperature = 0.7
  } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    let enhancedContext = '';
    let memoryCount = 0;
    let trainingCount = 0;

    // 1. Retrieve relevant memories/training data
    if (useMemory || useTrainingData) {
      const contextData = await retrieveRelevantContext(userId, message, useMemory, useTrainingData);
      enhancedContext = contextData.context;
      memoryCount = contextData.memoryCount;
      trainingCount = contextData.trainingCount;
    }

    // 2. Get user's trained model if specified
    let selectedModel = null;
    if (modelId) {
      const { data: model } = await supabase
        .from('models')
        .select('*')
        .eq('id', modelId)
        .eq('user_id', userId)
        .single();
      
      selectedModel = model;
    }

    // 3. Generate response using brain-enhanced context
    const response = await generateBrainResponse(message, enhancedContext, selectedModel, {
      maxTokens,
      temperature
    });

    // 4. Store conversation for future learning
    await storeConversation(userId, message, response, {
      modelId: selectedModel?.id,
      memoryCount,
      trainingCount,
      enhancedContext: enhancedContext.length > 0
    });

    res.json({
      success: true,
      response: response,
      metadata: {
        model_used: selectedModel?.name || 'Base AI',
        memory_references: memoryCount,
        training_references: trainingCount,
        enhanced_with_context: enhancedContext.length > 0,
        response_length: response.length
      }
    });

  } catch (error) {
    console.error('Brain chat processing failed:', error);
    res.status(500).json({ error: 'Failed to process brain chat' });
  }
}

async function retrieveRelevantContext(userId, message, useMemory, useTrainingData) {
  let context = '';
  let memoryCount = 0;
  let trainingCount = 0;

  try {
    // Search memories (with fallback to training data)
    if (useMemory) {
      try {
        const { data: memories } = await supabase
          .from('brain_memories')
          .select('content, summary, importance')
          .eq('user_id', userId)
          .or(`content.ilike.%${message}%,summary.ilike.%${message}%`)
          .gte('importance', 0.3)
          .order('importance', { ascending: false })
          .limit(3);

        if (memories && memories.length > 0) {
          memoryCount = memories.length;
          context += memories.map(m => `Memory: ${m.summary} - ${m.content.substring(0, 200)}`).join('\n');
        }
      } catch (memoryError) {
        console.log('Brain memories not available, using training data');
        useTrainingData = true; // Force fallback
      }
    }

    // Search training data
    if (useTrainingData) {
      const { data: trainingData } = await supabase
        .from('training_data')
        .select('input, output, category, quality_score')
        .eq('user_id', userId)
        .or(`input.ilike.%${message}%,output.ilike.%${message}%`)
        .gte('quality_score', 3.0)
        .order('quality_score', { ascending: false })
        .limit(5);

      if (trainingData && trainingData.length > 0) {
        trainingCount = trainingData.length;
        if (context) context += '\n\n';
        context += trainingData.map(t => `Training: Q: ${t.input} A: ${t.output.substring(0, 300)}`).join('\n');
      }
    }

  } catch (error) {
    console.error('Error retrieving context:', error);
  }

  return { context, memoryCount, trainingCount };
}

async function generateBrainResponse(message, context, model, options) {
  // Simulate AI response generation (you would integrate with actual AI APIs here)
  let response = '';
  
  if (context) {
    // Enhanced response with context
    response = `Based on your previous data and training: `;
    
    // Analyze the context to provide relevant response
    if (context.includes('javascript') || context.includes('react') || context.includes('node')) {
      response += `For this JavaScript/React question: "${message}", here's what I found from your training data:\n\n`;
      response += `From your learned patterns, this appears to be about ${extractTopics(message, context)}. `;
      response += generateContextualAnswer(message, context, model);
    } else {
      response += generateContextualAnswer(message, context, model);
    }
  } else {
    // Base response without context
    response = generateBaseResponse(message, model);
  }

  return response;
}

function extractTopics(message, context) {
  const topics = [];
  const keywords = ['javascript', 'react', 'node', 'python', 'css', 'html', 'api', 'database'];
  
  keywords.forEach(keyword => {
    if (message.toLowerCase().includes(keyword) || context.toLowerCase().includes(keyword)) {
      topics.push(keyword);
    }
  });
  
  return topics.length > 0 ? topics.join(', ') : 'programming';
}

function generateContextualAnswer(message, context, model) {
  // Simulate intelligent response based on context
  const specialization = model?.specialization || 'general';
  
  let answer = `Using your ${specialization} specialized model, I can help you with this. `;
  
  if (context.includes('function') || context.includes('const ') || context.includes('=>')) {
    answer += `Based on your training data, this looks like a code-related question. Here's a solution:\n\n`;
    answer += `\`\`\`javascript\n// Example based on your learned patterns\nfunction handleRequest() {\n  // Implementation here\n}\n\`\`\`\n\n`;
    answer += `This approach follows the patterns from your training data.`;
  } else {
    answer += `From your knowledge base, I understand you're asking about ${message}. `;
    answer += `Based on similar questions in your training data, here's my response: `;
    answer += `This is a comprehensive answer that incorporates your learned information.`;
  }
  
  return answer;
}

function generateBaseResponse(message, model) {
  const specialization = model?.specialization || 'general';
  
  return `Hello! I'm your AI assistant with ${specialization} specialization. ` +
         `Regarding "${message}", I'd be happy to help. ` +
         `Since this is a base response without specific training context, ` +
         `I recommend training me with more relevant data for better responses.`;
}

async function storeConversation(userId, message, response, metadata) {
  try {
    // Try to store in conversations table
    await supabase
      .from('conversations')
      .insert({
        user_id: userId,
        message: message,
        response: response,
        metadata: metadata,
        created_at: new Date().toISOString()
      });
  } catch (error) {
    // If conversations table doesn't exist, store as training data
    try {
      await supabase
        .from('training_data')
        .insert({
          user_id: userId,
          input: message,
          output: response,
          category: 'conversation',
          quality_score: 3.5,
          tags: ['chat', 'conversation'],
          metadata: {
            ...metadata,
            stored_as_conversation: true,
            generated_by_brain_chat: true
          },
          auto_collected: false,
          used_in_training: false,
          created_at: new Date().toISOString()
        });
    } catch (fallbackError) {
      console.error('Could not store conversation:', fallbackError);
    }
  }
}