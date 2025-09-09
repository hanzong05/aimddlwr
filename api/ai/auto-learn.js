// api/ai/auto-learn.js - Self-Learning AI System
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
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

    if (req.method === 'POST') {
      return await startAutoLearning(req, res, userId);
    } else if (req.method === 'GET') {
      return await getAutoLearningStatus(req, res, userId);
    }

  } catch (error) {
    console.error('Auto-learning error:', error);
    res.status(500).json({ error: 'Auto-learning request failed' });
  }
}

// START AUTO-LEARNING PROCESS
async function startAutoLearning(req, res, userId) {
  const { 
    topics = ['javascript', 'react', 'nodejs', 'python', 'programming'],
    sources = ['stackoverflow', 'github', 'dev.to', 'medium'],
    maxPages = 50,
    learningMode = 'code' // 'code', 'general', 'mixed'
  } = req.body;

  console.log(`🧠 Starting auto-learning for user ${userId}`);

  // Create learning session
  const { data: session, error: sessionError } = await supabase
    .from('learning_sessions')
    .insert({
      user_id: userId,
      status: 'starting',
      topics: topics,
      sources: sources,
      max_pages: maxPages,
      learning_mode: learningMode,
      started_at: new Date().toISOString()
    })
    .select()
    .single();

  if (sessionError) throw sessionError;

  // Start the learning process asynchronously
  setImmediate(() => processAutoLearning(session.id, userId, {
    topics, sources, maxPages, learningMode
  }));

  res.json({
    success: true,
    sessionId: session.id,
    message: 'Auto-learning started! Your AI is now collecting knowledge from the internet.',
    status: 'learning'
  });
}

// MAIN AUTO-LEARNING PROCESSOR
async function processAutoLearning(sessionId, userId, config) {
  try {
    console.log(`🚀 Processing auto-learning session ${sessionId}`);

    // Update session status
    await updateLearningSession(sessionId, { 
      status: 'running',
      progress: 0 
    });

    const collectedData = [];
    let totalProcessed = 0;

    // PHASE 1: Collect from multiple sources
    for (const source of config.sources) {
      console.log(`📡 Collecting from ${source}...`);
      
      for (const topic of config.topics) {
        try {
          const data = await collectFromSource(source, topic, config);
          collectedData.push(...data);
          totalProcessed++;
          
          // Update progress
          const progress = (totalProcessed / (config.sources.length * config.topics.length)) * 50;
          await updateLearningSession(sessionId, { progress });
          
          // Rate limiting
          await sleep(2000);
        } catch (error) {
          console.error(`Error collecting from ${source} for ${topic}:`, error);
        }
      }
    }

    console.log(`📊 Collected ${collectedData.length} items`);

    // PHASE 2: Process and filter data
    await updateLearningSession(sessionId, { 
      status: 'processing',
      progress: 50 
    });

    const processedData = await processCollectedData(collectedData, config.learningMode);
    
    // PHASE 3: Store high-quality data as training examples
    await updateLearningSession(sessionId, { 
      status: 'storing',
      progress: 75 
    });

    let storedCount = 0;
    for (const item of processedData) {
      try {
        await storeAsTrainingData(userId, item);
        storedCount++;
      } catch (error) {
        console.error('Error storing training data:', error);
      }
    }

    // PHASE 4: Auto-train model with new data
    if (storedCount > 10) {
      console.log(`🎯 Auto-training model with ${storedCount} new examples`);
      await triggerAutoTraining(userId, sessionId);
    }

    // Complete session
    await updateLearningSession(sessionId, {
      status: 'completed',
      progress: 100,
      completed_at: new Date().toISOString(),
      items_collected: collectedData.length,
      items_stored: storedCount
    });

    console.log(`✅ Auto-learning completed! Stored ${storedCount} training examples`);

  } catch (error) {
    console.error('Auto-learning failed:', error);
    await updateLearningSession(sessionId, {
      status: 'failed',
      error_message: error.message,
      completed_at: new Date().toISOString()
    });
  }
}

// COLLECT FROM DIFFERENT SOURCES
async function collectFromSource(source, topic, config) {
  switch (source) {
    case 'stackoverflow':
      return await collectFromStackOverflow(topic);
    case 'github':
      return await collectFromGitHub(topic);
    case 'dev.to':
      return await collectFromDevTo(topic);
    case 'medium':
      return await collectFromMedium(topic);
    default:
      return [];
  }
}

