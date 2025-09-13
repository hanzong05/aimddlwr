// api/ai/auto-scheduler.js - Automatic Question Generation Scheduler
import { createClient } from '@supabase/supabase-js';

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
    console.log('Auto-scheduler triggered');

    // Get all users with auto-generation enabled from user_preferences
    const { data: users, error: usersError } = await supabase
      .from('user_preferences')
      .select('user_id, auto_categories, auto_interval_hours, auto_questions_per_batch, last_auto_run')
      .eq('auto_questions_enabled', true);

    if (usersError) {
      console.error('Error fetching users:', usersError);
      throw usersError;
    }

    if (!users || users.length === 0) {
      return res.json({
        success: true,
        message: 'No users with auto-generation enabled',
        processed: 0
      });
    }

    const results = [];
    const now = new Date();

    for (const user of users) {
      try {
        const lastRun = user.last_auto_run ? new Date(user.last_auto_run) : null;
        const hoursSinceLastRun = lastRun ? (now - lastRun) / (1000 * 60 * 60) : 999;

        // Check if it's time to generate questions for this user
        if (hoursSinceLastRun >= (user.auto_interval_hours || 6)) {
          console.log(`Generating questions for user ${user.user_id}`);

          const generated = await generateQuestionsForUser(
            user.user_id,
            user.auto_categories || ['programming'],
            user.auto_questions_per_batch || 3
          );

          // Update last run time
          await supabase
            .from('user_preferences')
            .update({ last_auto_run: now.toISOString() })
            .eq('user_id', user.user_id);

          results.push({
            user_id: user.user_id,
            generated: generated,
            status: 'success'
          });

        } else {
          const hoursRemaining = (user.auto_interval_hours || 6) - hoursSinceLastRun;
          results.push({
            user_id: user.user_id,
            generated: 0,
            status: 'skipped',
            reason: `Next run in ${hoursRemaining.toFixed(1)} hours`
          });
        }

      } catch (userError) {
        console.error(`Error processing user ${user.user_id}:`, userError);
        results.push({
          user_id: user.user_id,
          generated: 0,
          status: 'error',
          error: userError.message
        });
      }
    }

    res.json({
      success: true,
      processed: users.length,
      results: results,
      timestamp: now.toISOString()
    });

  } catch (error) {
    console.error('Auto-scheduler error:', error);
    res.status(500).json({ error: 'Auto-scheduler failed' });
  }
}

