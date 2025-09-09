// api/ai/brain-chat.js - Brain-Powered Chat System
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
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const { message, conversationId, useTools = true, useBrainMemory = true } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log('🧠 Processing brain-powered chat request:', { userId, message, conversationId });

    // Get or create conversation
    let conversation = await getOrCreateConversation(userId, conversationId, message);
    
    // Get brain profile and preferences
    const brainProfile = await getBrainProfile(userId);
    const conversationHistory = await getConversationHistory(conversation.id);
    
    // Start brain session if needed
    const sessionId = await startBrainSession(userId, conversation.id);
    
    // Save user message
    await saveMessage(conversation.id, 'user', message);
    
    // Generate brain-powered response
    const aiResponse = await generateBrainResponse({
      message,
      userId,
      conversationHistory,
      brainProfile,
      sessionId,
      useTools,
      useBrainMemory
    });

    // Save AI response
    const aiMessage = await saveMessage(conversation.id, 'assistant', aiResponse.content, {
      confidence: aiResponse.confidence,
      source: aiResponse.source,
      tools_used: aiResponse.toolsUsed,
      memory_references: aiResponse.memoryReferences,
      brain_confidence: aiResponse.brainConfidence
    });

    // Store interaction as memory
    if (useBrainMemory && aiResponse.confidence > 0.7) {
      await storeInteractionMemory(userId, message, aiResponse.content, conversation.id);
    }

    // Update session stats
    await updateBrainSession(sessionId, {
      message_count: 1,
      tools_used: aiResponse.toolsUsed,
      memories_accessed: aiResponse.memoryReferences?.length || 0
    });

    console.log('🎯 Brain-powered response generated successfully');

    res.json({
      response: aiResponse.content,
      conversationId: conversation.id,
      messageId: aiMessage.id,
      confidence: aiResponse.confidence,
      brainConfidence: aiResponse.brainConfidence,
      source: aiResponse.source,
      toolsUsed: aiResponse.toolsUsed,
      memoryReferences: aiResponse.memoryReferences,
      learned: aiResponse.learned,
      sessionId: sessionId
    });

  } catch (error) {
    console.error('Brain chat error:', error);
    res.status(500).json({ 
      error: 'Brain chat request failed',
      details: error.message 
    });
  }
}

// BRAIN RESPONSE GENERATION
async function generateBrainResponse({
  message,
  userId,
  conversationHistory,
  brainProfile,
  sessionId,
  useTools,
  useBrainMemory
}) {
  console.log('🧠 Generating brain-powered response...');

  try {
    // PHASE 1: Memory retrieval
    let relevantMemories = [];
    if (useBrainMemory) {
      relevantMemories = await searchRelevantMemories(userId, message);
      console.log(`🧠 Found ${relevantMemories.length} relevant memories`);
    }

    // PHASE 2: Pattern matching
    const matchedPatterns = await findMatchingPatterns(userId, message);
    console.log(`🧠 Found ${matchedPatterns.length} matching patterns`);

    // PHASE 3: Tool selection and execution
    let toolResults = [];
    if (useTools) {
      const suggestedTools = await suggestTools(message, brainProfile);
      toolResults = await executeSelectedTools(userId, suggestedTools, message);
      console.log(`🔧 Executed ${toolResults.length} tools`);
    }

    // PHASE 4: Context building
    const context = buildResponseContext({
      message,
      conversationHistory,
      brainProfile,
      relevantMemories,
      matchedPatterns,
      toolResults
    });

    // PHASE 5: Response generation
    let response;
    let source = 'brain_generated';
    let confidence = 0.5;
    let brainConfidence = 0.5;

    // Try high-confidence patterns first
    if (matchedPatterns.length > 0 && matchedPatterns[0].confidence > 0.8) {
      response = await generateFromPattern(matchedPatterns[0], context);
      source = 'learned_pattern';
      confidence = matchedPatterns[0].confidence;
      brainConfidence = 0.9;
      
      // Update pattern usage
      await updatePatternUsage(matchedPatterns[0].id);
    }
    // Try OpenAI with brain context
    else if (process.env.OPENAI_API_KEY) {
      response = await generateWithOpenAI(context, brainProfile);
      source = 'openai_brain';
      confidence = 0.85;
      brainConfidence = 0.8;
    }
    // Fallback to brain-enhanced responses
    else {
      response = await generateBrainFallback(context, brainProfile);
      source = 'brain_fallback';
      confidence = 0.6;
      brainConfidence = 0.7;
    }

    // PHASE 6: Response enhancement
    const enhancedResponse = await enhanceResponse({
      response,
      toolResults,
      relevantMemories,
      brainProfile
    });

    // PHASE 7: Learning from interaction
    if (confidence > 0.7) {
      await learnFromInteraction(userId, message, enhancedResponse.content, context);
    }

    return {
      content: enhancedResponse.content,
      confidence,
      brainConfidence,
      source,
      toolsUsed: toolResults.map(tr => tr.toolName),
      memoryReferences: relevantMemories.map(m => m.id),
      learned: confidence > 0.7,
      reasoning: enhancedResponse.reasoning
    };

  } catch (error) {
    console.error('Brain response generation failed:', error);
    
    return {
      content: "I'm having trouble accessing my full brain capabilities right now. Let me help you with a basic response.",
      confidence: 0.3,
      brainConfidence: 0.2,
      source: 'error_fallback',
      toolsUsed: [],
      memoryReferences: [],
      learned: false
    };
  }
}

