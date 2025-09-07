// api/ai/chat.js - Replace the existing file with this API endpoint
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

    // Find or create conversation
    let conversation;
    if (conversationId) {
      const { data: existingConv } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .single();
      conversation = existingConv;
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

    // Generate AI response
    const aiResponse = await generateAIResponse(message, userId);

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

// AI response generator
async function generateAIResponse(message, userId) {
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
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ 
              role: 'system', 
              content: 'You are a helpful AI assistant. Be concise and friendly.' 
            }, { 
              role: 'user', 
              content: message 
            }],
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

    // Fallback responses
    const category = detectCategory(message);
    let response;

    if (category === 'greeting') {
      response = "Hello! I'm your AI assistant. How can I help you today?";
    } else if (category === 'programming') {
      response = `I'd be happy to help you with programming! You asked about: "${message}". Could you provide more specific details about what you're trying to accomplish?`;
    } else if (category === 'help') {
      response = `I understand you're looking for help with: "${message}". I'm still learning about this topic. Could you give me more context so I can assist you better?`;
    } else {
      response = `That's an interesting question about: "${message}". I'm building my knowledge on this topic. What specific information would be most helpful for you?`;
    }

    console.log('Using fallback response');
    return {
      content: response,
      confidence: 0.4,
      source: 'fallback',
      learned: false,
      category: category
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

function detectCategory(message) {
  const msg = message.toLowerCase();
  
  if (msg.includes('code') || msg.includes('programming') || msg.includes('javascript') || 
      msg.includes('react') || msg.includes('python') || msg.includes('function') || 
      msg.includes('variable') || msg.includes('debug')) {
    return 'programming';
  }
  if (msg.includes('hello') || msg.includes('hi') || msg.includes('hey') || 
      msg.includes('good morning') || msg.includes('good afternoon')) {
    return 'greeting';
  }
  if (msg.includes('help') || msg.includes('how') || msg.includes('what') || 
      msg.includes('explain') || msg.includes('tell me') || msg.includes('show me')) {
    return 'help';
  }
  
  return 'general';
}