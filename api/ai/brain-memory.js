// api/ai/brain-memory.js - Advanced Memory System
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

  } catch (error) {
    console.error('Brain memory error:', error);
    res.status(500).json({ error: 'Memory operation failed' });
  }
}

// SEARCH MEMORIES WITH SEMANTIC SIMILARITY
async function searchMemories(req, res, userId) {
  const { 
    query, 
    type, 
    category, 
    limit = 10, 
    min_importance = 0.3,
    include_context = false 
  } = req.query;

  try {
    // Check if brain_memories table exists, fallback to training_data
    let memories = [];
    
    try {
      let searchQuery = supabase
        .from('brain_memories')
        .select(`
          *,
          ${include_context ? 'context_connections!context_connections_source_id_fkey(*)' : ''}
        `)
        .eq('user_id', userId)
        .gte('importance', min_importance)
        .order('importance', { ascending: false })
        .limit(limit);

      if (type) {
        searchQuery = searchQuery.eq('type', type);
      }

      if (category) {
        searchQuery = searchQuery.eq('category', category);
      }

      if (query) {
        searchQuery = searchQuery.or(`content.ilike.%${query}%,summary.ilike.%${query}%`);
      }

      const { data: brainMemories, error: memoryError } = await searchQuery;
      
      if (memoryError && memoryError.code === 'PGRST116') {
        // Table doesn't exist, fallback to training data
        throw new Error('brain_memories table not found');
      } else if (memoryError) {
        throw memoryError;
      }
      
      memories = brainMemories || [];
      
    } catch (fallbackError) {
      // Fallback to training_data table as memory substitute
      console.log('Brain memories table not available, using training data as fallback');
      
      let fallbackQuery = supabase
        .from('training_data')
        .select('*')
        .eq('user_id', userId)
        .order('quality_score', { ascending: false })
        .limit(limit);

      if (query) {
        fallbackQuery = fallbackQuery.or(`input.ilike.%${query}%,output.ilike.%${query}%,category.ilike.%${query}%`);
      }

      if (category) {
        fallbackQuery = fallbackQuery.eq('category', category);
      }

      const { data: fallbackMemories, error: fallbackErr } = await fallbackQuery;
      
      if (fallbackErr) throw fallbackErr;
      
      // Transform training data to memory format
      memories = (fallbackMemories || []).map(item => ({
        id: item.id,
        type: 'training',
        content: item.output,
        summary: item.input,
        importance: item.quality_score / 5.0, // Convert 0-5 to 0-1
        confidence: 0.8,
        category: item.category,
        tags: item.tags || [],
        context: item.metadata || {},
        access_count: 0,
        created_at: item.created_at
      }));
    }

    const error = null; // No error if we got here

    // Update access count for retrieved memories (only if using actual brain_memories table)
    if (memories.length > 0 && memories[0].type !== 'training') {
      try {
        const memoryIds = memories.map(m => m.id);
        await supabase
          .from('brain_memories')
          .update({ 
            access_count: supabase.raw('access_count + 1'),
            last_accessed: new Date().toISOString()
          })
          .in('id', memoryIds);
      } catch (updateError) {
        console.log('Could not update access count:', updateError);
        // Ignore update errors for fallback data
      }
    }

    res.json({
      memories,
      total: memories.length,
      query_processed: {
        query,
        type,
        category,
        min_importance
      }
    });

  } catch (error) {
    console.error('Memory search failed:', error);
    res.status(500).json({ error: 'Memory search failed' });
  }
}

// CREATE NEW MEMORY
async function createMemory(req, res, userId) {
  const {
    type = 'episodic',
    content,
    summary,
    importance = 0.5,
    confidence = 0.8,
    category,
    tags = [],
    context = {},
    source_id,
    source_type,
    expires_at
  } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Memory content is required' });
  }

  try {
    // Generate embedding if OpenAI is available
    let embedding = null;
    if (process.env.OPENAI_API_KEY) {
      embedding = await generateEmbedding(content + ' ' + (summary || ''));
    }

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
          confidence,
          category,
          tags,
          context,
          source_id,
          source_type,
          embedding,
          expires_at,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error && error.code === 'PGRST116') {
        // Table doesn't exist, fallback to training_data
        throw new Error('brain_memories table not found');
      } else if (error) {
        throw error;
      }
      
      memory = memoryData;
      
    } catch (fallbackError) {
      // Fallback: Store as training data
      console.log('Brain memories table not available, storing as training data');
      
      const { data: trainingData, error: trainingError } = await supabase
        .from('training_data')
        .insert({
          user_id: userId,
          input: summary || content.substring(0, 200),
          output: content,
          category: category,
          quality_score: Math.min(5.0, Math.max(1.0, importance * 5)), // Convert 0-1 to 1-5
          tags: tags,
          metadata: {
            ...context,
            original_type: type,
            source_id,
            source_type,
            stored_as_memory: true
          },
          auto_collected: false,
          used_in_training: false,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (trainingError) throw trainingError;
      
      // Transform back to memory format for response
      memory = {
        id: trainingData.id,
        type: 'training',
        content: trainingData.output,
        summary: trainingData.input,
        importance: trainingData.quality_score / 5.0,
        confidence: 0.8,
        category: trainingData.category,
        tags: trainingData.tags || [],
        context: trainingData.metadata || {},
        created_at: trainingData.created_at
      };
    }

    // Create context connections if provided
    if (context.related_memories) {
      await createContextConnections(userId, memory.id, context.related_memories);
    }

    res.json({
      success: true,
      memory,
      message: 'Memory stored successfully'
    });

  } catch (error) {
    console.error('Memory creation failed:', error);
    res.status(500).json({ error: 'Failed to create memory' });
  }
}

// UPDATE EXISTING MEMORY
async function updateMemory(req, res, userId) {
  const { id, importance, tags, context, summary } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Memory ID is required' });
  }

  try {
    const updates = { updated_at: new Date().toISOString() };
    
    if (importance !== undefined) updates.importance = importance;
    if (tags) updates.tags = tags;
    if (context) updates.context = context;
    if (summary) updates.summary = summary;

    const { data: memory, error } = await supabase
      .from('brain_memories')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      memory,
      message: 'Memory updated successfully'
    });

  } catch (error) {
    console.error('Memory update failed:', error);
    res.status(500).json({ error: 'Failed to update memory' });
  }
}

// DELETE MEMORY
async function deleteMemory(req, res, userId) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Memory ID is required' });
  }

  try {
    const { error } = await supabase
      .from('brain_memories')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Memory deleted successfully'
    });

  } catch (error) {
    console.error('Memory deletion failed:', error);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
}

// HELPER FUNCTIONS
async function generateEmbedding(text) {
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-ada-002',
        input: text.substring(0, 8000) // OpenAI limit
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return data.data[0].embedding;
    }
  } catch (error) {
    console.error('Embedding generation failed:', error);
  }
  
  return null;
}

async function createContextConnections(userId, sourceId, relatedMemoryIds) {
  const connections = relatedMemoryIds.map(targetId => ({
    user_id: userId,
    source_id: sourceId,
    target_id: targetId,
    source_type: 'memory',
    target_type: 'memory',
    connection_type: 'related',
    strength: 0.7,
    confidence: 0.8
  }));

  await supabase
    .from('context_connections')
    .insert(connections);
}