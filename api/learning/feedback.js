// api/learning/feedback.js
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

  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Failed to process feedback' });
  }
}