// MEMORY RETRIEVAL
async function searchRelevantMemories(userId, query) {
  const { data: memories, error } = await supabase
    .from('brain_memories')
    .select('*')
    .eq('user_id', userId)
    .gte('importance', 0.4)
    .or(`content.ilike.%${query}%,summary.ilike.%${query}%`)
    .order('importance', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Memory search failed:', error);
    return [];
  }

  // Update access count
  if (memories.length > 0) {
    const memoryIds = memories.map(m => m.id);
    await supabase
      .from('brain_memories')
      .update({ 
        access_count: supabase.raw('access_count + 1'),
        last_accessed: new Date().toISOString()
      })
      .in('id', memoryIds);
  }

  return memories || [];
}

// PATTERN MATCHING
async function findMatchingPatterns(userId, message) {
  const normalizedMessage = message.toLowerCase().trim();
  
  const { data: patterns, error } = await supabase
    .from('learning_patterns')
    .select('*')
    .eq('user_id', userId)
    .gte('confidence', 0.5)
    .order('confidence', { ascending: false })
    .limit(10);

  if (error) return [];

  // Find patterns that match the input
  const matchingPatterns = patterns.filter(pattern => {
    const inputPattern = pattern.input_pattern.toLowerCase();
    return normalizedMessage.includes(inputPattern) || 
           inputPattern.includes(normalizedMessage.substring(0, 50));
  });

  return matchingPatterns;
}

// TOOL SUGGESTION AND EXECUTION
async function suggestTools(message, brainProfile) {
  const messageLower = message.toLowerCase();
  const suggestedTools = [];

  // Smart tool suggestion based on message content
  if (messageLower.includes('search') || messageLower.includes('find') || messageLower.includes('look up')) {
    suggestedTools.push('web_search');
  }
  
  if (messageLower.includes('calendar') || messageLower.includes('meeting') || messageLower.includes('schedule')) {
    suggestedTools.push('google_calendar');
  }
  
  if (messageLower.includes('sheet') || messageLower.includes('data') || messageLower.includes('spreadsheet')) {
    suggestedTools.push('google_sheets');
  }
  
  if (messageLower.includes('slack') || messageLower.includes('message team')) {
    suggestedTools.push('slack');
  }
  
  if (messageLower.includes('remember') || messageLower.includes('recall') || messageLower.includes('memory')) {
    suggestedTools.push('memory_search');
  }

  return suggestedTools;
}

