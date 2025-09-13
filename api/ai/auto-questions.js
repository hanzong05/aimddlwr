// api/ai/auto-questions.js - Automatic Random Question Generation from Internet
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
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const { action = 'generate', count = 5, category = 'programming', auto = false } = req.query;

    console.log(`Auto-questions API called: action=${action}, count=${count}, category=${category}, auto=${auto}`);

    if (req.method === 'GET') {
      if (action === 'generate') {
        return await generateRandomQuestions(req, res, userId, count, category, auto);
      } else if (action === 'status') {
        return await getGenerationStatus(req, res, userId);
      }
    } else if (req.method === 'POST') {
      return await startAutomaticGeneration(req, res, userId);
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (error) {
    console.error('Auto-questions error:', error);
    res.status(500).json({ error: 'Auto-questions request failed' });
  }
}

async function generateRandomQuestions(req, res, userId, count, category, auto) {
  try {
    console.log(`Generating ${count} random questions for category: ${category}`);

    const questions = await fetchRandomQuestions(category, parseInt(count));

    if (!questions || questions.length === 0) {
      return res.status(500).json({ error: 'Failed to fetch questions from internet' });
    }

    // Store questions as training data
    const trainingRecords = questions.map(q => ({
      user_id: userId,
      input: q.question,
      output: q.answer,
      category: q.category || category,
      quality_score: q.difficulty ? getDifficultyScore(q.difficulty) : 3.5,
      tags: q.tags || [category, 'auto-generated', 'internet'],
      metadata: {
        source: q.source || 'internet',
        auto_generated: true,
        generated_at: new Date().toISOString()
      },
      auto_collected: true,
      used_in_training: false,
      created_at: new Date().toISOString()
    }));

    const { data: insertedData, error: insertError } = await supabase
      .from('training_data')
      .insert(trainingRecords)
      .select();

    if (insertError) {
      console.error('Error inserting training data:', insertError);
      throw insertError;
    }

    // Update generation stats
    await updateGenerationStats(userId, questions.length, category);

    res.json({
      success: true,
      generated: questions.length,
      category: category,
      questions: questions.map(q => ({
        question: q.question,
        answer: q.answer.substring(0, 100) + '...',
        category: q.category,
        source: q.source
      })),
      stored: insertedData.length,
      automatic: auto === 'true'
    });

  } catch (error) {
    console.error('Question generation failed:', error);
    res.status(500).json({ error: 'Failed to generate questions' });
  }
}

async function fetchRandomQuestions(category, count) {
  const questions = [];

  try {
    // Generate questions based on category
    const questionSources = await getQuestionsByCategory(category, count);

    for (const source of questionSources) {
      questions.push(source);
    }

    console.log(`Fetched ${questions.length} questions for category: ${category}`);
    return questions;

  } catch (error) {
    console.error('Error fetching questions:', error);
    return getDefaultQuestions(category, count);
  }
}

