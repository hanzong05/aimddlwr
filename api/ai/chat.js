// api/ai/chat.js - Complete implementation with best free AI API
import { createClient } from '@supabase/supabase-js';
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

    // Generate AI response with best free API
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

// MAIN AI RESPONSE GENERATOR
async function generateAIResponse(userId, message) {
  // Check for trained model first
  const { data: activeModel } = await supabase
    .from('models')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('status', 'deployed')
    .single();

  if (activeModel) {
    const trainedResponse = await generateEnhancedTrainedResponse(activeModel, message);
    if (trainedResponse && !trainedResponse.includes('I can definitely assist')) {
      return trainedResponse;
    }
  }

  // Use the best free AI API
  return await getBestFreeAIResponse(message, userId);
}

// ENHANCED TRAINED MODEL RESPONSES
async function generateEnhancedTrainedResponse(model, message) {
  const { data: examples } = await supabase
    .from('training_data')
    .select('input, output, category, quality_score, tags')
    .eq('user_id', model.user_id)
    .eq('used_in_training', true)
    .gte('quality_score', 3.0)
    .order('quality_score', { ascending: false })
    .limit(30);

  if (!examples || examples.length === 0) {
    return null;
  }

  // Smart matching algorithm
  const bestMatch = findBestMatch(message, examples);
  
  if (bestMatch.score > 40) {
    return `Based on my training: ${bestMatch.example.output}`;
  } else if (bestMatch.score > 20) {
    return `From my knowledge: ${bestMatch.example.output}`;
  } else {
    const categoryMatch = findCategoryMatch(message, examples);
    if (categoryMatch) {
      return `Based on my ${categoryMatch.category} training: ${categoryMatch.output}`;
    }
  }

  return null;
}

// SMART MATCHING ALGORITHM
function findBestMatch(message, examples) {
  const messageLower = message.toLowerCase();
  const messageWords = extractKeywords(messageLower);
  
  let bestExample = null;
  let bestScore = 0;

  for (const example of examples) {
    const inputLower = example.input.toLowerCase();
    const inputWords = extractKeywords(inputLower);
    
    let score = 0;
    
    // 1. Exact substring matching
    if (messageLower.includes(inputLower.substring(0, Math.min(20, inputLower.length)))) {
      score += 60;
    } else if (inputLower.includes(messageLower.substring(0, Math.min(20, messageLower.length)))) {
      score += 50;
    }
    
    // 2. Keyword overlap
    const commonWords = messageWords.filter(word => inputWords.includes(word));
    const overlapRatio = commonWords.length / Math.max(messageWords.length, inputWords.length);
    score += overlapRatio * 40;
    
    // 3. Important keyword matching
    const importantMatches = commonWords.filter(word => isImportantWord(word));
    score += importantMatches.length * 15;
    
    // 4. Question type matching
    if (isQuestion(message) === isQuestion(example.input)) {
      score += 10;
    }
    
    // 5. Quality bonus
    score += (example.quality_score - 3) * 12;
    
    // 6. Category matching
    if (example.category) {
      const categoryWords = example.category.toLowerCase().split(/\s+/);
      const categoryMatches = messageWords.filter(word => categoryWords.includes(word));
      score += categoryMatches.length * 8;
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestExample = example;
    }
  }

  return { example: bestExample, score: bestScore };
}

function findCategoryMatch(message, examples) {
  const messageLower = message.toLowerCase();
  const categories = {};
  
  examples.forEach(ex => {
    if (ex.category) {
      if (!categories[ex.category]) categories[ex.category] = [];
      categories[ex.category].push(ex);
    }
  });
  
  for (const [category, categoryExamples] of Object.entries(categories)) {
    const categoryWords = category.toLowerCase().split(/\s+/);
    if (categoryWords.some(word => messageLower.includes(word))) {
      const randomExample = categoryExamples[Math.floor(Math.random() * categoryExamples.length)];
      return randomExample;
    }
  }
  
  return null;
}

// BEST FREE AI API INTEGRATION
async function getBestFreeAIResponse(message, userId) {
  // Get conversation context
  const context = await getUserContext(userId);
  
  // Try multiple free models in order of quality
  const responses = await Promise.allSettled([
    tryMicrosoftDialoGPT(message, context),
    tryFacebookBlenderBot(message),
    tryGoogleFlanT5(message),
    tryOpenAIGPT2(message)
  ]);

  // Return the first successful response
  for (const response of responses) {
    if (response.status === 'fulfilled' && response.value) {
      return response.value;
    }
  }

  // Ultimate fallback
  return generateSmartDefault(message);
}

// Model 1: Microsoft DialoGPT (Best for conversations)
async function tryMicrosoftDialoGPT(message, context) {
  if (!process.env.HUGGINGFACE_API_KEY) return null;
  
  try {
    const response = await fetch('https://api-inference.huggingface.co/models/microsoft/DialoGPT-large', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: {
          past_user_inputs: context?.userInputs?.slice(-3) || [],
          generated_responses: context?.botResponses?.slice(-3) || [],
          text: message
        },
        parameters: {
          max_length: 100,
          temperature: 0.7,
          do_sample: true,
          top_p: 0.9
        }
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.generated_text && data.generated_text.length > 5) {
        return data.generated_text.trim();
      }
    }
  } catch (error) {
    console.log('DialoGPT failed:', error.message);
  }
  return null;
}

// Model 2: Facebook BlenderBot
async function tryFacebookBlenderBot(message) {
  if (!process.env.HUGGINGFACE_API_KEY) return null;
  
  try {
    const response = await fetch('https://api-inference.huggingface.co/models/facebook/blenderbot-400M-distill', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: message,
        parameters: {
          max_length: 150,
          temperature: 0.7,
          do_sample: true
        }
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data[0]?.generated_text) {
        const fullText = data[0].generated_text;
        const parts = fullText.split(message);
        return parts[1] ? parts[1].trim() : fullText.trim();
      }
    }
  } catch (error) {
    console.log('BlenderBot failed:', error.message);
  }
  return null;
}

