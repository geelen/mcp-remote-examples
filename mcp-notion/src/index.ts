import OAuthProvider, { AuthRequest, OAuthHelpers } from './oauth/oauth-provider'
import { MCPEntrypoint } from './lib/MCPEntrypoint'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { Hono } from 'hono'
import pick from 'just-pick'

// Context from the auth process, encrypted & stored in the auth token
// and provided to the MCP Server as this.props
type Props = {
  userId: string
  userName: string
  workspaceId: string
  workspaceName: string
  access_token?: string  // Standard property name
  accessToken?: string   // Also support legacy property name
  scope: string
}

export class NotionMCP extends MCPEntrypoint<Props> {
  // Helper function for Notion API calls
  private async notionRequest(endpoint: string, method: string = 'GET', body: any = null) {
    try {
      // Get the access token from props - simplified from the previous complex approach
      const token = this.props.accessToken;
      
      if (!token) {
        throw new Error('Authentication required. Please authenticate with Notion.');
      }
      
      const url = endpoint.startsWith('https://') ? endpoint : `https://api.notion.com/v1/${endpoint}`
      
      const options: RequestInit = {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        }
      }
      
      if (body && (method === 'POST' || method === 'PATCH')) {
        options.body = JSON.stringify(body)
      }
      
      const response = await fetch(url, options);
      
      // Check for auth errors specifically
      if (response.status === 401 || response.status === 403) {
        const errorText = await response.text();
        throw new Error('Your Notion authentication has expired or is invalid. Please authenticate again.');
      }
      
      // Check for other HTTP errors
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Notion API returned ${response.status}: ${errorText}`);
      }
      
      // Parse the JSON response
      const jsonResponse = await response.json();
      return jsonResponse;
    } catch (error) {
      console.error(`Error in notionRequest(${endpoint}):`, error);
      throw error;
    }
  }
  
  // Helper to extract page title
  private getPageTitle(page: any): string {
    try {
      const title = page.properties?.title?.title?.[0]?.plain_text || 
                    page.properties?.Name?.title?.[0]?.plain_text ||
                    page.properties?.name?.title?.[0]?.plain_text || 
                    'Untitled'
      return title
    } catch (e) {
      return 'Untitled'
    }
  }
  
  // Helper to format simple text for Notion
  private formatNotionText(text: string) {
    return [{
      type: 'text',
      text: { content: text }
    }]
  }
  
  // Helper to convert Notion blocks to markdown
  private async blocksToMarkdown(blocks: any[]): Promise<string> {
    let markdown = '';
    
    for (const block of blocks) {
      switch (block.type) {
        case 'paragraph':
          const paragraphText = block.paragraph?.rich_text?.map((t: any) => t.plain_text).join('') || '';
          markdown += paragraphText + '\n\n';
          break;
        case 'heading_1':
          const h1Text = block.heading_1?.rich_text?.map((t: any) => t.plain_text).join('') || '';
          markdown += `# ${h1Text}\n\n`;
          break;
        case 'heading_2':
          const h2Text = block.heading_2?.rich_text?.map((t: any) => t.plain_text).join('') || '';
          markdown += `## ${h2Text}\n\n`;
          break;
        case 'heading_3':
          const h3Text = block.heading_3?.rich_text?.map((t: any) => t.plain_text).join('') || '';
          markdown += `### ${h3Text}\n\n`;
          break;
        case 'bulleted_list_item':
          const bulletText = block.bulleted_list_item?.rich_text?.map((t: any) => t.plain_text).join('') || '';
          markdown += `• ${bulletText}\n`;
          break;
        case 'numbered_list_item':
          const numberText = block.numbered_list_item?.rich_text?.map((t: any) => t.plain_text).join('') || '';
          markdown += `1. ${numberText}\n`;
          break;
        case 'to_do':
          const todoText = block.to_do?.rich_text?.map((t: any) => t.plain_text).join('') || '';
          const checkbox = block.to_do?.checked ? '[x]' : '[ ]';
          markdown += `${checkbox} ${todoText}\n`;
          break;
        case 'code':
          const codeText = block.code?.rich_text?.map((t: any) => t.plain_text).join('') || '';
          const language = block.code?.language || '';
          markdown += '```' + language + '\n' + codeText + '\n```\n\n';
          break;
        case 'quote':
          const quoteText = block.quote?.rich_text?.map((t: any) => t.plain_text).join('') || '';
          markdown += `> ${quoteText}\n\n`;
          break;
        case 'divider':
          markdown += '---\n\n';
          break;
        default:
          if (block.type && block[block.type]?.rich_text) {
            const fallbackText = block[block.type].rich_text.map((t: any) => t.plain_text).join('') || '';
            markdown += fallbackText + '\n\n';
          }
      }
    }
    
    return markdown;
  }
  
  // Helper to convert markdown to Notion blocks
  private markdownToBlocks(markdown: string): any[] {
    const blocks: any[] = [];
    const lines = markdown.split('\n');
    
    let currentIndex = 0;
    
    while (currentIndex < lines.length) {
      const line = lines[currentIndex].trim();
      
      if (line.startsWith('# ')) {
        // Heading 1
        blocks.push({
          object: 'block',
          type: 'heading_1',
          heading_1: {
            rich_text: [{
              type: 'text',
              text: { content: line.substring(2) }
            }]
          }
        });
      } else if (line.startsWith('## ')) {
        // Heading 2
        blocks.push({
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{
              type: 'text',
              text: { content: line.substring(3) }
            }]
          }
        });
      } else if (line.startsWith('### ')) {
        // Heading 3
        blocks.push({
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [{
              type: 'text',
              text: { content: line.substring(4) }
            }]
          }
        });
      } else if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('• ')) {
        // Bulleted list item
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{
              type: 'text',
              text: { content: line.substring(2) }
            }]
          }
        });
      } else if (line.match(/^\d+\.\s/)) {
        // Numbered list item
        const content = line.substring(line.indexOf('.') + 1).trim();
        blocks.push({
          object: 'block',
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: [{
              type: 'text',
              text: { content }
            }]
          }
        });
      } else if (line.startsWith('[ ] ') || line.startsWith('[x] ') || line.startsWith('[X] ')) {
        // To-do item
        const checked = line.startsWith('[x] ') || line.startsWith('[X] ');
        const content = line.substring(4);
        blocks.push({
          object: 'block',
          type: 'to_do',
          to_do: {
            rich_text: [{
              type: 'text',
              text: { content }
            }],
            checked
          }
        });
      } else if (line.startsWith('> ')) {
        // Quote
        blocks.push({
          object: 'block',
          type: 'quote',
          quote: {
            rich_text: [{
              type: 'text',
              text: { content: line.substring(2) }
            }]
          }
        });
      } else if (line === '---') {
        // Divider
        blocks.push({
          object: 'block',
          type: 'divider',
          divider: {}
        });
      } else if (line.startsWith('```')) {
        // Code block
        let language = line.substring(3).trim();
        let codeContent = '';
        let endIndex = currentIndex + 1;
        
        // Find the end of the code block
        while (endIndex < lines.length && !lines[endIndex].startsWith('```')) {
          codeContent += lines[endIndex] + '\n';
          endIndex++;
        }
        
        blocks.push({
          object: 'block',
          type: 'code',
          code: {
            rich_text: [{
              type: 'text',
              text: { content: codeContent }
            }],
            language: language || 'plain text'
          }
        });
        
        currentIndex = endIndex; // Skip to after the code block
      } else if (line.length > 0) {
        // Paragraph
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: line }
            }]
          }
        });
      }
      
      currentIndex++;
    }
    
    return blocks;
  }

  get server() {
    const server = new McpServer({
      name: 'Notion Assistant MCP',
      version: '1.0.0',
      capabilities: { tools: {} }  // Explicitly specify only tools capability
    })

    server.tool('myAccount', 'Get information about your Notion account', {}, async () => {
      const userInfo = {
        user: this.props.userName || 'Unknown',
        workspace: this.props.workspaceName || 'Unknown',
        permissions: this.props.scope ? this.props.scope.split(',').join(', ') : 'None'
      }
      
      return {
        content: [{ 
          type: 'text', 
          text: `# Your Notion Account\n\n**User:** ${userInfo.user}\n**Workspace:** ${userInfo.workspace}\n**Permissions:** ${userInfo.permissions}`
        }]
      }
    })

    server.tool('listPages', 'List your recent Notion pages', {
      limit: z.number().min(1).max(100).default(10).describe('Number of pages to retrieve')
    }, async ({ limit }) => {
      try {
        const search = await this.notionRequest('search', 'POST', {
          filter: { property: 'object', value: 'page' },
          sort: { direction: 'descending', timestamp: 'last_edited_time' },
          page_size: limit
        })
        
        if (!search.results || search.results.length === 0) {
          return {
            content: [{ type: 'text', text: "No pages found in your Notion workspace." }]
          }
        }
        
        const pages = search.results.map((page: any) => ({
          id: page.id,
          title: this.getPageTitle(page),
          url: page.url,
          lastEdited: new Date(page.last_edited_time).toLocaleString()
        }))
        
        let response = "# Your Recent Notion Pages\n\n"
        pages.forEach((page: any, index: number) => {
          response += `${index + 1}. **${page.title}**\n`
          response += `   ID: \`${page.id}\`\n`
          response += `   Last edited: ${page.lastEdited}\n`
          response += `   [Open in Notion](${page.url})\n\n`
        })
        
        return {
          content: [{ type: 'text', text: response }]
        }
      } catch (error) {
        console.error('Error in listPages tool:', error);
        return {
          content: [{ 
            type: 'text', 
            text: `Error listing pages: ${error.message || 'Unknown error'}\n\nThis may be due to:\n- The Notion integration not having access to pages\n- Authentication issues\n- API rate limits\n\nPlease make sure the integration is properly authorized with your Notion workspace.`
          }]
        };
      }
    })
    
    server.tool('listDatabases', 'List your Notion databases', {
      limit: z.number().min(1).max(100).default(10).describe('Number of databases to retrieve')
    }, async ({ limit }) => {
      const search = await this.notionRequest('search', 'POST', {
        filter: { property: 'object', value: 'database' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: limit
      })
      
      if (!search.results || search.results.length === 0) {
        return {
          content: [{ type: 'text', text: "No databases found in your Notion workspace." }]
        }
      }
      
      let response = "# Your Notion Databases\n\n"
      search.results.forEach((db: any, index: number) => {
        const title = db.title?.[0]?.plain_text || db.title?.[0]?.text?.content || 'Untitled Database'
        
        response += `${index + 1}. **${title}**\n`
        response += `   ID: \`${db.id}\`\n`
        response += `   [Open in Notion](${db.url})\n\n`
      })
      
      return {
        content: [{ type: 'text', text: response }]
      }
    })
    
    server.tool('getPage', 'Read the content of a Notion page', {
      pageId: z.string().describe('The Notion page ID')
    }, async ({ pageId }) => {
      // Get the page info
      const page = await this.notionRequest(`pages/${pageId}`)
      
      if (!page || page.object !== 'page') {
        return {
          content: [{ type: 'text', text: `Error: Could not find a page with ID ${pageId}` }]
        }
      }
      
      // Get the page content (blocks)
      const blocks = await this.notionRequest(`blocks/${pageId}/children`)
      
      if (!blocks || !blocks.results) {
        return {
          content: [{ type: 'text', text: `Error: Could not retrieve content for page ${pageId}` }]
        }
      }
      
      // Get the page title
      const title = this.getPageTitle(page)
      
      // Convert blocks to markdown
      const markdown = await this.blocksToMarkdown(blocks.results);
      
      return {
        content: [{ 
          type: 'text', 
          text: `# ${title}\n\n${markdown}`
        }]
      }
    })
    
    server.tool('search', 'Search your Notion workspace', {
      query: z.string().describe('Your search query')
    }, async ({ query }) => {
      const search = await this.notionRequest('search', 'POST', {
        query,
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 10
      })
      
      if (!search.results || search.results.length === 0) {
        return {
          content: [{ type: 'text', text: `No results found for "${query}"` }]
        }
      }
      
      let response = `# Search Results for "${query}"\n\n`;
      
      search.results.forEach((item: any, index: number) => {
        const objectType = item.object;
        let title = 'Untitled';
        
        if (objectType === 'page') {
          title = this.getPageTitle(item);
        } else if (objectType === 'database') {
          title = item.title?.[0]?.plain_text || 'Untitled Database';
        }
        
        response += `${index + 1}. **${title}** (${objectType})\n`;
        response += `   ID: \`${item.id}\`\n`;
        response += `   Last edited: ${new Date(item.last_edited_time).toLocaleString()}\n`;
        response += `   [Open in Notion](${item.url})\n\n`;
      });
      
      return {
        content: [{ type: 'text', text: response }]
      }
    })
    
    server.tool('queryDatabase', 'Query items from a Notion database', {
      databaseId: z.string().describe('The ID of the database to query'),
      limit: z.number().min(1).max(100).default(10).describe('Maximum number of results to return'),
      filter: z.string().optional().describe('Optional JSON filter string (see Notion API docs for format)'),
      sorts: z.string().optional().describe('Optional JSON sorts string (see Notion API docs for format)')
    }, async ({ databaseId, limit, filter, sorts }) => {
      // Prepare the query body
      const queryBody: any = {
        page_size: limit
      };
      
      // Add filter if provided
      if (filter) {
        try {
          queryBody.filter = JSON.parse(filter);
        } catch (e) {
          return {
            content: [{ type: 'text', text: `Error parsing filter JSON: ${e}` }]
          };
        }
      }
      
      // Add sorts if provided
      if (sorts) {
        try {
          queryBody.sorts = JSON.parse(sorts);
        } catch (e) {
          return {
            content: [{ type: 'text', text: `Error parsing sorts JSON: ${e}` }]
          };
        }
      }
      
      try {
        // Query the database
        const response = await this.notionRequest(`databases/${databaseId}/query`, 'POST', queryBody);
        
        if (!response.results || response.results.length === 0) {
          return {
            content: [{ type: 'text', text: `No results found in database ${databaseId}` }]
          };
        }
        
        // Get database info to understand property types
        const dbInfo = await this.notionRequest(`databases/${databaseId}`);
        const propertyTypes: Record<string, string> = {};
        
        if (dbInfo && dbInfo.properties) {
          Object.entries(dbInfo.properties).forEach(([name, prop]: [string, any]) => {
            propertyTypes[name] = prop.type;
          });
        }
        
        // Format results as a markdown table
        let markdown = `# Database Query Results\n\n`;
        
        // Extract property names from the first result
        const propertyNames = Object.keys(response.results[0].properties || {});
        
        // Create table header
        markdown += `| # | ${propertyNames.join(' | ')} |\n`;
        markdown += `| --- | ${propertyNames.map(() => '---').join(' | ')} |\n`;
        
        // Add each row
        response.results.forEach((item: any, index: number) => {
          const cells = propertyNames.map(propName => {
            const property = item.properties[propName];
            const type = propertyTypes[propName] || property.type;
            
            // Extract value based on property type
            switch (type) {
              case 'title':
                return property.title.map((t: any) => t.plain_text).join('') || '';
              case 'rich_text':
                return property.rich_text.map((t: any) => t.plain_text).join('') || '';
              case 'select':
                return property.select?.name || '';
              case 'multi_select':
                return property.multi_select?.map((s: any) => s.name).join(', ') || '';
              case 'date':
                return property.date?.start || '';
              case 'checkbox':
                return property.checkbox ? '✅' : '❌';
              case 'number':
                return property.number?.toString() || '';
              case 'email':
                return property.email || '';
              case 'phone_number':
                return property.phone_number || '';
              case 'url':
                return property.url || '';
              default:
                return '(unsupported type)';
            }
          });
          
          markdown += `| ${index + 1} | ${cells.join(' | ')} |\n`;
        });
        
        markdown += `\n**Total results:** ${response.results.length}\n`;
        markdown += `**Database ID:** \`${databaseId}\`\n`;
        
        return {
          content: [{ type: 'text', text: markdown }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error querying database: ${error}` }]
        };
      }
    })
    
    server.tool('createPage', 'Create a new Notion page', {
      parentId: z.string().describe('Parent page ID to create the page under'),
      title: z.string().describe('Title of the new page'),
      content: z.string().describe('Markdown content for the page')
    }, async ({ parentId, title, content }) => {
      try {
        // Convert simple markdown content to Notion blocks
        const blocks = this.markdownToBlocks(content);
        
        // Create the page
        const page = await this.notionRequest('pages', 'POST', {
          parent: { page_id: parentId },
          properties: {
            title: {
              title: [{ type: 'text', text: { content: title } }]
            }
          },
          children: blocks
        });
        
        if (!page || !page.id) {
          return {
            content: [{ type: 'text', text: 'Failed to create page. Please check the parent ID and try again.' }]
          };
        }
        
        return {
          content: [{ 
            type: 'text', 
            text: `# Page Created Successfully\n\n**Title:** ${title}\n**Page ID:** \`${page.id}\`\n**URL:** [Open in Notion](${page.url})`
          }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error creating page: ${error}` }]
        };
      }
    })
    
    server.tool('addDatabaseItem', 'Add a new item to a Notion database', {
      databaseId: z.string().describe('The ID of the database to add an item to'),
      properties: z.string().describe('JSON string of properties according to the database schema')
    }, async ({ databaseId, properties }) => {
      try {
        // Parse the properties
        let parsedProperties;
        try {
          parsedProperties = JSON.parse(properties);
        } catch (e) {
          return {
            content: [{ type: 'text', text: `Error parsing properties JSON: ${e}` }]
          };
        }
        
        // Get database info to validate property types
        const dbInfo = await this.notionRequest(`databases/${databaseId}`);
        if (!dbInfo || !dbInfo.properties) {
          return {
            content: [{ type: 'text', text: `Database with ID ${databaseId} not found or could not be accessed.` }]
          };
        }
        
        // Create the database item
        const newItem = await this.notionRequest('pages', 'POST', {
          parent: { database_id: databaseId },
          properties: parsedProperties
        });
        
        if (!newItem || !newItem.id) {
          return {
            content: [{ type: 'text', text: 'Failed to create database item. Please check the properties and try again.' }]
          };
        }
        
        // Get the title of the new item
        const title = this.getPageTitle(newItem);
        
        return {
          content: [{ 
            type: 'text', 
            text: `# Database Item Created Successfully\n\n**Title:** ${title}\n**Item ID:** \`${newItem.id}\`\n**Database ID:** \`${databaseId}\`\n**URL:** [Open in Notion](${newItem.url})`
          }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error adding database item: ${error}` }]
        };
      }
    })
    
    // Simple logging of initialization
    console.error('Notion Assistant MCP server initialized with 8 tools');
    return server
  }
}

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers }}>()

/**
 * OAuth Authorization Endpoint
 *
 * This route initiates the Notion OAuth flow when a user wants to log in.
 * It creates a random state parameter to prevent CSRF attacks and stores the
 * original OAuth request information in KV storage for later retrieval.
 * Then it redirects the user to Notion's authorization page with the appropriate
 * parameters so the user can authenticate and grant permissions.
 */
app.get('/authorize', async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw)
  // Store the request info in KV to catch ya up on the rebound
  const randomString = crypto.randomUUID()
  await c.env.OAUTH_KV.put(`login:${randomString}`, JSON.stringify(oauthReqInfo), { expirationTtl: 600 })

  const upstream = new URL(`https://api.notion.com/v1/oauth/authorize`)
  upstream.searchParams.set('client_id', c.env.NOTION_CLIENT_ID)
  upstream.searchParams.set('redirect_uri', 'https://<YOUR_WORKER_DOMAIN>/callback')
  upstream.searchParams.set('response_type', 'code')
  // Request specific Notion permissions
  upstream.searchParams.set('owner', 'user')
  upstream.searchParams.set('scope', 'read_content,update_content,create_content,read_blocks,update_blocks,read_databases,create_databases,update_databases')
  upstream.searchParams.set('state', randomString)

  return Response.redirect(upstream.href)
})

/**
 * OAuth Callback Endpoint
 *
 * This route handles the callback from Notion after user authentication.
 * It exchanges the temporary code for an access token, then stores user
 * metadata & the auth token as part of the 'props' on the token passed
 * down to the client. It ends by redirecting the client back to _its_ callback URL
 */
app.get('/callback', async (c) => {
  const code = c.req.query('code') as string

  // Get the oathReqInfo out of KV
  const randomString = c.req.query('state')
  if (!randomString) {
    return c.text('Missing state', 400)
  }
  const oauthReqInfo = await c.env.OAUTH_KV.get<AuthRequest>(`login:${randomString}`, { type: 'json' })
  if (!oauthReqInfo) {
    return c.text('Invalid state', 400)
  }

  // Exchange the code for an access token
  const resp = await fetch(`https://api.notion.com/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${btoa(`${c.env.NOTION_CLIENT_ID}:${c.env.NOTION_CLIENT_SECRET}`)}`
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://<YOUR_WORKER_DOMAIN>/callback'
    })
  })

  if (!resp.ok) {
    console.log(await resp.text())
    return c.text('Failed to fetch access token', 500)
  }

  const data = await resp.json()
  if (!data.access_token) {
    return c.text('Missing access token', 400)
  }

  const accessToken = data.access_token
  
  // Get user info from the Notion API response
  const userId = data.owner?.user?.id || 'unknown'
  const userName = data.owner?.user?.name || 'unknown'
  const workspaceId = data.workspace_id || 'unknown'
  const workspaceName = data.workspace_name || 'unknown'
  const scope = data.scope || ''
  
  // Store token in KV for future use
  await c.env.OAUTH_KV.put(`oauth:token:notion`, accessToken, { expirationTtl: 2592000 }); // 30 days

  // Return back to the MCP client a new token
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: userId,
    metadata: {
      label: userName,
    },
    scope: oauthReqInfo.scope.join(' '),
    // This will be available on this.props inside NotionMCP
    props: {
      userId,
      userName,
      workspaceId,
      workspaceName,
      accessToken,
      scope
    } as Props,
  })

  return Response.redirect(redirectTo)
})