// STACK OVERFLOW COLLECTOR
async function collectFromStackOverflow(topic) {
  try {
    const url = `https://api.stackexchange.com/2.3/questions?order=desc&sort=votes&tagged=${topic}&site=stackoverflow&pagesize=20&filter=!9_bDDxJY5`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    const collected = [];
    
    for (const question of data.items || []) {
      if (question.accepted_answer_id) {
        // Get the accepted answer
        const answerUrl = `https://api.stackexchange.com/2.3/answers/${question.accepted_answer_id}?site=stackoverflow&filter=!9_bDDxJY5`;
        const answerResponse = await fetch(answerUrl);
        const answerData = await answerResponse.json();
        
        if (answerData.items && answerData.items[0]) {
          const answer = answerData.items[0];
          
          collected.push({
            source: 'stackoverflow',
            type: 'qa',
            question: question.title,
            answer: answer.body,
            score: question.score,
            topic: topic,
            url: `https://stackoverflow.com/questions/${question.question_id}`,
            raw_data: { question, answer }
          });
        }
        
        await sleep(100); // Rate limiting
      }
    }
    
    return collected;
  } catch (error) {
    console.error('StackOverflow collection error:', error);
    return [];
  }
}

// GITHUB COLLECTOR
async function collectFromGitHub(topic) {
  try {
    if (!process.env.GITHUB_TOKEN) {
      console.log('GitHub token not provided, skipping GitHub collection');
      return [];
    }

    const query = `${topic} language:javascript stars:>100`;
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=10`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    const data = await response.json();
    const collected = [];
    
    for (const repo of data.items || []) {
      try {
        // Get README content
        const readmeUrl = `https://api.github.com/repos/${repo.full_name}/readme`;
        const readmeResponse = await fetch(readmeUrl, {
          headers: {
            'Authorization': `token ${process.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        
        if (readmeResponse.ok) {
          const readmeData = await readmeResponse.json();
          const readmeContent = Buffer.from(readmeData.content, 'base64').toString('utf-8');
          
          collected.push({
            source: 'github',
            type: 'documentation',
            question: `How to use ${repo.name}?`,
            answer: readmeContent,
            score: repo.stargazers_count,
            topic: topic,
            url: repo.html_url,
            raw_data: { repo, readme: readmeContent }
          });
        }
        
        await sleep(1000); // GitHub rate limiting
      } catch (error) {
        console.error(`Error processing repo ${repo.full_name}:`, error);
      }
    }
    
    return collected;
  } catch (error) {
    console.error('GitHub collection error:', error);
    return [];
  }
}

// DEV.TO COLLECTOR
async function collectFromDevTo(topic) {
  try {
    const url = `https://dev.to/api/articles?tag=${topic}&top=7`;
    
    const response = await fetch(url);
    const articles = await response.json();
    
    const collected = [];
    
    for (const article of articles.slice(0, 5)) {
      try {
        // Get full article content
        const articleUrl = `https://dev.to/api/articles/${article.id}`;
        const articleResponse = await fetch(articleUrl);
        const fullArticle = await articleResponse.json();
        
        collected.push({
          source: 'dev.to',
          type: 'article',
          question: article.title,
          answer: fullArticle.body_markdown || fullArticle.description,
          score: article.positive_reactions_count,
          topic: topic,
          url: article.url,
          raw_data: fullArticle
        });
        
        await sleep(500);
      } catch (error) {
        console.error(`Error processing article ${article.id}:`, error);
      }
    }
    
    return collected;
  } catch (error) {
    console.error('Dev.to collection error:', error);
    return [];
  }
}

// MEDIUM COLLECTOR (using RSS)
async function collectFromMedium(topic) {
  try {
    // Use a public RSS to JSON service
    const rssUrl = `https://medium.com/feed/tag/${topic}`;
    const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
    
    const response = await fetch(apiUrl);
    const data = await response.json();
    
    const collected = [];
    
    for (const item of (data.items || []).slice(0, 5)) {
      collected.push({
        source: 'medium',
        type: 'article',
        question: item.title,
        answer: item.description || item.content,
        score: 0, // Medium doesn't provide scores via RSS
        topic: topic,
        url: item.link,
        raw_data: item
      });
    }
    
    return collected;
  } catch (error) {
    console.error('Medium collection error:', error);
    return [];
  }
}

// PROCESS COLLECTED DATA
async function processCollectedData(rawData, learningMode) {
  const processed = [];
  
  for (const item of rawData) {
    try {
      // Clean and process the content
      const cleanedItem = await cleanAndProcessItem(item, learningMode);
      
      if (cleanedItem && isHighQuality(cleanedItem)) {
        processed.push(cleanedItem);
      }
    } catch (error) {
      console.error('Error processing item:', error);
    }
  }
  
  // Sort by quality score
  return processed.sort((a, b) => b.qualityScore - a.qualityScore);
}

// CLEAN AND PROCESS INDIVIDUAL ITEMS
async function cleanAndProcessItem(item, learningMode) {
  // Remove HTML tags and clean content
  const cleanQuestion = stripHtml(item.question).substring(0, 200);
  let cleanAnswer = stripHtml(item.answer);
  
  // Extract code blocks if learning mode is 'code'
  if (learningMode === 'code') {
    const codeBlocks = extractCodeBlocks(cleanAnswer);
    if (codeBlocks.length === 0) {
      return null; // Skip if no code found
    }
    
    // Enhance answer with proper code formatting
    cleanAnswer = formatCodeAnswer(cleanAnswer, codeBlocks);
  }
  
  // Limit answer length
  cleanAnswer = cleanAnswer.substring(0, 2000);
  
  // Calculate quality score
  const qualityScore = calculateQualityScore(item, cleanQuestion, cleanAnswer);
  
  if (qualityScore < 3.0) {
    return null; // Skip low quality content
  }
  
  return {
    input: cleanQuestion,
    output: cleanAnswer,
    category: item.topic,
    quality_score: qualityScore,
    tags: [item.topic, item.source, item.type],
    metadata: {
      source: item.source,
      sourceUrl: item.url,
      originalScore: item.score,
      collectedAt: new Date().toISOString()
    }
  };
}

// QUALITY SCORING ALGORITHM
function calculateQualityScore(item, question, answer) {
  let score = 3.0; // Base score
  
  // Source reliability
  if (item.source === 'stackoverflow') score += 1.0;
  if (item.source === 'github') score += 0.8;
  if (item.source === 'dev.to') score += 0.6;
  
  // Content length (sweet spot)
  if (answer.length > 100 && answer.length < 1500) score += 0.5;
  if (answer.length > 1500) score -= 0.3;
  
  // Code presence (for programming topics)
  if (answer.includes('```') || answer.includes('function') || answer.includes('const ')) {
    score += 0.7;
  }
  
  // Original score/popularity
  if (item.score > 10) score += 0.3;
  if (item.score > 50) score += 0.5;
  if (item.score > 100) score += 0.7;
  
  // Question quality
  if (question.includes('how to') || question.includes('how do')) score += 0.3;
  
  return Math.min(5.0, Math.max(1.0, score));
}

// UTILITY FUNCTIONS
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

function extractCodeBlocks(text) {
  const codePattern = /```[\s\S]*?```|`[^`]+`/g;
  return text.match(codePattern) || [];
}

function formatCodeAnswer(answer, codeBlocks) {
  // Ensure code blocks are properly formatted
  let formatted = answer;
  
  codeBlocks.forEach(block => {
    if (!block.startsWith('```')) {
      formatted = formatted.replace(block, `\`${block.replace(/`/g, '')}\``);
    }
  });
  
  return formatted;
}

