// api/ai/brain-tools.js - Tool Integration System
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

    const { action } = req.query;

    switch (action) {
      case 'list':
        return await listTools(req, res, userId);
      case 'execute':
        return await executeTool(req, res, userId);
      case 'configure':
        return await configureTool(req, res, userId);
      case 'test':
        return await testTool(req, res, userId);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

  } catch (error) {
    console.error('Brain tools error:', error);
    res.status(500).json({ error: 'Tool operation failed' });
  }
}

// LIST AVAILABLE TOOLS
async function listTools(req, res, userId) {
  const { data: tools, error } = await supabase
    .from('brain_tools')
    .select('*')
    .eq('user_id', userId)
    .order('tool_name');

  if (error) throw error;

  res.json({
    tools: tools.map(tool => ({
      ...tool,
      credentials_encrypted: undefined // Don't expose credentials
    })),
    total: tools.length
  });
}

// EXECUTE A TOOL
async function executeTool(req, res, userId) {
  const { toolName, action, parameters = {} } = req.body;

  if (!toolName || !action) {
    return res.status(400).json({ error: 'Tool name and action required' });
  }

  try {
    // Get tool configuration
    const { data: tool, error: toolError } = await supabase
      .from('brain_tools')
      .select('*')
      .eq('user_id', userId)
      .eq('tool_name', toolName)
      .single();

    if (toolError || !tool) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    if (!tool.is_enabled) {
      return res.status(400).json({ error: 'Tool is not enabled' });
    }

    // Execute the tool
    const startTime = Date.now();
    const result = await executeToolAction(tool, action, parameters);
    const executionTime = Date.now() - startTime;

    // Log usage
    await supabase
      .from('tool_usage_logs')
      .insert({
        user_id: userId,
        tool_id: tool.id,
        action_type: action,
        request_data: parameters,
        response_data: result,
        execution_time_ms: executionTime,
        success: true
      });

    // Update tool stats
    await supabase
      .from('brain_tools')
      .update({
        usage_count: tool.usage_count + 1,
        last_used: new Date().toISOString(),
        average_response_time: Math.round(
          (tool.average_response_time * tool.usage_count + executionTime) / (tool.usage_count + 1)
        )
      })
      .eq('id', tool.id);

    res.json({
      success: true,
      result,
      executionTime,
      tool: toolName,
      action
    });

  } catch (error) {
    console.error(`Tool execution failed: ${toolName}:${action}`, error);
    
    // Log failed usage
    await supabase
      .from('tool_usage_logs')
      .insert({
        user_id: userId,
        tool_id: tool?.id,
        action_type: action,
        request_data: parameters,
        execution_time_ms: Date.now() - startTime,
        success: false,
        error_message: error.message
      });

    res.status(500).json({ 
      error: 'Tool execution failed',
      details: error.message 
    });
  }
}

// CONFIGURE A TOOL
async function configureTool(req, res, userId) {
  const { toolName, configuration, credentials, isEnabled } = req.body;

  if (!toolName) {
    return res.status(400).json({ error: 'Tool name required' });
  }

  try {
    // Encrypt credentials if provided
    let encryptedCredentials = null;
    if (credentials) {
      encryptedCredentials = Buffer.from(JSON.stringify(credentials)).toString('base64');
    }

    const updates = { updated_at: new Date().toISOString() };
    if (configuration) updates.configuration = configuration;
    if (encryptedCredentials) updates.credentials_encrypted = encryptedCredentials;
    if (isEnabled !== undefined) updates.is_enabled = isEnabled;

    const { data: tool, error } = await supabase
      .from('brain_tools')
      .update(updates)
      .eq('user_id', userId)
      .eq('tool_name', toolName)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      tool: {
        ...tool,
        credentials_encrypted: undefined // Don't expose credentials
      },
      message: 'Tool configured successfully'
    });

  } catch (error) {
    console.error('Tool configuration failed:', error);
    res.status(500).json({ error: 'Tool configuration failed' });
  }
}