async function generateQuestionsForUser(userId, categories, questionsPerBatch) {
  let totalGenerated = 0;

  try {
    for (const category of categories) {
      const questions = await getRandomQuestionsByCategory(category, questionsPerBatch);

      if (questions && questions.length > 0) {
        // Store as training data
        const trainingRecords = questions.map(q => ({
          user_id: userId,
          input: q.question,
          output: q.answer,
          category: q.category || category,
          quality_score: getDifficultyScore(q.difficulty),
          tags: q.tags || [category, 'auto-generated'],
          metadata: {
            source: q.source || 'auto-scheduler',
            auto_generated: true,
            scheduled_generation: true,
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
          console.error(`Error inserting training data for user ${userId}:`, insertError);
        } else {
          totalGenerated += insertedData.length;
          console.log(`Generated ${insertedData.length} questions for user ${userId}, category ${category}`);
        }
      }
    }

    // Update user stats
    await updateUserStats(userId, totalGenerated);

  } catch (error) {
    console.error(`Error generating questions for user ${userId}:`, error);
  }

  return totalGenerated;
}

async function getRandomQuestionsByCategory(category, count) {
  // Extended question pools for different categories
  const questionPools = {
    programming: [
      {
        question: "What is the difference between == and === in JavaScript?",
        answer: "The == operator performs type coercion before comparison, while === performs strict equality comparison without type conversion.\n\nExamples:\n```javascript\n5 == '5'   // true (coerces string to number)\n5 === '5'  // false (different types)\n\nnull == undefined   // true\nnull === undefined  // false\n\n0 == false   // true\n0 === false  // false\n```\n\nAlways use === for predictable comparisons.",
        category: "javascript",
        difficulty: "beginner",
        tags: ["javascript", "operators", "comparison"],
        source: "JavaScript Fundamentals"
      },
      {
        question: "How do you center a div both horizontally and vertically in CSS?",
        answer: "Several methods to center a div:\n\n**1. Flexbox (Recommended):**\n```css\n.container {\n  display: flex;\n  justify-content: center;\n  align-items: center;\n  height: 100vh;\n}\n```\n\n**2. Grid:**\n```css\n.container {\n  display: grid;\n  place-items: center;\n  height: 100vh;\n}\n```\n\n**3. Absolute positioning:**\n```css\n.centered {\n  position: absolute;\n  top: 50%;\n  left: 50%;\n  transform: translate(-50%, -50%);\n}\n```",
        category: "css",
        difficulty: "intermediate",
        tags: ["css", "centering", "flexbox", "grid"],
        source: "CSS Layout Techniques"
      },
      {
        question: "What is a closure in JavaScript?",
        answer: "A closure is a function that has access to variables in its outer (enclosing) scope even after the outer function has returned.\n\n```javascript\nfunction outerFunction(x) {\n  // Outer variable\n  const outerVar = x;\n  \n  // Inner function (closure)\n  function innerFunction(y) {\n    // Access to outerVar from outer scope\n    return outerVar + y;\n  }\n  \n  return innerFunction;\n}\n\nconst addFive = outerFunction(5);\nconsole.log(addFive(3)); // 8\n```\n\n**Use cases:**\n- Data privacy\n- Module patterns\n- Event handlers\n- Callbacks",
        category: "javascript",
        difficulty: "intermediate",
        tags: ["javascript", "closures", "scope", "functions"],
        source: "JavaScript Advanced Concepts"
      },
      {
        question: "How do you handle authentication in a React app?",
        answer: "Common authentication patterns in React:\n\n**1. Context + Local Storage:**\n```jsx\nconst AuthContext = createContext();\n\nfunction AuthProvider({ children }) {\n  const [user, setUser] = useState(null);\n  const [loading, setLoading] = useState(true);\n  \n  useEffect(() => {\n    const token = localStorage.getItem('token');\n    if (token) {\n      // Verify token and set user\n      verifyToken(token).then(setUser);\n    }\n    setLoading(false);\n  }, []);\n  \n  const login = async (credentials) => {\n    const { user, token } = await authenticate(credentials);\n    localStorage.setItem('token', token);\n    setUser(user);\n  };\n  \n  return (\n    <AuthContext.Provider value={{ user, login, loading }}>\n      {children}\n    </AuthContext.Provider>\n  );\n}\n```\n\n**2. Protected Routes:**\n```jsx\nfunction ProtectedRoute({ children }) {\n  const { user, loading } = useAuth();\n  \n  if (loading) return <div>Loading...</div>;\n  if (!user) return <Navigate to=\"/login\" />;\n  \n  return children;\n}\n```",
        category: "react",
        difficulty: "advanced",
        tags: ["react", "authentication", "context", "routing"],
        source: "React Authentication Patterns"
      }
    ],
    webdev: [
      {
        question: "What are the main HTTP status codes and their meanings?",
        answer: "Common HTTP status codes:\n\n**2xx Success:**\n- 200 OK - Request successful\n- 201 Created - Resource created\n- 204 No Content - Successful, no response body\n\n**3xx Redirection:**\n- 301 Moved Permanently - Resource moved\n- 302 Found - Temporary redirect\n- 304 Not Modified - Use cached version\n\n**4xx Client Error:**\n- 400 Bad Request - Invalid request\n- 401 Unauthorized - Authentication required\n- 403 Forbidden - Access denied\n- 404 Not Found - Resource not found\n- 429 Too Many Requests - Rate limited\n\n**5xx Server Error:**\n- 500 Internal Server Error - Server fault\n- 502 Bad Gateway - Invalid response from upstream\n- 503 Service Unavailable - Server overloaded",
        category: "http",
        difficulty: "intermediate",
        tags: ["http", "status-codes", "web-development"],
        source: "HTTP Protocol Reference"
      },
      {
        question: "How do you optimize website performance?",
        answer: "Website performance optimization strategies:\n\n**1. Image Optimization:**\n- Use WebP format\n- Compress images\n- Lazy loading\n- Responsive images\n\n**2. Code Optimization:**\n- Minify CSS/JavaScript\n- Remove unused code\n- Bundle optimization\n- Tree shaking\n\n**3. Caching:**\n- Browser caching\n- CDN usage\n- Service workers\n- Database query caching\n\n**4. Loading Strategies:**\n- Critical CSS inline\n- Async/defer scripts\n- Preload important resources\n- Code splitting\n\n**5. Server Optimization:**\n- Gzip compression\n- HTTP/2\n- Reduce server response time\n- Optimize database queries",
        category: "performance",
        difficulty: "advanced",
        tags: ["performance", "optimization", "web-development"],
        source: "Web Performance Best Practices"
      }
    ],
    database: [
      {
        question: "What is database normalization and why is it important?",
        answer: "Database normalization is the process of organizing data to reduce redundancy and improve data integrity.\n\n**Normal Forms:**\n\n**1NF (First Normal Form):**\n- Atomic values only\n- No repeating groups\n- Each row is unique\n\n**2NF (Second Normal Form):**\n- Must be in 1NF\n- No partial dependencies\n- Non-key attributes depend on entire primary key\n\n**3NF (Third Normal Form):**\n- Must be in 2NF\n- No transitive dependencies\n- Non-key attributes depend only on primary key\n\n**Benefits:**\n- Eliminates data redundancy\n- Prevents update anomalies\n- Saves storage space\n- Maintains data consistency\n- Easier maintenance",
        category: "database",
        difficulty: "intermediate",
        tags: ["database", "normalization", "design"],
        source: "Database Design Principles"
      }
    ],
    general: [
      {
        question: "What is the difference between Agile and Waterfall methodologies?",
        answer: "Comparison of Agile vs Waterfall:\n\n**Waterfall:**\n- Sequential phases\n- Detailed upfront planning\n- Fixed requirements\n- Documentation-heavy\n- Testing at the end\n- Good for: Well-defined projects, regulatory requirements\n\n**Agile:**\n- Iterative development\n- Adaptive planning\n- Flexible requirements\n- Working software focus\n- Continuous testing\n- Good for: Evolving requirements, rapid delivery\n\n**Key Differences:**\n- Flexibility: Agile is more adaptable\n- Customer involvement: Agile has continuous feedback\n- Risk management: Agile identifies issues early\n- Delivery: Agile delivers working software incrementally",
        category: "methodology",
        difficulty: "intermediate",
        tags: ["agile", "waterfall", "project-management"],
        source: "Software Development Methodologies"
      }
    ]
  };

  const categoryQuestions = questionPools[category] || questionPools.programming;

  // Shuffle and return requested count
  const shuffled = [...categoryQuestions].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function getDifficultyScore(difficulty) {
  const scores = {
    'beginner': 3.2,
    'intermediate': 4.0,
    'advanced': 4.5,
    'expert': 4.8
  };
  return scores[difficulty] || 3.5;
}

async function updateUserStats(userId, questionsGenerated) {
  try {
    // Update user_preferences with generation stats
    await supabase
      .from('user_preferences')
      .upsert({
        user_id: userId,
        auto_questions_generated: questionsGenerated,
        last_auto_generation: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    // Also update user_activity_summary if it exists
    try {
      await supabase
        .from('user_activity_summary')
        .upsert({
          user_id: userId,
          updated_at: new Date().toISOString()
        });
    } catch (activityError) {
      console.log('Activity summary update failed:', activityError.message);
    }

  } catch (error) {
    console.error('Error updating user stats:', error);
  }
}