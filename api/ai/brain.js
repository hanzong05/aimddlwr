// api/ai/brain.js - Consolidated Brain Functions (Memory + Chat + Tools)
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
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const { type, action } = req.query; // memory, chat, tools
    
    console.log(`Brain API called with type: ${type}, action: ${action}, query:`, req.query);

    switch (type) {
      case 'memory':
        return await handleMemory(req, res, userId);
      case 'chat':
        return await handleChat(req, res, userId);
      case 'tools':
        return await handleTools(req, res, userId);
      default:
        return res.status(400).json({ 
          error: 'Invalid type. Use ?type=memory, ?type=chat, or ?type=tools',
          received: { type, action, allQuery: req.query }
        });
    }

  } catch (error) {
    console.error('Brain error:', error);
    res.status(500).json({ error: 'Brain operation failed' });
  }
}

// MEMORY FUNCTIONS
async function handleMemory(req, res, userId) {
  switch (req.method) {
    case 'GET':
      return await searchMemories(req, res, userId);
    case 'POST':
      return await createMemory(req, res, userId);
    case 'PUT':
      return await updateMemory(req, res, userId);
    case 'DELETE':
      return await deleteMemory(req, res, userId);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function searchMemories(req, res, userId) {
  const { query, category, limit = 10, min_importance = 0.3 } = req.query;

  try {
    let memories = [];
    
    try {
      let searchQuery = supabase
        .from('brain_memories')
        .select('*')
        .eq('user_id', userId)
        .gte('importance', min_importance)
        .order('importance', { ascending: false })
        .limit(limit);

      if (category) searchQuery = searchQuery.eq('category', category);
      if (query) searchQuery = searchQuery.or(`content.ilike.%${query}%,summary.ilike.%${query}%`);

      const { data: brainMemories, error: memoryError } = await searchQuery;
      
      if (memoryError && memoryError.code === 'PGRST116') {
        throw new Error('brain_memories table not found');
      } else if (memoryError) {
        throw memoryError;
      }
      
      memories = brainMemories || [];
      
    } catch (fallbackError) {
      // Fallback to training_data
      let fallbackQuery = supabase
        .from('training_data')
        .select('*')
        .eq('user_id', userId)
        .order('quality_score', { ascending: false })
        .limit(limit);

      if (query) fallbackQuery = fallbackQuery.or(`input.ilike.%${query}%,output.ilike.%${query}%,category.ilike.%${query}%`);
      if (category) fallbackQuery = fallbackQuery.eq('category', category);

      const { data: fallbackMemories, error: fallbackErr } = await fallbackQuery;
      if (fallbackErr) throw fallbackErr;
      
      memories = (fallbackMemories || []).map(item => ({
        id: item.id,
        type: 'training',
        content: item.output,
        summary: item.input,
        importance: item.quality_score / 5.0,
        category: item.category,
        tags: item.tags || [],
        created_at: item.created_at
      }));
    }

    res.json({ memories, total: memories.length });
  } catch (error) {
    console.error('Memory search failed:', error);
    res.status(500).json({ error: 'Memory search failed' });
  }
}

async function createMemory(req, res, userId) {
  const { type = 'episodic', content, summary, importance = 0.5, category, tags = [] } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Memory content is required' });
  }

  try {
    let memory;
    try {
      const { data: memoryData, error } = await supabase
        .from('brain_memories')
        .insert({
          user_id: userId,
          type,
          content,
          summary: summary || content.substring(0, 200) + '...',
          importance,
          category,
          tags,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error && error.code === 'PGRST116') {
        throw new Error('brain_memories table not found');
      } else if (error) {
        throw error;
      }
      
      memory = memoryData;
      
    } catch (fallbackError) {
      // Fallback: Store as training data
      const { data: trainingData, error: trainingError } = await supabase
        .from('training_data')
        .insert({
          user_id: userId,
          input: summary || content.substring(0, 200),
          output: content,
          category: category,
          quality_score: Math.min(5.0, Math.max(1.0, importance * 5)),
          tags: tags,
          metadata: { stored_as_memory: true },
          auto_collected: false,
          used_in_training: false,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (trainingError) throw trainingError;
      
      memory = {
        id: trainingData.id,
        type: 'training',
        content: trainingData.output,
        summary: trainingData.input,
        importance: trainingData.quality_score / 5.0,
        category: trainingData.category,
        tags: trainingData.tags || [],
        created_at: trainingData.created_at
      };
    }

    res.json({ success: true, memory });
  } catch (error) {
    console.error('Memory creation failed:', error);
    res.status(500).json({ error: 'Failed to create memory' });
  }
}

async function updateMemory(req, res, userId) {
  const { id, importance, tags, summary } = req.body;
  if (!id) return res.status(400).json({ error: 'Memory ID is required' });

  try {
    const updates = { updated_at: new Date().toISOString() };
    if (importance !== undefined) updates.importance = importance;
    if (tags) updates.tags = tags;
    if (summary) updates.summary = summary;

    const { data: memory, error } = await supabase
      .from('brain_memories')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, memory });
  } catch (error) {
    console.error('Memory update failed:', error);
    res.status(500).json({ error: 'Failed to update memory' });
  }
}

async function deleteMemory(req, res, userId) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Memory ID is required' });

  try {
    const { error } = await supabase
      .from('brain_memories')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Memory deletion failed:', error);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
}

// CHAT FUNCTIONS
async function handleChat(req, res, userId) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, useMemory = true, modelId = null, maxTokens = 500 } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    let enhancedContext = '';
    let memoryCount = 0;

    if (useMemory) {
      const contextData = await retrieveRelevantContext(userId, message);
      enhancedContext = contextData.context;
      memoryCount = contextData.memoryCount;
    }

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

    const response = await generateBrainResponse(message, enhancedContext, selectedModel);

    // Store conversation
    try {
      await supabase.from('training_data').insert({
        user_id: userId,
        input: message,
        output: response,
        category: 'conversation',
        quality_score: 3.5,
        tags: ['chat', 'conversation'],
        metadata: { generated_by_brain_chat: true },
        auto_collected: false,
        used_in_training: false,
        created_at: new Date().toISOString()
      });
    } catch (storeError) {
      console.error('Could not store conversation:', storeError);
    }

    res.json({
      success: true,
      response: response,
      metadata: {
        model_used: selectedModel?.name || 'Base AI',
        memory_references: memoryCount,
        enhanced_with_context: enhancedContext.length > 0
      }
    });

  } catch (error) {
    console.error('Brain chat processing failed:', error);
    res.status(500).json({ error: 'Failed to process brain chat' });
  }
}

