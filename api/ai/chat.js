// api/ai/chat.js - Improved version with better context understanding
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
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const { message, conversationId } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log('Processing chat request:', { userId, message, conversationId });

    // Get conversation context
    let conversation;
    let conversationHistory = [];
    
    if (conversationId) {
      const { data: existingConv } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .single();
      conversation = existingConv;

      // Get recent conversation history for context
      if (conversation) {
        const { data: history } = await supabase
          .from('messages')
          .select('type, content')
          .eq('conversation_id', conversationId)
          .order('timestamp', { ascending: false })
          .limit(10);
        
        conversationHistory = history ? history.reverse() : [];
      }
    }

    if (!conversation) {
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          user_id: userId,
          title: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (convError) {
        console.error('Conversation creation error:', convError);
        throw convError;
      }
      conversation = newConv;
    }

    // Save user message
    const { error: userMsgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        type: 'user',
        content: message,
        timestamp: new Date().toISOString()
      });

    if (userMsgError) {
      console.error('User message save error:', userMsgError);
      throw userMsgError;
    }

    // Generate AI response with context
    const aiResponse = await generateAIResponse(message, userId, conversationHistory);

    // Save AI message
    const { data: aiMessage, error: aiMsgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        type: 'assistant',
        content: aiResponse.content,
        metadata: {
          confidence: aiResponse.confidence,
          source: aiResponse.source
        },
        timestamp: new Date().toISOString()
      })
      .select()
      .single();

    if (aiMsgError) {
      console.error('AI message save error:', aiMsgError);
      throw aiMsgError;
    }

    // Store as training data if good quality
    if (aiResponse.confidence > 0.6) {
      await supabase
        .from('training_data')
        .insert({
          user_id: userId,
          input: message,
          output: aiResponse.content,
          quality_score: Math.min(5, aiResponse.confidence * 5),
          category: aiResponse.category || 'general'
        });
    }

    console.log('Chat response generated successfully');

    res.json({
      response: aiResponse.content,
      conversationId: conversation.id,
      messageId: aiMessage.id,
      confidence: aiResponse.confidence,
      source: aiResponse.source,
      learned: aiResponse.learned
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: 'Chat request failed',
      details: error.message 
    });
  }
}

// Improved AI response generator with better context understanding
async function generateAIResponse(message, userId, conversationHistory = []) {
  try {
    console.log('Generating AI response for:', message);

    // Check for learned patterns first
    const { data: patterns } = await supabase
      .from('learning_patterns')
      .select('*')
      .eq('user_id', userId)
      .ilike('input_pattern', `%${message.toLowerCase()}%`)
      .order('confidence', { ascending: false })
      .limit(1);

    if (patterns && patterns.length > 0) {
      const pattern = patterns[0];
      // Update usage count
      await supabase
        .from('learning_patterns')
        .update({ 
          use_count: pattern.use_count + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', pattern.id);

      console.log('Using learned pattern');
      return {
        content: pattern.response_pattern,
        confidence: pattern.confidence,
        source: 'learned_pattern',
        learned: false,
        category: pattern.category
      };
    }

    // Try OpenAI if available
    if (process.env.OPENAI_API_KEY) {
      try {
        console.log('Calling OpenAI API');
        
        // Build context-aware messages
        const messages = [
          { 
            role: 'system', 
            content: 'You are a helpful, friendly AI assistant. Be conversational and remember context from the conversation. When someone introduces themselves, acknowledge their name warmly.' 
          }
        ];

        // Add conversation history for context
        conversationHistory.slice(-6).forEach(msg => {
          messages.push({
            role: msg.type === 'user' ? 'user' : 'assistant',
            content: msg.content
          });
        });

        // Add current message
        messages.push({ role: 'user', content: message });

        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: messages,
            max_tokens: 500,
            temperature: 0.7,
          }),
        });

        if (openaiResponse.ok) {
          const data = await openaiResponse.json();
          const response = data.choices[0].message.content;

          // Store as learning pattern
          await supabase
            .from('learning_patterns')
            .insert({
              user_id: userId,
              input_pattern: message.toLowerCase(),
              response_pattern: response,
              confidence: 0.8,
              category: detectCategory(message),
              use_count: 1
            });

          console.log('OpenAI response generated and stored');
          return {
            content: response,
            confidence: 0.8,
            source: 'external_ai',
            learned: true,
            category: detectCategory(message)
          };
        } else {
          console.error('OpenAI API error:', await openaiResponse.text());
        }
      } catch (openaiError) {
        console.error('OpenAI request failed:', openaiError);
      }
    }

    // Improved fallback responses with better context awareness
    const response = generateContextualFallback(message, conversationHistory);

    console.log('Using improved fallback response');
    return {
      content: response.content,
      confidence: response.confidence,
      source: 'fallback',
      learned: false,
      category: response.category
    };

  } catch (error) {
    console.error('AI generation error:', error);
    return {
      content: "I'm having trouble processing your request right now. Please try again in a moment.",
      confidence: 0.1,
      source: 'error',
      learned: false,
      category: 'error'
    };
  }
}

