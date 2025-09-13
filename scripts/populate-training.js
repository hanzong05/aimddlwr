// Quick script to populate training data for your AI
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function populateTrainingData() {
  // Your user ID from the users table
  const userId = '040427c4-c759-47b6-935c-a5be720531ce';
  
  const trainingData = [
    // Java Programming
    {
      user_id: userId,
      input: "teach me java basics",
      output: "Java is an object-oriented programming language. Here are the basics:\n\n**Basic Structure:**\n```java\npublic class HelloWorld {\n    public static void main(String[] args) {\n        System.out.println(\"Hello, World!\");\n    }\n}\n```\n\n**Variables:**\n```java\nint age = 25;\nString name = \"John\";\nboolean isStudent = true;\ndouble price = 19.99;\n```\n\n**Classes and Objects:**\n```java\npublic class Person {\n    private String name;\n    private int age;\n    \n    public Person(String name, int age) {\n        this.name = name;\n        this.age = age;\n    }\n    \n    public void introduce() {\n        System.out.println(\"Hi, I'm \" + name);\n    }\n}\n```",
      category: "java",
      quality_score: 4.8
    },
    {
      user_id: userId,
      input: "java loops and conditionals",
      output: "Java control structures:\n\n**If-Else:**\n```java\nif (age >= 18) {\n    System.out.println(\"Adult\");\n} else {\n    System.out.println(\"Minor\");\n}\n```\n\n**For Loop:**\n```java\nfor (int i = 0; i < 5; i++) {\n    System.out.println(i);\n}\n```\n\n**While Loop:**\n```java\nint count = 0;\nwhile (count < 3) {\n    System.out.println(count);\n    count++;\n}\n```\n\n**Enhanced For Loop:**\n```java\nint[] numbers = {1, 2, 3, 4, 5};\nfor (int num : numbers) {\n    System.out.println(num);\n}\n```",
      category: "java",
      quality_score: 4.5,
    },
    
    // GitHub Search
    {
      user_id: userId,
      input: "how to search github effectively",
      output: "GitHub search tips and tricks:\n\n**Basic Search:**\n- Search repositories: `machine learning`\n- Search code: `function calculateTotal`\n- Search issues: `bug authentication`\n\n**Advanced Filters:**\n```\nuser:microsoft language:typescript stars:>1000\nlanguage:python topic:machine-learning created:>2023-01-01\nfilename:package.json react\npath:src/ extension:js\n```\n\n**GitHub CLI:**\n```bash\ngh repo search \"vue components\" --language=vue\ngh issue search \"authentication bug\" --state=open\n```\n\n**Search Operators:**\n- `OR`: `cats OR dogs`\n- `NOT`: `cats NOT dogs`\n- `\"exact phrase\"`\n- `repo:owner/name`\n- `size:>1000`",
      category: "github",
      quality_score: 4.7,
    },
    
    // Programming General
    {
      user_id: userId,
      input: "hello",
      output: "Hello! I'm your AI programming assistant. I can help you with:\n\n- **Java**: Classes, objects, loops, data structures\n- **JavaScript**: Functions, async/await, DOM manipulation\n- **React**: Components, hooks, state management\n- **GitHub**: Repository search, Git commands\n- **Node.js**: Server setup, APIs, database connections\n- **General Programming**: Algorithms, debugging, best practices\n\nWhat would you like to learn about today?",
      category: "conversation",
      quality_score: 4.0,
    },
    
    // JavaScript/React
    {
      user_id: userId,
      input: "react hooks tutorial",
      output: "React Hooks fundamentals:\n\n**useState - State Management:**\n```jsx\nimport React, { useState } from 'react';\n\nfunction Counter() {\n  const [count, setCount] = useState(0);\n  \n  return (\n    <div>\n      <p>Count: {count}</p>\n      <button onClick={() => setCount(count + 1)}>\n        Increment\n      </button>\n    </div>\n  );\n}\n```\n\n**useEffect - Side Effects:**\n```jsx\nimport { useEffect } from 'react';\n\nfunction UserProfile({ userId }) {\n  const [user, setUser] = useState(null);\n  \n  useEffect(() => {\n    fetchUser(userId).then(setUser);\n  }, [userId]); // Dependency array\n  \n  return <div>{user?.name}</div>;\n}\n```\n\n**Custom Hooks:**\n```jsx\nfunction useCounter(initialValue = 0) {\n  const [count, setCount] = useState(initialValue);\n  \n  const increment = () => setCount(count + 1);\n  const decrement = () => setCount(count - 1);\n  \n  return { count, increment, decrement };\n}\n```",
      category: "react",
      quality_score: 4.6,
    }
  ];

  try {
    console.log('Inserting training data...');
    
    const { data, error } = await supabase
      .from('training_data')
      .insert(trainingData)
      .select();

    if (error) {
      console.error('Error inserting training data:', error);
      return;
    }

    console.log(`✅ Successfully inserted ${data.length} training records`);
    console.log('Your AI now has knowledge about:');
    console.log('- Java programming basics');
    console.log('- GitHub search techniques');
    console.log('- React hooks and components');
    console.log('- General programming conversations');
    
  } catch (error) {
    console.error('Script error:', error);
  }
}

// Run the script
populateTrainingData().then(() => {
  console.log('Training data population complete!');
  process.exit(0);
}).catch(error => {
  console.error('Failed to populate training data:', error);
  process.exit(1);
});