async function executeSelectedTools(userId, toolNames, message) {
  const results = [];

  for (const toolName of toolNames) {
    try {
      // Get tool configuration
      const { data: tool } = await supabase
        .from('brain_tools')
        .select('*')
        .eq('user_id', userId)
        .eq('tool_name', toolName)
        .eq('is_enabled', true)
        .single();

      if (!tool) continue;

      // Execute tool based on message context
      let result;
      switch (toolName) {
        case 'web_search':
          result = await executeWebSearchTool(message);
          break;
        case 'memory_search':
          result = await executeMemorySearchTool(userId, message);
          break;
        case 'google_calendar':
          result = await executeCalendarTool(message, tool);
          break;
        default:
          continue;
      }

      results.push({
        toolName,
        result,
        success: true
      });

    } catch (error) {
      console.error(`Tool execution failed: ${toolName}`, error);
      results.push({
        toolName,
        error: error.message,
        success: false
      });
    }
  }

  return results;
}

// CONTEXT BUILDING
function buildResponseContext({
  message,
  conversationHistory,
  brainProfile,
  relevantMemories,
  matchedPatterns,
  toolResults
}) {
  return {
    currentMessage: message,
    userProfile: {
      personality: brainProfile.personality_traits,
      interests: brainProfile.interests,
      expertise: brainProfile.expertise_areas,
      communicationStyle: brainProfile.communication_style
    },
    conversationContext: conversationHistory.slice(-6).map(h => ({
      role: h.type === 'user' ? 'user' : 'assistant',
      content: h.content
    })),
    relevantMemories: relevantMemories.map(m => ({
      type: m.type,
      content: m.summary || m.content.substring(0, 200),
      importance: m.importance,
      category: m.category
    })),
    learnedPatterns: matchedPatterns.slice(0, 3),
    toolData: toolResults.filter(tr => tr.success).map(tr => ({
      tool: tr.toolName,
      data: tr.result
    })),
    timestamp: new Date().toISOString()
  };
}

// RESPONSE GENERATION METHODS
async function generateFromPattern(pattern, context) {
  let response = pattern.response_pattern;
  
  // Simple template replacement
  response = response.replace(/\{user_name\}/g, context.userProfile.name || 'there');
  response = response.replace(/\{current_time\}/g, new Date().toLocaleTimeString());
  
  return response;
}

async function generateWithOpenAI(context, brainProfile) {
  const systemPrompt = buildSystemPrompt(brainProfile, context);
  
  const messages = [
    { role: 'system', content: systemPrompt },
    ...context.conversationContext,
    { role: 'user', content: context.currentMessage }
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: messages,
      max_tokens: 500,
      temperature: 0.7,
    }),
  });

  if (response.ok) {
    const data = await response.json();
    return data.choices[0].message.content;
  }
  
  throw new Error('OpenAI request failed');
}

function buildSystemPrompt(brainProfile, context) {
  let prompt = `You are a personalized AI brain assistant with the following characteristics:

Personality: ${JSON.stringify(brainProfile.personality_traits)}
Communication Style: ${JSON.stringify(brainProfile.communication_style)}
User Interests: ${brainProfile.interests?.join(', ') || 'General topics'}
Expertise Areas: ${brainProfile.expertise_areas?.join(', ') || 'General knowledge'}

RELEVANT MEMORIES:
${context.relevantMemories.map(m => `- ${m.content} (${m.type}, importance: ${m.importance})`).join('\n')}

AVAILABLE TOOL DATA:
${context.toolData.map(t => `- ${t.tool}: ${JSON.stringify(t.data).substring(0, 200)}`).join('\n')}

Respond in a way that:
1. Reflects the user's personality preferences
2. References relevant memories when appropriate
3. Uses available tool data to enhance your response
4. Maintains consistency with past conversations
5. Adapts your communication style to match user preferences`;

  return prompt;
}

async function generateBrainFallback(context, brainProfile) {
  const message = context.currentMessage.toLowerCase();
  
  // Enhanced fallback with brain context
  if (context.relevantMemories.length > 0) {
    const memory = context.relevantMemories[0];
    return `Based on what I remember about ${memory.category}, ${memory.content.substring(0, 100)}... Let me help you with that.`;
  }
  
  if (context.toolData.length > 0) {
    const toolData = context.toolData[0];
    return `I found some relevant information using ${toolData.tool}. Let me help you with your question.`;
  }
  
  // Personality-based response
  const helpfulness = brainProfile.personality_traits?.helpfulness || 0.8;
  if (helpfulness > 0.8) {
    return "I'm here to help! While I'm still learning about your specific needs, I'd be happy to assist you. Could you tell me more about what you're looking for?";
  }
  
  return "I understand what you're asking. Let me think about how I can best help you with that.";
}