function generateContextualFallback(message, conversationHistory) {
  const msg = message.toLowerCase().trim();
  
  // Check if this looks like an introduction or name mention
  if (isIntroduction(msg, conversationHistory)) {
    const name = extractName(msg);
    if (name) {
      return {
        content: `Nice to meet you, ${name}! I'm your AI assistant. How can I help you today?`,
        confidence: 0.7,
        category: 'introduction'
      };
    } else {
      return {
        content: "Nice to meet you! I'm your AI assistant. What's your name, and how can I help you today?",
        confidence: 0.6,
        category: 'introduction'
      };
    }
  }

  // Check if they're correcting/clarifying something from previous messages
  if (isCorrection(msg, conversationHistory)) {
    return {
      content: "I understand, thank you for clarifying! I'll remember that. Is there anything else I can help you with?",
      confidence: 0.6,
      category: 'clarification'
    };
  }

  // Detect category and respond appropriately
  const category = detectCategory(msg);
  
  switch (category) {
    case 'greeting':
      return {
        content: "Hello! I'm your AI assistant. How can I help you today?",
        confidence: 0.7,
        category: 'greeting'
      };
      
    case 'programming':
      return {
        content: `I'd be happy to help you with programming! Could you tell me more specifically what you're working on or what you'd like to know?`,
        confidence: 0.6,
        category: 'programming'
      };
      
    case 'help':
      return {
        content: `I'm here to help! Could you give me more details about what you need assistance with?`,
        confidence: 0.6,
        category: 'help'
      };
      
    default:
      return {
        content: `I'm still learning about many topics. Could you tell me more about what you're looking for? I'd love to help however I can!`,
        confidence: 0.4,
        category: 'general'
      };
  }
}

function isIntroduction(message, conversationHistory) {
  const introPatterns = [
    /^(i'm|im|i am|my name is|call me|this is)\s+\w+/i,
    /^(hi|hello|hey),?\s*(i'm|im|i am|my name is)\s+\w+/i,
    /^(i'm|im|i am)\s+\w+$/i
  ];
  
  // Check if this looks like an introduction
  const looksLikeIntro = introPatterns.some(pattern => pattern.test(message));
  
  // Check if it's early in the conversation (less than 3 messages)
  const isEarlyConversation = conversationHistory.length < 6;
  
  return looksLikeIntro && isEarlyConversation;
}

function extractName(message) {
  const namePatterns = [
    /(?:i'm|im|i am|my name is|call me)\s+(\w+)/i,
    /^(\w+)$/i
  ];
  
  for (const pattern of namePatterns) {
    const match = message.match(pattern);
    if (match && match[1] && match[1].length > 1) {
      return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    }
  }
  return null;
}

function isCorrection(message, conversationHistory) {
  const correctionPatterns = [
    /^no,?\s+/i,
    /^that's (not|wrong)/i,
    /^(actually|no)\s+/i,
    /^that'?s my/i
  ];
  
  const hasRecentBotMessage = conversationHistory.length > 0 && 
    conversationHistory[conversationHistory.length - 1]?.type === 'assistant';
  
  return correctionPatterns.some(pattern => pattern.test(message)) && hasRecentBotMessage;
}

function detectCategory(message) {
  const msg = message.toLowerCase();
  
  if (msg.includes('code') || msg.includes('programming') || msg.includes('javascript') || 
      msg.includes('react') || msg.includes('python') || msg.includes('function') || 
      msg.includes('variable') || msg.includes('debug') || msg.includes('html') || 
      msg.includes('css') || msg.includes('api')) {
    return 'programming';
  }
  
  if (msg.includes('hello') || msg.includes('hi') || msg.includes('hey') || 
      msg.includes('good morning') || msg.includes('good afternoon') || 
      msg.includes('good evening') || msg.startsWith('sup')) {
    return 'greeting';
  }
  
  if (msg.includes('help') || msg.includes('how') || msg.includes('what') || 
      msg.includes('explain') || msg.includes('tell me') || msg.includes('show me') ||
      msg.includes('can you') || msg.includes('could you')) {
    return 'help';
  }
  
  return 'general';
}