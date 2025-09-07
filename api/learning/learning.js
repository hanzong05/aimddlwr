import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { endpoint } = req.query; // Get the endpoint from URL

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    // Route based on endpoint parameter
    switch (endpoint) {
      case 'analytics':
        return await handleAnalytics(req, res, userId);
      case 'patterns':
        return await handlePatterns(req, res, userId);
      case 'feedback':
        return await handleFeedback(req, res, userId);
      default:
        return res.status(404).json({ error: 'Endpoint not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Request failed' });
  }
}

async function handleAnalytics(req, res, userId) {
  // Your analytics logic here
  let { data: analytics } = await supabase
    .from('learning_analytics')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!analytics) {
    const { data: patterns } = await supabase
      .from('learning_patterns')
      .select('confidence, use_count')
      .eq('user_id', userId);

    const totalPatterns = patterns?.length || 0;
    const highConfidencePatterns = patterns?.filter(p => p.confidence >= 0.7).length || 0;
    const averageConfidence = totalPatterns > 0 
      ? patterns.reduce((sum, p) => sum + p.confidence, 0) / totalPatterns 
      : 0;
    const learningRate = totalPatterns > 0 ? highConfidencePatterns / totalPatterns : 0;

    return res.json({
      totalPatterns,
      highConfidencePatterns,
      averageConfidence,
      learningRate,
      recentActivity: false
    });
  }

  res.json({
    totalPatterns: analytics.total_patterns,
    highConfidencePatterns: analytics.high_confidence_patterns,
    averageConfidence: analytics.average_confidence,
    learningRate: analytics.learning_rate,
    recentActivity: analytics.last_calculated > new Date(Date.now() - 24*60*60*1000)
  });
}

async function handlePatterns(req, res, userId) {
  const { limit = 10 } = req.query;
  const { data: patterns } = await supabase
    .from('learning_patterns')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(parseInt(limit));

  res.json(patterns || []);
}

async function handleFeedback(req, res, userId) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { pattern_id, feedback_type, feedback_score } = req.body;

  await supabase
    .from('pattern_feedback')
    .insert({
      user_id: userId,
      pattern_id,
      feedback_type,
      feedback_score
    });

  if (feedback_type === 'positive') {
    await supabase
      .from('learning_patterns')
      .update({ 
        confidence: supabase.raw('LEAST(1.0, confidence + 0.1)')
      })
      .eq('id', pattern_id);
  } else if (feedback_type === 'negative') {
    await supabase
      .from('learning_patterns')
      .update({ 
        confidence: supabase.raw('GREATEST(0.1, confidence - 0.15)')
      })
      .eq('id', pattern_id);
  }

  res.json({ success: true });
}