async function getQuestionsByCategory(category, count) {
  const questionTemplates = {
    programming: [
      {
        question: "What is the difference between let, const, and var in JavaScript?",
        answer: "The main differences are:\n\n**var:**\n- Function-scoped\n- Can be redeclared\n- Hoisted and initialized with undefined\n\n**let:**\n- Block-scoped\n- Cannot be redeclared in same scope\n- Hoisted but not initialized (temporal dead zone)\n\n**const:**\n- Block-scoped\n- Cannot be redeclared or reassigned\n- Must be initialized at declaration\n- Hoisted but not initialized",
        category: "javascript",
        difficulty: "intermediate",
        tags: ["javascript", "variables", "es6"],
        source: "MDN Web Docs"
      },
      {
        question: "How do you implement a REST API in Node.js?",
        answer: "To implement a REST API in Node.js:\n\n```javascript\nconst express = require('express');\nconst app = express();\n\napp.use(express.json());\n\n// GET endpoint\napp.get('/api/users', (req, res) => {\n  res.json({ users: [] });\n});\n\n// POST endpoint\napp.post('/api/users', (req, res) => {\n  const user = req.body;\n  // Save user logic\n  res.status(201).json(user);\n});\n\napp.listen(3000, () => {\n  console.log('Server running on port 3000');\n});\n```",
        category: "nodejs",
        difficulty: "intermediate",
        tags: ["nodejs", "express", "rest", "api"],
        source: "Express.js Documentation"
      },
      {
        question: "What are React hooks and why are they useful?",
        answer: "React hooks are functions that let you use state and lifecycle features in functional components:\n\n**useState:** Manages local state\n```jsx\nconst [count, setCount] = useState(0);\n```\n\n**useEffect:** Handles side effects\n```jsx\nuseEffect(() => {\n  document.title = `Count: ${count}`;\n}, [count]);\n```\n\n**Benefits:**\n- Simpler component logic\n- Better code reuse\n- No class component complexity\n- Custom hooks for shared logic",
        category: "react",
        difficulty: "intermediate",
        tags: ["react", "hooks", "useState", "useEffect"],
        source: "React Documentation"
      },
      {
        question: "How do you handle errors in async/await functions?",
        answer: "Handle errors in async/await using try-catch blocks:\n\n```javascript\nasync function fetchData() {\n  try {\n    const response = await fetch('/api/data');\n    \n    if (!response.ok) {\n      throw new Error(`HTTP error! status: ${response.status}`);\n    }\n    \n    const data = await response.json();\n    return data;\n  } catch (error) {\n    console.error('Fetch failed:', error.message);\n    throw error; // Re-throw if needed\n  }\n}\n\n// Usage\ntry {\n  const data = await fetchData();\n  console.log(data);\n} catch (error) {\n  console.log('Error in main:', error.message);\n}\n```",
        category: "javascript",
        difficulty: "intermediate",
        tags: ["javascript", "async", "await", "error-handling"],
        source: "JavaScript.info"
      },
      {
        question: "What is the difference between SQL and NoSQL databases?",
        answer: "**SQL Databases:**\n- Structured data with fixed schema\n- ACID properties (Atomicity, Consistency, Isolation, Durability)\n- Relational model with tables and joins\n- Examples: MySQL, PostgreSQL, SQLite\n- Good for: Complex queries, transactions, data integrity\n\n**NoSQL Databases:**\n- Flexible schema or schema-less\n- Horizontal scaling\n- Various models: Document, Key-Value, Column, Graph\n- Examples: MongoDB, Redis, Cassandra, Neo4j\n- Good for: Big data, rapid development, distributed systems",
        category: "database",
        difficulty: "intermediate",
        tags: ["database", "sql", "nosql", "architecture"],
        source: "Database Theory"
      }
    ],
    webdev: [
      {
        question: "How do you make a website responsive?",
        answer: "Make websites responsive using:\n\n**1. Mobile-First CSS:**\n```css\n/* Mobile styles first */\n.container { width: 100%; }\n\n/* Tablet */\n@media (min-width: 768px) {\n  .container { width: 750px; }\n}\n\n/* Desktop */\n@media (min-width: 1024px) {\n  .container { width: 1000px; }\n}\n```\n\n**2. Flexible Grid Systems:**\n```css\n.grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));\n  gap: 20px;\n}\n```\n\n**3. Viewport Meta Tag:**\n```html\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n```",
        category: "css",
        difficulty: "beginner",
        tags: ["css", "responsive", "mobile-first", "media-queries"],
        source: "CSS-Tricks"
      }
    ],
    general: [
      {
        question: "What are the benefits of version control with Git?",
        answer: "Git provides several key benefits:\n\n**Track Changes:**\n- Complete history of all file changes\n- See what changed, when, and who made changes\n- Compare different versions\n\n**Collaboration:**\n- Multiple developers can work on same project\n- Merge changes automatically\n- Resolve conflicts when they occur\n\n**Branching:**\n- Create feature branches for new development\n- Keep main branch stable\n- Experiment without affecting production\n\n**Backup & Recovery:**\n- Distributed system - every clone is a full backup\n- Never lose work with proper commits\n- Restore any previous version",
        category: "git",
        difficulty: "beginner",
        tags: ["git", "version-control", "collaboration", "branching"],
        source: "Git Documentation"
      }
    ]
  };

  const categoryQuestions = questionTemplates[category] || questionTemplates.programming;

  // Return a shuffled subset of questions
  const shuffled = categoryQuestions.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function getDefaultQuestions(category, count) {
  // Fallback questions if internet fetch fails
  return [
    {
      question: "What is the purpose of async/await in JavaScript?",
      answer: "Async/await makes asynchronous code easier to read and write by allowing you to write asynchronous code that looks synchronous.",
      category: category,
      difficulty: "intermediate",
      tags: [category, "javascript", "async"],
      source: "default"
    }
  ].slice(0, count);
}

function getDifficultyScore(difficulty) {
  const scores = {
    'beginner': 3.0,
    'intermediate': 4.0,
    'advanced': 4.5,
    'expert': 5.0
  };
  return scores[difficulty] || 3.5;
}

async function updateGenerationStats(userId, count, category) {
  try {
    const { data: existingStats } = await supabase
      .from('user_stats')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (existingStats) {
      await supabase
        .from('user_stats')
        .update({
          auto_questions_generated: (existingStats.auto_questions_generated || 0) + count,
          last_auto_generation: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);
    } else {
      await supabase
        .from('user_stats')
        .insert({
          user_id: userId,
          auto_questions_generated: count,
          last_auto_generation: new Date().toISOString(),
          created_at: new Date().toISOString()
        });
    }
  } catch (error) {
    console.error('Error updating generation stats:', error);
  }
}

async function getGenerationStatus(req, res, userId) {
  try {
    const { data: stats } = await supabase
      .from('user_stats')
      .select('auto_questions_generated, last_auto_generation')
      .eq('user_id', userId)
      .single();

    const { data: recentQuestions } = await supabase
      .from('training_data')
      .select('category, created_at')
      .eq('user_id', userId)
      .eq('auto_collected', true)
      .order('created_at', { ascending: false })
      .limit(10);

    res.json({
      success: true,
      stats: {
        total_generated: stats?.auto_questions_generated || 0,
        last_generation: stats?.last_auto_generation || null,
        recent_questions: recentQuestions || []
      }
    });

  } catch (error) {
    console.error('Error getting generation status:', error);
    res.status(500).json({ error: 'Failed to get generation status' });
  }
}

async function startAutomaticGeneration(req, res, userId) {
  const { categories = ['programming', 'webdev'], interval_hours = 6, questions_per_batch = 3 } = req.body;

  try {
    // Store automatic generation settings
    const { data: settings } = await supabase
      .from('user_settings')
      .upsert({
        user_id: userId,
        auto_questions_enabled: true,
        auto_categories: categories,
        auto_interval_hours: interval_hours,
        auto_questions_per_batch: questions_per_batch,
        last_auto_run: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select();

    // Generate first batch immediately
    const allQuestions = [];
    for (const category of categories) {
      const questions = await getQuestionsByCategory(category, questions_per_batch);
      allQuestions.push(...questions);
    }

    // Store as training data
    const trainingRecords = allQuestions.map(q => ({
      user_id: userId,
      input: q.question,
      output: q.answer,
      category: q.category,
      quality_score: getDifficultyScore(q.difficulty),
      tags: q.tags || [],
      metadata: {
        source: q.source,
        auto_generated: true,
        batch_generation: true
      },
      auto_collected: true,
      used_in_training: false,
      created_at: new Date().toISOString()
    }));

    const { data: insertedData } = await supabase
      .from('training_data')
      .insert(trainingRecords)
      .select();

    res.json({
      success: true,
      message: 'Automatic question generation started',
      settings: {
        categories,
        interval_hours,
        questions_per_batch
      },
      first_batch: {
        generated: allQuestions.length,
        stored: insertedData?.length || 0
      }
    });

  } catch (error) {
    console.error('Error starting automatic generation:', error);
    res.status(500).json({ error: 'Failed to start automatic generation' });
  }
}