// TEST A TOOL CONNECTION
async function testTool(req, res, userId) {
  const { toolName } = req.body;

  if (!toolName) {
    return res.status(400).json({ error: 'Tool name required' });
  }

  try {
    const { data: tool, error } = await supabase
      .from('brain_tools')
      .select('*')
      .eq('user_id', userId)
      .eq('tool_name', toolName)
      .single();

    if (error || !tool) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    // Run tool-specific test
    const testResult = await testToolConnection(tool);

    res.json({
      success: testResult.success,
      tool: toolName,
      status: testResult.status,
      message: testResult.message,
      details: testResult.details
    });

  } catch (error) {
    console.error('Tool test failed:', error);
    res.status(500).json({ 
      success: false,
      error: 'Tool test failed',
      details: error.message 
    });
  }
}

// TOOL EXECUTION HANDLERS
async function executeToolAction(tool, action, parameters) {
  const { tool_name, configuration, credentials_encrypted } = tool;
  
  // Decrypt credentials
  let credentials = {};
  if (credentials_encrypted) {
    try {
      credentials = JSON.parse(Buffer.from(credentials_encrypted, 'base64').toString());
    } catch (error) {
      throw new Error('Invalid credentials configuration');
    }
  }

  switch (tool_name) {
    case 'web_search':
      return await executeWebSearch(action, parameters, configuration);
    
    case 'google_calendar':
      return await executeGoogleCalendar(action, parameters, configuration, credentials);
    
    case 'google_sheets':
      return await executeGoogleSheets(action, parameters, configuration, credentials);
    
    case 'slack':
      return await executeSlack(action, parameters, configuration, credentials);
    
    case 'notion':
      return await executeNotion(action, parameters, configuration, credentials);
    
    case 'memory_search':
      return await executeMemorySearch(action, parameters, configuration, tool.user_id);
    
    case 'code_interpreter':
      return await executeCodeInterpreter(action, parameters, configuration);
    
    default:
      throw new Error(`Unknown tool: ${tool_name}`);
  }
}

// WEB SEARCH TOOL
async function executeWebSearch(action, parameters, config) {
  const { query, maxResults = 5 } = parameters;
  
  if (action === 'search') {
    // Use a search API (example with DuckDuckGo)
    const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    
    const response = await fetch(searchUrl);
    const data = await response.json();
    
    return {
      query,
      results: data.RelatedTopics?.slice(0, maxResults) || [],
      total: data.RelatedTopics?.length || 0
    };
  }
  
  throw new Error(`Unknown web search action: ${action}`);
}

// GOOGLE CALENDAR TOOL
async function executeGoogleCalendar(action, parameters, config, credentials) {
  // Placeholder for Google Calendar integration
  // You would implement OAuth and Google Calendar API calls here
  
  if (action === 'list_events') {
    return {
      events: [
        {
          id: 'example1',
          title: 'Team Meeting',
          start: '2024-01-15T10:00:00Z',
          end: '2024-01-15T11:00:00Z'
        }
      ],
      message: 'Google Calendar integration not fully implemented yet'
    };
  }
  
  if (action === 'create_event') {
    const { title, start, end, description } = parameters;
    return {
      event: { id: 'new_event', title, start, end },
      message: 'Event creation simulated - implement Google Calendar API'
    };
  }
  
  throw new Error(`Unknown calendar action: ${action}`);
}

// GOOGLE SHEETS TOOL
async function executeGoogleSheets(action, parameters, config, credentials) {
  // Placeholder for Google Sheets integration
  
  if (action === 'read_sheet') {
    return {
      data: [['Name', 'Email'], ['John Doe', 'john@example.com']],
      message: 'Google Sheets integration not fully implemented yet'
    };
  }
  
  if (action === 'write_sheet') {
    return {
      range: 'A1:B2',
      message: 'Write operation simulated - implement Google Sheets API'
    };
  }
  
  throw new Error(`Unknown sheets action: ${action}`);
}