// RESPONSE ENHANCEMENT
async function enhanceResponse({ response, toolResults, relevantMemories, brainProfile }) {
  let enhancedResponse = response;
  
  // Add tool results if relevant
  const successfulTools = toolResults.filter(tr => tr.success);
  
  if (successfulTools.length > 0) {
    const toolSummary = successfulTools.map(tr => {
      switch (tr.toolName) {
        case 'web_search':
          return `I found some recent information: ${tr.result.results?.slice(0, 2).map(r => r.title || r.text).join(', ')}`;
        case 'memory_search':
          return `I recalled: ${tr.result.memories?.slice(0, 2).map(m => m.summary).join(', ')}`;
        case 'google_calendar':
          return `From your calendar: ${tr.result.events?.slice(0, 2).map(e => e.title).join(', ')}`;
        default:
          return `Used ${tr.toolName} successfully`;
      }
    }).join('. ');
    
    enhancedResponse += `\n\n${toolSummary}`;
  }
  
  // Add memory context if highly relevant
  const highImportanceMemories = relevantMemories.filter(m => m.importance > 0.8);
  if (highImportanceMemories.length > 0) {
    const memoryContext = highImportanceMemories[0];
    enhancedResponse += `\n\n💭 I remember we discussed ${memoryContext.category} before: "${memoryContext.content.substring(0, 100)}..."`;
  }
  
  return {
    content: enhancedResponse,
    reasoning: {
      toolsUsed: successfulTools.length,
      memoriesReferenced: relevantMemories.length,
      enhancementsApplied: ['tool_integration', 'memory_context']
    }
  };
}

// LEARNING FROM INTERACTION
async function learnFromInteraction(userId, userMessage, aiResponse, context) {
  try {
    // Create a new learning pattern
    const pattern = {
      user_id: userId,
      pattern_type: 'conversation',
      input_pattern: userMessage.toLowerCase().substring(0, 200),
      response_pattern: aiResponse,
      context_tags: extractTags(userMessage),
      confidence: 0.6,
      category: detectCategory(userMessage),
      learned_from: 'brain_interaction',
      conditions: {
        tool_results: context.toolData.length > 0,
        memory_used: context.relevantMemories.length > 0,
        conversation_length: context.conversationContext.length
      }
    };

    const { error } = await supabase
      .from('learning_patterns')
      .insert(pattern);

    if (error) {
      console.error('Failed to store learning pattern:', error);
    } else {
      console.log('🧠 Learned new pattern from interaction');
    }

    // Store as training data
    await supabase
      .from('training_data')
      .insert({
        user_id: userId,
        input: userMessage,
        output: aiResponse,
        quality_score: 4.0,
        category: detectCategory(userMessage),
        auto_generated: true,
        source_conversation_id: context.conversationId
      });

  } catch (error) {
    console.error('Learning from interaction failed:', error);
  }
}