async function retrieveRelevantContext(userId, message) {
  let context = '';
  let memoryCount = 0;

  console.log(`🔍 Searching training data for user ${userId} with message: "${message}"`);

  try {
    // First, try to find exact matches
    let { data: trainingData, error: searchError } = await supabase
      .from('training_data')
      .select('input, output, category')
      .eq('user_id', userId)
      .or(`input.ilike.%${message}%,output.ilike.%${message}%`)
      .gte('quality_score', 2.0)
      .order('quality_score', { ascending: false })
      .limit(5);

    if (searchError) {
      console.error('Training data search error:', searchError);
    }
    
    console.log(`📊 Found ${trainingData?.length || 0} exact matches`);

    // If no matches found, try keyword-based search
    if (!trainingData || trainingData.length === 0) {
      const keywords = message.toLowerCase().split(' ').filter(word => word.length > 2);
      if (keywords.length > 0) {
        const keywordSearch = keywords.map(keyword => `input.ilike.%${keyword}%,output.ilike.%${keyword}%,category.ilike.%${keyword}%`).join(',');
        
        const { data: keywordData } = await supabase
          .from('training_data')
          .select('input, output, category')
          .eq('user_id', userId)
          .or(keywordSearch)
          .gte('quality_score', 2.0)
          .order('quality_score', { ascending: false })
          .limit(3);
          
        trainingData = keywordData;
      }
    }

    // If still no matches, get the best general training data
    if (!trainingData || trainingData.length === 0) {
      console.log('🔄 No keyword matches, fetching best general training data...');
      const { data: generalData } = await supabase
        .from('training_data')
        .select('input, output, category')
        .eq('user_id', userId)
        .gte('quality_score', 2.0)  // Lowered threshold
        .order('quality_score', { ascending: false })
        .limit(3);
        
      trainingData = generalData;
      console.log(`📚 Found ${generalData?.length || 0} general training examples`);
    }

    // If STILL no matches, get ANY training data for this user
    if (!trainingData || trainingData.length === 0) {
      console.log('🆘 Getting ANY training data for user...');
      const { data: anyData } = await supabase
        .from('training_data')
        .select('input, output, category')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(2);
        
      trainingData = anyData;
      console.log(`🗂️ Found ${anyData?.length || 0} total training examples for user`);
    }

    if (trainingData && trainingData.length > 0) {
      memoryCount = trainingData.length;
      context = trainingData.map(t => `Q: ${t.input}\nA: ${t.output.substring(0, 300)}\nCategory: ${t.category}`).join('\n\n');
    }
  } catch (error) {
    console.error('Error retrieving context:', error);
  }

  return { context, memoryCount };
}

