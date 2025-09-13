// Debug endpoint to test training data access
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

  try {
    // For debugging, allow without auth if no header provided
    let userId = '040427c4-c759-47b6-935c-a5be720531ce';
    
    if (req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Invalid authorization header' });
      }
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
    }

    console.log('Debug training endpoint called for user:', userId);

    // Test basic database connection
    const { data: testData, error: testError } = await supabase
      .from('training_data')
      .select('count')
      .eq('user_id', userId);

    if (testError) {
      console.error('Basic query failed:', testError);
      return res.status(500).json({ 
        error: 'Database connection failed', 
        details: testError.message 
      });
    }

    // Get actual training data
    const { data: trainingData, error: dataError } = await supabase
      .from('training_data')
      .select('*')
      .eq('user_id', userId)
      .gte('quality_score', 2.0)
      .order('created_at', { ascending: false })
      .limit(20);

    if (dataError) {
      console.error('Training data query failed:', dataError);
      return res.status(500).json({ 
        error: 'Training data query failed', 
        details: dataError.message 
      });
    }

    console.log(`Found ${trainingData?.length || 0} training examples`);

    // Test training_jobs table access
    let jobsTableExists = true;
    try {
      const { data: jobTest, error: jobError } = await supabase
        .from('training_jobs')
        .select('id')
        .limit(1);
      
      if (jobError) {
        console.error('Jobs table error:', jobError);
        jobsTableExists = false;
      }
    } catch (jobErr) {
      console.error('Jobs table access failed:', jobErr);
      jobsTableExists = false;
    }

    // Return debug information
    return res.json({
      success: true,
      debug: {
        userId: userId,
        trainingDataCount: trainingData?.length || 0,
        trainingDataSample: trainingData?.slice(0, 3).map(item => ({
          id: item.id,
          input: item.input?.substring(0, 50) + '...',
          category: item.category,
          quality_score: item.quality_score,
          created_at: item.created_at
        })) || [],
        qualityScores: trainingData?.map(item => item.quality_score) || [],
        categories: [...new Set(trainingData?.map(item => item.category) || [])],
        jobsTableExists: jobsTableExists,
        sufficientForAdvanced: (trainingData?.length || 0) >= 10,
        sufficientForRegular: (trainingData?.length || 0) >= 5
      }
    });

  } catch (error) {
    console.error('Debug endpoint error:', error);
    return res.status(500).json({ 
      error: 'Debug endpoint failed', 
      details: error.message,
      stack: error.stack
    });
  }
}