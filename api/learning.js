// api/learning.js - Consolidated Learning API
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
    // Verify auth
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    // Get endpoint from query parameter (set by vercel.json rewrite)
    const { endpoint } = req.query;
    
    console.log(`Learning API called with endpoint: ${endpoint}, query:`, req.query);

    // Route to appropriate handler
    switch (endpoint) {
      case 'analytics':
        return await handleAnalytics(req, res, userId);
      case 'patterns':
        return await handlePatterns(req, res, userId);
      case 'feedback':
        return await handleFeedback(req, res, userId);
      case 'health':
        return await handleHealth(req, res, userId);
      case undefined:
      case null:
        // Default to analytics if no endpoint specified
        return await handleAnalytics(req, res, userId);
      default:
        return res.status(404).json({ 
          error: 'Learning endpoint not found',
          availableEndpoints: ['analytics', 'patterns', 'feedback', 'health'],
          received: endpoint
        });
    }

  } catch (error) {
    console.error('Learning API error:', error);
    res.status(500).json({ error: 'Request failed' });
  }
}

// ============================================================================
// ANALYTICS HANDLER
// ============================================================================
async function handleAnalytics(req, res, userId) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get learning analytics
  const { data: analytics } = await supabase
    .from('learning_analytics')
    .select('*')
    .eq('user_id', userId)
    .single();

  // If no analytics exist, calculate them
  if (!analytics) {
    const { data: patterns } = await supabase
      .from('learning_patterns')
      .select('confidence, use_count')
      .eq('user_id', userId);

    if (patterns && patterns.length > 0) {
      const totalPatterns = patterns.length;
      const highConfidencePatterns = patterns.filter(p => p.confidence >= 0.7).length;
      const averageConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0) / totalPatterns;
      const totalInteractions = patterns.reduce((sum, p) => sum + p.use_count, 0);
      const learningRate = highConfidencePatterns / totalPatterns;

      // Create analytics record
      await supabase
        .from('learning_analytics')
        .insert({
          user_id: userId,
          total_patterns: totalPatterns,
          high_confidence_patterns: highConfidencePatterns,
          average_confidence: averageConfidence,
          total_interactions: totalInteractions,
          learning_rate: learningRate
        });

      return res.json({
        totalPatterns,
        highConfidencePatterns,
        averageConfidence,
        learningRate,
        totalInteractions,
        recentActivity: true
      });
    }
  }

  // Check for recent activity
  const { data: recentPatterns } = await supabase
    .from('learning_patterns')
    .select('created_at')
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(1);

  res.json({
    totalPatterns: analytics?.total_patterns || 0,
    highConfidencePatterns: analytics?.high_confidence_patterns || 0,
    averageConfidence: analytics?.average_confidence || 0,
    learningRate: analytics?.learning_rate || 0,
    totalInteractions: analytics?.total_interactions || 0,
    recentActivity: recentPatterns && recentPatterns.length > 0
  });
}

// ============================================================================
// PATTERNS HANDLER
// ============================================================================
async function handlePatterns(req, res, userId) {
  switch (req.method) {
    case 'GET':
      return await getPatterns(req, res, userId);
    case 'POST':
      return await createPattern(req, res, userId);
    case 'PUT':
      return await updatePattern(req, res, userId);
    case 'DELETE':
      return await deletePattern(req, res, userId);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function getPatterns(req, res, userId) {
  const { 
    limit = 20, 
    offset = 0, 
    category, 
    min_confidence = 0,
    sort = 'confidence'
  } = req.query;

  let query = supabase
    .from('learning_patterns')
    .select('*')
    .eq('user_id', userId)
    .gte('confidence', min_confidence)
    .order(sort, { ascending: false })
    .range(offset, offset + limit - 1);

  if (category) {
    query = query.eq('category', category);
  }

  const { data: patterns, error } = await query;

  if (error) throw error;

  res.json(patterns || []);
}

async function createPattern(req, res, userId) {
  const { input_pattern, response_pattern, category, confidence = 0.5 } = req.body;

  if (!input_pattern || !response_pattern) {
    return res.status(400).json({ error: 'Input and response patterns required' });
  }

  const { data, error } = await supabase
    .from('learning_patterns')
    .insert({
      user_id: userId,
      input_pattern,
      response_pattern,
      category,
      confidence,
      use_count: 1
    })
    .select()
    .single();

  if (error) throw error;

  res.json({ success: true, pattern: data });
}

async function updatePattern(req, res, userId) {
  const { id, confidence, response_pattern, category } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Pattern ID required' });
  }

  const updates = { updated_at: new Date().toISOString() };
  if (confidence !== undefined) updates.confidence = confidence;
  if (response_pattern) updates.response_pattern = response_pattern;
  if (category) updates.category = category;

  const { data, error } = await supabase
    .from('learning_patterns')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;

  res.json({ success: true, pattern: data });
}

async function deletePattern(req, res, userId) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Pattern ID required' });
  }

  const { error } = await supabase
    .from('learning_patterns')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;

  res.json({ success: true });
}

// ============================================================================
// FEEDBACK HANDLER
// ============================================================================
async function handleFeedback(req, res, userId) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { 
    pattern_id, 
    feedback_type, 
    feedback_score, 
    corrected_response,
    original_response 
  } = req.body;

  if (!pattern_id || !feedback_type) {
    return res.status(400).json({ error: 'Pattern ID and feedback type required' });
  }

  // Save feedback
  const { data: feedback, error: feedbackError } = await supabase
    .from('pattern_feedback')
    .insert({
      user_id: userId,
      pattern_id,
      feedback_type,
      feedback_score,
      original_response,
      corrected_response
    })
    .select()
    .single();

  if (feedbackError) throw feedbackError;

  // Update pattern confidence based on feedback
  if (feedback_type === 'positive' && feedback_score >= 4) {
    await supabase
      .from('learning_patterns')
      .update({ 
        confidence: supabase.raw('LEAST(1.0, confidence + 0.1)'),
        updated_at: new Date().toISOString()
      })
      .eq('id', pattern_id)
      .eq('user_id', userId);
  } else if (feedback_type === 'negative') {
    await supabase
      .from('learning_patterns')
      .update({ 
        confidence: supabase.raw('GREATEST(0.1, confidence - 0.15)'),
        updated_at: new Date().toISOString()
      })
      .eq('id', pattern_id)
      .eq('user_id', userId);
  } else if (feedback_type === 'correction' && corrected_response) {
    await supabase
      .from('learning_patterns')
      .update({ 
        response_pattern: corrected_response,
        confidence: supabase.raw('LEAST(1.0, confidence + 0.05)'),
        updated_at: new Date().toISOString()
      })
      .eq('id', pattern_id)
      .eq('user_id', userId);
  }

  res.json({ success: true, feedback });
}

// ============================================================================
// HEALTH HANDLER
// ============================================================================
async function handleHealth(req, res, userId) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Call the health check function
  const { data: healthData, error } = await supabase
    .rpc('check_learning_health', { target_user_id: userId });

  if (error) throw error;

  const health = healthData[0] || {
    status: 'beginning',
    total_patterns: 0,
    avg_confidence: 0,
    recent_learning_activity: false,
    recommendations: ['Start chatting to begin learning!']
  };

  res.json(health);
}