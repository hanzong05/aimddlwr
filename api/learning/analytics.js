// api/learning/analytics.js
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
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

  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
}