function generateBrainResponse(message, context, model) {
  const specialization = model?.specialization || 'general';
  const lowerMessage = message.toLowerCase();
  
  if (context) {
    // Extract the most relevant answer from context
    const contextLines = context.split('\n\n');
    const bestMatch = contextLines[0]; // First result is highest quality
    
    if (bestMatch.includes('A: ')) {
      const answer = bestMatch.split('A: ')[1].split('\nCategory:')[0];
      return `Based on your training data:\n\n${answer}`;
    }
    
    return `Based on your ${specialization} training data, here's what I found:\n\n${context.substring(0, 500)}...`;
  } else {
    // Provide basic responses for common queries
    if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
      return "Hello! I'm your AI assistant. I can help with programming, web development, and technical questions. How can I assist you today?";
    } else if (lowerMessage.includes('java') && lowerMessage.includes('teach')) {
      return `I'd be happy to teach you Java! Here are some fundamentals:

**Basic Java Structure:**
\`\`\`java
public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
\`\`\`

**Variables and Data Types:**
\`\`\`java
int number = 42;
String text = "Hello";
boolean isTrue = true;
double decimal = 3.14;
\`\`\`

Would you like me to explain any specific Java concepts?`;
    } else if (lowerMessage.includes('github') && lowerMessage.includes('search')) {
      return `To search GitHub effectively:

**GitHub Search Syntax:**
- \`user:username\` - Search in specific user's repos
- \`language:java\` - Filter by programming language
- \`stars:>100\` - Filter by star count
- \`created:>2023-01-01\` - Filter by creation date

**Advanced Search:**
- Go to github.com/search/advanced
- Use specific filters for repositories, code, issues, etc.
- Search within code: \`filename:config.js\`

**GitHub CLI:**
\`\`\`bash
gh repo search "machine learning" --language=python
\`\`\`

What specific type of project are you looking for?`;
    } else {
      return `Hello! I'm your AI assistant with ${specialization} specialization. Regarding "${message}", I'd be happy to help. For better responses, please train me with more relevant data or try asking about programming topics like Java, JavaScript, React, or GitHub.`;
    }
  }
}