function isHighQuality(item) {
  return item.qualityScore >= 3.0 && 
         item.input.length >= 10 && 
         item.output.length >= 50;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// STORE AS TRAINING DATA
async function storeAsTrainingData(userId, processedItem) {
  const { error } = await supabase
    .from('training_data')
    .insert({
      user_id: userId,
      input: processedItem.input,
      output: processedItem.output,
      category: processedItem.category,
      quality_score: processedItem.quality_score,
      tags: processedItem.tags,
      metadata: processedItem.metadata,
      auto_collected: true,
      created_at: new Date().toISOString()
    });
    
  if (error) throw error;
}

// AUTO-TRIGGER TRAINING
async function triggerAutoTraining(userId, sessionId) {
  try {
    const { data: job, error } = await supabase
      .from('training_jobs')
      .insert({
        user_id: userId,
        status: 'pending',
        auto_triggered: true,
        learning_session_id: sessionId,
        epochs: 3,
        batch_size: 16,
        learning_rate: 0.001,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    // Start training process
    setImmediate(() => processAutoTraining(job.id, userId));
    
    console.log(`🚀 Auto-training started with job ID: ${job.id}`);
  } catch (error) {
    console.error('Failed to trigger auto-training:', error);
  }
}

async function processAutoTraining(jobId, userId) {
  // Use your existing training logic from train.js
  // This would be similar to your processTraining function
  console.log(`🤖 Processing auto-training job ${jobId}`);
}

// UPDATE LEARNING SESSION
async function updateLearningSession(sessionId, updates) {
  await supabase
    .from('learning_sessions')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', sessionId);
}

// GET LEARNING STATUS
async function getAutoLearningStatus(req, res, userId) {
  const { sessionId } = req.query;
  
  if (sessionId) {
    // Get specific session
    const { data: session, error } = await supabase
      .from('learning_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .single();
      
    if (error) throw error;
    return res.json(session);
  } else {
    // Get all sessions for user
    const { data: sessions, error } = await supabase
      .from('learning_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
      
    if (error) throw error;
    return res.json(sessions);
  }
}