// HELPER FUNCTIONS
async function getOrCreateConversation(userId, conversationId, message) {
  if (conversationId) {
    const { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single();
    
    if (conversation) return conversation;
  }

  // Create new conversation
  const { data: newConversation, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      title: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
      status: 'active',
      conversation_type: 'brain_chat',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;
  return newConversation;
}

async function getBrainProfile(userId) {
  const { data: profile } = await supabase
    .from('brain_profile')
    .select('*')
    .eq('user_id', userId)
    .single();

  return profile || {
    personality_traits: { helpfulness: 0.9, creativity: 0.7, formality: 0.5 },
    communication_style: { verbosity: 0.7, technical_level: 0.5 },
    interests: [],
    expertise_areas: []
  };
}

async function getConversationHistory(conversationId) {
  const { data: messages } = await supabase
    .from('messages')
    .select('type, content, timestamp')
    .eq('conversation_id', conversationId)
    .order('timestamp', { ascending: false })
    .limit(10);

  return messages ? messages.reverse() : [];
}

async function startBrainSession(userId, conversationId) {
  const { data: session, error } = await supabase
    .from('brain_sessions')
    .insert({
      user_id: userId,
      session_type: 'conversation',
      start_time: new Date().toISOString(),
      session_metadata: { conversation_id: conversationId }
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to start brain session:', error);
    return null;
  }

  return session.id;
}

async function saveMessage(conversationId, type, content, metadata = {}) {
  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      type,
      content,
      metadata,
      brain_confidence: metadata.brain_confidence,
      tools_used: metadata.tools_used,
      memory_references: metadata.memory_references,
      timestamp: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;
  return message;
}

async function storeInteractionMemory(userId, userMessage, aiResponse, conversationId) {
  try {
    await supabase
      .from('brain_memories')
      .insert({
        user_id: userId,
        type: 'episodic',
        content: `User asked: "${userMessage}" and I responded: "${aiResponse}"`,
        summary: `Conversation about ${detectCategory(userMessage)}`,
        importance: 0.6,
        confidence: 0.8,
        category: detectCategory(userMessage),
        source_id: conversationId,
        source_type: 'conversation',
        created_at: new Date().toISOString()
      });
  } catch (error) {
    console.error('Failed to store interaction memory:', error);
  }
}

async function updateBrainSession(sessionId, updates) {
  if (!sessionId) return;
  
  await supabase
    .from('brain_sessions')
    .update({
      message_count: supabase.raw('message_count + ?', [updates.message_count || 0]),
      tools_used: updates.tools_used || [],
      memories_accessed: supabase.raw('memories_accessed + ?', [updates.memories_accessed || 0]),
      updated_at: new Date().toISOString()
    })
    .eq('id', sessionId);
}

async function updatePatternUsage(patternId) {
  await supabase
    .from('learning_patterns')
    .update({
      use_count: supabase.raw('use_count + 1'),
      last_used: new Date().toISOString()
    })
    .eq('id', patternId);
}

// TOOL EXECUTION HELPERS
async function executeWebSearchTool(query) {
  try {
    // Extract search terms from the message
    const searchTerms = extractSearchTerms(query);
    
    // Simple web search simulation (replace with actual search API)
    return {
      query: searchTerms,
      results: [
        { title: 'Search Result 1', text: 'Relevant information about ' + searchTerms },
        { title: 'Search Result 2', text: 'Additional context for ' + searchTerms }
      ]
    };
  } catch (error) {
    throw new Error('Web search failed: ' + error.message);
  }
}

async function executeMemorySearchTool(userId, query) {
  const { data: memories } = await supabase
    .from('brain_memories')
    .select('*')
    .eq('user_id', userId)
    .ilike('content', `%${query}%`)
    .order('importance', { ascending: false })
    .limit(3);

  return {
    query,
    memories: memories || [],
    total: memories?.length || 0
  };
}

async function executeCalendarTool(message, tool) {
  // Calendar tool simulation
  return {
    events: [
      { title: 'Upcoming Meeting', start: '2024-01-15T10:00:00Z' }
    ],
    message: 'Calendar integration simulated'
  };
}

// UTILITY FUNCTIONS
function extractTags(text) {
  const words = text.toLowerCase().split(/\s+/);
  return words.filter(word => word.length > 3).slice(0, 5);
}

function extractSearchTerms(message) {
  // Simple extraction - improve with NLP
  const searchWords = ['search', 'find', 'look up', 'about', 'what is'];
  const words = message.toLowerCase().split(/\s+/);
  
  let startIndex = 0;
  for (const searchWord of searchWords) {
    const index = words.indexOf(searchWord);
    if (index !== -1) {
      startIndex = index + 1;
      break;
    }
  }
  
  return words.slice(startIndex, startIndex + 3).join(' ') || message.substring(0, 50);
}

function detectCategory(message) {
  const msg = message.toLowerCase();
  
  if (msg.includes('code') || msg.includes('programming') || msg.includes('function')) {
    return 'programming';
  }
  if (msg.includes('calendar') || msg.includes('meeting') || msg.includes('schedule')) {
    return 'scheduling';
  }
  if (msg.includes('data') || msg.includes('analyze') || msg.includes('chart')) {
    return 'analysis';
  }
  if (msg.includes('creative') || msg.includes('story') || msg.includes('write')) {
    return 'creative';
  }
  
  return 'general';
}