// Simple index page to explain what this worker does
app.get('/', async (c) => {
  return c.html(`
    <html>
      <head>
        <title>Notion Assistant MCP</title>
        <style>
          body { font-family: system-ui, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
          code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
          pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow: auto; }
          ul li { margin-bottom: 8px; }
          .tool { font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>Notion Assistant MCP</h1>
        <p>This is a Model Context Protocol (MCP) server that provides access to your Notion data.</p>
        <p>To use this service, connect to: <code>${new URL('/sse', c.req.url).href}</code> in your MCP client.</p>
        
        <h2>Available Tools</h2>
        <ul>
          <li><span class="tool">myAccount</span> - Get information about your Notion account</li>
          <li><span class="tool">listPages</span> - List your recent Notion pages</li>
          <li><span class="tool">listDatabases</span> - List your Notion databases</li>
          <li><span class="tool">getPage</span> - Read the content of a Notion page</li>
          <li><span class="tool">search</span> - Search your Notion workspace</li>
          <li><span class="tool">queryDatabase</span> - Query items from a Notion database</li>
          <li><span class="tool">createPage</span> - Create a new Notion page</li>
          <li><span class="tool">addDatabaseItem</span> - Add a new item to a Notion database</li>
        </ul>
        
        <h2>Features</h2>
        <ul>
          <li>Create and update Notion pages</li>
          <li>Add items to databases</li>
          <li>Query database contents</li>
          <li>Read and search your Notion workspace</li>
          <li>Secured with OAuth authentication</li>
        </ul>
        
        <h2>Permissions</h2>
        <p>This integration requests the following permissions:</p>
        <ul>
          <li><code>read_content</code> - Read your Notion pages and databases</li>
          <li><code>update_content</code> - Update Notion pages</li>
          <li><code>create_content</code> - Create new Notion pages</li>
          <li><code>read_blocks</code> - Read content blocks within pages</li>
          <li><code>update_blocks</code> - Update content blocks</li>
          <li><code>read_databases</code> - Access database content</li>
          <li><code>create_databases</code> - Create new databases</li>
          <li><code>update_databases</code> - Update database content</li>
        </ul>
      </body>
    </html>
  `)
})

// Add CORS preflight handler for all routes
app.options('*', (c) => {
  const response = new Response(null, {
    status: 204, // No content for OPTIONS response
  });
  
  // Add CORS headers
  response.headers.set('Access-Control-Allow-Origin', c.req.headers.get('Origin') || '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Max-Age', '86400'); // 24 hours
  
  return response;
});

export default new OAuthProvider({
  apiRoute: '/sse',
  apiHandler: NotionMCP.Router,
  defaultHandler: app,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})