// TOOLS FUNCTIONS
async function handleTools(req, res, userId) {
  if (req.method === 'GET') {
    // Handle GET requests for listing tools
    const { action } = req.query;
    
    if (action === 'list') {
      return res.json({
        success: true,
        tools: [
          { name: 'analyze-conversation', description: 'Analyze conversation patterns' },
          { name: 'optimize-memory', description: 'Optimize memory usage' },
          { name: 'generate-insights', description: 'Generate insights from data' }
        ]
      });
    }
    
    return res.status(400).json({ error: 'Invalid action for GET request' });
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.query;
  const { tool, toolName, params = {}, parameters = {} } = req.body;
  
  // Support both 'tool' and 'toolName' for compatibility
  const selectedTool = tool || toolName;
  const selectedParams = Object.keys(params).length > 0 ? params : parameters;
  
  if (action === 'execute' && !selectedTool) {
    return res.status(400).json({ error: 'Tool name required in body (use "tool" or "toolName" field)' });
  }

  try {
    let result;
    
    switch (selectedTool) {
      case 'analyze-conversation':
        result = await analyzeConversation(userId, selectedParams);
        break;
      case 'optimize-memory':
        result = await optimizeMemory(userId, selectedParams);
        break;
      case 'generate-insights':
        result = await generateInsights(userId, selectedParams);
        break;
      case 'memory_search':
        // Handle memory search tool from frontend
        result = await handleMemorySearch(userId, selectedParams);
        break;
      default:
        return res.status(400).json({ 
          error: 'Unknown tool',
          availableTools: ['analyze-conversation', 'optimize-memory', 'generate-insights', 'memory_search'],
          received: selectedTool
        });
    }

    res.json({ success: true, result });
  } catch (error) {
    console.error('Tool execution failed:', error);
    res.status(500).json({ error: 'Tool execution failed' });
  }
}

async function analyzeConversation(userId, params) {
  const { data: conversations } = await supabase
    .from('training_data')
    .select('*')
    .eq('user_id', userId)
    .eq('category', 'conversation')
    .order('created_at', { ascending: false })
    .limit(50);

  return {
    totalConversations: conversations?.length || 0,
    averageLength: conversations ? conversations.reduce((acc, c) => acc + c.input.length + c.output.length, 0) / conversations.length : 0,
    topTopics: extractTopics(conversations || [])
  };
}

async function optimizeMemory(userId, params) {
  const { data: memories } = await supabase
    .from('training_data')
    .select('*')
    .eq('user_id', userId)
    .order('quality_score', { ascending: false });

  return {
    totalMemories: memories?.length || 0,
    highQuality: memories?.filter(m => m.quality_score >= 4.0).length || 0,
    suggested_cleanup: memories?.filter(m => m.quality_score < 2.0).length || 0
  };
}

async function generateInsights(userId, params) {
  const { data: data } = await supabase
    .from('training_data')
    .select('category, quality_score')
    .eq('user_id', userId);

  const categories = {};
  data?.forEach(item => {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item.quality_score);
  });

  return {
    categoryBreakdown: Object.keys(categories).map(cat => ({
      category: cat,
      count: categories[cat].length,
      averageQuality: categories[cat].reduce((a, b) => a + b, 0) / categories[cat].length
    })),
    recommendations: ['Focus on high-quality examples', 'Diversify training categories', 'Regular model retraining']
  };
}

async function handleMemorySearch(userId, params) {
  const { query = '', limit = 10 } = params;
  
  // Search training data as memory fallback
  const { data: memories } = await supabase
    .from('training_data')
    .select('input, output, category, quality_score')
    .eq('user_id', userId)
    .or(`input.ilike.%${query}%,output.ilike.%${query}%`)
    .order('quality_score', { ascending: false })
    .limit(limit);

  return {
    searchQuery: query,
    totalResults: memories?.length || 0,
    memories: (memories || []).map(item => ({
      id: item.id,
      content: item.output,
      summary: item.input,
      category: item.category,
      relevance: item.quality_score / 5.0
    }))
  };
}

function extractTopics(conversations) {
  const topics = {};
  conversations.forEach(conv => {
    const words = conv.input.toLowerCase().split(' ');
    words.forEach(word => {
      if (word.length > 3) {
        topics[word] = (topics[word] || 0) + 1;
      }
    });
  });
  
  return Object.entries(topics)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([topic, count]) => ({ topic, count }));
}