// Model 3: Google Flan-T5
async function tryGoogleFlanT5(message) {
  if (!process.env.HUGGINGFACE_API_KEY) return null;
  
  try {
    const response = await fetch('https://api-inference.huggingface.co/models/google/flan-t5-base', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: `Answer this question helpfully: ${message}`,
        parameters: {
          max_length: 100,
          temperature: 0.7,
          do_sample: true
        }
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data[0]?.generated_text && data[0].generated_text.length > 3) {
        return data[0].generated_text.trim();
      }
    }
  } catch (error) {
    console.log('Flan-T5 failed:', error.message);
  }
  return null;
}

// Model 4: GPT-2 (Reliable fallback)
async function tryOpenAIGPT2(message) {
  if (!process.env.HUGGINGFACE_API_KEY) return null;
  
  try {
    const prompt = `Human: ${message}\nAI: `;
    
    const response = await fetch('https://api-inference.huggingface.co/models/gpt2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_length: prompt.length + 80,
          temperature: 0.8,
          do_sample: true,
          top_p: 0.9,
          stop: ["Human:", "\n\n"]
        }
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data[0]?.generated_text) {
        const fullText = data[0].generated_text;
        const aiResponse = fullText.split('AI: ')[1];
        if (aiResponse && aiResponse.trim().length > 5) {
          return aiResponse.trim().split('\n')[0];
        }
      }
    }
  } catch (error) {
    console.log('GPT-2 failed:', error.message);
  }
  return null;
}

// HELPER FUNCTIONS
async function getUserContext(userId) {
  try {
    const { data: recentConversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('user_id', userId)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .single();

    if (!recentConversation) return null;

    const { data: recentMessages } = await supabase
      .from('messages')
      .select('content, type, timestamp')
      .eq('conversation_id', recentConversation.id)
      .order('timestamp', { ascending: false })
      .limit(6);

    if (!recentMessages || recentMessages.length === 0) return null;

    const userInputs = [];
    const botResponses = [];

    recentMessages.reverse().forEach(msg => {
      if (msg.type === 'user') {
        userInputs.push(msg.content);
      } else if (msg.type === 'assistant') {
        botResponses.push(msg.content);
      }
    });

    return { userInputs, botResponses };
  } catch (error) {
    return null;
  }
}

function extractKeywords(text) {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2)
    .filter(word => !['the', 'and', 'are', 'you', 'for', 'can', 'how', 'what', 'this', 'that', 'with', 'from', 'they', 'have', 'not', 'but', 'all', 'one', 'her', 'his', 'our', 'out', 'day', 'get', 'use', 'man', 'new', 'now', 'way', 'may', 'say', 'each', 'she', 'two', 'how', 'its', 'who', 'oil', 'sit', 'set', 'had', 'let', 'put', 'end', 'why', 'try', 'god', 'six', 'dog', 'eat', 'ago', 'yet', 'cut', 'yes', 'car', 'far', 'sea', 'eye', 'really', 'something', 'think'].includes(word));
}

function isImportantWord(word) {
  const importantCategories = [
    'javascript', 'python', 'react', 'node', 'css', 'html', 'api', 'database', 'server', 'code', 'function', 'component', 'deploy', 'vercel', 'github', 'programming', 'development', 'website', 'application', 'framework', 'library', 'frontend', 'backend', 'machine', 'learning', 'artificial', 'intelligence', 'algorithm', 'data', 'model', 'training', 'neural', 'network'
  ];
  return importantCategories.includes(word) || word.length > 6;
}

function isQuestion(text) {
  const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which', 'can', 'could', 'would', 'should', 'do', 'does', 'did', 'is', 'are', 'was', 'were'];
  const firstWord = text.toLowerCase().split(' ')[0];
  return questionWords.includes(firstWord) || text.includes('?');
}

function generateSmartDefault(message) {
  const messageLower = message.toLowerCase();
  
  // Intent detection
  if (messageLower.includes('hello') || messageLower.includes('hi')) {
    return "Hello! I'm your AI assistant. How can I help you today?";
  }
  
  if (messageLower.includes('how') && messageLower.includes('work')) {
    return "I'd be happy to explain how that works! Could you be more specific about what you'd like to understand?";
  }
  
  if (messageLower.includes('what') && messageLower.includes('is')) {
    return "That's a great question! Let me help you understand that concept better.";
  }
  
  if (messageLower.includes('help') || messageLower.includes('assist')) {
    return "I'm here to help! What specific topic or problem would you like assistance with?";
  }
  
  if (messageLower.includes('code') || messageLower.includes('programming')) {
    return "I can definitely help with programming! What language or specific coding challenge are you working on?";
  }
  
  if (messageLower.includes('thank')) {
    return "You're very welcome! Is there anything else I can help you with?";
  }
  
  // Default smart responses
  const smartDefaults = [
    "That's an interesting question! Could you provide a bit more context so I can give you the best answer?",
    "I'd be happy to help you with that. Can you tell me more about what specifically you're looking for?",
    "Great question! Let me think about the best way to explain this to you.",
    "I understand you're asking about this topic. What particular aspect would you like me to focus on?",
    "That's something I can definitely help with! What's your current level of experience with this?"
  ];
  
  return smartDefaults[Math.floor(Math.random() * smartDefaults.length)];
}

// DATABASE HELPER FUNCTIONS
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
      quality_score: 3.0,
      created_at: new Date().toISOString()
    }]);
}