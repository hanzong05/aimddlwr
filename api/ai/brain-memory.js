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
      // Text-based search for now (can be enhanced with vector search)
      searchQuery = searchQuery.or(`content.ilike.%${query}%,summary.ilike.%${query}%`);
    }

    const { data: memories, error } = await searchQuery;

    if (error) throw error;

    // Update access count for retrieved memories
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

    const { data: memory, error } = await supabase
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

    if (error) throw error;

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