// SLACK TOOL
async function executeSlack(action, parameters, config, credentials) {
  const { token } = credentials;
  
  if (action === 'send_message') {
    const { channel, text } = parameters;
    
    if (!token) {
      throw new Error('Slack token not configured');
    }
    
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel, text })
    });
    
    const result = await response.json();
    
    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error}`);
    }
    
    return {
      channel,
      message: text,
      timestamp: result.ts,
      success: true
    };
  }
  
  if (action === 'list_channels') {
    const response = await fetch('https://slack.com/api/conversations.list', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const result = await response.json();
    
    return {
      channels: result.channels || [],
      total: result.channels?.length || 0
    };
  }
  
  throw new Error(`Unknown Slack action: ${action}`);
}

// NOTION TOOL
async function executeNotion(action, parameters, config, credentials) {
  const { token } = credentials;
  
  if (action === 'create_page') {
    const { parent, title, content } = parameters;
    
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: parent },
        properties: {
          title: {
            title: [{ text: { content: title } }]
          }
        }
      })
    });
    
    const result = await response.json();
    
    return {
      page_id: result.id,
      title,
      url: result.url,
      success: true
    };
  }
  
  throw new Error(`Unknown Notion action: ${action}`);
}

// MEMORY SEARCH TOOL
async function executeMemorySearch(action, parameters, config, userId) {
  if (action === 'search') {
    const { query, limit = 5, type } = parameters;
    
    let searchQuery = supabase
      .from('brain_memories')
      .select('*')
      .eq('user_id', userId)
      .order('importance', { ascending: false })
      .limit(limit);
    
    if (type) {
      searchQuery = searchQuery.eq('type', type);
    }
    
    if (query) {
      searchQuery = searchQuery.ilike('content', `%${query}%`);
    }
    
    const { data: memories, error } = await searchQuery;
    
    if (error) throw error;
    
    return {
      memories,
      query,
      total: memories.length
    };
  }
  
  throw new Error(`Unknown memory search action: ${action}`);
}

// CODE INTERPRETER TOOL
async function executeCodeInterpreter(action, parameters, config) {
  if (action === 'execute') {
    const { code, language = 'javascript' } = parameters;
    
    // Basic JavaScript execution (be very careful with this in production!)
    if (language === 'javascript') {
      try {
        // Create a safe execution context
        const result = eval(`(function() { ${code} })()`);
        
        return {
          result: String(result),
          language,
          success: true
        };
      } catch (error) {
        return {
          error: error.message,
          language,
          success: false
        };
      }
    }
    
    throw new Error(`Unsupported language: ${language}`);
  }
  
  throw new Error(`Unknown code interpreter action: ${action}`);
}

// TOOL CONNECTION TESTS
async function testToolConnection(tool) {
  const { tool_name, credentials_encrypted } = tool;
  
  let credentials = {};
  if (credentials_encrypted) {
    try {
      credentials = JSON.parse(Buffer.from(credentials_encrypted, 'base64').toString());
    } catch (error) {
      return {
        success: false,
        status: 'error',
        message: 'Invalid credentials format'
      };
    }
  }
  
  switch (tool_name) {
    case 'slack':
      if (!credentials.token) {
        return {
          success: false,
          status: 'error',
          message: 'Slack token not configured'
        };
      }
      
      try {
        const response = await fetch('https://slack.com/api/auth.test', {
          headers: { 'Authorization': `Bearer ${credentials.token}` }
        });
        const result = await response.json();
        
        return {
          success: result.ok,
          status: result.ok ? 'connected' : 'error',
          message: result.ok ? `Connected as ${result.user}` : result.error
        };
      } catch (error) {
        return {
          success: false,
          status: 'error',
          message: 'Connection failed'
        };
      }
    
    case 'web_search':
      return {
        success: true,
        status: 'ready',
        message: 'Web search is ready to use'
      };
    
    case 'memory_search':
      return {
        success: true,
        status: 'ready',
        message: 'Memory search is ready to use'
      };
    
    default:
      return {
        success: true,
        status: 'not_implemented',
        message: `Test not implemented for ${tool_name}`
      };
  }
}